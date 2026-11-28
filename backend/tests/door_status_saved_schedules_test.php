<?php

require_once dirname(__DIR__) . '/services/DoorStatusService.php';

function expectSaved(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = entrivo_pdo();
try {
    // Temporary shadows, created WITHOUT the cache columns like an existing
    // install: the first report that sends a copy must add them.
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY, device_name VARCHAR(50), device_type VARCHAR(20), status VARCHAR(20)) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE door_controller_status (
        device_id INT NOT NULL PRIMARY KEY, door_state ENUM('locked','unlocked') NOT NULL,
        boot_id CHAR(32) NOT NULL, report_sequence BIGINT UNSIGNED NOT NULL,
        received_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB");
    $pdo->exec("INSERT INTO fingerprint_devices VALUES (1,'Door','enrollment','active')");
    $service = new DoorStatusService($pdo);
    $boot = str_repeat('b', 32);
    $sequence = 0;
    $send = function (array $extra) use ($service, $boot, &$sequence) {
        $service->report(['device_id' => 1, 'sequence' => ++$sequence, 'boot_id' => $boot, 'door_state' => 'unlocked'] + $extra);
        return $service->snapshot(1)['saved_schedules'];
    };

    // Older firmware sends nothing: not reported, and no columns are needed.
    $saved = $send([]);
    expectSaved($saved['reported'] === false && $saved['saved_at'] === null, 'Without a copy in the report, nothing is shown. Got ' . json_encode($saved));

    // 2026-12-05 00:00 Asia/Manila = 2026-12-04 16:00 UTC.
    $until = 1796400000;
    $saved = $send(['cache_version' => 123456, 'cache_valid_until' => $until]);
    expectSaved(DoorStatusSchema::hasCacheColumns($pdo), 'The first report with a copy must add the cache columns.');
    expectSaved($saved['reported'] === true && $saved['version'] === 123456 && $saved['saved_at'] !== null,
        'A reported copy is stored with a saved time. Got ' . json_encode($saved));
    expectSaved($saved['valid_until'] === (new DateTimeImmutable('@' . $until))->setTimezone(new DateTimeZone('Asia/Manila'))->format('Y-m-d H:i:s'),
        'valid_until is shown in Manila time. Got ' . json_encode($saved));

    // The same copy again (e.g. after a restart) keeps its saved time.
    $pdo->exec("UPDATE door_controller_status SET cache_saved_at = '2026-11-01 08:00:00'");
    $saved = $send(['cache_version' => 123456, 'cache_valid_until' => $until]);
    expectSaved($saved['saved_at'] === '2026-11-01 08:00:00', 'Reporting the same copy keeps its saved time. Got ' . json_encode($saved));

    // A new copy gets a new saved time.
    $saved = $send(['cache_version' => 654321, 'cache_valid_until' => $until]);
    expectSaved($saved['version'] === 654321 && $saved['saved_at'] !== '2026-11-01 08:00:00', 'A new copy gets a new saved time.');

    // A report without the field (older firmware after a downgrade) leaves it as it was.
    $saved = $send([]);
    expectSaved($saved['version'] === 654321, 'A report without a copy leaves the stored one.');

    // 0 = the door has no saved copy.
    $saved = $send(['cache_version' => 0, 'cache_valid_until' => 0]);
    expectSaved($saved['reported'] === true && $saved['version'] === 0 && $saved['saved_at'] === null && $saved['valid_until'] === null,
        'Version 0 means no copy saved. Got ' . json_encode($saved));

    // Invalid values are ignored.
    $saved = $send(['cache_version' => -5]);
    expectSaved($saved['version'] === 0, 'A negative version is ignored.');

    // While the door is offline the last copy is still shown (it is what the door uses).
    $send(['cache_version' => 777, 'cache_valid_until' => $until]);
    $pdo->exec('UPDATE door_controller_status SET received_at = NOW(6) - INTERVAL 10 MINUTE');
    $door = $service->snapshot(1);
    expectSaved($door['online'] === false && $door['saved_schedules']['version'] === 777, 'An offline door still shows its last saved copy.');

    echo "PASS: door status reports store which offline schedule copy the door saved (adding the columns on existing installs), keep its saved time across repeats, and ignore missing or invalid values.\n";
} finally {
    $pdo->exec('DROP TEMPORARY TABLE IF EXISTS door_controller_status');
    $pdo->exec('DROP TEMPORARY TABLE IF EXISTS fingerprint_devices');
}
