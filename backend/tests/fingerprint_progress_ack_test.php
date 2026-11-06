<?php

require_once dirname(__DIR__) . '/models/FingerprintEnrollmentJob.php';

$pdo = entrivo_pdo();
// Shadow the real slot registry so fixtures never write live sensor rows.
$pdo->exec("CREATE TEMPORARY TABLE fingerprint_sensor_slots (
    device_id INT NOT NULL, slot INT NOT NULL, state VARCHAR(20) NOT NULL DEFAULT 'free',
    fingerprint_id INT NULL, job_id INT NULL, updated_at DATETIME NULL,
    PRIMARY KEY (device_id, slot)
) ENGINE=InnoDB");
$pdo->exec("CREATE TEMPORARY TABLE fingerprint_enrollment_jobs (
    job_id INT PRIMARY KEY,
    enrollment_device_id INT NOT NULL,
    assigned_slot INT NULL,
    status VARCHAR(32) NOT NULL,
    progress INT NOT NULL,
    current_step VARCHAR(150),
    error_message TEXT NULL,
    started_at DATETIME NULL,
    finished_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB");

try {
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs
        (job_id, enrollment_device_id, status, progress, current_step, started_at)
        VALUES (1, 1, 'processing', 10, 'Place finger for first scan', NOW())");
    $jobs = new FingerprintEnrollmentJob($pdo);
    if (!$jobs->updateProgress(1, 10, 'Place finger for first scan', 1)) {
        throw new RuntimeException('An unchanged valid progress update must be acknowledged.');
    }
    if (!$jobs->updateProgress(1, 35, 'First scan captured. Remove finger', 1)) {
        throw new RuntimeException('A changed progress update must be acknowledged.');
    }
    if (!$jobs->updateProgress(1, 35, 'First scan captured. Remove finger', 1)) {
        throw new RuntimeException('A repeated changed step must be acknowledged.');
    }
    if ($jobs->updateProgress(1, 35, 'First scan captured. Remove finger', 2)) {
        throw new RuntimeException('The wrong device must not be acknowledged.');
    }
    $pdo->exec("UPDATE fingerprint_enrollment_jobs SET status='failed' WHERE job_id=1");
    if ($jobs->updateProgress(1, 35, 'First scan captured. Remove finger', 1)) {
        throw new RuntimeException('A closed job must not be acknowledged.');
    }
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs
        (job_id, enrollment_device_id, assigned_slot, status, progress, current_step)
        VALUES (2, 1, 22, 'needs_reconciliation', 90, 'Sensor storage needs reconciliation'),
               (3, 1, 23, 'stored_pending_commit', 90, 'Recovering stored Sensor A fingerprint')");
    $recoverable = $jobs->getRecoverableJob(1);
    if (!$recoverable || (int) $recoverable['job_id'] !== 3) {
        throw new RuntimeException('A reconciliation job must wait for Retry before the board resumes it.');
    }
    echo "PASS: repeated progress acknowledgements, wrong-device/closed-job rejection, and explicit recovery retry.\n";
} finally {
    $pdo->exec('DROP TEMPORARY TABLE IF EXISTS fingerprint_enrollment_jobs');
    $pdo->exec('DROP TEMPORARY TABLE IF EXISTS fingerprint_sensor_slots');
}
