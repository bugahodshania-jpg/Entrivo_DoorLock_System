<?php

require_once dirname(__DIR__) . '/services/FingerprintEnrollmentService.php';

function expectTemplateEnrollment(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = entrivo_pdo();
$tables = ['fingerprints', 'fingerprint_enrollment_jobs', 'fingerprint_enrollment_verifications'];
try {
    // Connection-local shadows keep real enrollments and template backups intact.
    $pdo->exec("CREATE TEMPORARY TABLE fingerprints (
        fingerprint_id INT PRIMARY KEY AUTO_INCREMENT, user_id INT, finger_name VARCHAR(50),
        enrollment_device_id INT, enrollment_slot INT, shared_door_slot INT,
        template_data LONGBLOB, template_hash CHAR(64), status VARCHAR(20),
        door_sync_status VARCHAR(20), door_synced_at DATETIME NULL, enrolled_at DATETIME
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_enrollment_jobs (
        job_id INT PRIMARY KEY, user_id INT, fingerprint_id INT NULL, finger_name VARCHAR(50),
        enrollment_device_id INT, assigned_slot INT, status VARCHAR(20), progress INT,
        current_step VARCHAR(150), error_message TEXT NULL, finished_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_enrollment_verifications (
        job_id INT PRIMARY KEY, fingerprint_id INT, user_id INT, finger_name VARCHAR(50),
        enrollment_device_id INT, fresh_scan_verified TINYINT, stored_slot INT, matched_slot INT,
        confidence INT, template_bytes INT, template_sha256 CHAR(64), verified_at DATETIME
    ) ENGINE=InnoDB");
    $service = new FingerprintEnrollmentService();
    $insert = $pdo->prepare("INSERT INTO fingerprint_enrollment_jobs
        (job_id,user_id,fingerprint_id,finger_name,enrollment_device_id,assigned_slot,status,progress,current_step)
        VALUES (?,1,?,'Right Index',1,?,'processing',95,'Reading template')");
    $jobId = 0;
    foreach ([512, 768, 1024, 1536] as $bytes) {
        $pdo->exec('DELETE FROM fingerprints');
        $originalId = null;
        foreach (['enroll', 'update'] as $operation) {
            ++$jobId;
            $insert->execute([$jobId, $originalId, $jobId]);
            if ($operation === 'update') {
                $pdo->prepare("UPDATE fingerprint_enrollment_jobs SET progress=99, current_step='Final verification passed: matched the saved slot' WHERE job_id=?")
                    ->execute([$jobId]);
            }
            // Invalid UTF-8 catches the former empty JSON completion response.
            $binary = str_repeat($operation === 'enroll' ? "\xFF\x01" : "\x80\x02", $bytes / 2);
            $result = $service->completeEnrollment(['job_id' => $jobId, 'enrollment_device_id' => 1,
                'assigned_slot' => $jobId, 'template_data_base64' => base64_encode($binary),
                'verification' => ['fresh_scan_verified' => true, 'stored_slot' => $jobId,
                    'matched_slot' => $jobId, 'confidence' => 1, 'template_bytes' => $bytes,
                    'template_sha256' => hash('sha256', $binary)]]);
            expectTemplateEnrollment($result['status'] === 200 && $result['body']['success'], "$operation must accept the entire $bytes-byte template.");
            $metadata = $result['body']['fingerprint'];
            expectTemplateEnrollment($metadata['template_bytes'] === $bytes && $metadata['has_template_data']
                && !array_key_exists('template_data', $metadata), 'Completion must return accurate metadata without raw bytes.');
            json_encode($result['body'], JSON_THROW_ON_ERROR);
            $saved = $pdo->query('SELECT * FROM fingerprints')->fetch();
            expectTemplateEnrollment($saved['template_data'] === $binary && $saved['template_hash'] === hash('sha256', $binary), 'The backup and hash must include every byte.');
            expectTemplateEnrollment((int) $saved['enrollment_slot'] === $jobId && $saved['status'] === 'active', 'The saved mapping must match the confirmed slot.');
            expectTemplateEnrollment((int) $pdo->query('SELECT COUNT(*) FROM fingerprints')->fetchColumn() === 1, 'Updating a finger must preserve its record instead of adding a duplicate.');
            if ($originalId !== null) expectTemplateEnrollment((int) $saved['fingerprint_id'] === $originalId, 'Update must preserve fingerprint identity.');
            $originalId = (int) $saved['fingerprint_id'];
            $job = $pdo->query('SELECT * FROM fingerprint_enrollment_jobs WHERE job_id=' . $jobId)->fetch();
            expectTemplateEnrollment($job['status'] === 'completed' && (int) $job['progress'] === 100, 'The job must reach completion.');
            $expectedStep = 'Enrollment completed after final verification';
            expectTemplateEnrollment($job['current_step'] === $expectedStep && $result['body']['job']['current_step'] === $expectedStep,
                'Explicit fresh proof must confirm completion even when the progress 99 reply was lost.');
            $proof = $pdo->query('SELECT * FROM fingerprint_enrollment_verifications WHERE job_id=' . $jobId)->fetch();
            expectTemplateEnrollment($proof && $proof['template_sha256'] === hash('sha256', $binary)
                && (int) $proof['template_bytes'] === $bytes, 'Completion must persist its exact sensor proof.');
        }
    }
    foreach ([1, 256, 511, 513, 640, 769, 1023, 1025, 1535, 1537, 2048] as $bytes) {
        ++$jobId;
        $insert->execute([$jobId, $originalId, $jobId]);
        $before = $pdo->query('SELECT * FROM fingerprints')->fetchAll();
        $result = $service->completeEnrollment(['job_id' => $jobId, 'enrollment_device_id' => 1,
            'assigned_slot' => $jobId, 'template_data_base64' => base64_encode(str_repeat("\xFF", $bytes))]);
        expectTemplateEnrollment($result['status'] === 422 && !$result['body']['success'], 'Unsupported/truncated template size must fail.');
        expectTemplateEnrollment($pdo->query('SELECT * FROM fingerprints')->fetchAll() === $before, 'A bad template must preserve the existing fingerprint backup and mapping.');
    }
    foreach ([512, 768, 1024, 1536] as $bytes) {
        // 1024 ASCII bytes are also syntactically valid base64 for 768 bytes.
        // The digest selects the correct representation, never the size alone.
        $binary = str_repeat('AB', $bytes / 2);
        $hash = hash('sha256', $binary);
        expectTemplateEnrollment(FingerprintTemplateFormat::verifiedBinary($binary, $hash) === $binary, 'Raw ASCII templates must retain their full size.');
        expectTemplateEnrollment(FingerprintTemplateFormat::verifiedBinary(base64_encode($binary), $hash) === $binary, 'Legacy base64 backups must decode to the same verified bytes.');
        expectTemplateEnrollment(FingerprintTemplateFormat::verifiedBinary($binary, str_repeat('0', 64)) === null, 'Hash mismatch must fail.');
    }
    foreach ([512, 768, 1024, 1536] as $bytes) {
        foreach (["\xFF", "\0", 'A'] as $value) {
            $binary = str_repeat($value, $bytes);
            $hash = hash('sha256', $binary);
            expectTemplateEnrollment(!FingerprintTemplateFormat::isUsableTemplate($binary), 'Uniform buffers must never be usable templates.');
            expectTemplateEnrollment(FingerprintTemplateFormat::verifiedBinary($binary, $hash) === null
                && FingerprintTemplateFormat::verifiedBinary(base64_encode($binary), $hash) === null,
                'A correct hash must not make uniform raw or legacy base64 backups valid.');

            ++$jobId;
            $insert->execute([$jobId, $originalId, $jobId]);
            $before = $pdo->query('SELECT * FROM fingerprints')->fetchAll();
            $result = $service->completeEnrollment(['job_id' => $jobId, 'enrollment_device_id' => 1,
                'assigned_slot' => $jobId, 'template_data_base64' => base64_encode($binary)]);
            expectTemplateEnrollment($result['status'] === 422 && !$result['body']['success']
                && str_contains($result['body']['message'], 'repeated byte'), 'Uniform sensor data must fail with an explanation.');
            expectTemplateEnrollment($pdo->query('SELECT * FROM fingerprints')->fetchAll() === $before,
                'Uniform data must preserve the previous template, hash, slot, and fingerprint identity.');
            $failed = $pdo->query('SELECT status, error_message FROM fingerprint_enrollment_jobs WHERE job_id=' . $jobId)->fetch();
            expectTemplateEnrollment($failed['status'] === 'processing' && $failed['error_message'] === null,
                'Rejected completion must preserve the claimed job without partially committing a failure.');
        }
        for ($value = 0; $value <= 255; ++$value) {
            expectTemplateEnrollment(!FingerprintTemplateFormat::isUsableTemplate(str_repeat(chr($value), $bytes)),
                'The guard must reject every uniform byte value.');
        }
        expectTemplateEnrollment(FingerprintTemplateFormat::isUsableTemplate(str_repeat("\0", $bytes - 1) . "\x01"),
            'One differing byte must pass the guard without an entropy threshold.');
    }
    echo "PASS: verified 512/768/1024/1536-byte enrollment and update, full-byte backup/hash, durable sensor proof, valid JSON completion, stable identity, unsupported-size and uniform-buffer preservation, and legacy backup verification.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    foreach ($tables as $table) $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
}
