<?php

require_once dirname(__DIR__) . '/services/DoorStatusService.php';

function expectWifi(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = entrivo_pdo();
try {
    // Temporary shadows, created WITHOUT wifi_rssi like an existing install:
    // the first report must add the column and keep working.
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY, device_name VARCHAR(50), device_type VARCHAR(20), status VARCHAR(20)) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE door_controller_status (
        device_id INT NOT NULL PRIMARY KEY, door_state ENUM('locked','unlocked') NOT NULL,
        boot_id CHAR(32) NOT NULL, report_sequence BIGINT UNSIGNED NOT NULL,
        received_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB");
    $pdo->exec("INSERT INTO fingerprint_devices VALUES (1,'Sensor A','enrollment','active')");
    $service = new DoorStatusService($pdo);
    $boot = str_repeat('a', 32);

    $service->report(['device_id' => 1, 'sequence' => 1, 'boot_id' => $boot, 'door_state' => 'locked', 'wifi_rssi' => -58]);
    expectWifi(DoorStatusSchema::hasWifiColumn($pdo), 'The first report must add the wifi_rssi column.');
    $door = $service->snapshot(1);
    expectWifi($door['online'] === true && $door['wifi_rssi'] === -58, 'A fresh report returns its signal strength. Got ' . json_encode($door));

    $service->report(['device_id' => 1, 'sequence' => 2, 'boot_id' => $boot, 'door_state' => 'unlocked', 'wifi_rssi' => -77]);
    expectWifi($service->snapshot(1)['wifi_rssi'] === -77, 'The latest report replaces the signal strength.');

    // Older firmware sends no strength; out-of-range values are ignored.
    $service->report(['device_id' => 1, 'sequence' => 3, 'boot_id' => $boot, 'door_state' => 'unlocked']);
    expectWifi($service->snapshot(1)['wifi_rssi'] === null, 'A report without a strength stores none.');
    $service->report(['device_id' => 1, 'sequence' => 4, 'boot_id' => $boot, 'door_state' => 'locked', 'wifi_rssi' => 25]);
    expectWifi($service->snapshot(1)['wifi_rssi'] === null, 'An impossible strength (> 0 dBm) is ignored.');

    // The WiFi window (20 s) is shorter than the door state window (45 s).
    $pdo->exec('UPDATE door_controller_status SET received_at = NOW(6) - INTERVAL 30 SECOND');
    $mid = $service->snapshot(1);
    expectWifi($mid['online'] === true && $mid['wifi_expires_in_ms'] === 0 && $mid['expires_in_ms'] > 0,
        'After 30 s the door state is still fresh but the WiFi window has ended. Got ' . json_encode($mid));
    $service->report(['device_id' => 1, 'sequence' => 6, 'boot_id' => $boot, 'door_state' => 'locked', 'wifi_rssi' => -60]);
    $fresh = $service->snapshot(1);
    expectWifi($fresh['wifi_expires_in_ms'] > 19000 && $fresh['wifi_expires_in_ms'] <= 20000, 'A new report restarts the 20 s WiFi window.');

    // A stale report shows no strength: the portal shows "not connected".
    $service->report(['device_id' => 1, 'sequence' => 7, 'boot_id' => $boot, 'door_state' => 'locked', 'wifi_rssi' => -60]);
    $pdo->exec('UPDATE door_controller_status SET received_at = NOW(6) - INTERVAL 2 MINUTE');
    $stale = $service->snapshot(1);
    expectWifi($stale['online'] === false && $stale['wifi_rssi'] === null, 'A stale report has no live signal strength.');

    echo "PASS: door status reports store the controller's WiFi signal (adding the column on existing installs), return it only while fresh, and ignore missing or impossible values.\n";
} finally {
    $pdo->exec('DROP TEMPORARY TABLE IF EXISTS door_controller_status');
    $pdo->exec('DROP TEMPORARY TABLE IF EXISTS fingerprint_devices');
}
