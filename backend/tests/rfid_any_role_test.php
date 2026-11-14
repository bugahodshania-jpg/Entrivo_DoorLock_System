<?php

require_once dirname(__DIR__) . '/services/CombinedDoorAccessService.php';

function expectAnyRole(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = entrivo_pdo();
// Connection-local shadow tables: real accounts, cards, schedules and logs are never touched.
$pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY,device_type VARCHAR(20),status VARCHAR(20)) ENGINE=InnoDB');
$pdo->exec('CREATE TEMPORARY TABLE users (id INT PRIMARY KEY,username VARCHAR(50),role VARCHAR(20),is_active INT,approval_status VARCHAR(20),must_change_password INT,onboarding_step VARCHAR(20)) ENGINE=InnoDB');
$pdo->exec('CREATE TEMPORARY TABLE rfid_cards (card_id INT PRIMARY KEY,user_id INT,rfid_uid VARCHAR(30),status VARCHAR(20)) ENGINE=InnoDB');
$pdo->exec("CREATE TEMPORARY TABLE schedules (
    schedule_id INT PRIMARY KEY, user_id INT, schedule_type VARCHAR(20), schedule_kind VARCHAR(20),
    schedule_date DATE NULL, time_start TIME, time_end TIME, start_date DATE NULL, end_date DATE NULL,
    repeat_type VARCHAR(30), repeat_day VARCHAR(15) NULL, repeat_days TEXT NULL,
    grace_period_minutes INT DEFAULT 15, status VARCHAR(20), overridden_by_schedule_id INT NULL
) ENGINE=InnoDB");
$pdo->exec('CREATE TEMPORARY TABLE access_overrides (override_id INT PRIMARY KEY, user_id INT, approved_by INT NULL, override_start DATETIME, override_end DATETIME) ENGINE=InnoDB');
$pdo->exec("CREATE TEMPORARY TABLE access_log (
    log_id INT PRIMARY KEY AUTO_INCREMENT,user_id INT NULL,card_id INT NULL,rfid_uid VARCHAR(10) NULL,fingerprint_id INT NULL,
    schedule_id INT NULL,override_id INT NULL,access_timestamp DATETIME,
    access_status ENUM('granted','denied'),
    denial_reason ENUM('not_registered','invalid_rfid','invalid_fingerprint','no_schedule','expired_schedule','schedule_not_started','unauthorized','offline') NULL,
    method_access ENUM('RFID','Fingerprint','Override'),access_type ENUM('IN','OUT') NOT NULL DEFAULT 'IN'
) ENGINE=InnoDB");

