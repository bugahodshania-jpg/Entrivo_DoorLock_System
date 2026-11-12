<?php

require_once dirname(__DIR__) . '/services/FingerprintEnrollmentService.php';
require_once dirname(__DIR__) . '/services/DirectFingerprintImportService.php';

function expectBlockCancel(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = entrivo_pdo();
$tables = ['fingerprint_enrollment_jobs', 'fingerprint_devices', 'fingerprints', 'direct_fingerprint_import_jobs',
    'fingerprint_sensor_slots', 'fingerprint_enrollment_backups'];
try {
    // Temporary shadows: no production enrollment, slot, backup or import row is touched.
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_enrollment_jobs (
        job_id INT PRIMARY KEY AUTO_INCREMENT, user_id INT, fingerprint_id INT NULL,
        finger_name VARCHAR(50), enrollment_device_id INT NULL, assigned_slot INT NULL,
        status VARCHAR(32), progress INT DEFAULT 0, current_step VARCHAR(150), error_message TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        started_at DATETIME NULL, finished_at DATETIME NULL
    ) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE fingerprints (fingerprint_id INT PRIMARY KEY, enrollment_slot INT NULL, shared_door_slot INT NULL) ENGINE=InnoDB');
    $pdo->exec("CREATE TEMPORARY TABLE direct_fingerprint_import_jobs (
        id INT PRIMARY KEY, user_id INT, enrollment_device_id INT, target_slot INT, status VARCHAR(20),
        current_step VARCHAR(150) NULL, error_message TEXT NULL, finished_at DATETIME NULL,
        active_device_key INT NULL, active_fingerprint_key INT NULL, queued_at DATETIME NULL, processing_at DATETIME NULL
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_sensor_slots (
        device_id INT NOT NULL, slot INT NOT NULL, state VARCHAR(20) NOT NULL DEFAULT 'free',
        fingerprint_id INT NULL, job_id INT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (device_id, slot)
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_enrollment_backups (
        job_id INT NOT NULL PRIMARY KEY, enrollment_device_id INT NOT NULL, stored_slot INT NOT NULL,
        template_data BLOB NOT NULL, template_bytes INT NOT NULL, template_sha256 CHAR(64) NOT NULL
    ) ENGINE=InnoDB");
    $pdo->exec('INSERT INTO fingerprint_devices VALUES (1)');

    // User 2 is being blocked: a waiting and a running enrollment, plus an old
    // completed one. User 3 is not blocked and keeps their waiting job.
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs (job_id,user_id,finger_name,enrollment_device_id,assigned_slot,status,current_step) VALUES
        (10,2,'Right Thumb',1,NULL,'waiting','Waiting for Sensor A'),
        (11,2,'Left Thumb',1,7,'processing','Place finger'),
        (12,2,'Right Index',1,8,'completed','Done'),
        (13,3,'Right Thumb',1,NULL,'waiting','Waiting for Sensor A')");
    $pdo->exec("INSERT INTO fingerprint_sensor_slots (device_id,slot,state,job_id) VALUES (1,7,'reserved',11)");
    $pdo->exec("INSERT INTO direct_fingerprint_import_jobs (id,user_id,enrollment_device_id,target_slot,status) VALUES
        (20,2,1,9,'processing'),(21,2,1,9,'completed'),(22,3,1,5,'pending')");

    $cancelled = (new FingerprintEnrollmentService($pdo))->cancelOpenJobsForUser(2, 'Cancelled because the account was blocked.');
    expectBlockCancel($cancelled === [10, 11], 'Both open jobs of the blocked user must be cancelled. Got ' . json_encode($cancelled));
    $status = static fn (int $id) => $pdo->query('SELECT status FROM fingerprint_enrollment_jobs WHERE job_id=' . $id)->fetchColumn();
    foreach ([10, 11] as $id) {
        expectBlockCancel(!in_array($status($id), FingerprintEnrollmentJob::OPEN_STATUSES, true), "Job $id must no longer be open, got " . $status($id));
    }
    expectBlockCancel($status(12) === 'completed', 'A completed enrollment is history and stays as it is.');
    expectBlockCancel($status(13) === 'waiting', 'Another user\'s enrollment must not be touched.');
    $slot = $pdo->query('SELECT state, job_id FROM fingerprint_sensor_slots WHERE device_id=1 AND slot=7')->fetch(PDO::FETCH_ASSOC);
    expectBlockCancel(!$slot || $slot['state'] !== 'reserved' || (int) $slot['job_id'] !== 11, 'The running job\'s reserved sensor slot must be released.');
    expectBlockCancel((new FingerprintEnrollmentService($pdo))->cancelOpenJobsForUser(2, 'again') === [], 'Nothing is left to cancel.');

    $imports = (new DirectFingerprintImportService($pdo, false))->cancelForUser(2, 'Cancelled because the account was blocked.');
    $importStatus = static fn (int $id) => $pdo->query('SELECT status FROM direct_fingerprint_import_jobs WHERE id=' . $id)->fetchColumn();
    expectBlockCancel($imports === 1 && $importStatus(20) === 'cancelled', 'The running restore of the blocked user must be cancelled.');
    expectBlockCancel($importStatus(21) === 'completed' && $importStatus(22) === 'pending', 'Finished restores and other users stay as they are.');

    echo "PASS: blocking an account cancels its waiting and running enrollments (releasing the reserved slot) and its open database restores, leaving finished work and other users alone.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    foreach ($tables as $table) $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
}
