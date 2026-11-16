<?php

require_once dirname(__DIR__) . '/services/DoorControlService.php';
require_once dirname(__DIR__) . '/services/ScheduleAccessPolicy.php';

function expectDoorControl(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function expectDoorControlError(callable $call, int $status, string $message): void
{
    try {
        $call();
    } catch (DoorStatusException $error) {
        expectDoorControl($error->httpStatus === $status, $message . ' (HTTP ' . $error->httpStatus . ': ' . $error->getMessage() . ')');
        return;
    }
    throw new RuntimeException($message . ' (no error)');
}

$pdo = entrivo_pdo();
$tables = ['users', 'fingerprint_devices', 'door_controller_status', 'door_controller_controls', 'schedules', 'access_overrides', 'activity_logs'];
try {
    // Connection-local shadow tables: real accounts and door rows are never touched.
    $pdo->exec('CREATE TEMPORARY TABLE users (id INT PRIMARY KEY, role VARCHAR(20), is_active INT, password_hash VARCHAR(255)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY, device_name VARCHAR(50), device_type VARCHAR(20), status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE door_controller_status (device_id INT PRIMARY KEY, door_state VARCHAR(10), boot_id CHAR(32), report_sequence INT, received_at DATETIME(6), wifi_rssi SMALLINT NULL) ENGINE=InnoDB');
    $pdo->exec("CREATE TEMPORARY TABLE door_controller_controls (
        device_id INT NOT NULL PRIMARY KEY, schedule_mode VARCHAR(10) NOT NULL DEFAULT 'auto', command VARCHAR(10) NULL,
        command_id INT NOT NULL DEFAULT 0, command_by INT NULL, command_at DATETIME NULL, command_done_id INT NOT NULL DEFAULT 0,
        command_done_at DATETIME NULL, mode_updated_by INT NULL, mode_updated_at DATETIME NULL) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE schedules (schedule_id INT PRIMARY KEY, user_id INT, status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE access_overrides (override_id INT PRIMARY KEY) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE activity_logs (id INT PRIMARY KEY AUTO_INCREMENT) ENGINE=InnoDB');
    $hash = password_hash('secret-pass', PASSWORD_DEFAULT);
    $users = $pdo->prepare('INSERT INTO users VALUES (?, ?, ?, ?)');
    foreach ([[1, 'super_admin', 1, $hash], [2, 'admin', 1, $hash], [3, 'faculty', 1, $hash]] as $row) $users->execute($row);
    $pdo->exec("INSERT INTO fingerprint_devices VALUES (1, 'Door', 'enrollment', 'active')");
    $pdo->exec("INSERT INTO door_controller_status VALUES (1, 'locked', REPEAT('a', 32), 5, NOW(6), -60)");

    $service = new DoorControlService($pdo);
    expectDoorControl($service->controls(1)['schedule_mode'] === 'auto', 'Scheduling defaults to Auto.');

    // Password and role are checked on the server.
    expectDoorControlError(fn () => $service->setScheduleMode(['actor_id' => 2, 'password' => 'wrong', 'mode' => 'off']), 422, 'A wrong password must be refused.');
    expectDoorControlError(fn () => $service->setScheduleMode(['actor_id' => 3, 'password' => 'secret-pass', 'mode' => 'off']), 403, 'Faculty cannot change scheduling.');
    expectDoorControlError(fn () => $service->sendCommand(['actor_id' => 2, 'password' => 'secret-pass', 'action' => 'unlock']), 403, 'An admin cannot lock or unlock remotely.');

    // An admin turns scheduling Off: any active registered account enters.
    $result = $service->setScheduleMode(['actor_id' => 2, 'password' => 'secret-pass', 'mode' => 'off']);
    expectDoorControl($result['controls']['schedule_mode'] === 'off', 'An admin can turn scheduling off.');
    $entry = (new ScheduleAccessPolicy($pdo))->evaluateEntry(3, 'faculty', new DateTimeImmutable('now'), 1);
    expectDoorControl($entry['granted'] === true && $entry['schedule_kind'] === 'schedule_off', 'With scheduling Off, entry needs no schedule. Got ' . json_encode($entry));
    $service->setScheduleMode(['actor_id' => 1, 'password' => 'secret-pass', 'mode' => 'on']);
    $entry = (new ScheduleAccessPolicy($pdo))->evaluateEntry(3, 'faculty', new DateTimeImmutable('now'), 1);
    expectDoorControl($entry['granted'] === false, 'With scheduling On, a faculty member without a schedule is refused.');

    // A Super Admin unlock waits for the controller, which picks it up, then confirms it.
    $service->sendCommand(['actor_id' => 1, 'password' => 'secret-pass', 'action' => 'unlock']);
    $reply = $service->forController(1, null);
    expectDoorControl(($reply['command']['action'] ?? null) === 'unlock' && $reply['schedule_mode'] === 'on', 'The controller receives the pending unlock and the mode. Got ' . json_encode($reply));
    $id = $reply['command']['id'];
    $reply = $service->forController(1, $id);
    expectDoorControl(!isset($reply['command']) && $service->controls(1)['last_command']['id'] === $id, 'A confirmed command is cleared.');

    // An offline controller cannot be sent a command.
    $pdo->exec('UPDATE door_controller_status SET received_at = NOW(6) - INTERVAL 10 MINUTE');
    expectDoorControlError(fn () => $service->sendCommand(['actor_id' => 1, 'password' => 'secret-pass', 'action' => 'lock']), 409, 'An offline door must refuse a command.');

    echo "PASS: door scheduling (Auto default, On, Off: entry without a schedule) changed by admins only with their password; remote lock/unlock by a Super Admin only, delivered to the controller and cleared once it confirms; refused while the door is offline.\n";
} finally {
    foreach ($tables as $table) $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
}
