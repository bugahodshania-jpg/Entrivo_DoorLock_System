<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/FingerprintSlotRegistry.php';

function expectSlotRegistry(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$pdo = entrivo_pdo();
$tables = ['fingerprints', 'fingerprint_enrollment_jobs', 'direct_fingerprint_import_jobs', 'fingerprint_sensor_slots'];
try {
    // Shadow the real registry so live sensor rows cannot leak into the fixture.
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_sensor_slots (
        device_id INT NOT NULL, slot INT NOT NULL, state VARCHAR(20) NOT NULL DEFAULT 'free',
        fingerprint_id INT NULL, job_id INT NULL, updated_at DATETIME NULL,
        PRIMARY KEY (device_id, slot)
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE fingerprints (
        fingerprint_id INT PRIMARY KEY, enrollment_slot INT NULL, shared_door_slot INT NULL, status VARCHAR(20)
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_enrollment_jobs (
        job_id INT PRIMARY KEY, assigned_slot INT NULL, status VARCHAR(32), progress INT
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE direct_fingerprint_import_jobs (
        id INT PRIMARY KEY, target_slot INT
    ) ENGINE=InnoDB");
    $pdo->exec("INSERT INTO fingerprints VALUES (1,2,2,'active'),(2,4,4,'inactive')");
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs VALUES (10,6,'waiting',0),(11,7,'failed',95),(12,8,'failed',10)");

    $first = FingerprintSlotRegistry::nextFreeSlot($pdo, 16);
    expectSlotRegistry($first === 1, 'The first free gap must be reused instead of highest-slot-plus-one.');

    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs VALUES (13,1,'processing',5)");
    $second = FingerprintSlotRegistry::nextFreeSlot($pdo, 16, [3], 0);
    expectSlotRegistry($second === 4, 'Inactive mapped slots may be reused; occupied, reserved, and failed-write slots stay unavailable.');

    try {
        FingerprintSlotRegistry::nextFreeSlot($pdo, 3, [1], 0);
        expectSlotRegistry(false, 'A full sensor must not invent another slot.');
    } catch (FingerprintSlotReservationException $error) {
        expectSlotRegistry($error->getCode() === 409, 'A full sensor must preserve existing fingerprints.');
    }

    echo "PASS: slot registry reuses free gaps, preserves occupied/reserved/orphaned slots, and never uses highest-slot-plus-one.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    foreach ($tables as $table) {
        $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
    }
}
