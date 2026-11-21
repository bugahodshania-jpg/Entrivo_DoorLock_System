<?php

// Staff room hours: only staff a Super Admin allowed enter without a schedule,
// only inside the room hours; a schedule still comes first; changes need a
// Super Admin and their password, and are logged.
require_once dirname(__DIR__) . '/services/DoorControlService.php';
require_once dirname(__DIR__) . '/services/ScheduleAccessPolicy.php';
require_once dirname(__DIR__) . '/services/DoorAccessCacheService.php';

function expectRoom(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function expectRoomError(callable $call, int $status, string $message): void
{
    try {
        $call();
    } catch (DoorStatusException $error) {
        expectRoom($error->httpStatus === $status, $message . ' (HTTP ' . $error->httpStatus . ': ' . $error->getMessage() . ')');
        return;
    }
    throw new RuntimeException($message . ' (no error)');
}

$pdo = entrivo_pdo();
$tables = ['users', 'staff_room_access', 'door_controller_controls', 'schedules', 'access_overrides', 'activity_logs',
    'activity_transactions', 'rfid_cards', 'fingerprints', 'door_emergency_cards', 'admin_info', 'faculty_info', 'staff_info'];
try {
    // Connection-local shadow tables: real accounts, schedules and door rows are never touched.
    $pdo->exec("CREATE TEMPORARY TABLE users (id INT PRIMARY KEY, username VARCHAR(60), role VARCHAR(20), is_active INT, password_hash VARCHAR(255),
        approval_status VARCHAR(20) DEFAULT 'approved', must_change_password INT DEFAULT 0, onboarding_step VARCHAR(20) DEFAULT 'done') ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE staff_room_access (user_id INT NOT NULL PRIMARY KEY, granted_by INT NULL, granted_at DATETIME NOT NULL) ENGINE=InnoDB');
    $pdo->exec("CREATE TEMPORARY TABLE door_controller_controls (
        device_id INT NOT NULL PRIMARY KEY, schedule_mode VARCHAR(10) NOT NULL DEFAULT 'auto', command VARCHAR(10) NULL,
        command_id INT NOT NULL DEFAULT 0, command_by INT NULL, command_at DATETIME NULL, command_done_id INT NOT NULL DEFAULT 0,
        command_done_at DATETIME NULL, mode_updated_by INT NULL, mode_updated_at DATETIME NULL,
        room_hours_start TIME NULL, room_hours_end TIME NULL) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE schedules (
        schedule_id INT PRIMARY KEY, user_id INT, schedule_type VARCHAR(20), schedule_kind VARCHAR(20),
        schedule_date DATE NULL, time_start TIME, time_end TIME, start_date DATE NULL, end_date DATE NULL,
        repeat_type VARCHAR(30), repeat_day VARCHAR(15) NULL, repeat_days TEXT NULL,
        grace_period_minutes INT DEFAULT 15, status VARCHAR(20), overridden_by_schedule_id INT NULL) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE access_overrides (override_id INT PRIMARY KEY, user_id INT, approved_by INT NULL, override_start DATETIME, override_end DATETIME) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE activity_logs (id INT PRIMARY KEY AUTO_INCREMENT) ENGINE=InnoDB');
    $pdo->exec("CREATE TEMPORARY TABLE activity_transactions (transaction_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        actor_user_id INT UNSIGNED NULL, target_user_id INT UNSIGNED NULL, activity_type VARCHAR(32) NOT NULL, entity_type VARCHAR(64) NULL,
        entity_id VARCHAR(64) NULL, description VARCHAR(512) NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'Success',
        ip_address VARCHAR(45) NULL, user_agent VARCHAR(512) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE rfid_cards (card_id INT PRIMARY KEY, user_id INT NULL, rfid_uid VARCHAR(30), status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE fingerprints (fingerprint_id INT PRIMARY KEY, user_id INT, finger_name VARCHAR(50), enrollment_device_id INT, enrollment_slot INT) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE door_emergency_cards (rfid_uid VARCHAR(10) NOT NULL PRIMARY KEY, card_name VARCHAR(60) NOT NULL, device_id INT NULL, reported_at DATETIME NOT NULL) ENGINE=InnoDB');

    foreach (['admin_info', 'faculty_info', 'staff_info'] as $info) {
        $pdo->exec("CREATE TEMPORARY TABLE {$info} (user_id INT PRIMARY KEY, first_name VARCHAR(60), last_name VARCHAR(60)) ENGINE=InnoDB");
    }
    $pdo->exec("INSERT INTO staff_info VALUES (4, 'Rosa', 'Keeper')");
    $hash = password_hash('secret-pass', PASSWORD_DEFAULT);
    $users = $pdo->prepare('INSERT INTO users (id, username, role, is_active, password_hash) VALUES (?, ?, ?, 1, ?)');
    foreach ([[1, 'super.admin', 'super_admin'], [2, 'an.admin', 'admin'], [3, 'a.faculty', 'faculty'],
        [4, 'room.keeper', 'staff'], [5, 'office.staff', 'staff']] as [$id, $name, $role]) {
        $users->execute([$id, $name, $role, $hash]);
    }
    // The room keeper also has a regular schedule on Thursday 08:00-10:00.
    $pdo->exec("INSERT INTO schedules (schedule_id,user_id,schedule_type,schedule_kind,schedule_date,time_start,time_end,repeat_type,status)
        VALUES (30,4,'single','regular','2026-11-12','08:00:00','10:00:00','none','approved')");

    $zone = new DateTimeZone('Asia/Manila');
    $at = static fn (string $time) => new DateTimeImmutable('2026-11-12 ' . $time, $zone);
    $policy = new ScheduleAccessPolicy($pdo);
    $entry = static fn (int $userId, string $role, string $time) => $policy->evaluateEntry($userId, $role, $at($time), 1);
    $service = new DoorControlService($pdo);

    // Nobody has room hours until a Super Admin allows them (least privilege).
    expectRoom($entry(4, 'staff', '07:00')['granted'] === false && $entry(4, 'staff', '07:00')['reason'] === 'schedule_not_started'
        && $entry(4, 'staff', '12:00')['granted'] === false, 'A staff member who was not allowed still needs a schedule.');

    // Only a Super Admin, with the right password, for staff accounts only.
    $allow = ['actor_id' => 1, 'password' => 'secret-pass', 'action' => 'staff_room_access', 'user_id' => 4, 'allowed' => true];
    expectRoomError(fn () => $service->setStaffRoomAccess([...$allow, 'actor_id' => 2]), 403, 'An admin cannot change staff room access.');
    expectRoomError(fn () => $service->setStaffRoomAccess([...$allow, 'password' => 'wrong']), 422, 'A wrong password is refused.');
    expectRoomError(fn () => $service->setStaffRoomAccess([...$allow, 'user_id' => 3]), 422, 'Faculty cannot be given room hours.');
    expectRoomError(fn () => $service->setStaffRoomAccess([...$allow, 'allowed' => 'yes']), 422, 'allowed must be true or false.');
    $result = $service->setStaffRoomAccess($allow);
    expectRoom($result['allowed_user_ids'] === [4] && $result['hours']['label'] === '6:00 AM – 9:00 PM',
        'The room keeper is allowed, with the default hours. Got ' . json_encode($result));

    // Inside the room hours: granted, ending at 21:00 (for the 15-minute reminder).
    $morning = $entry(4, 'staff', '06:00');
    expectRoom($morning['granted'] && $morning['schedule_kind'] === 'room_hours' && $morning['time_end'] === '21:00:00'
        && $morning['schedule_id'] === null, '06:00 opens on room hours. Got ' . json_encode($morning));
    expectRoom($entry(4, 'staff', '20:59')['granted'], '20:59 is still inside the room hours.');
    // A running schedule still comes first (it is linked in the logs).
    $scheduled = $entry(4, 'staff', '09:00');
    expectRoom($scheduled['granted'] && $scheduled['schedule_kind'] === 'regular' && $scheduled['schedule_id'] === 30,
        'A running schedule is used before the room hours. Got ' . json_encode($scheduled));
    // Outside the room hours: refused, with the right reason for the voice prompt.
    expectRoom(!$entry(4, 'staff', '05:59')['granted'] && $entry(4, 'staff', '05:59')['reason'] === 'schedule_not_started', 'Before 06:00: not started.');
    expectRoom(!$entry(4, 'staff', '21:00')['granted'] && $entry(4, 'staff', '21:00')['reason'] === 'expired_schedule', '21:00: room hours ended.');
    // Other staff are unaffected, and the allow list never applies to other roles.
    expectRoom(!$entry(5, 'staff', '12:00')['granted'], 'Another staff member still needs a schedule.');
    $pdo->exec('INSERT INTO staff_room_access VALUES (3, 1, NOW())');
    expectRoom(!$entry(3, 'faculty', '12:00')['granted'], 'Room hours never apply to faculty, even if listed.');
    $pdo->exec('DELETE FROM staff_room_access WHERE user_id = 3');

    // The hours can be changed by a Super Admin only, and must make sense.
    $hours = ['actor_id' => 1, 'password' => 'secret-pass', 'action' => 'room_hours', 'start' => '07:30', 'end' => '19:00'];
    expectRoomError(fn () => $service->setRoomHours([...$hours, 'actor_id' => 2]), 403, 'An admin cannot change the room hours.');
    expectRoomError(fn () => $service->setRoomHours([...$hours, 'end' => '07:00']), 422, 'The end must be after the start.');
    expectRoomError(fn () => $service->setRoomHours([...$hours, 'start' => '7am']), 422, 'Times must be HH:MM.');
    $changed = $service->setRoomHours($hours);
    expectRoom($changed['hours'] === ['start' => '07:30', 'end' => '19:00', 'label' => '7:30 AM – 7:00 PM'], 'Hours saved. Got ' . json_encode($changed['hours']));
    expectRoom(!$entry(4, 'staff', '07:00')['granted'] && $entry(4, 'staff', '18:00')['time_end'] === '19:00:00', 'New hours apply at once.');

    // Admins can view it; only a Super Admin can edit; faculty cannot view.
    expectRoom($service->roomAccess(['actor_id' => 2])['can_edit'] === false && $service->roomAccess(['actor_id' => 1])['can_edit'] === true, 'View and edit rights.');
    expectRoomError(fn () => $service->roomAccess(['actor_id' => 3]), 403, 'Faculty cannot view staff room access.');

    // Removing access: a schedule is needed again. Every change is in the door control logs.
    $service->setStaffRoomAccess([...$allow, 'allowed' => false]);
    expectRoom(!$entry(4, 'staff', '12:00')['granted'], 'After removal the room keeper needs a schedule again.');
    $logs = $pdo->query("SELECT description, status FROM activity_transactions WHERE entity_type = 'door' ORDER BY transaction_id")->fetchAll(PDO::FETCH_ASSOC);
    $descriptions = array_column($logs, 'description');
    expectRoom(in_array('Allowed Rosa Keeper to enter during the staff room hours.', $descriptions, true)
        && in_array('Set the staff room hours to 7:30 AM – 7:00 PM.', $descriptions, true)
        && in_array('Removed Rosa Keeper from the staff room hours.', $descriptions, true)
        && in_array('Refused an attempt to change staff room access: incorrect security password.', $descriptions, true),
        'Changes and refused attempts are logged. Got ' . json_encode($descriptions));

    // The door's offline copy gives an allowed staff member the room hours of each day.
    $service->setStaffRoomAccess($allow);
    $pdo->exec("INSERT INTO rfid_cards VALUES (1, 4, 'AD00000004', 'active'), (2, 5, 'AE00000005', 'active')");
    putenv('DOOR_EMERGENCY_RFID_UIDS');
    $copy = (new DoorAccessCacheService($pdo, static fn () => null))->build(1, $at('07:00'));
    $payload = substr($copy['bytes'], 40);
    $person = static fn (int $index) => unpack('Vuser/Crole/Cflags/vfirst/vcount', substr($payload, $index * 12, 12));
    [$keeper, $office] = [$person(0), $person(1)];
    $windowsBase = ($copy['people'] + $copy['credentials']) * 12;
    $window = static fn (int $index) => unpack('Vstart/Vend/Ckind', substr($payload, $windowsBase + $index * 12, 9));
    $first = $window($keeper['first']);
    $roomStart = $window($keeper['first'] + 1);
    expectRoom($keeper['user'] === 4 && $keeper['count'] === 1 + 8 && $office['user'] === 5 && $office['count'] === 0,
        'The room keeper has the schedule plus 8 days of room hours; other staff have none. Got ' . json_encode([$keeper, $office]));
    expectRoom($first['start'] === $at('08:00')->getTimestamp() && $roomStart['start'] === $at('07:30')->getTimestamp()
        && $roomStart['end'] === $at('19:00')->getTimestamp() && $roomStart['kind'] === 1,
        'Schedules come first, then the room hours (07:30-19:00) as regular windows.');

    echo "PASS: staff room hours apply only to staff a Super Admin allowed, only inside the hours (a schedule still comes first), "
        . "are changed only by a Super Admin with their password, are logged, and reach the door's offline copy.\n";
} finally {
    foreach ($tables as $table) $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
}
