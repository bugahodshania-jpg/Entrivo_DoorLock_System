<?php

require_once dirname(__DIR__) . '/services/FingerprintEnrollmentService.php';
require_once dirname(__DIR__) . '/services/FingerprintSlotRegistry.php';

function expectEnrollmentRecovery(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$pdo = entrivo_pdo();
$tables = ['fingerprint_enrollment_jobs', 'fingerprint_enrollment_verifications', 'fingerprints', 'fingerprint_devices', 'fingerprint_enrollment_backups', 'fingerprint_sensor_slots', 'fingerprint_enrollment_verify_jobs'];
$old = str_repeat('OLD!', 128);
$binary = str_repeat("\xFF\x01", 256);

try {
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_enrollment_jobs (
        job_id INT PRIMARY KEY, user_id INT, fingerprint_id INT NULL, finger_name VARCHAR(50),
        enrollment_device_id INT NULL, assigned_slot INT NULL, previous_slot INT NULL, job_mode VARCHAR(20),
        status VARCHAR(32), progress INT, current_step VARCHAR(150), error_message TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME NULL, finished_at DATETIME NULL
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_enrollment_verifications (
        job_id INT PRIMARY KEY, fingerprint_id INT, user_id INT, finger_name VARCHAR(50),
        enrollment_device_id INT, fresh_scan_verified TINYINT, stored_slot INT, matched_slot INT,
        confidence INT, template_bytes INT, template_sha256 CHAR(64), verified_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE fingerprints (
        fingerprint_id INT PRIMARY KEY AUTO_INCREMENT, user_id INT, finger_name VARCHAR(50), enrollment_device_id INT NULL,
        enrollment_slot INT NULL, shared_door_slot INT NULL, template_data LONGBLOB, template_hash VARCHAR(64),
        status VARCHAR(20), door_sync_status VARCHAR(20), door_synced_at DATETIME NULL, enrolled_at DATETIME NULL
    ) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY) ENGINE=InnoDB');
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_enrollment_backups (
        job_id INT PRIMARY KEY, enrollment_device_id INT, stored_slot INT,
        template_data BLOB, template_bytes INT, template_sha256 CHAR(64),
        matched_slot INT NULL, confidence INT NULL, fresh_scan_verified TINYINT DEFAULT 0
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_sensor_slots (
        device_id INT NOT NULL, slot INT NOT NULL, state VARCHAR(32) NOT NULL DEFAULT 'free',
        fingerprint_id INT NULL, job_id INT NULL, updated_at DATETIME NULL,
        PRIMARY KEY (device_id, slot)
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_enrollment_verify_jobs (
        id INT NOT NULL PRIMARY KEY AUTO_INCREMENT,
        enrollment_job_id INT NOT NULL, actor_id INT NULL, user_id INT NOT NULL,
        fingerprint_id INT NOT NULL, enrollment_device_id INT NOT NULL, target_slot INT NOT NULL,
        user_name VARCHAR(255) NOT NULL DEFAULT '', finger_name VARCHAR(50) NOT NULL DEFAULT '',
        template_hash CHAR(64) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending',
        current_step VARCHAR(180) NOT NULL DEFAULT 'Place the same finger to verify enrollment',
        claim_token CHAR(64) NULL, matched_slot INT NULL, confidence INT NULL,
        identified TINYINT(1) NOT NULL DEFAULT 0, access_log_id INT NULL, error_message TEXT NULL,
        queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, processing_at DATETIME NULL,
        finished_at DATETIME NULL, active_device_key INT NULL
    ) ENGINE=InnoDB");
    $pdo->exec('INSERT INTO fingerprint_devices VALUES (1)');
    $pdo->prepare("INSERT INTO fingerprints VALUES (4,2,'Right Index',1,5,5,?,?,'active','synced',NULL,'2026-10-20 08:00:00')")
        ->execute([$old, hash('sha256', $old)]);
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs
        (job_id,user_id,fingerprint_id,finger_name,enrollment_device_id,assigned_slot,previous_slot,job_mode,status,progress,current_step)
        VALUES (7,2,4,'Right Index',1,12,5,'update','processing',80,'Generating fingerprint model')");
    $pdo->prepare("INSERT INTO fingerprints VALUES (9,9,'Left Thumb',1,9,9,?,?,'active','synced',NULL,NULL)")
        ->execute([str_repeat('OTHR', 128), hash('sha256', str_repeat('OTHR', 128))]);

    $service = new FingerprintEnrollmentService($pdo);
    $stored = $service->markStored([
        'job_id' => 7,
        'enrollment_device_id' => 1,
        'assigned_slot' => 12,
        'current_step' => 'Fingerprint stored on Sensor A. Confirming the database mapping.',
    ]);
    expectEnrollmentRecovery($stored['status'] === 200 && $stored['body']['job']['status'] === 'stored_pending_commit',
        'A successful Store must record stored_pending_commit before the database commit.');

    $failed = $service->failEnrollment([
        'job_id' => 7,
        'enrollment_device_id' => 1,
        'error_message' => 'standard search returned code 0x17',
    ]);
    expectEnrollmentRecovery($failed['status'] === 200 && $pdo->query("SELECT status FROM fingerprint_enrollment_jobs WHERE job_id=7")->fetchColumn() === 'failed',
        'An unsuccessful post-Store enrollment must fail closed so Download cannot open.');
    $original = $pdo->query('SELECT template_data, enrollment_slot, status FROM fingerprints WHERE fingerprint_id=4')->fetch();
    expectEnrollmentRecovery($original['template_data'] === $old && (int) $original['enrollment_slot'] === 5 && $original['status'] === 'active',
        'An unsuccessful update must keep the original fingerprint usable.');

    $duplicate = $service->resolveDuplicateMatch(['job_id' => 7, 'enrollment_device_id' => 1, 'matched_slot' => 5]);
    expectEnrollmentRecovery($duplicate['status'] === 409 && $duplicate['body']['action'] === 'reject' &&
        $duplicate['body']['matched_slot'] === 5 && str_contains($duplicate['body']['message'], 'Right Index'),
        'Matching an enrolled finger must stop and show its existing enrollment.');

    $rejected = $service->resolveDuplicateMatch(['job_id' => 7, 'enrollment_device_id' => 1, 'matched_slot' => 9]);
    expectEnrollmentRecovery($rejected['status'] === 409 && $rejected['body']['owner'] === 'other_user',
        'A match that belongs to another user must reject enrollment without writing.');

    $retried = $service->retryEnrollmentJob(['job_id' => 7]);
    expectEnrollmentRecovery($retried['status'] === 200 && $retried['body']['job']['status'] === 'waiting'
        && ($retried['body']['job']['assigned_slot'] ?? null) === null
        && (int) ($retried['body']['job']['progress'] ?? -1) === 0,
        'Retry after a failed enrollment must restart a fresh two-scan capture.');

    $pdo->exec("UPDATE fingerprint_enrollment_jobs
        SET status='stored_pending_commit', progress=90, assigned_slot=12,
            current_step='Stored at slot 12', finished_at=NULL, error_message=NULL
        WHERE job_id=7");
    FingerprintSlotRegistry::reserve($pdo, 1, 12, 7, 4);

    $payload = [
        'job_id' => 7,
        'enrollment_device_id' => 1,
        'assigned_slot' => 12,
        'template_data_base64' => base64_encode($binary),
        'verification' => [
            'storage_confirmed' => true,
            'stored_slot' => 12,
            'matched_slot' => 12,
            'template_bytes' => 512,
            'template_sha256' => hash('sha256', $binary),
        ],
    ];
    $completed = $service->completeEnrollment($payload);
    expectEnrollmentRecovery($completed['status'] === 200 && $completed['body']['success'],
        'A confirmed stored-slot template must commit the Sensor A mapping: ' . ($completed['body']['message'] ?? ''));
    $updated = $pdo->query('SELECT enrollment_slot, template_data, status FROM fingerprints WHERE fingerprint_id=4')->fetch();
    expectEnrollmentRecovery((int) $updated['enrollment_slot'] === 12 && $updated['template_data'] === $binary && $updated['status'] === 'active',
        'A successful update replaces the mapping after the stored-slot template is confirmed.');
    $retry = $service->completeEnrollment($payload);
    expectEnrollmentRecovery($retry['status'] === 200 && !empty($retry['body']['idempotent']),
        'Repeated completion requests must not create a second fingerprint record.');

    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs
        (job_id,user_id,fingerprint_id,finger_name,enrollment_device_id,assigned_slot,previous_slot,job_mode,status,progress,current_step)
        VALUES (8,3,NULL,'Left Index',1,20,NULL,'enroll','stored_pending_commit',85,'Stored at slot 20')");
    $uniform = str_repeat("\x00", 512);
    $rejectedUniform = $service->reportIdentifyMatch([
        'job_id' => 8,
        'enrollment_device_id' => 1,
        'assigned_slot' => 20,
        'template_data_base64' => base64_encode($uniform),
        'verification' => [
            'storage_confirmed' => true,
            'stored_slot' => 20,
            'matched_slot' => 20,
            'template_bytes' => 512,
            'template_sha256' => hash('sha256', $uniform),
        ],
    ]);
    expectEnrollmentRecovery($rejectedUniform['status'] === 422,
        'A uniform stored template must be rejected: ' . ($rejectedUniform['body']['message'] ?? ''));
    $rejectedHash = $service->reportIdentifyMatch([
        'job_id' => 8,
        'enrollment_device_id' => 1,
        'assigned_slot' => 20,
        'template_data_base64' => base64_encode($binary),
        'verification' => [
            'storage_confirmed' => true,
            'stored_slot' => 20,
            'matched_slot' => 20,
            'template_bytes' => 512,
            'template_sha256' => hash('sha256', $old),
        ],
    ]);
    expectEnrollmentRecovery($rejectedHash['status'] === 422,
        'A stored template whose SHA-256 does not match the bytes must be rejected: ' . ($rejectedHash['body']['message'] ?? ''));
    $rejectedSlot = $service->reportIdentifyMatch([
        'job_id' => 8,
        'enrollment_device_id' => 1,
        'assigned_slot' => 20,
        'template_data_base64' => base64_encode($binary),
        'verification' => [
            'storage_confirmed' => true,
            'stored_slot' => 21,
            'matched_slot' => 21,
            'template_bytes' => 512,
            'template_sha256' => hash('sha256', $binary),
        ],
    ]);
    expectEnrollmentRecovery($rejectedSlot['status'] === 409,
        'A template bound to the wrong slot must be rejected: ' . ($rejectedSlot['body']['message'] ?? ''));
    expectEnrollmentRecovery($pdo->query("SELECT COUNT(*) FROM fingerprints WHERE user_id=3")->fetchColumn() == 0,
        'Rejected stored templates must not invent a database user link.');

    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs
        (job_id,user_id,fingerprint_id,finger_name,enrollment_device_id,assigned_slot,previous_slot,job_mode,status,progress,current_step)
        VALUES (9,4,NULL,'Left Middle',1,30,NULL,'enroll','stored_pending_commit',85,'Stored at slot 30')");
    $reported = $service->reportIdentifyMatch([
        'job_id' => 9,
        'enrollment_device_id' => 1,
        'assigned_slot' => 30,
        'template_data_base64' => base64_encode($binary),
        'verification' => [
            'storage_confirmed' => true,
            'stored_slot' => 30,
            'matched_slot' => 30,
            'confidence' => 1,
            'template_bytes' => 512,
            'template_sha256' => hash('sha256', $binary),
        ],
    ]);
    expectEnrollmentRecovery($reported['status'] === 200 && ($reported['body']['job']['status'] ?? '') === 'stored_pending_commit',
        'A stored-slot template must wait for download instead of auto-completing: ' . ($reported['body']['message'] ?? ''));
    expectEnrollmentRecovery($pdo->query("SELECT COUNT(*) FROM fingerprints WHERE user_id=4")->fetchColumn() == 0,
        'Reporting a stored-slot template must not write the user mapping yet.');
    $listed = $service->getSingleJobProgress(9);
    expectEnrollmentRecovery(($listed['identify_match']['matched_slot'] ?? 0) === 30 &&
        ($listed['identify_match']['stored_slot'] ?? 0) === 30 &&
        !empty($listed['identify_match']['template_data_base64']) &&
        ($listed['identify_match']['template_sha256'] ?? '') === hash('sha256', $binary),
        'The live job poll must expose the stored-slot template for the download modal.');
    $downloaded = $service->commitEnrollmentDownload(['job_id' => 9]);
    expectEnrollmentRecovery($downloaded['status'] === 200 && $downloaded['body']['success'] === true,
        'Download must commit the stored-slot template: ' . ($downloaded['body']['message'] ?? ''));
    expectEnrollmentRecovery($pdo->query("SELECT COUNT(*) FROM fingerprints WHERE user_id=4 AND enrollment_slot=30 AND status='active'")->fetchColumn() == 1,
        'Download must create the user-linked fingerprint from the stored-slot template.');
    expectEnrollmentRecovery((int) $pdo->query("SELECT COUNT(*) FROM fingerprint_enrollment_verify_jobs WHERE status IN ('pending','processing')")->fetchColumn() === 0,
        'Download must not queue a third-scan verify job.');

    echo "PASS: stored-slot report waits for download, and download commits the user-slot mapping without a third scan.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    foreach ($tables as $table) {
        $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
    }
}
