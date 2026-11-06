<?php

require_once dirname(__DIR__) . '/services/EnrollmentVerifyService.php';
require_once dirname(__DIR__) . '/config/connection.php';

function expectEnrollmentVerify(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = entrivo_pdo();
$binary = str_repeat("\xFF\x01", 256);
$hash = hash('sha256', $binary);
$tables = ['fingerprint_enrollment_verify_jobs', 'fingerprints', 'users', 'access_log', 'fingerprint_sensor_slots'];

try {
    // Shadow the real slot registry so fixtures never write live sensor rows.
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_sensor_slots (
        device_id INT NOT NULL, slot INT NOT NULL, state VARCHAR(20) NOT NULL DEFAULT 'free',
        fingerprint_id INT NULL, job_id INT NULL, updated_at DATETIME NULL,
        PRIMARY KEY (device_id, slot)
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE users (id INT PRIMARY KEY, username VARCHAR(50)) ENGINE=InnoDB");
    $pdo->exec("INSERT INTO users VALUES (4, 'Ada Faculty')");
    $pdo->exec("CREATE TEMPORARY TABLE fingerprints (
        fingerprint_id INT PRIMARY KEY, user_id INT, finger_name VARCHAR(50),
        enrollment_device_id INT, enrollment_slot INT, template_hash CHAR(64), status VARCHAR(20)
    ) ENGINE=InnoDB");
    $pdo->prepare('INSERT INTO fingerprints VALUES (11, 4, \'Left Middle\', 1, 30, ?, \'active\')')->execute([$hash]);
    $pdo->exec("CREATE TEMPORARY TABLE access_log (
        log_id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NULL, fingerprint_id INT NULL, schedule_id INT NULL, override_id INT NULL,
        access_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        access_status VARCHAR(20), denial_reason VARCHAR(40) NULL,
        method_access VARCHAR(20), access_type VARCHAR(10) NULL,
        matched_slot INT NULL, match_confidence INT NULL
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

    $service = new EnrollmentVerifyService($pdo);
    $queued = $service->queueFromCompletedEnrollment([
        'job' => [
            'job_id' => 9,
            'enrollment_device_id' => 1,
            'assigned_slot' => 30,
            'user_id' => 4,
            'user_name' => 'Ada Faculty',
            'finger_name' => 'Left Middle',
        ],
        'fingerprint' => [
            'fingerprint_id' => 11,
            'user_id' => 4,
            'enrollment_slot' => 30,
            'template_hash' => $hash,
        ],
        'verification' => ['template_sha256' => $hash],
    ], 1);
    expectEnrollmentVerify(($queued['verify_job_id'] ?? 0) > 0 && $queued['status'] === 'pending',
        'Download must queue a short-lived enrollment verify job.');
    expectEnrollmentVerify($service->queueFromCompletedEnrollment([
        'job' => ['job_id' => 9, 'enrollment_device_id' => 1, 'assigned_slot' => 30, 'user_id' => 4],
        'fingerprint' => ['fingerprint_id' => 11, 'user_id' => 4],
        'verification' => ['template_sha256' => $hash],
    ])['verify_job_id'] === $queued['verify_job_id'],
        'A second download of the same enrollment must reuse the existing verify job.');

    $claim = $service->claim(['enrollment_device_id' => 1]);
    expectEnrollmentVerify(!empty($claim['job']['claim_token']) && $claim['job']['status'] === 'processing',
        'Sensor A must be able to claim the queued verify job.');

    $granted = $service->deviceUpdate([
        'job_id' => $queued['verify_job_id'],
        'enrollment_device_id' => 1,
        'claim_token' => $claim['job']['claim_token'],
        'identified' => true,
        'matched_slot' => 30,
        'confidence' => 142,
        'template_hash' => $hash,
    ]);
    expectEnrollmentVerify($granted['identified'] === true && $granted['slot'] === 30 && $granted['confidence'] === 142
        && $granted['user_name'] === 'Ada Faculty',
        'A matching post-download scan must return the user, slot, and confidence.');

    $log = $pdo->query('SELECT * FROM access_log ORDER BY log_id DESC LIMIT 1')->fetch();
    expectEnrollmentVerify($log
        && $log['access_type'] === 'VERIFY'
        && $log['access_status'] === 'granted'
        && $log['method_access'] === 'Fingerprint'
        && (int) $log['matched_slot'] === 30
        && (int) $log['match_confidence'] === 142,
        'A successful verify scan must write a VERIFY access log with slot and confidence.');
    expectEnrollmentVerify((int) $pdo->query("SELECT COUNT(*) FROM access_log WHERE access_type IN ('IN','OUT')")->fetchColumn() === 0,
        'Enrollment verify must never write an attendance IN or OUT log.');
    expectEnrollmentVerify((int) $pdo->query("SELECT SUM(access_status = 'granted' AND (access_type IS NULL OR access_type IN ('IN','OUT'))) FROM access_log")->fetchColumn() === 0,
        'Attendance granted counts must ignore VERIFY rows.');

    $repeat = $service->deviceUpdate([
        'job_id' => $queued['verify_job_id'],
        'enrollment_device_id' => 1,
        'claim_token' => $claim['job']['claim_token'],
        'identified' => true,
        'matched_slot' => 30,
        'confidence' => 10,
        'template_hash' => $hash,
    ]);
    expectEnrollmentVerify($repeat['verify']['status'] === 'completed'
        && (int) $pdo->query('SELECT COUNT(*) FROM access_log')->fetchColumn() === 1,
        'A repeated verify report must stay idempotent and keep the enrollment.');

    $missed = $service->queueFromCompletedEnrollment([
        'job' => [
            'job_id' => 10,
            'enrollment_device_id' => 1,
            'assigned_slot' => 31,
            'user_id' => 4,
            'user_name' => 'Ada Faculty',
            'finger_name' => 'Left Index',
        ],
        'fingerprint' => [
            'fingerprint_id' => 12,
            'user_id' => 4,
            'enrollment_slot' => 31,
            'template_hash' => $hash,
        ],
        'verification' => ['template_sha256' => $hash],
    ]);
    $pdo->prepare('INSERT INTO fingerprints VALUES (12, 4, \'Left Index\', 1, 31, ?, \'active\')')->execute([$hash]);
    $missClaim = $service->claim(['enrollment_device_id' => 1]);
    $denied = $service->deviceUpdate([
        'job_id' => $missed['verify_job_id'],
        'enrollment_device_id' => 1,
        'claim_token' => $missClaim['job']['claim_token'],
        'identified' => false,
        'matched_slot' => 31,
        'confidence' => 0,
        'template_hash' => '',
        'error_message' => 'Sensor A did not identify the enrolled slot after download.',
    ]);
    expectEnrollmentVerify($denied['identified'] === false && $denied['verify']['status'] === 'failed',
        'A missed verify scan must keep the stored enrollment and record a denial.');
    $deniedLog = $pdo->query("SELECT * FROM access_log WHERE access_status='denied' ORDER BY log_id DESC LIMIT 1")->fetch();
    expectEnrollmentVerify($deniedLog
        && $deniedLog['access_type'] === 'VERIFY'
        && $deniedLog['method_access'] === 'Fingerprint'
        && (int) $deniedLog['matched_slot'] === 31,
        'A missed verify scan must write a denied VERIFY log for the attempted slot.');
    expectEnrollmentVerify((int) $pdo->query("SELECT COUNT(*) FROM access_log WHERE access_type='IN'")->fetchColumn() === 0,
        'Denied verify must also stay out of attendance IN counts.');

    echo "PASS: post-download verify queues once, writes VERIFY logs with slot/confidence, never writes IN, and keeps the enrollment on a miss.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    foreach ($tables as $table) {
        $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
    }
}
