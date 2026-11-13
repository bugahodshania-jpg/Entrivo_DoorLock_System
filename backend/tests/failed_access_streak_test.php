<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/FailedAccessStreak.php';

function expectStreak(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = entrivo_pdo();
try {
    // Temporary shadow: no real access log row is touched.
    $pdo->exec("CREATE TEMPORARY TABLE access_log (
        log_id INT PRIMARY KEY AUTO_INCREMENT, user_id INT NULL, rfid_uid VARCHAR(10) NULL,
        access_timestamp DATETIME, access_status ENUM('granted','denied'), method_access ENUM('RFID','Fingerprint','Override')
    ) ENGINE=InnoDB");
    $add = static function (?int $user, string $status, string $time, string $method = 'RFID', ?string $uid = null) use ($pdo): array {
        $pdo->prepare('INSERT INTO access_log (user_id,rfid_uid,access_timestamp,access_status,method_access) VALUES (?,?,?,?,?)')
            ->execute([$user, $uid, "2026-11-13 $time", $status, $method]);
        return $pdo->query('SELECT * FROM access_log WHERE log_id=' . (int) $pdo->lastInsertId())->fetch(PDO::FETCH_ASSOC);
    };

    // User 5: granted, then four failures in a row.
    $add(5, 'granted', '08:00:00');
    $counts = [];
    foreach (['08:01:00', '08:02:00', '08:03:00', '08:04:00'] as $time) $counts[] = FailedAccessStreak::count($pdo, $add(5, 'denied', $time));
    expectStreak($counts === [1, 2, 3, 4], 'Failures count up after the last granted access: ' . json_encode($counts));

    // Another user's failures in between never add to user 5's run.
    $add(6, 'denied', '08:04:30');
    expectStreak(FailedAccessStreak::count($pdo, $add(5, 'denied', '08:05:00')) === 5, 'Other people do not join the run.');

    // A granted access ends the run.
    $add(5, 'granted', '08:06:00');
    expectStreak(FailedAccessStreak::count($pdo, $add(5, 'denied', '08:07:00')) === 1, 'A granted access restarts the count.');

    // Failures more than 10 minutes before the attempt do not count.
    $add(7, 'denied', '09:00:00');
    $add(7, 'denied', '09:01:00');
    expectStreak(FailedAccessStreak::count($pdo, $add(7, 'denied', '09:20:00')) === 1, 'Old failures outside the window are ignored.');

    // Unregistered card: grouped by UID. Unregistered fingerprints: grouped together.
    $add(null, 'denied', '10:00:00', 'RFID', 'AA00000001');
    $add(null, 'denied', '10:00:10', 'RFID', 'BB00000002');
    $add(null, 'denied', '10:00:20', 'RFID', 'AA00000001');
    expectStreak(FailedAccessStreak::count($pdo, $add(null, 'denied', '10:00:30', 'RFID', 'AA00000001')) === 3, 'An unknown card is tracked by its UID.');
    $add(null, 'denied', '11:00:00', 'Fingerprint');
    $add(null, 'denied', '11:00:10', 'Fingerprint');
    expectStreak(FailedAccessStreak::count($pdo, $add(null, 'denied', '11:00:20', 'Fingerprint')) === 3, 'Unregistered fingerprints are tracked together.');

    // Granted attempts are never a failure.
    expectStreak(FailedAccessStreak::count($pdo, $add(5, 'granted', '12:00:00')) === 0, 'A granted attempt has no failure count.');

    echo "PASS: failed attempts in a row are counted per person (account, unknown card UID, unregistered fingerprints), reset by a granted access, limited to 10 minutes, never mixing people.\n";
} finally {
    $pdo->exec('DROP TEMPORARY TABLE IF EXISTS access_log');
}
