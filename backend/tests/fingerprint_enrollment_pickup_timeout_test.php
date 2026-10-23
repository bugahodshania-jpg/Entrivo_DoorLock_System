<?php

require_once dirname(__DIR__) . '/services/FingerprintEnrollmentService.php';

function expectEnrollmentPickup(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

final class EnrollmentClaimDeadlineRace extends FingerprintEnrollmentJob
{
    public PDO $fixturePdo;
    public int $claimTimestamp;

    public function getNextAvailableSlot()
    {
        // Advance only this test connection between cleanup and the guarded claim.
        $this->fixturePdo->exec('SET timestamp=' . $this->claimTimestamp);
        return 7;
    }
}

$pdo = entrivo_pdo();
$tables = ['fingerprint_enrollment_jobs', 'fingerprint_devices', 'fingerprints', 'direct_fingerprint_import_jobs'];
$frozen = new DateTimeImmutable('2026-10-21 10:00:00', new DateTimeZone('Asia/Manila'));

try {
    // Temporary shadows isolate every table used by the model and service.
    // No production enrollment, device, backup, import, or schema is modified.
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_enrollment_jobs (
        job_id INT PRIMARY KEY AUTO_INCREMENT, user_id INT, fingerprint_id INT NULL,
        finger_name VARCHAR(50), enrollment_device_id INT NULL, assigned_slot INT NULL,
        status VARCHAR(20), progress INT DEFAULT 0, current_step VARCHAR(150), error_message TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        started_at DATETIME NULL, finished_at DATETIME NULL
    ) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE fingerprints (fingerprint_id INT PRIMARY KEY, enrollment_slot INT NULL, shared_door_slot INT NULL) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE direct_fingerprint_import_jobs (id INT PRIMARY KEY, enrollment_device_id INT, target_slot INT, status VARCHAR(20), queued_at DATETIME, processing_at DATETIME NULL) ENGINE=InnoDB');
    $pdo->exec('INSERT INTO fingerprint_devices VALUES (1), (2)');
    $model = new FingerprintEnrollmentJob();
    $service = new FingerprintEnrollmentService();
    $insert = $pdo->prepare("INSERT INTO fingerprint_enrollment_jobs
        (job_id,user_id,finger_name,enrollment_device_id,status,current_step,created_at,updated_at,started_at,finished_at)
        VALUES (?,?,'Fixture finger',?,?, 'Fixture',?,?,?,?)");
    $add = static function (int $id, int $ageSeconds, string $status = 'waiting', ?int $deviceId = 1, bool $nullUpdatedAt = false) use ($insert, $frozen): void {
        $at = $frozen->modify('-' . $ageSeconds . ' seconds')->format('Y-m-d H:i:s');
        $insert->execute([$id, $id, $deviceId, $status, $at, $nullUpdatedAt ? null : $at,
            $status === 'processing' ? $at : null,
            in_array($status, ['completed', 'failed', 'cancelled'], true) ? $at : null]);
    };
    $read = static function (int $id) use ($pdo): array {
        $query = $pdo->prepare('SELECT * FROM fingerprint_enrollment_jobs WHERE job_id=?');
        $query->execute([$id]);
        return $query->fetch(PDO::FETCH_ASSOC);
    };
    $reset = static function () use ($pdo, $frozen): void {
        $pdo->exec('DELETE FROM fingerprint_enrollment_jobs');
        $pdo->exec('SET timestamp=' . $frozen->getTimestamp());
    };

    $reset();
    $add(1, 179);
    $add(2, 180);
    $add(3, 181);
    $add(4, 181, 'processing');
    $add(5, 600, 'completed');
    $add(6, 600, 'failed');
    $add(7, 180, 'waiting', null, true);
    expectEnrollmentPickup($model->cancelIdleWaitingJobs() === 3, 'Only waiting jobs at least three minutes old must cancel.');
    expectEnrollmentPickup($read(1)['status'] === 'waiting', 'Enrollment at 2:59 must remain waiting.');
    foreach ([2, 3, 7] as $id) {
        $job = $read($id);
        expectEnrollmentPickup($job['status'] === 'cancelled' && $job['finished_at'] === $frozen->format('Y-m-d H:i:s'), 'Pickup timeout must close and timestamp the enrollment.');
        expectEnrollmentPickup(str_contains($job['error_message'], 'Sensor A') && str_contains($job['error_message'], 'within 3 minutes'), 'Cancellation must explain the three-minute Sensor A timeout.');
        expectEnrollmentPickup(!$model->hasPendingJob($id), 'Cancelled enrollment must release its user for a new enrollment.');
    }
    expectEnrollmentPickup($read(4)['status'] === 'processing' && $read(5)['status'] === 'completed' && $read(6)['status'] === 'failed', 'Pickup expiration must preserve processing and terminal enrollments.');

    $reset();
    $add(10, 180);
    $add(11, 179);
    expectEnrollmentPickup((int) $model->getNextWaitingJob(1)['job_id'] === 11 && $read(10)['status'] === 'cancelled', 'Hardware pickup must skip and cancel expired enrollment without an admin poll.');
    expectEnrollmentPickup($model->claimJob(11, 1) && $read(11)['status'] === 'processing', 'A job within its three-minute wait must claim normally.');
    expectEnrollmentPickup(!$pdo->inTransaction(), 'Normal claims must release the transaction.');

    $reset();
    $add(20, 180);
    expectEnrollmentPickup(!$model->claimJob(20, 1) && $read(20)['status'] === 'cancelled' && $read(20)['assigned_slot'] === null, 'Direct late claims must persist cancellation without reserving a sensor slot.');
    $add(21, 179);
    $race = new EnrollmentClaimDeadlineRace();
    $race->fixturePdo = $pdo;
    $race->claimTimestamp = $frozen->getTimestamp() + 1;
    expectEnrollmentPickup(!$race->claimJob(21, 1) && $read(21)['status'] === 'cancelled', 'A job crossing its deadline during claim must cancel rather than reach hardware.');
    expectEnrollmentPickup(!$pdo->inTransaction(), 'A timed-out claim must release its row and device locks.');

    $reset();
    $add(22, 180);
    expectEnrollmentPickup(!$model->updateProgress(22, 25, 'Late scan', 1) && $read(22)['status'] === 'cancelled', 'Late progress must not revive an expired waiting enrollment.');
    $add(23, 180);
    expectEnrollmentPickup(!$model->markProcessing(23) && $read(23)['status'] === 'cancelled', 'Legacy processing entry must obey the same pickup deadline.');
    $add(24, 180);
    $beforeCompletion = $read(24);
    $completion = $service->completeEnrollment(['job_id' => 24, 'enrollment_device_id' => 1, 'assigned_slot' => 7,
        'template_data_base64' => base64_encode(str_repeat('AB', 256)),
        'verification' => ['fresh_scan_verified' => true, 'stored_slot' => 7, 'matched_slot' => 7,
            'confidence' => 1, 'template_bytes' => 512, 'template_sha256' => hash('sha256', str_repeat('AB', 256))]]);
    expectEnrollmentPickup($completion['status'] === 409 && $read(24) === $beforeCompletion, 'Direct completion must reject an unclaimed waiting job without changing it or saving a fingerprint.');
    expectEnrollmentPickup((int) $pdo->query('SELECT COUNT(*) FROM fingerprints')->fetchColumn() === 0, 'An expired waiting enrollment must not create a fingerprint record.');

    $pdo->exec('SET timestamp=' . ($frozen->getTimestamp() + 10));
    expectEnrollmentPickup($model->retryJob(22), 'Timed-out enrollment must remain retryable.');
    $retried = $read(22);
    expectEnrollmentPickup($retried['status'] === 'waiting' && $retried['updated_at'] === $frozen->modify('+10 seconds')->format('Y-m-d H:i:s') && $retried['finished_at'] === null && $retried['error_message'] === null, 'Retry must clear the old result and give a fresh pickup attempt timestamp.');
    $pdo->exec('SET timestamp=' . ($frozen->getTimestamp() + 189));
    expectEnrollmentPickup($model->cancelIdleWaitingJobs() === 0 && $read(22)['status'] === 'waiting', 'A retry must retain the full 2:59 waiting interval despite its older created_at.');
    $pdo->exec('SET timestamp=' . ($frozen->getTimestamp() + 190));
    expectEnrollmentPickup($model->cancelIdleWaitingJobs() === 1 && $read(22)['status'] === 'cancelled', 'A retry must cancel at exactly three minutes after its own attempt timestamp.');

    $reset();
    $add(30, 121, 'processing');
    $add(31, 119, 'processing');
    expectEnrollmentPickup($model->requeueStaleProcessingJobs(1) === 1, 'The existing two-minute processing recovery must remain unchanged.');
    expectEnrollmentPickup($read(30)['status'] === 'waiting' && $read(30)['updated_at'] === $frozen->format('Y-m-d H:i:s') && $read(31)['status'] === 'processing', 'Automatic requeue must start a fresh waiting attempt.');
    expectEnrollmentPickup($model->cancelIdleWaitingJobs() === 0, 'An automatic requeue must not expire using the previous processing timestamp.');

    $reset();
    $add(40, 180);
    $listed = $service->listEnrollmentJobs(['job_id' => 40])['body']['jobs'][0];
    expectEnrollmentPickup($listed['status'] === 'cancelled' && $listed['is_closed'] && $listed['can_retry'] && !$listed['is_live'] && !$listed['can_cancel'], 'Both enrollment pages must receive a closed retryable state from the polling API.');
    expectEnrollmentPickup(str_contains($listed['error_message'], 'within 3 minutes'), 'Polling must expose the actual three-minute cancellation reason.');

    echo "PASS: three-minute enrollment pickup boundary, automatic cancellation, no late claim/progress/completion, fresh retry and requeue deadlines, preserved processing recovery, and polling cancellation state.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    $pdo->exec('SET timestamp=0');
    foreach ($tables as $table) $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
}
