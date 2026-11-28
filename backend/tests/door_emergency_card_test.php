<?php

require_once dirname(__DIR__) . '/services/DoorControlService.php';
require_once dirname(__DIR__) . '/services/EmergencyCards.php';

function expectCard(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function expectCardError(callable $call, int $status, string $message): void
{
    try {
        $call();
    } catch (DoorStatusException $error) {
        expectCard($error->httpStatus === $status, $message . ' (HTTP ' . $error->httpStatus . ': ' . $error->getMessage() . ')');
        return;
    }
    throw new RuntimeException($message . ' (no error)');
}

$pdo = entrivo_pdo();
$tables = ['users', 'fingerprint_devices', 'door_controller_status', 'door_controller_controls', 'activity_logs',
    'activity_transactions', 'rfid_cards', 'door_emergency_cards', 'admin_info', 'faculty_info', 'staff_info'];
try {
    // Connection-local shadow tables: real accounts, cards and door rows are never touched.
    $pdo->exec('CREATE TEMPORARY TABLE users (id INT PRIMARY KEY, role VARCHAR(20), is_active INT, password_hash VARCHAR(255), username VARCHAR(60) NULL) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY, device_name VARCHAR(50), device_type VARCHAR(20), status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE door_controller_status (device_id INT PRIMARY KEY, door_state VARCHAR(10), boot_id CHAR(32), report_sequence INT, received_at DATETIME(6), wifi_rssi SMALLINT NULL) ENGINE=InnoDB');
    // Created WITHOUT the emergency card columns, like an existing install.
    $pdo->exec("CREATE TEMPORARY TABLE door_controller_controls (
        device_id INT NOT NULL PRIMARY KEY, schedule_mode VARCHAR(10) NOT NULL DEFAULT 'auto', command VARCHAR(10) NULL,
        command_id INT NOT NULL DEFAULT 0, command_by INT NULL, command_at DATETIME NULL, command_done_id INT NOT NULL DEFAULT 0,
        command_done_at DATETIME NULL, mode_updated_by INT NULL, mode_updated_at DATETIME NULL) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE activity_logs (id INT PRIMARY KEY AUTO_INCREMENT) ENGINE=InnoDB');
    $pdo->exec("CREATE TEMPORARY TABLE activity_transactions (transaction_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        actor_user_id INT UNSIGNED NULL, target_user_id INT UNSIGNED NULL, activity_type VARCHAR(32) NOT NULL, entity_type VARCHAR(64) NULL,
        entity_id VARCHAR(64) NULL, description VARCHAR(512) NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'Success',
        ip_address VARCHAR(45) NULL, user_agent VARCHAR(512) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE rfid_cards (rfid_uid VARCHAR(10) PRIMARY KEY, user_id INT) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE door_emergency_cards (rfid_uid VARCHAR(10) NOT NULL PRIMARY KEY, card_name VARCHAR(60) NOT NULL, device_id INT NULL, reported_at DATETIME NOT NULL) ENGINE=InnoDB');
    foreach (['admin_info', 'faculty_info', 'staff_info'] as $info) {
        $pdo->exec("CREATE TEMPORARY TABLE {$info} (user_id INT PRIMARY KEY, first_name VARCHAR(50), last_name VARCHAR(50)) ENGINE=InnoDB");
    }
    $hash = password_hash('secret-pass', PASSWORD_DEFAULT);
    $users = $pdo->prepare('INSERT INTO users (id, role, is_active, password_hash) VALUES (?, ?, ?, ?)');
    foreach ([[1, 'super_admin', 1, $hash], [2, 'admin', 1, $hash]] as $row) $users->execute($row);
    $pdo->exec("INSERT INTO admin_info VALUES (1, 'Ana', 'Reyes')");
    $pdo->exec("INSERT INTO fingerprint_devices VALUES (1, 'Door', 'enrollment', 'active')");
    $pdo->exec("INSERT INTO rfid_cards VALUES ('1F00469B7D', 7)");
    $pdo->exec("INSERT INTO door_emergency_cards VALUES ('4300C46DDF', 'Built-in card', 1, NOW())");
    EmergencyCards::reset();

    $service = new DoorControlService($pdo);
    $super = ['actor_id' => 1, 'password' => 'secret-pass', 'action' => 'emergency_card'];

    // Before any card is set, the door's reply leaves its saved card alone.
    expectCard(!array_key_exists('emergency_card', $service->forController(1, null, '')), 'Without the columns, the reply must not carry a card.');
    $view = $service->emergencyCard(['actor_id' => 1]);
    expectCard($view['card'] === null && $view['built_in']['uid'] === '4300C46DDF', 'Nothing set yet; the built-in card is shown. Got ' . json_encode($view));

    // Only a Super Admin, with the right password, may change or view it.
    expectCardError(fn () => $service->setEmergencyCard(['actor_id' => 2, 'password' => 'secret-pass', 'action' => 'emergency_card', 'uid' => 'AABBCCDDEE']), 403, 'An Admin cannot set the emergency card.');
    expectCardError(fn () => $service->emergencyCard(['actor_id' => 2]), 403, 'An Admin cannot view the emergency card.');
    expectCardError(fn () => $service->setEmergencyCard(['password' => 'wrong'] + $super + ['uid' => 'AABBCCDDEE']), 422, 'A wrong password must be refused.');

    // Invalid, registered, or built-in cards are refused.
    expectCardError(fn () => $service->setEmergencyCard($super + ['uid' => '12345']), 422, 'A short UID must be refused.');
    expectCardError(fn () => $service->setEmergencyCard($super + ['uid' => 'ZZZZZZZZZZ']), 422, 'A non-hex UID must be refused.');
    expectCardError(fn () => $service->setEmergencyCard($super + ['uid' => '1f00469b7d']), 422, "A user's registered card must be refused.");
    expectCardError(fn () => $service->setEmergencyCard($super + ['uid' => '4300C46DDF']), 422, 'The built-in card cannot also be the portal card.');

    // Set it: stored, logged, sent to the door, and accepted as an emergency card.
    $result = $service->setEmergencyCard($super + ['uid' => 'aabbccddee', 'name' => "  Dean's   Office Card "]);
    expectCard($result['card']['uid'] === 'AABBCCDDEE' && $result['card']['name'] === "Dean's Office Card" && $result['card']['set_by'] === 'Ana Reyes',
        'The card is stored upper-case with a tidy name. Got ' . json_encode($result['card']));
    expectCard($result['door'] === null || $result['door']['matches'] === false, 'The door has not saved it yet.');
    $reply = $service->forController(1, null, '');
    expectCard($reply['emergency_card'] === ['uid' => 'AABBCCDDEE', 'name' => "Dean's Office Card"], 'The door receives the card. Got ' . json_encode($reply));
    expectCard(in_array('AABBCCDDEE', EmergencyCards::uids(), true) && EmergencyCards::nameFor('aabbccddee') === "Dean's Office Card",
        'The portal card is an emergency card online too.');
    expectCard(in_array('4300C46DDF', EmergencyCards::uids(), true), 'The built-in card keeps working next to it.');
    $log = $pdo->query("SELECT description FROM activity_transactions ORDER BY transaction_id DESC LIMIT 1")->fetchColumn();
    expectCard(str_contains($log, 'ending CDDEE') === false && str_contains($log, 'ending DDEE') && !str_contains($log, 'AABBCCDDEE'),
        'The log names the card by its last 4 characters only. Got ' . $log);

    // The door reports it saved: the portal shows it as saved on the door.
    $service->forController(1, null, 'AABBCCDDEE');
    $view = $service->emergencyCard(['actor_id' => 1]);
    expectCard($view['door']['matches'] === true && $view['door']['reported_at'] !== null, 'The door saved it. Got ' . json_encode($view['door']));
    $pdo->exec("UPDATE door_controller_controls SET emergency_card_door_at = '2026-11-01 08:00:00'");
    $service->forController(1, null, 'AABBCCDDEE');
    expectCard($service->emergencyCard(['actor_id' => 1])['door']['reported_at'] === '2026-11-01 08:00:00', 'Repeated reports keep the saved time.');
    $service->forController(1, null, 'not-a-uid');
    expectCard($service->emergencyCard(['actor_id' => 1])['door']['uid'] === 'AABBCCDDEE', 'An invalid reported UID is ignored.');

    // Replace it: the old card stops being an emergency card.
    $service->setEmergencyCard($super + ['uid' => '1122334455', 'name' => '']);
    expectCard(!in_array('AABBCCDDEE', EmergencyCards::uids(), true) && EmergencyCards::nameFor('1122334455') === EmergencyCards::DEFAULT_NAME,
        'Replacing the card removes the old one; an empty name becomes "Emergency card".');
    expectCard($service->emergencyCard(['actor_id' => 1])['door']['matches'] === false, 'The door must save the new card again.');

    // Remove it: the door is told to clear its saved card ('' = none).
    $removed = $service->setEmergencyCard($super + ['uid' => '']);
    expectCard($removed['card'] === null, 'The card is removed.');
    expectCard($service->forController(1, null, '1122334455')['emergency_card'] === ['uid' => '', 'name' => ''], 'The door is told to remove it.');
    expectCard(!in_array('1122334455', EmergencyCards::uids(), true) && in_array('4300C46DDF', EmergencyCards::uids(), true),
        'After removing, only the built-in card is an emergency card.');
    $service->forController(1, null, '');
    expectCard($service->emergencyCard(['actor_id' => 1])['door']['matches'] === true, 'The door confirms the removal.');

    echo "PASS: a Super Admin sets, replaces and removes the portal emergency card (password checked, registered and built-in cards refused); the door receives it and reports it saved; it works next to the built-in card.\n";
} finally {
    foreach ($tables as $table) $pdo->exec("DROP TEMPORARY TABLE IF EXISTS {$table}");
    EmergencyCards::reset();
}
