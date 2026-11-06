<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/FingerprintSlotRegistry.php';

$pdo = entrivo_pdo();
FingerprintSlotRegistry::ensure($pdo);

try {
    $pdo->exec("ALTER TABLE fingerprint_enrollment_jobs
        MODIFY status ENUM(
            'waiting','processing','stored_pending_commit','completed','needs_reconciliation','failed','cancelled'
        ) DEFAULT 'waiting'");
} catch (PDOException $error) {
    fwrite(STDERR, 'Status enum update skipped: ' . $error->getMessage() . PHP_EOL);
}

foreach ([
    "ALTER TABLE fingerprint_enrollment_jobs ADD COLUMN job_mode ENUM('enroll','update') NULL",
    'ALTER TABLE fingerprint_enrollment_jobs ADD COLUMN previous_slot INT NULL',
] as $sql) {
    try {
        $pdo->exec($sql);
    } catch (PDOException $error) {
        if (!str_contains($error->getMessage(), 'Duplicate column')) {
            throw $error;
        }
    }
}

echo "PASS: fingerprint_sensor_slots and enrollment recovery columns are ready.\n";