$pdo->exec("INSERT INTO fingerprint_devices VALUES (1,'enrollment','active')");
$roles = ['student' => 1, 'faculty' => 2, 'staff' => 3, 'admin' => 4, 'super_admin' => 5];
foreach ($roles as $role => $id) {
    $pdo->prepare("INSERT INTO users VALUES (?,?,?,1,'approved',0,'done')")->execute([$id, "user$id", $role]);
    $pdo->prepare("INSERT INTO rfid_cards VALUES (?,?,?,'active')")->execute([$id, $id, sprintf('AA000000%02d', $id)]);
    $pdo->prepare("INSERT INTO schedules (schedule_id,user_id,schedule_type,schedule_kind,schedule_date,time_start,time_end,repeat_type,status)
        VALUES (?,?,'single','regular','2026-11-09','08:00:00','10:00:00','none','approved')")->execute([$id, $id]);
}

$service = new CombinedDoorAccessService($pdo);
$inSchedule = new DateTimeImmutable('2026-11-09 09:00:00', new DateTimeZone('Asia/Manila'));
$afterSchedule = new DateTimeImmutable('2026-11-09 11:00:00', new DateTimeZone('Asia/Manila'));
$card = static fn (int $id, string $direction) => ['method' => 'rfid', 'enrollment_device_id' => 1,
    'rfid_uid' => sprintf('AA000000%02d', $id), 'direction' => $direction];

$at = static fn (string $time) => new DateTimeImmutable("2026-11-09 $time", new DateTimeZone('Asia/Manila'));
$student = $roles['student'];
$faculty = $roles['faculty'];
$lastLog = static fn () => $pdo->query('SELECT * FROM access_log ORDER BY log_id DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);

// Students: a registered card and a REGULAR schedule never open the room.
$regular = $service->verify($card($student, 'entry'), $at('08:30:00'));
expectAnyRole($regular['access_granted'] === false && $regular['reason'] === 'no_schedule',
    'A student card must not open the door on a regular schedule. Got ' . json_encode($regular));
expectAnyRole($lastLog()['access_status'] === 'denied' && $lastLog()['denial_reason'] === 'no_schedule', 'The refused student entry must be logged.');
// A faculty member inside does not let a student in either (no "joining" without an override).
expectAnyRole($service->verify($card($faculty, 'entry'), $at('08:40:00'))['access_granted'] === true, 'Faculty entry during schedule.');
expectAnyRole($service->verify($card($student, 'entry'), $at('08:45:00'))['access_granted'] === false,
    'A student without an approved override must be refused even while a faculty member is inside.');
// Students can always exit, schedule or not.
expectAnyRole($service->verify($card($student, 'exit'), $at('08:31:00'))['access_granted'] === true, 'A student can always exit.');
expectAnyRole($service->verify($card($student, 'exit'), $at('23:00:00'))['access_granted'] === true, 'A student can exit after every schedule ended.');

// An approved override lets the student in, only inside its window.
$pdo->exec("INSERT INTO schedules (schedule_id,user_id,schedule_type,schedule_kind,schedule_date,time_start,time_end,repeat_type,status)
    VALUES (50,$student,'single','override','2026-11-09','13:00:00','14:00:00','none','approved')");
$pdo->exec("INSERT INTO access_overrides VALUES (50,$student,99,'2026-11-09 13:00:00','2026-11-09 14:00:00')");
$early = $service->verify($card($student, 'entry'), $at('12:30:00'));
expectAnyRole($early['access_granted'] === false && $early['reason'] === 'schedule_not_started', 'Before the override window a student is refused. Got ' . json_encode($early));
$alone = $service->verify($card($student, 'entry'), $at('13:30:00'));
expectAnyRole($alone['access_granted'] === true && $alone['schedule_kind'] === 'override' && (int) $alone['override_id'] === 50,
    'An approved override must let a student enter. Got ' . json_encode($alone));
$after = $service->verify($card($student, 'entry'), $at('14:30:00'));
expectAnyRole($after['access_granted'] === false && $after['reason'] === 'expired_schedule', 'After the override window a student is refused. Got ' . json_encode($after));
// An override schedule whose request was never approved does not count.
$pdo->exec("INSERT INTO schedules (schedule_id,user_id,schedule_type,schedule_kind,schedule_date,time_start,time_end,repeat_type,status)
    VALUES (51,$student,'single','override','2026-11-09','15:00:00','16:00:00','none','approved')");
$pdo->exec("INSERT INTO access_overrides VALUES (51,$student,NULL,'2026-11-09 15:00:00','2026-11-09 16:00:00')");
expectAnyRole($service->verify($card($student, 'entry'), $at('15:30:00'))['access_granted'] === false,
    'An override without an approval must not let a student in.');

// Faculty and staff: regular schedule (or approved override) only.
$pdo->exec('DELETE FROM access_log');
foreach (['faculty', 'staff'] as $role) {
    $id = $roles[$role];
    $entry = $service->verify($card($id, 'entry'), $inSchedule);
    expectAnyRole($entry['access_granted'] === true && $entry['schedule_kind'] === 'regular', "A $role card must open the door during the user's approved schedule. Got " . json_encode($entry));
    $late = $service->verify($card($id, 'entry'), $afterSchedule);
    expectAnyRole($late['access_granted'] === false && $late['reason'] === 'expired_schedule',
        "A $role card must be refused entry after the schedule ends. Got " . json_encode($late));
    $exit = $service->verify($card($id, 'exit'), $afterSchedule);
    expectAnyRole($exit['access_granted'] === true, "A $role card must always be able to exit. Got " . json_encode($exit));
}
$pdo->exec("INSERT INTO schedules (schedule_id,user_id,schedule_type,schedule_kind,schedule_date,time_start,time_end,repeat_type,status)
    VALUES (60,$faculty,'single','override','2026-11-09','18:00:00','19:00:00','none','approved')");
$pdo->exec("INSERT INTO access_overrides VALUES (60,$faculty,99,'2026-11-09 18:00:00','2026-11-09 19:00:00')");
expectAnyRole($service->verify($card($faculty, 'entry'), $at('18:30:00'))['schedule_kind'] === 'override', 'An approved override must let faculty in outside the regular schedule.');

// Admin and super admin: permanent override, no schedule needed.
foreach (['admin', 'super_admin'] as $role) {
    $id = $roles[$role];
    $scheduled = $service->verify($card($id, 'entry'), $inSchedule);
    expectAnyRole($scheduled['access_granted'] === true && $scheduled['schedule_kind'] === 'regular' && (int) $scheduled['schedule_id'] === $id,
        "A $role entry during a schedule is linked to it. Got " . json_encode($scheduled));
    $anytime = $service->verify($card($id, 'entry'), $afterSchedule);
    expectAnyRole($anytime['access_granted'] === true && $anytime['schedule_kind'] === 'permanent_override' && $anytime['schedule_id'] === null,
        "A $role card must open the door without a schedule (permanent override). Got " . json_encode($anytime));
    expectAnyRole($lastLog()['access_status'] === 'granted' && $lastLog()['access_type'] === 'IN', "The $role permanent override entry must be logged.");
    $exit = $service->verify($card($id, 'exit'), $afterSchedule);
    expectAnyRole($exit['access_granted'] === true, "A $role card must always be able to exit. Got " . json_encode($exit));
}

// Inactive accounts never get in, whatever the role.
foreach ($roles as $role => $id) {
    $pdo->prepare('UPDATE users SET is_active=0 WHERE id=?')->execute([$id]);
    $inactive = $service->verify($card($id, 'entry'), $at('13:30:00'));
    expectAnyRole($inactive['access_granted'] === false && $inactive['reason'] === 'account_inactive', "An inactive $role must be refused. Got " . json_encode($inactive));
    $pdo->prepare('UPDATE users SET is_active=1 WHERE id=?')->execute([$id]);
}

// Emergency access card (DOOR_EMERGENCY_RFID_UIDS): permanent override for entry, whatever the role.
$previousEmergency = getenv('DOOR_EMERGENCY_RFID_UIDS');
try {
    putenv('DOOR_EMERGENCY_RFID_UIDS= bogus, aa00000001 ');
    expectAnyRole(CombinedDoorAccessService::emergencyCardUids() === ['AA00000001'], 'Emergency card UIDs are normalized and invalid entries dropped.');
    $emergency = $service->verify($card($student, 'entry'), $at('21:00:00'));
    expectAnyRole($emergency['access_granted'] === true && $emergency['schedule_kind'] === 'permanent_override',
        'An emergency card must open the door without a schedule or override. Got ' . json_encode($emergency));
    expectAnyRole($lastLog()['access_status'] === 'granted' && $lastLog()['access_type'] === 'IN', 'The emergency card entry must be logged IN.');
    expectAnyRole($service->verify($card($student, 'exit'), $at('21:05:00'))['access_granted'] === true, 'An emergency card can exit.');
    expectAnyRole($service->verify($card($faculty, 'entry'), $at('21:00:00'))['access_granted'] === false, 'Other cards are not affected.');
    $pdo->prepare('UPDATE users SET is_active=0 WHERE id=?')->execute([$student]);
    expectAnyRole($service->verify($card($student, 'entry'), $at('21:10:00'))['reason'] === 'account_inactive', 'An emergency card on an inactive account is refused.');
    $pdo->prepare('UPDATE users SET is_active=1 WHERE id=?')->execute([$student]);

    // A standalone emergency card (not registered to any account) still works, logged by UID only.
    putenv('DOOR_EMERGENCY_RFID_UIDS=AA00000001,BB000000EE');
    $loose = static fn (string $direction) => ['method' => 'rfid', 'enrollment_device_id' => 1, 'rfid_uid' => 'BB000000EE', 'direction' => $direction];
    $looseEntry = $service->verify($loose('entry'), $at('22:00:00'));
    expectAnyRole($looseEntry['access_granted'] === true && $looseEntry['schedule_kind'] === 'permanent_override',
        'An unregistered emergency card must open the door. Got ' . json_encode($looseEntry));
    expectAnyRole($lastLog()['user_id'] === null && $lastLog()['rfid_uid'] === 'BB000000EE' && $lastLog()['access_status'] === 'granted',
        'An unregistered emergency card entry is logged by UID with no user.');
    expectAnyRole($service->verify($loose('exit'), $at('22:05:00'))['access_granted'] === true, 'An unregistered emergency card can exit.');
    $unknown = $service->verify(['method' => 'rfid', 'enrollment_device_id' => 1, 'rfid_uid' => 'CC000000FF', 'direction' => 'entry'], $at('22:10:00'));
    expectAnyRole($unknown['reason'] === 'not_registered', 'Other unregistered cards are still refused.');
    putenv('DOOR_EMERGENCY_RFID_UIDS');
    expectAnyRole($service->verify($card($student, 'entry'), $at('21:15:00'))['access_granted'] === false, 'Without the setting the card follows the student rule again.');
} finally {
    putenv($previousEmergency === false ? 'DOOR_EMERGENCY_RFID_UIDS' : 'DOOR_EMERGENCY_RFID_UIDS=' . $previousEmergency);
}

// The exit reader lets ANY card out online (as offline), and every exit is saved as a granted OUT with the card UID.
$exitScan = static fn (string $uid) => ['method' => 'rfid', 'enrollment_device_id' => 1, 'rfid_uid' => $uid, 'direction' => 'exit'];
$expectExitLogged = static function (string $uid, ?int $userId, ?int $cardId, string $label) use ($service, $exitScan, $lastLog, $at): void {
    $before = $lastLog()['log_id'] ?? 0;
    $result = $service->verify($exitScan($uid), $at('23:00:00'));
    expectAnyRole($result['access_granted'] === true, "$label must be let out. Got " . json_encode($result));
    $log = $lastLog();
    expectAnyRole((int) $log['log_id'] > (int) $before, "$label exit must be saved to the access log.");
    expectAnyRole($log['access_status'] === 'granted' && $log['access_type'] === 'OUT' && $log['denial_reason'] === null
        && $log['method_access'] === 'RFID' && $log['rfid_uid'] === $uid,
        "$label exit must be logged as a granted RFID OUT with its UID. Got " . json_encode($log));
    expectAnyRole(($log['user_id'] === null ? null : (int) $log['user_id']) === $userId
        && ($log['card_id'] === null ? null : (int) $log['card_id']) === $cardId,
        "$label exit must be logged to the right user and card. Got " . json_encode($log));
};
$expectExitLogged('DD000000AA', null, null, 'An unregistered card');
$pdo->exec("INSERT INTO rfid_cards VALUES (20,NULL,'DD000000BB','active')");
$expectExitLogged('DD000000BB', null, 20, 'A card linked to no account');
$pdo->exec("INSERT INTO rfid_cards VALUES (21,1,'DD000000CC','active'),(22,2,'DD000000CC','active')");
$expectExitLogged('DD000000CC', null, null, 'A card UID with conflicting registrations');
$pdo->prepare("UPDATE rfid_cards SET status='lost' WHERE card_id=?")->execute([$faculty]);
$expectExitLogged(sprintf('AA000000%02d', $faculty), $faculty, $faculty, 'A lost card');
$pdo->prepare("UPDATE rfid_cards SET status='active' WHERE card_id=?")->execute([$faculty]);
$pdo->prepare('UPDATE users SET is_active=0 WHERE id=?')->execute([$student]);
$expectExitLogged(sprintf('AA000000%02d', $student), $student, $student, 'A card of an inactive account');
$pdo->prepare("UPDATE users SET is_active=1, approval_status='pending' WHERE id=?")->execute([$student]);
$expectExitLogged(sprintf('AA000000%02d', $student), $student, $student, 'A card of an unapproved account');
$pdo->prepare("UPDATE users SET approval_status='approved', onboarding_step='security' WHERE id=?")->execute([$student]);
$expectExitLogged(sprintf('AA000000%02d', $student), $student, $student, 'A card of an account still finishing setup');
$pdo->prepare("UPDATE users SET onboarding_step='done' WHERE id=?")->execute([$student]);
// Entry is unchanged: the same cards are still refused at the entrance.
expectAnyRole($service->verify(['method' => 'rfid', 'enrollment_device_id' => 1, 'rfid_uid' => 'DD000000AA', 'direction' => 'entry'], $at('23:10:00'))['reason'] === 'not_registered',
    'An unregistered card is still refused at the entrance.');
expectAnyRole($lastLog()['access_status'] === 'denied' && $lastLog()['access_type'] === 'IN', 'The refused entry is logged as a denied IN.');

echo "PASS: RFID entry by role (faculty/staff: regular or approved override; students: approved override only, never a regular schedule or a faculty member inside; admin/super admin: permanent override without a schedule), emergency access cards (permanent override on entry), inactive accounts refused, exit always allowed for any card (unregistered, unlinked, conflicting, lost, inactive or incomplete account) and saved to the access log.
";
