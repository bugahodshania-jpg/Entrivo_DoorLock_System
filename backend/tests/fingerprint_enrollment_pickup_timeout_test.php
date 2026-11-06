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
$tables = ['fingerprint_enrollment_jobs', 'fingerprint_devices', 'fingerprints', 'direct_fingerprint_import_jobs',
    'fingerprint_sensor_slots', 'fingerprint_enrollment_backups'];
$frozen = new DateTimeImmutable('2026-10-21 10:00:00', new DateTimeZone('Asia/Manila'));

try {
    // Temporary shadows isolate every table used by the model and service.
    // No production enrollment, device, backup, import, or schema is modified.
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
    $pdo->exec('CREATE TEMPORARY TABLE direct_fingerprint_import_jobs (id INT PRIMARY KEY, enrollment_device_id INT, target_slot INT, status VARCHAR(20), queued_at DATETIME, processing_at DATETIME NULL) ENGINE=InnoDB');
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_sensor_slots (
        device_id INT NOT NULL, slot INT NOT NULL, state VARCHAR(20) NOT NULL DEFAULT 'free',
        fingerprint_id INT NULL, job_id INT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (device_id, slot)
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_enrollment_backups (
        job_id INT NOT NULL PRIMARY KEY, enrollment_device_id INT NOT NULL, stored_slot INT NOT NULL,
        template_data BLOB NOT NULL, template_bytes INT NOT NULL, template_sha256 CHAR(64) NOT NULL
    ) ENGINE=InnoDB");
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
        $pdo->exec('DELETE FROM fingerprint_sensor_slots');
        $pdo->exec('DELETE FROM fingerprint_enrollment_backups');
        $pdo->exec('SET timestamp=' . $frozen->getTimestamp());
    };

    $reset();
    $add(1, 599);
    $add(2, 600);
    $add(3, 601);
    $add(4, 599, 'processing');
    $add(5, 1200, 'completed');
    $add(6, 1200, 'failed');
    $add(7, 600, 'waiting', null, true);
    expectEnrollmentPickup($model->cancelIdleWaitingJobs() === 3, 'Only open jobs at least ten minutes idle must cancel.');
    expectEnrollmentPickup($read(1)['status'] === 'waiting', 'Enrollment at 9:59 must remain waiting.');
    expectEnrollmentPickup($read(4)['status'] === 'processing', 'Processing enrollment at 9:59 must remain live.');
    foreach ([2, 3, 7] as $id) {
        $job = $read($id);
        expectEnrollmentPickup($job['status'] === 'cancelled' && $job['finished_at'] === $frozen->format('Y-m-d H:i:s'), 'Pickup timeout must close and timestamp the enrollment.');
        expectEnrollmentPickup(str_contains($job['error_message'], 'Sensor A') && str_contains($job['error_message'], 'within 10 minutes'), 'Cancellation must explain the ten-minute Sensor A timeout.');
        expectEnrollmentPickup(!$model->hasPendingJob($id), 'Cancelled enrollment must release its user for a new enrollment.');
    }
    expectEnrollmentPickup($read(5)['status'] === 'completed' && $read(6)['status'] === 'failed', 'Idle expiration must preserve terminal enrollments.');

    $reset();
    $add(10, 600);
    $add(11, 599);
    expectEnrollmentPickup((int) $model->getNextWaitingJob(1)['job_id'] === 11 && $read(10)['status'] === 'cancelled', 'Hardware pickup must skip and cancel expired enrollment without an admin poll.');
    expectEnrollmentPickup($model->claimJob(11, 1) && $read(11)['status'] === 'processing', 'A job within its ten-minute wait must claim normally.');
    expectEnrollmentPickup(!$pdo->inTransaction(), 'Normal claims must release the transaction.');

    $reset();
    $add(20, 600);
    expectEnrollmentPickup(!$model->claimJob(20, 1) && $read(20)['status'] === 'cancelled' && $read(20)['assigned_slot'] === null, 'Direct late claims must persist cancellation without reserving a sensor slot.');
    $add(21, 599);
    $race = new EnrollmentClaimDeadlineRace();
    $race->fixturePdo = $pdo;
    $race->claimTimestamp = $frozen->getTimestamp() + 1;
    expectEnrollmentPickup(!$race->claimJob(21, 1) && $read(21)['status'] === 'cancelled', 'A job crossing its deadline during claim must cancel rather than reach hardware.');
    expectEnrollmentPickup(!$pdo->inTransaction(), 'A timed-out claim must release its row and device locks.');

    $reset();
    $add(22, 600);
    expectEnrollmentPickup(!$model->updateProgress(22, 25, 'Late scan', 1) && $read(22)['status'] === 'cancelled', 'Late progress must not revive an expired waiting enrollment.');
    $add(23, 600);
    expectEnrollmentPickup(!$model->markProcessing(23) && $read(23)['status'] === 'cancelled', 'Legacy processing entry must obey the same pickup deadline.');
    $add(24, 600);
    $beforeCompletion = $read(24);
    $completion = $service->completeEnrollment(['job_id' => 24, 'enrollment_device_id' => 1, 'assigned_slot' => 7,
        'template_data_base64' => base64_encode(str_repeat('AB', 256)),
        'verification' => ['fresh_scan_verified' => true, 'stored_slot' => 7, 'matched_slot' => 7,
            'confidence' => 1, 'template_bytes' => 512, 'template_sha256' => hash('sha256', str_repeat('AB', 256))]]);
    expectEnrollmentPickup($completion['status'] === 409 && $read(24) === $beforeCompletion, 'Direct completion must reject an unclaimed waiting job without changing it or saving a fingerprint.');
    expectEnrollmentPickup((int) $pdo->query('SELECT COUNT(*) FROM fingerprints')->fetchColumn() === 0, 'An expired waiting enrollment must not create a fingerprint record.');
    $pdo->exec('DELETE FROM fingerprint_enrollment_jobs WHERE job_id IN (23, 24)');

    $pdo->exec('SET timestamp=' . ($frozen->getTimestamp() + 10));
    expectEnrollmentPickup($model->retryJob(22), 'Timed-out enrollment must remain retryable.');
    $retried = $read(22);
    expectEnrollmentPickup($retried['status'] === 'waiting' && $retried['updated_at'] === $frozen->modify('+10 seconds')->format('Y-m-d H:i:s') && $retried['finished_at'] === null && $retried['error_message'] === null, 'Retry must clear the old result and give a fresh pickup attempt timestamp.');
    $pdo->exec('SET timestamp=' . ($frozen->getTimestamp() + 609));
    expectEnrollmentPickup($model->cancelIdleWaitingJobs() === 0 && $read(22)['status'] === 'waiting', 'A retry must retain the full 9:59 waiting interval despite its older created_at.');
    $pdo->exec('SET timestamp=' . ($frozen->getTimestamp() + 610));
    expectEnrollmentPickup($model->cancelIdleWaitingJobs() === 1 && $read(22)['status'] === 'cancelled', 'A retry must cancel at exactly ten minutes after its own attempt timestamp.');

    $reset();
    $add(30, 121, 'processing');
    $add(31, 119, 'processing');
    expectEnrollmentPickup($model->requeueStaleProcessingJobs(1) === 1, 'The existing two-minute processing recovery must remain unchanged.');
    expectEnrollmentPickup($read(30)['status'] === 'waiting' && $read(30)['updated_at'] === $frozen->format('Y-m-d H:i:s') && $read(31)['status'] === 'processing', 'Automatic requeue must start a fresh waiting attempt.');
    expectEnrollmentPickup($model->cancelIdleWaitingJobs() === 0, 'An automatic requeue must not expire using the previous processing timestamp.');

    $reset();
    $add(40, 600);
    $listed = $service->listEnrollmentJobs(['job_id' => 40])['body']['jobs'][0];
    expectEnrollmentPickup($listed['status'] === 'cancelled' && $listed['is_closed'] && $listed['can_retry'] && !$listed['is_live'] && !$listed['can_cancel'], 'Both enrollment pages must receive a closed retryable state from the polling API.');
    expectEnrollmentPickup(str_contains($listed['error_message'], 'within 10 minutes'), 'Polling must expose the actual ten-minute cancellation reason.');

    $reset();
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs
        (job_id,user_id,finger_name,enrollment_device_id,assigned_slot,status,progress,current_step,created_at,updated_at,started_at)
        VALUES (50,50,'Fixture finger',1,7,'processing',40,'Place the same finger again','"
        . $frozen->modify('-600 seconds')->format('Y-m-d H:i:s') . "','"
        . $frozen->modify('-600 seconds')->format('Y-m-d H:i:s') . "','"
        . $frozen->modify('-600 seconds')->format('Y-m-d H:i:s') . "')");
    $pdo->exec("INSERT INTO fingerprint_sensor_slots (device_id,slot,state,job_id) VALUES (1,7,'reserved',50)");
    expectEnrollmentPickup($model->hasPendingJob(50) === false && $read(50)['status'] === 'cancelled', 'A ten-minute idle processing job must cancel instead of staying queued for Enroll.');
    expectEnrollmentPickup(str_contains($read(50)['error_message'], 'did not progress within 10 minutes'), 'Processing timeout must explain the idle rollback.');
    expectEnrollmentPickup($pdo->query("SELECT state FROM fingerprint_sensor_slots WHERE device_id=1 AND slot=7")->fetchColumn() === 'free', 'An unfinished processing reservation must be released.');
    expectEnrollmentPickup((int) $pdo->query('SELECT COUNT(*) FROM fingerprints')->fetchColumn() === 0, 'A cancelled processing enrollment must not leave a fingerprint mapping.');

    $reset();
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs
        (job_id,user_id,finger_name,enrollment_device_id,assigned_slot,status,progress,current_step,created_at,updated_at,started_at)
        VALUES (51,51,'Fixture finger',1,8,'stored_pending_commit',96,'Fingerprint stored on Sensor A','"
        . $frozen->modify('-600 seconds')->format('Y-m-d H:i:s') . "','"
        . $frozen->modify('-600 seconds')->format('Y-m-d H:i:s') . "','"
        . $frozen->modify('-600 seconds')->format('Y-m-d H:i:s') . "')");
    $pdo->exec("INSERT INTO fingerprint_sensor_slots (device_id,slot,state,job_id) VALUES (1,8,'reserved',51)");
    $pdo->exec("INSERT INTO fingerprint_enrollment_backups VALUES (51,1,8,'backup-bytes',12,'".str_repeat('ab', 32)."')");
    expectEnrollmentPickup($model->expireStaleOpenJobs() === 1 && $read(51)['status'] === 'cancelled', 'A stored enrollment that stops progressing must cancel after ten minutes.');
    expectEnrollmentPickup($pdo->query("SELECT state FROM fingerprint_sensor_slots WHERE device_id=1 AND slot=8")->fetchColumn() === 'awaiting_cleanup', 'A stored-but-uncommitted slot must await Sensor A cleanup instead of being reused.');
    expectEnrollmentPickup((int) $pdo->query('SELECT COUNT(*) FROM fingerprint_enrollment_backups')->fetchColumn() === 0, 'A timed-out enrollment must delete its staged backup.');
    expectEnrollmentPickup(!$model->hasPendingJob(51), 'Rolled-back stored enrollment must not block a new Enroll click.');

    $reset();
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs
        (job_id,user_id,finger_name,enrollment_device_id,assigned_slot,status,progress,current_step,created_at,updated_at,started_at)
        VALUES (60,60,'Fixture finger',1,9,'processing',80,'Creating fingerprint model','"
        . $frozen->format('Y-m-d H:i:s') . "','"
        . $frozen->format('Y-m-d H:i:s') . "','"
        . $frozen->format('Y-m-d H:i:s') . "')");
    $pdo->exec("INSERT INTO fingerprint_sensor_slots (device_id,slot,state,job_id) VALUES (1,9,'reserved',60)");
    $listed = $service->listEnrollmentJobs(['job_id' => 60])['body']['jobs'][0];
    expectEnrollmentPickup(!empty($listed['can_cancel']) && !empty($listed['is_live']), 'In-progress enrollment must stay cancellable from the progress dialog.');
    $cancelled = $service->cancelEnrollmentJob(['job_id' => 60, 'reason' => 'Cancelled by admin.']);
    expectEnrollmentPickup($cancelled['status'] === 200 && $read(60)['status'] === 'cancelled', 'An administrator must be able to cancel a processing enrollment.');
    expectEnrollmentPickup($pdo->query("SELECT state FROM fingerprint_sensor_slots WHERE device_id=1 AND slot=9")->fetchColumn() === 'free', 'Cancelling before Store must release the reserved slot.');

    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs
        (job_id,user_id,finger_name,enrollment_device_id,assigned_slot,status,progress,current_step,created_at,updated_at,started_at)
        VALUES (61,61,'Fixture finger',1,10,'stored_pending_commit',96,'Fingerprint stored on Sensor A','"
        . $frozen->format('Y-m-d H:i:s') . "','"
        . $frozen->format('Y-m-d H:i:s') . "','"
        . $frozen->format('Y-m-d H:i:s') . "')");
    $pdo->exec("INSERT INTO fingerprint_sensor_slots (device_id,slot,state,job_id) VALUES (1,10,'reserved',61)");
    $pdo->exec("INSERT INTO fingerprint_enrollment_backups VALUES (61,1,10,'backup-bytes',12,'".str_repeat('cd', 32)."')");
    $listed = $service->listEnrollmentJobs(['job_id' => 61])['body']['jobs'][0];
    expectEnrollmentPickup(!empty($listed['can_cancel']) && !empty($listed['is_live']), 'A stored enrollment waiting for download must stay cancellable.');
    $cancelled = $service->cancelEnrollmentJob(['job_id' => 61, 'reason' => 'Cancelled by admin.']);
    expectEnrollmentPickup($cancelled['status'] === 200 && $read(61)['status'] === 'cancelled', 'An administrator must be able to cancel enrollment after Store.');
    expectEnrollmentPickup($pdo->query("SELECT state FROM fingerprint_sensor_slots WHERE device_id=1 AND slot=10")->fetchColumn() === 'awaiting_cleanup', 'Cancelling after Store must keep the occupied slot from being reused until Sensor A clears it.');
    expectEnrollmentPickup((int) $pdo->query('SELECT COUNT(*) FROM fingerprint_enrollment_backups WHERE job_id=61')->fetchColumn() === 0, 'Cancelling after Store must drop the staged download backup.');
    expectEnrollmentPickup(($service->getSingleJobProgress(61)['identify_match'] ?? null) === null, 'A cancelled stored enrollment must hide the download modal.');
    $lateReport = $service->reportIdentifyMatch([
        'job_id' => 61,
        'enrollment_device_id' => 1,
        'assigned_slot' => 10,
        'template_data_base64' => base64_encode(str_repeat('AB', 256)),
        'verification' => ['storage_confirmed' => true, 'stored_slot' => 10, 'matched_slot' => 10,
            'confidence' => 1, 'template_bytes' => 512, 'template_sha256' => hash('sha256', str_repeat('AB', 256))],
    ]);
    expectEnrollmentPickup($lateReport['status'] === 409 && $read(61)['status'] === 'cancelled', 'A late stored-template report must not revive a cancelled enrollment.');

    echo "PASS: ten-minute enrollment idle boundary, automatic cancellation with reservation/backup rollback, no late claim/progress/completion, fresh retry deadlines, preserved processing recovery helper, polling cancellation state, and admin cancel through Store/download.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    $pdo->exec('SET timestamp=0');
    foreach ($tables as $table) $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
}
