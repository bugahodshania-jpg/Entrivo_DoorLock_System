<?php

require_once __DIR__ . '/../models/FingerprintEnrollmentJob.php';
require_once __DIR__ . '/../models/Fingerprint.php';
require_once __DIR__ . '/FingerprintTemplateFormat.php';
require_once __DIR__ . '/FingerprintEnrollmentVerification.php';
require_once __DIR__ . '/FingerprintEnrollmentBackup.php';
require_once __DIR__ . '/FingerprintSlotRegistry.php';

final class FingerprintEnrollmentCompletionException extends RuntimeException
{
}

class FingerprintEnrollmentService
{
    private FingerprintEnrollmentJob $jobModel;
    private Fingerprint $fingerprintModel;
    private PDO $conn;
    private const MAX_FINGERPRINTS_PER_USER = 5;

    public function __construct(?PDO $pdo = null)
    {
        $this->conn = $pdo ?? entrivo_pdo();
        $this->jobModel = new FingerprintEnrollmentJob($this->conn);
        $this->fingerprintModel = new Fingerprint($this->conn);
    }

    public function createEnrollmentJob(
        $userId,
        $fingerName,
        $deviceId,
        ?int $fingerprintId = null
    )
    {
        if ($userId <= 0 || trim((string) $fingerName) === '' || (int) $deviceId <= 0) {
            return [
                "success" => false,
                "message" => "Missing required fields."
            ];
        }

        if (!$this->jobModel->userExists($userId)) {
            return [
                "success" => false,
                "message" => "User not found."
            ];
        }

        // No admin or super admin, whatever their privileges, may enroll or
        // update a fingerprint for a blocked account.
        $blocked = $this->blockedAccountMessage((int) $userId);
        if ($blocked !== null) {
            return [
                "success" => false,
                "message" => $blocked
            ];
        }

        $this->jobModel->ensureEnrollmentDevice((int) $deviceId);

        if (!$this->jobModel->deviceExists($deviceId)) {
            return [
                "success" => false,
                "message" => "Enrollment device not found."
            ];
        }

        $fingerprintRecord = null;
        if ($fingerprintId !== null && $fingerprintId > 0) {
            $fingerprintRecord = $this->fingerprintModel->getById($fingerprintId);

            if (!$fingerprintRecord) {
                return [
                    "success" => false,
                    "message" => "Fingerprint record not found."
                ];
            }

            if ((int) ($fingerprintRecord['user_id'] ?? 0) !== (int) $userId) {
                return [
                    "success" => false,
                    "message" => "Fingerprint record does not belong to the selected user."
                ];
            }
        }

        $matchingFingerRecord = $this->fingerprintModel->findByUserAndFingerName($userId, $fingerName);

        if ($matchingFingerRecord) {
            $matchingFingerprintId = (int) ($matchingFingerRecord['fingerprint_id'] ?? 0);
            $isSameFingerprintRecord = $fingerprintId !== null
                && $fingerprintId > 0
                && $matchingFingerprintId === $fingerprintId;

            if (!$isSameFingerprintRecord) {
                return [
                    "success" => false,
                    "message" => "That finger is already registered for this user. Use Update instead."
                ];
            }
        }

        $isExistingFingerprintUpdate = $fingerprintId !== null && $fingerprintId > 0;

        if (!$isExistingFingerprintUpdate) {
            $storedFingerprintCount = $this->fingerprintModel->countNamedFingerprints((int) $userId);

            if ($storedFingerprintCount >= self::MAX_FINGERPRINTS_PER_USER) {
                return [
                    "success" => false,
                    "message" => "This user already has 5 fingerprints. Update an existing finger or delete one before adding another."
                ];
            }
        }

        if ($this->jobModel->hasPendingJob($userId)) {
            return [
                "success" => false,
                "message" => "User already has a pending enrollment."
            ];
        }

        $previousSlot = $isExistingFingerprintUpdate
            ? (int) (($fingerprintRecord['enrollment_slot'] ?? 0) ?: ($matchingFingerRecord['enrollment_slot'] ?? 0))
            : 0;

        try {
            $jobId = $this->jobModel->createJob(
                $userId,
                $fingerName,
                $deviceId,
                $fingerprintId
            );
            $this->jobModel->annotateJobMode(
                (int) $jobId,
                $isExistingFingerprintUpdate ? 'update' : 'enroll',
                $previousSlot > 0 ? $previousSlot : null,
                $fingerprintId
            );
        } catch (DirectFingerprintSensorBusyException $error) {
            return ['success' => false, 'message' => $error->getMessage()];
        }

        return [
            "success" => true,
            "job_id" => $jobId,
            "fingerprint_id" => $fingerprintId,
            "job_mode" => $isExistingFingerprintUpdate ? 'update' : 'enroll',
            "previous_slot" => $previousSlot > 0 ? $previousSlot : null,
            "message" => $isExistingFingerprintUpdate
                ? "Fingerprint update job created. The existing Sensor A mapping stays active until the replacement is confirmed."
                : "Enrollment job created."
        ];
    }

    /**
     * Message refusing fingerprint enrollment for a blocked account, or null
     * when the account may be enrolled. Blocked = switched off (is_active 0),
     * except a Super Admin on standby, who is shown as Inactive, not Blocked.
     */
    public function blockedAccountMessage(int $userId): ?string
    {
        $query = $this->conn->prepare('SELECT * FROM users WHERE id = ?');
        $query->execute([$userId]);
        $user = $query->fetch(PDO::FETCH_ASSOC);
        if (!$user || !array_key_exists('is_active', $user) || (int) $user['is_active'] === 1) {
            return null;
        }
        if (($user['role'] ?? '') === 'super_admin') {
            try {
                $standby = $this->conn->prepare('SELECT 1 FROM super_admin_session_standby WHERE user_id = ? LIMIT 1');
                $standby->execute([$userId]);
                if ($standby->fetchColumn()) {
                    return null;
                }
            } catch (PDOException) {
                // No standby table: a switched-off Super Admin is blocked.
            }
        }
        return 'This account is blocked. Unblock it in Manage Users before enrolling or updating a fingerprint.';
    }

    /**
     * Cancels every open enrollment job of a user (used when the account is
     * blocked), with the same rollback as an administrator's cancel: the
     * reserved sensor slot and staged backup are released and the board's
     * late progress or completion is refused. Returns the cancelled job IDs.
     *
     * @return list<int>
     */
    public function cancelOpenJobsForUser(int $userId, string $reason): array
    {
        $statuses = FingerprintEnrollmentJob::OPEN_STATUSES;
        $query = $this->conn->prepare('SELECT job_id FROM fingerprint_enrollment_jobs WHERE user_id = ? AND status IN ('
            . implode(',', array_fill(0, count($statuses), '?')) . ') ORDER BY job_id');
        $query->execute([$userId, ...$statuses]);
        $cancelled = [];
        foreach ($query->fetchAll(PDO::FETCH_COLUMN) as $jobId) {
            if ($this->jobModel->cancelOpenJob((int) $jobId, $reason)) {
                $cancelled[] = (int) $jobId;
            }
        }
        return $cancelled;
    }

    public function startEnrollment(array $input): array
    {
        $userId = (int) ($input['user_id'] ?? 0);
        $fingerName = trim((string) ($input['finger_name'] ?? ''));
        $deviceId = (int) ($input['device_id'] ?? ($input['enrollment_device_id'] ?? 0));
        $fingerprintId = (int) ($input['fingerprint_id'] ?? 0);

        $result = $this->createEnrollmentJob(
            $userId,
            $fingerName,
            $deviceId,
            $fingerprintId > 0 ? $fingerprintId : null
        );

        return [
            'status' => $result['success'] ? 200 : 400,
            'body' => $result,
        ];
    }

    public function getPendingJob(array $query = [])
    {
        $deviceId = (int) ($query['enrollment_device_id'] ?? 0);

        if ($deviceId <= 0) {
            return null;
        }

        $this->jobModel->expireStaleOpenJobs();
        $recoverable = $this->jobModel->getRecoverableJob($deviceId);
        if ($recoverable && !FingerprintEnrollmentBackup::hasIdentifyMatch($this->conn, (int) $recoverable['job_id'])) {
            return $this->deviceJobPayload($recoverable, true);
        }

        $waiting = $this->jobModel->getNextWaitingJob($deviceId);
        return $waiting ? $this->deviceJobPayload($waiting, false) : null;
    }

    public function claimJob(int $jobId, ?int $deviceId = null): bool
    {
        return $this->jobModel->claimJob($jobId, $deviceId);
    }

    public function getJobById(int $jobId)
    {
        $job = $this->jobModel->getJobById($jobId);
        return $job ? $this->deviceJobPayload($job, in_array((string) ($job['status'] ?? ''), FingerprintEnrollmentJob::RECOVERABLE_STATUSES, true)) : null;
    }

    private function deviceJobPayload(array $job, bool $recovery): array
    {
        $job = $this->withVerification($job) ?? $job;
        $userId = (int) ($job['user_id'] ?? 0);
        $fingerprintId = (int) ($job['fingerprint_id'] ?? 0);
        $previous = (int) ($job['previous_slot'] ?? 0);
        if ($fingerprintId > 0 && $previous <= 0) {
            $record = $this->fingerprintModel->getById($fingerprintId);
            $previous = (int) ($record['enrollment_slot'] ?? 0);
        }
        if ($previous <= 0 && $userId > 0) {
            $record = $this->fingerprintModel->findByUserAndFingerName($userId, (string) ($job['finger_name'] ?? ''));
            $previous = is_array($record) ? (int) ($record['enrollment_slot'] ?? 0) : 0;
        }
        $owned = [];
        if ($userId > 0) {
            $rows = $this->conn->prepare("SELECT enrollment_slot FROM fingerprints
                WHERE user_id = ? AND status = 'active' AND enrollment_slot IS NOT NULL");
            $rows->execute([$userId]);
            foreach ($rows as $row) {
                $owned[] = (int) $row['enrollment_slot'];
            }
        }
        $mode = (string) ($job['job_mode'] ?? '');
        if ($mode !== 'update' && $mode !== 'enroll') {
            $mode = $fingerprintId > 0 ? 'update' : 'enroll';
        }
        $job['job_mode'] = $mode;
        $job['previous_slot'] = $previous > 0 ? $previous : null;
        $job['owned_slots'] = $owned;
        $job['recovery'] = $recovery || in_array((string) ($job['status'] ?? ''), FingerprintEnrollmentJob::RECOVERABLE_STATUSES, true);
        return $job;
    }

    public function getSingleJobProgress(int $jobId): ?array
    {
        $job = $this->jobModel->getJobById($jobId);

        if (!$job) {
            return null;
        }

        $status = (string) ($job['status'] ?? 'waiting');

        return [
            'job_id' => (int) $job['job_id'],
            'user_id' => (int) ($job['user_id'] ?? 0),
            'finger_name' => (string) ($job['finger_name'] ?? ''),
            'enrollment_device_id' => isset($job['enrollment_device_id']) ? (int) $job['enrollment_device_id'] : null,
            'status' => $status,
            'progress' => (int) ($job['progress'] ?? 0),
            'current_step' => (string) ($job['current_step'] ?? ''),
            'assigned_slot' => isset($job['assigned_slot']) ? (int) $job['assigned_slot'] : null,
            'error_message' => (string) ($job['error_message'] ?? ''),
            'started_at' => $job['started_at'] ?? null,
            'finished_at' => $job['finished_at'] ?? null,
            'created_at' => $job['created_at'] ?? null,
            'updated_at' => $job['updated_at'] ?? null,
            'has_template_data' => (bool) ($job['has_template_data'] ?? false),
            'template_bytes' => (int) ($job['template_bytes'] ?? 0),
            'is_live' => in_array($status, ['waiting', 'processing', 'stored_pending_commit', 'needs_reconciliation'], true),
            'is_closed' => in_array($status, ['completed', 'failed', 'cancelled'], true),
            'can_retry' => in_array($status, ['failed', 'cancelled', 'needs_reconciliation'], true),
            'can_cancel' => in_array($status, FingerprintEnrollmentJob::OPEN_STATUSES, true),
            'verification' => $this->verificationForJob($job),
            'identify_match' => $this->identifyMatchForJob($job),
        ];
    }

    public function listEnrollmentJobs(array $query = []): array
    {
        $jobId = isset($query['job_id']) && $query['job_id'] > 0 ? (int) $query['job_id'] : 0;

        if ($jobId > 0) {
            $job = $this->getSingleJobProgress($jobId);

            if ($job && !empty($query['events'])) {
                $job['events'] = $this->buildEnrollmentTimeline($job);
            }

            return [
                'status' => 200,
                'body' => [
                    'success' => true,
                    'jobs' => $job ? [$job] : [],
                ],
            ];
        }

        $this->jobModel->expireStaleOpenJobs();
        $limit = (int) ($query['limit'] ?? 12);
        $jobs = $this->jobModel->getRecentJobs($limit);

        $normalizedJobs = array_map(function (array $job): array {
            $status = (string) ($job['status'] ?? 'waiting');

            return [
                'job_id' => (int) $job['job_id'],
                'user_id' => (int) $job['user_id'],
                'fingerprint_id' => isset($job['fingerprint_id']) ? (int) $job['fingerprint_id'] : null,
                'user_name' => trim((string) ($job['full_name'] ?? '')) !== ''
                    ? trim((string) $job['full_name'])
                    : (string) ($job['username'] ?? 'Unknown user'),
                'email' => (string) ($job['email'] ?? ''),
                'role' => (string) ($job['role'] ?? ''),
                'finger_name' => (string) ($job['finger_name'] ?? ''),
                'enrollment_device_id' => isset($job['enrollment_device_id']) ? (int) $job['enrollment_device_id'] : null,
                'status' => $status,
                'progress' => (int) ($job['progress'] ?? 0),
                'current_step' => (string) ($job['current_step'] ?? ''),
                'assigned_slot' => isset($job['assigned_slot']) ? (int) $job['assigned_slot'] : null,
                'error_message' => (string) ($job['error_message'] ?? ''),
                'started_at' => $job['started_at'],
                'finished_at' => $job['finished_at'],
                'created_at' => $job['created_at'],
                'updated_at' => $job['updated_at'],
                'has_template_data' => (bool) ($job['has_template_data'] ?? false),
                'template_bytes' => (int) ($job['template_bytes'] ?? 0),
                'is_live' => in_array($status, ['waiting', 'processing', 'stored_pending_commit', 'needs_reconciliation'], true),
                'is_closed' => in_array($status, ['completed', 'failed', 'cancelled'], true),
                'can_retry' => in_array($status, ['failed', 'cancelled', 'needs_reconciliation'], true),
                'can_cancel' => in_array($status, FingerprintEnrollmentJob::OPEN_STATUSES, true),
                'verification' => $this->verificationForJob($job),
                'identify_match' => $this->identifyMatchForJob($job),
            ];
        }, $jobs);

        return [
            'status' => 200,
            'body' => [
                'success' => true,
                'jobs' => $normalizedJobs,
            ],
        ];
    }

    public function updateJobProgress(array $input): array
    {
        $jobId = (int) ($input['job_id'] ?? 0);
        $deviceId = (int) ($input['enrollment_device_id'] ?? 0);
        $progress = (int) ($input['progress'] ?? 0);
        $step = trim((string) ($input['current_step'] ?? ''));

        if ($jobId <= 0 || $deviceId <= 0 || $step === '') {
            return [
                'status' => 400,
                'body' => [
                    'success' => false,
                    'message' => 'Job ID, enrollment device, and current step are required.'
                ],
            ];
        }

        $job = $this->jobModel->getJobById($jobId);

        if (!$job) {
            return [
                'status' => 404,
                'body' => [
                    'success' => false,
                    'message' => 'Enrollment job not found.'
                ],
            ];
        }

        if ((int) ($job['enrollment_device_id'] ?? 0) > 0 && (int) $job['enrollment_device_id'] !== $deviceId) {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => 'This job belongs to a different enrollment device.'
                ],
            ];
        }

        if (in_array($job['status'], ['completed', 'failed', 'cancelled'], true)) {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => 'This enrollment job is already closed.'
                ],
            ];
        }

        $updated = $this->jobModel->updateProgress($jobId, $progress, $step, $deviceId);
        $freshJob = $this->jobModel->getJobById($jobId);

        return [
            'status' => $updated ? 200 : 409,
            'body' => [
                'success' => $updated,
                'message' => $updated ? 'Enrollment progress updated.' : 'Unable to update enrollment progress.',
                'job' => $freshJob,
            ],
        ];
    }

    public function reserveEmptySlot(array $input): array
    {
        foreach (['job_id', 'enrollment_device_id', 'expected_assigned_slot', 'sensor_capacity'] as $field) {
            if (!isset($input[$field]) || !is_int($input[$field]) || $input[$field] <= 0) {
                return ['status' => 400, 'body' => ['success' => false, 'message' => 'Job, device, reserved slot, and sensor capacity must be positive integers.']];
            }
        }
        $capacity = $input['sensor_capacity'];
        $occupiedSlots = $input['occupied_slots'] ?? null;
        if ($capacity < 2 || $capacity > 65535 || $input['expected_assigned_slot'] > 65535 ||
            !is_array($occupiedSlots) || !array_is_list($occupiedSlots) || count($occupiedSlots) > $capacity) {
            return ['status' => 400, 'body' => ['success' => false, 'message' => 'A valid sensor capacity and complete occupied-slot list are required.']];
        }
        foreach ($occupiedSlots as $slot) {
            if (!is_int($slot) || $slot < 0 || $slot >= $capacity) {
                return ['status' => 400, 'body' => ['success' => false, 'message' => 'The sensor slot index contains an invalid slot.']];
            }
        }

        try {
            $assignedSlot = $this->jobModel->reserveEmptySlot($input['job_id'], $input['enrollment_device_id'],
                $input['expected_assigned_slot'], $capacity, $occupiedSlots);
            return ['status' => 200, 'body' => ['success' => true, 'job_id' => $input['job_id'],
                'assigned_slot' => $assignedSlot, 'message' => 'An empty sensor slot was reserved. Existing fingerprints were preserved.']];
        } catch (FingerprintSlotReservationException $error) {
            return ['status' => $error->getCode(), 'body' => ['success' => false, 'message' => $error->getMessage()]];
        }
    }

    public function completeEnrollment(array $input): array
    {
        $jobId = (int) ($input['job_id'] ?? 0);
        $deviceId = (int) ($input['enrollment_device_id'] ?? 0);
        $assignedSlot = (int) ($input['assigned_slot'] ?? 0);
        if ($jobId <= 0 || $deviceId <= 0 || $assignedSlot <= 0) {
            return $this->completionFailure(400, 'Job ID, enrollment device, and the reserved sensor slot are required.');
        }

        $storageConfirmed = is_array($input['verification'] ?? null)
            && ($input['verification']['storage_confirmed'] ?? null) === true;
        $encoded = $input['template_data_base64'] ?? null;
        $binary = '';
        if (is_string($encoded) && trim($encoded) !== '') {
            $decoded = base64_decode(trim($encoded), true);
            if ($decoded === false) {
                return $this->completionFailure(400, 'Template data must be valid base64.');
            }
            $binary = $decoded;
            if (!FingerprintTemplateFormat::isSupportedSize(strlen($binary))) {
                if (!$storageConfirmed) {
                    return $this->completionFailure(422, sprintf(
                        'Invalid fingerprint template size. Supported sizes: %s bytes; got %d bytes.',
                        FingerprintTemplateFormat::describeSupportedSizes(), strlen($binary)
                    ));
                }
                $binary = '';
            } elseif (!FingerprintTemplateFormat::isUsableTemplate($binary)) {
                if (!$storageConfirmed) {
                    return $this->completionFailure(422, 'The sensor returned invalid fingerprint template data containing only one repeated byte. Enroll the finger again; the existing fingerprint was preserved.');
                }
                $binary = '';
            }
        } elseif (!$storageConfirmed) {
            return $this->completionFailure(400, 'Actual fingerprint template data is required before completion.');
        }
        try {
            $proof = FingerprintEnrollmentVerification::normalize($input['verification'] ?? null, $binary);
        } catch (InvalidArgumentException $error) {
            return $this->completionFailure(422, $error->getMessage());
        }
        if ($proof['stored_slot'] !== $assignedSlot || $proof['matched_slot'] !== $assignedSlot) {
            return $this->completionFailure(409, 'The stored sensor slots must both equal the reserved job slot.');
        }
        if ((int) ($proof['template_bytes'] ?? 0) <= 0 || ($proof['template_sha256'] ?? '') === '') {
            $this->jobModel->markStoredPending(
                $jobId,
                $deviceId,
                $assignedSlot,
                'Sensor A storage is recorded. Waiting for a confirmed stored-slot template.'
            );
            return $this->completionFailure(409, 'A confirmed stored-slot template is required before this fingerprint can open the door. The stored Sensor A template was preserved.');
        }
        if ($this->conn->inTransaction()) {
            return $this->completionFailure(409, 'Enrollment completion requires its own transaction.');
        }

        $this->conn->beginTransaction();
        try {
            $job = $this->jobModel->lockJobById($jobId);
            if (!$job) throw new FingerprintEnrollmentCompletionException('Enrollment job not found.', 404);
            if ((int) ($job['enrollment_device_id'] ?? 0) !== $deviceId) {
                throw new FingerprintEnrollmentCompletionException('This job belongs to a different enrollment device.', 409);
            }
            $reservedSlot = (int) ($job['assigned_slot'] ?? 0);
            if ($reservedSlot <= 0 || $reservedSlot !== $assignedSlot) {
                throw new FingerprintEnrollmentCompletionException('Assigned slot does not match the stored reserved job slot.', 409);
            }
            if (!in_array($job['status'], ['processing', 'stored_pending_commit', 'completed'], true) ||
                (in_array($job['status'], ['processing', 'stored_pending_commit'], true) && !empty($job['finished_at']))) {
                throw new FingerprintEnrollmentCompletionException('Only a claimed, processing enrollment job can be completed.', 409);
            }
            if (!FingerprintEnrollmentVerification::tableExists($this->conn)) {
                throw new FingerprintEnrollmentCompletionException('Enrollment verification storage is not installed. Apply the fingerprint enrollment verification migration before completing enrollment.', 503);
            }

            if ($job['status'] === 'completed') {
                $stored = FingerprintEnrollmentVerification::findByJobId($this->conn, $jobId);
                if (!$stored || (int) ($job['progress'] ?? 0) !== 100 || empty($job['finished_at']) ||
                    (int) $stored['enrollment_device_id'] !== $deviceId ||
                    (int) $stored['user_id'] !== (int) $job['user_id'] ||
                    (string) $stored['finger_name'] !== (string) $job['finger_name']) {
                    throw new FingerprintEnrollmentCompletionException('This completed job has no matching durable sensor verification proof.', 409);
                }
                $metadata = FingerprintEnrollmentVerification::metadata($stored);
                foreach ($proof as $field => $value) {
                    if ($metadata[$field] !== $value) {
                        throw new FingerprintEnrollmentCompletionException('Completion retry does not match the original sensor verification proof.', 409);
                    }
                }
                $fingerprint = $this->fingerprintModel->getById((int) $stored['fingerprint_id']);
                $this->assertSavedEnrollment($fingerprint, $job, $binary, $proof);
                $this->conn->commit();
                return $this->completionSuccess($job, $fingerprint, $metadata, true);
            }
            if (FingerprintEnrollmentVerification::findByJobId($this->conn, $jobId)) {
                throw new FingerprintEnrollmentCompletionException('This job already has a conflicting verification record.', 409);
            }
            $staged = FingerprintEnrollmentBackup::find($this->conn, $jobId);
            if ($staged && ((int) $staged['enrollment_device_id'] !== $deviceId ||
                (int) $staged['stored_slot'] !== $assignedSlot ||
                (int) $staged['template_bytes'] !== strlen($binary) ||
                $staged['template_data'] !== $binary ||
                !hash_equals((string) $staged['template_sha256'], $proof['template_sha256']))) {
                throw new FingerprintEnrollmentCompletionException('The stored template does not match the staged slot backup.', 409);
            }
            $targetId = (int) ($job['fingerprint_id'] ?? 0);
            $previous = $targetId > 0 ? $this->fingerprintModel->getById($targetId) : null;
            if ($targetId > 0 && (!$previous || (int) $previous['user_id'] !== (int) $job['user_id'])) {
                throw new FingerprintEnrollmentCompletionException('The fingerprint update target no longer belongs to this user.', 409);
            }
            $job['is_update'] = $previous !== null && (!empty($previous['enrollment_slot']) || !empty($previous['template_data']));
            $previousSlot = (int) (($job['previous_slot'] ?? 0) ?: ($previous['enrollment_slot'] ?? 0));
            if ($binary !== '') {
                $fingerprint = $this->fingerprintModel->saveEnrollment(
                    (int) $job['user_id'], (string) $job['finger_name'], $deviceId, $assignedSlot,
                    $binary, $proof['template_sha256'], $targetId > 0 ? $targetId : null
                );
            } else {
                $fingerprint = $this->fingerprintModel->activateSensorMapping(
                    (int) $job['user_id'], (string) $job['finger_name'], $deviceId, $assignedSlot,
                    $targetId > 0 ? $targetId : null
                );
            }
            $fingerprint = $this->fingerprintModel->getById((int) ($fingerprint['fingerprint_id'] ?? 0));
            $this->assertSavedEnrollment($fingerprint, $job, $binary, $proof);
            FingerprintSlotRegistry::markActive(
                $this->conn,
                $deviceId,
                $assignedSlot,
                (int) ($fingerprint['fingerprint_id'] ?? 0),
                $jobId
            );
            if ($job['is_update'] && $previousSlot > 0 && $previousSlot !== $assignedSlot) {
                FingerprintSlotRegistry::markAwaitingCleanup($this->conn, $deviceId, $previousSlot);
            }
            $stored = FingerprintEnrollmentVerification::record($this->conn, $job, $fingerprint, $proof);
            if (!$stored || !$this->jobModel->completeJob($jobId, $assignedSlot, $deviceId)) {
                throw new FingerprintEnrollmentCompletionException('Unable to atomically confirm the saved fingerprint and enrollment job.', 409);
            }
            FingerprintEnrollmentBackup::delete($this->conn, $jobId);
            $freshJob = $this->jobModel->lockJobById($jobId);
            if (!$freshJob || $freshJob['status'] !== 'completed' || (int) $freshJob['progress'] !== 100 || empty($freshJob['finished_at'])) {
                throw new FingerprintEnrollmentCompletionException('The completed enrollment could not be read back.', 409);
            }
            $freshJob['is_update'] = $job['is_update'];
            $metadata = FingerprintEnrollmentVerification::metadata($stored);
            $this->conn->commit();
            return $this->completionSuccess($freshJob, $fingerprint, $metadata);
        } catch (Throwable $error) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            if ($error instanceof FingerprintEnrollmentCompletionException) {
                return $this->completionFailure($error->getCode(), $error->getMessage());
            }
            error_log('Verified enrollment completion: ' . $error->getMessage());
            return $this->completionFailure(503, 'The fingerprint, verification proof, and completed job could not be saved together. Existing enrollment data was preserved; retry the verified completion.');
        }
    }

    private function assertSavedEnrollment(?array $fingerprint, array $job, string $binary, array $proof): void
    {
        if (!$fingerprint || (int) ($fingerprint['fingerprint_id'] ?? 0) <= 0 ||
            (int) ($fingerprint['user_id'] ?? 0) !== (int) $job['user_id'] ||
            (string) ($fingerprint['finger_name'] ?? '') !== (string) $job['finger_name'] ||
            (int) ($fingerprint['enrollment_device_id'] ?? 0) !== (int) $job['enrollment_device_id'] ||
            (int) ($fingerprint['enrollment_slot'] ?? 0) !== $proof['stored_slot'] ||
            (int) ($fingerprint['shared_door_slot'] ?? 0) !== $proof['stored_slot'] ||
            ($fingerprint['status'] ?? null) !== 'active') {
            throw new FingerprintEnrollmentCompletionException('Saved fingerprint bytes, hash, ownership, or sensor mapping did not match the verified enrollment.', 409);
        }
        if ($binary === '') {
            return;
        }
        if (($fingerprint['template_data'] ?? null) !== $binary ||
            ($fingerprint['template_hash'] ?? null) !== $proof['template_sha256'] ||
            FingerprintTemplateFormat::verifiedBinary($fingerprint['template_data'] ?? null, $fingerprint['template_hash'] ?? null) !== $binary) {
            throw new FingerprintEnrollmentCompletionException('Saved fingerprint bytes, hash, ownership, or sensor mapping did not match the verified enrollment.', 409);
        }
    }

    private function normalizeBoardJob(array $job): array
    {
        // MySQL returns these as strings. The board accepts only JSON numbers.
        foreach (['job_id', 'user_id', 'fingerprint_id', 'enrollment_device_id', 'assigned_slot', 'progress'] as $field) {
            if (isset($job[$field]) && is_numeric($job[$field])) {
                $job[$field] = (int) $job[$field];
            }
        }

        return $job;
    }

    private function completionSuccess(array $job, array $fingerprint, array $proof, bool $idempotent = false): array
    {
        $job = $this->normalizeBoardJob($job);
        $job['verification'] = $proof;
        $fingerprint['has_template_data'] = true;
        $fingerprint['template_bytes'] = $proof['template_bytes'];
        unset($fingerprint['template_data']);
        return ['status' => 200, 'body' => [
            'success' => true, 'message' => 'Enrollment completed after the stored-slot template was downloaded.',
            'job' => $job, 'fingerprint' => $fingerprint, 'verification' => $proof, 'idempotent' => $idempotent,
        ]];
    }

    private function completionFailure(int $status, string $message): array
    {
        return ['status' => $status, 'body' => ['success' => false, 'message' => $message]];
    }

    private function verificationForJob(array $job): ?array
    {
        if (($job['status'] ?? null) !== 'completed') return null;
        $stored = FingerprintEnrollmentVerification::findByJobId($this->conn, (int) $job['job_id']);
        return $stored ? FingerprintEnrollmentVerification::metadata($stored) : null;
    }

    private function identifyMatchForJob(array $job): ?array
    {
        $status = (string) ($job['status'] ?? '');
        if (!in_array($status, ['stored_pending_commit', 'needs_reconciliation', 'processing'], true)) {
            return null;
        }
        return FingerprintEnrollmentBackup::identifyMatch($this->conn, (int) $job['job_id']);
    }

    public function reportIdentifyMatch(array $input): array
    {
        $jobId = (int) ($input['job_id'] ?? 0);
        $deviceId = (int) ($input['enrollment_device_id'] ?? 0);
        $assignedSlot = (int) ($input['assigned_slot'] ?? 0);
        $encoded = $input['template_data_base64'] ?? null;
        $binary = is_string($encoded) ? base64_decode(trim($encoded), true) : false;
        if ($jobId <= 0 || $deviceId <= 0 || $assignedSlot <= 0 || !is_string($binary) || $binary === '') {
            return $this->completionFailure(400, 'Job, device, reserved slot, and the stored-slot template are required.');
        }
        if (!FingerprintTemplateFormat::isSupportedSize(strlen($binary)) || !FingerprintTemplateFormat::isUsableTemplate($binary)) {
            return $this->completionFailure(422, 'The stored template is not a usable Sensor A model.');
        }
        try {
            $proof = FingerprintEnrollmentVerification::normalize($input['verification'] ?? null, $binary);
        } catch (InvalidArgumentException $error) {
            return $this->completionFailure(422, $error->getMessage());
        }
        if ($proof['stored_slot'] !== $assignedSlot || $proof['matched_slot'] !== $assignedSlot) {
            return $this->completionFailure(409, 'The reported template must belong to the reserved sensor slot.');
        }
        if ((int) ($proof['template_bytes'] ?? 0) <= 0 || ($proof['template_sha256'] ?? '') === '') {
            return $this->completionFailure(409, 'A confirmed stored-slot template is required before download.');
        }
        $job = $this->jobModel->getJobById($jobId);
        if (!$job || (int) ($job['enrollment_device_id'] ?? 0) !== $deviceId) {
            return $this->completionFailure(404, 'Enrollment job not found for this device.');
        }
        if (!in_array($job['status'], ['processing', 'stored_pending_commit', 'needs_reconciliation'], true)) {
            return $this->completionFailure(409, 'This enrollment is not waiting for a stored-slot template.');
        }
        if ((int) ($job['assigned_slot'] ?? 0) !== $assignedSlot) {
            return $this->completionFailure(409, 'The stored template slot does not match the reserved job slot.');
        }
        try {
            FingerprintEnrollmentBackup::ensure($this->conn);
            FingerprintEnrollmentBackup::stage($this->conn, $jobId, $deviceId, $assignedSlot, $binary, $proof['template_sha256']);
            FingerprintEnrollmentBackup::recordIdentifyMatch(
                $this->conn,
                $jobId,
                $proof['matched_slot'],
                max(1, (int) ($proof['confidence'] ?? 1)),
                !empty($proof['fresh_scan_verified'])
            );
        } catch (InvalidArgumentException $error) {
            return $this->completionFailure(422, $error->getMessage());
        } catch (DomainException $error) {
            return $this->completionFailure(409, $error->getMessage());
        }
        $this->jobModel->markStoredPending(
            $jobId,
            $deviceId,
            $assignedSlot,
            'Stored at slot ' . $proof['stored_slot'] . '. Waiting for download.'
        );
        $this->jobModel->updateProgress(
            $jobId,
            95,
            'Stored at slot ' . $proof['stored_slot'] . '. Waiting for download.',
            $deviceId
        );
        return [
            'status' => 200,
            'body' => [
                'success' => true,
                'job_id' => $jobId,
                'assigned_slot' => $assignedSlot,
                'matched_slot' => $proof['matched_slot'],
                'confidence' => $proof['confidence'],
                'template_bytes' => $proof['template_bytes'],
                'template_sha256' => $proof['template_sha256'],
                'message' => 'The stored-slot template is confirmed. Download it to save it.',
                'job' => $this->getSingleJobProgress($jobId),
            ],
        ];
    }

    public function commitEnrollmentDownload(array $input): array
    {
        $jobId = (int) ($input['job_id'] ?? 0);
        if ($jobId <= 0) {
            return $this->completionFailure(400, 'A valid enrollment job is required.');
        }
        $job = $this->jobModel->getJobById($jobId);
        if (!$job) {
            return $this->completionFailure(404, 'Enrollment job not found.');
        }
        $match = FingerprintEnrollmentBackup::identifyMatch($this->conn, $jobId);
        if (!$match) {
            return $this->completionFailure(409, 'Sensor A has not confirmed the stored-slot template yet. Wait for the stored template to be read, then download.');
        }
        $result = $this->completeEnrollment([
            'job_id' => $jobId,
            'enrollment_device_id' => (int) $job['enrollment_device_id'],
            'assigned_slot' => (int) $job['assigned_slot'],
            'template_data_base64' => $match['template_data_base64'],
            'verification' => [
                'fresh_scan_verified' => !empty($match['fresh_scan_verified']),
                'storage_confirmed' => true,
                'stored_slot' => $match['stored_slot'],
                'matched_slot' => $match['matched_slot'],
                'confidence' => $match['confidence'],
                'template_bytes' => $match['template_bytes'],
                'template_sha256' => $match['template_sha256'],
            ],
        ]);
        if (!empty($result['body']['success'])) {
            $this->cancelPostDownloadVerifyJobs($jobId);
        }
        return $result;
    }

    private function cancelPostDownloadVerifyJobs(int $jobId): void
    {
        try {
            $this->conn->prepare("UPDATE fingerprint_enrollment_verify_jobs
                SET status='cancelled', current_step='Enrollment finished after Download. No third scan.',
                    finished_at=NOW(), error_message='Post-download verify is not part of enrollment.'
                WHERE enrollment_job_id=? AND status IN ('pending','processing')")->execute([$jobId]);
        } catch (Throwable $error) {
            // Table may be absent on older databases.
        }
    }

    private function withVerification($job): ?array
    {
        if (!$job) return null;
        $job = $this->normalizeBoardJob($job);
        $job['verification'] = $this->verificationForJob($job);
        return $job;
    }

    public function markStored(array $input): array
    {
        $jobId = (int) ($input['job_id'] ?? 0);
        $deviceId = (int) ($input['enrollment_device_id'] ?? 0);
        $slot = (int) ($input['assigned_slot'] ?? 0);
        $step = trim((string) ($input['current_step'] ?? ('Stored at slot ' . $slot)));
        if ($jobId <= 0 || $deviceId <= 0 || $slot <= 0) {
            return ['status' => 400, 'body' => ['success' => false, 'message' => 'Job, device, and stored slot are required.']];
        }
        $job = $this->jobModel->getJobById($jobId);
        if (!$job) {
            return ['status' => 404, 'body' => ['success' => false, 'message' => 'Enrollment job not found.']];
        }
        if ((int) ($job['enrollment_device_id'] ?? 0) !== $deviceId) {
            return ['status' => 409, 'body' => ['success' => false, 'message' => 'This job belongs to a different enrollment device.']];
        }
        if (in_array($job['status'], ['completed', 'failed', 'cancelled'], true)) {
            return ['status' => 409, 'body' => ['success' => false, 'message' => 'This enrollment job is already closed.']];
        }
        $updated = $this->jobModel->markStoredPending($jobId, $deviceId, $slot, $step);
        FingerprintSlotRegistry::reserve($this->conn, $deviceId, $slot, $jobId, (int) ($job['fingerprint_id'] ?? 0) ?: null);
        return [
            'status' => $updated ? 200 : 409,
            'body' => [
                'success' => $updated,
                'message' => $updated
                    ? 'Sensor storage is recorded. The original fingerprint stays usable until this mapping is committed.'
                    : 'Unable to record sensor storage.',
                'job' => $this->getJobById($jobId),
            ],
        ];
    }

    public function resolveDuplicateMatch(array $input): array
    {
        $jobId = (int) ($input['job_id'] ?? 0);
        $deviceId = (int) ($input['enrollment_device_id'] ?? 0);
        $matchedSlot = (int) ($input['matched_slot'] ?? 0);
        if ($jobId <= 0 || $deviceId <= 0 || $matchedSlot <= 0) {
            return ['status' => 400, 'body' => ['success' => false, 'message' => 'Job, device, and matched slot are required.']];
        }
        $job = $this->jobModel->getJobById($jobId);
        if (!$job || (int) ($job['enrollment_device_id'] ?? 0) !== $deviceId) {
            return ['status' => 404, 'body' => ['success' => false, 'message' => 'Enrollment job not found for this device.']];
        }
        $owner = FingerprintSlotRegistry::owner($this->conn, $deviceId, $matchedSlot);
        $fingerprintId = (int) ($job['fingerprint_id'] ?? 0);
        $previousSlot = (int) ($job['previous_slot'] ?? 0);
        if ($fingerprintId > 0 && $previousSlot <= 0) {
            $record = $this->fingerprintModel->getById($fingerprintId);
            $previousSlot = (int) ($record['enrollment_slot'] ?? 0);
        }

        if ($owner && (int) $owner['user_id'] === (int) $job['user_id'] && $fingerprintId > 0 &&
            ((int) $owner['fingerprint_id'] === $fingerprintId || $matchedSlot === $previousSlot)) {
            return ['status' => 409, 'body' => [
                'success' => false,
                'action' => 'reject',
                'owner' => 'same_fingerprint',
                'matched_slot' => $matchedSlot,
                'fingerprint_id' => (int) $owner['fingerprint_id'],
                'message' => 'This finger is already enrolled as ' . $owner['finger_name'] . ' for this user at sensor slot ' . $matchedSlot . '. The existing enrollment was kept.',
            ]];
        }
        if ($owner && (int) $owner['user_id'] === (int) $job['user_id']) {
            return ['status' => 409, 'body' => [
                'success' => false,
                'action' => 'reject',
                'owner' => 'same_user_other_finger',
                'matched_slot' => $matchedSlot,
                'fingerprint_id' => (int) $owner['fingerprint_id'],
                'message' => 'This finger is already enrolled as ' . $owner['finger_name'] . ' for this user at sensor slot ' . $matchedSlot . '. Existing sensor data was preserved.',
            ]];
        }
        if ($owner) {
            return ['status' => 409, 'body' => [
                'success' => false,
                'action' => 'reject',
                'owner' => 'other_user',
                'matched_slot' => $matchedSlot,
                'fingerprint_id' => (int) $owner['fingerprint_id'],
                'message' => 'This finger is already enrolled as ' . $owner['finger_name'] . ' for another user at sensor slot ' . $matchedSlot . '. Existing sensor data was preserved.',
            ]];
        }
        return ['status' => 409, 'body' => [
            'success' => false,
            'action' => 'reject',
            'owner' => 'unknown',
            'matched_slot' => $matchedSlot,
            'message' => 'This finger already matches sensor slot ' . $matchedSlot . '. Reconcile the existing fingerprint mapping before retrying. Existing sensor data was preserved.',
        ]];
    }

    public function failEnrollment(array $input): array
    {
        $jobId = (int) ($input['job_id'] ?? 0);
        $deviceId = (int) ($input['enrollment_device_id'] ?? 0);
        $message = trim((string) ($input['error_message'] ?? 'Enrollment failed.'));

        if ($jobId <= 0 || $deviceId <= 0) {
            return [
                'status' => 400,
                'body' => [
                    'success' => false,
                    'message' => 'Job ID and enrollment device are required.'
                ],
            ];
        }

        $job = $this->jobModel->getJobById($jobId);

        if (!$job) {
            return [
                'status' => 404,
                'body' => [
                    'success' => false,
                    'message' => 'Enrollment job not found.'
                ],
            ];
        }

        if ((int) ($job['enrollment_device_id'] ?? 0) > 0 && (int) $job['enrollment_device_id'] !== $deviceId) {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => 'This job belongs to a different enrollment device.'
                ],
            ];
        }

        if (in_array($job['status'], ['completed', 'failed', 'cancelled'], true)) {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => 'This enrollment job is already closed.'
                ],
            ];
        }

        $failed = $this->jobModel->failJob($jobId, $message, $deviceId);
        $freshJob = $this->jobModel->getJobById($jobId);

        return [
            'status' => $failed ? 200 : 409,
            'body' => [
                'success' => $failed,
                'message' => $failed ? 'Enrollment job marked as failed.' : 'Unable to fail enrollment job.',
                'job' => $freshJob,
            ],
        ];
    }

    public function retryEnrollmentJob(array $input): array
    {
        $jobId = (int) ($input['job_id'] ?? 0);

        if ($jobId <= 0) {
            return [
                'status' => 400,
                'body' => [
                    'success' => false,
                    'message' => 'A valid job ID is required.'
                ],
            ];
        }

        $job = $this->jobModel->getJobById($jobId);

        if (!$job) {
            return [
                'status' => 404,
                'body' => [
                    'success' => false,
                    'message' => 'Enrollment job not found.'
                ],
            ];
        }

        // A retry is a new enrollment attempt: refused for a blocked account too.
        $blocked = $this->blockedAccountMessage((int) ($job['user_id'] ?? 0));
        if ($blocked !== null) {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => $blocked
                ],
            ];
        }

        if ($job['status'] === 'completed') {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => 'Completed enrollment jobs cannot be retried.'
                ],
            ];
        }

        if (!in_array($job['status'], ['failed', 'cancelled', 'needs_reconciliation'], true)) {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => 'Only failed or cancelled jobs can be retried.'
                ],
            ];
        }

        $retried = $this->jobModel->retryJob($jobId);
        $freshJob = $this->jobModel->getJobById($jobId);

        return [
            'status' => $retried ? 200 : 409,
            'body' => [
                'success' => $retried,
                'message' => $retried
                    ? 'Enrollment restarted. Sensor A will run a fresh two-scan enrollment.'
                    : 'Unable to retry enrollment job.',
                'job' => $freshJob,
            ],
        ];
    }

    public function cancelEnrollmentJob(array $input): array
    {
        $jobId = (int) ($input['job_id'] ?? 0);
        $reason = trim((string) ($input['reason'] ?? 'Cancelled by admin.'));

        if ($jobId <= 0) {
            return [
                'status' => 400,
                'body' => [
                    'success' => false,
                    'message' => 'A valid job ID is required.'
                ],
            ];
        }

        $job = $this->jobModel->getJobById($jobId);

        if (!$job) {
            return [
                'status' => 404,
                'body' => [
                    'success' => false,
                    'message' => 'Enrollment job not found.'
                ],
            ];
        }

        if ($job['status'] === 'completed') {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => 'Completed enrollment jobs cannot be cancelled.'
                ],
            ];
        }

        if (!in_array((string) $job['status'], FingerprintEnrollmentJob::OPEN_STATUSES, true)) {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => 'This enrollment is already closed and cannot be cancelled.'
                ],
            ];
        }

        $deviceId = (int) ($job['enrollment_device_id'] ?? 0);
        $slot = (int) ($job['assigned_slot'] ?? 0);
        $progress = (int) ($job['progress'] ?? 0);
        $mayHaveStoredTemplate = in_array((string) $job['status'], FingerprintEnrollmentJob::RECOVERABLE_STATUSES, true)
            || $progress >= 85
            || str_contains(strtolower((string) ($job['current_step'] ?? '')), 'stored');
        $actorId = (int) ($input['actor_id'] ?? 0);

        $cancelled = $this->jobModel->cancelOpenJob($jobId, $reason !== '' ? $reason : 'Cancelled by admin.');
        $freshJob = $this->jobModel->getJobById($jobId);
        $sensorJob = null;
        $message = $cancelled ? 'Enrollment job cancelled. Start enrollment again.' : 'Unable to cancel enrollment job.';

        if ($cancelled && $mayHaveStoredTemplate && $deviceId > 0 && $slot > 0 && $actorId > 0) {
            try {
                require_once __DIR__ . '/SensorMemorySchema.php';
                require_once __DIR__ . '/SensorMemoryService.php';
                if (SensorMemorySchema::tableExists($this->conn)) {
                    $queued = (new SensorMemoryService($this->conn))->adminAction([
                        'action' => 'delete_slot',
                        'actor_id' => $actorId,
                        'device_id' => $deviceId,
                        'slot_id' => $slot,
                    ]);
                    $sensorJob = $queued['job'] ?? null;
                    $message = 'Enrollment cancelled. Sensor A is clearing slot ' . $slot
                        . '. Keep the door locked, then start enrollment again.';
                }
            } catch (Throwable $error) {
                $message = 'Enrollment cancelled in the database, but Sensor A slot ' . $slot
                    . ' still needs clearing in Sensor Memory. ' . $error->getMessage();
            }
        }

        return [
            'status' => $cancelled ? 200 : 409,
            'body' => [
                'success' => $cancelled,
                'message' => $message,
                'job' => $freshJob,
                'sensor_job' => $sensorJob,
            ],
        ];
    }

    /**
     * @param array<string, mixed> $job
     * @return array<int, array{title: string, description: string, status: string, occurred_at: string}>
     */
    private function buildEnrollmentTimeline(array $job): array
    {
        require_once __DIR__ . '/ActivityLogService.php';
        $logged = (new ActivityLogService(entrivo_pdo()))->listFingerprintJobEvents((int) ($job['job_id'] ?? 0));
        $events = [];

        foreach ($logged as $index => $event) {
            $description = trim((string) ($event['description'] ?? ''));
            $events[] = [
                'title' => $this->enrollmentTimelineTitle((string) ($event['activity_type'] ?? ''), $description),
                'description' => $description,
                'status' => (string) ($event['status'] ?? 'Success'),
                'occurred_at' => (string) ($event['occurred_at'] ?? ''),
                'rank' => 10 + $index,
            ];
        }

        $status = strtolower(trim((string) ($job['status'] ?? '')));
        $createdAt = trim((string) ($job['created_at'] ?? ''));
        $startedAt = trim((string) ($job['started_at'] ?? ''));
        $finishedAt = trim((string) ($job['finished_at'] ?? ''));
        $updatedAt = trim((string) ($job['updated_at'] ?? ''));
        $step = trim((string) ($job['current_step'] ?? ''));
        $errorMessage = trim((string) ($job['error_message'] ?? ''));
        $progress = (int) ($job['progress'] ?? 0);

        if ($createdAt !== '' && !$this->enrollmentTimelineHasTitle($events, ['Created', 'Retried', 'Queued'])) {
            $events[] = [
                'title' => 'Queued',
                'description' => 'This enrollment job was added to the station queue.',
                'status' => 'Pending',
                'occurred_at' => $createdAt,
                'rank' => 1,
            ];
        }

        if ($startedAt !== '' && !$this->enrollmentTimelineHasText($events, 'claimed this job')) {
            $events[] = [
                'title' => 'Claimed',
                'description' => 'The enrollment station claimed this job and started the scan.',
                'status' => 'Pending',
                'occurred_at' => $startedAt,
                'rank' => 2,
            ];
        }

        $genericSteps = [
            'waiting for esp32',
            'job claimed by esp32',
            'enrollment completed',
            'enrollment failed',
            'enrollment cancelled',
        ];
        $progressAt = $finishedAt !== '' ? $finishedAt : $updatedAt;

        if (
            $step !== ''
            && !in_array(strtolower($step), $genericSteps, true)
            && $progressAt !== ''
            && $progressAt !== $startedAt
            && !$this->enrollmentTimelineHasText($events, $step)
        ) {
            $events[] = [
                'title' => 'Progress',
                'description' => $step . ' (' . $progress . '%).',
                'status' => $status === 'failed' ? 'Failed' : ($status === 'cancelled' ? 'Cancelled' : 'Pending'),
                'occurred_at' => $progressAt,
                'rank' => 4,
            ];
        }

        $outcomeAt = $finishedAt !== '' ? $finishedAt : $updatedAt;

        if ($status === 'completed' && $outcomeAt !== '' && !$this->enrollmentTimelineHasTitle($events, ['Enrolled', 'Updated', 'Completed'])) {
            $saved = !empty($job['has_template_data']) ? ' The template was saved.' : '';
            $events[] = [
                'title' => 'Completed',
                'description' => 'Enrollment finished and the fingerprint is ready.' . $saved,
                'status' => 'Success',
                'occurred_at' => $outcomeAt,
                'rank' => 6,
            ];
        }

        if ($status === 'failed' && $outcomeAt !== '' && !$this->enrollmentTimelineHasTitle($events, ['Failed'])) {
            $events[] = [
                'title' => 'Failed',
                'description' => $errorMessage !== '' ? $errorMessage : ($step !== '' ? $step . '.' : 'This enrollment job did not finish.'),
                'status' => 'Failed',
                'occurred_at' => $outcomeAt,
                'rank' => 6,
            ];
        }

        if ($status === 'cancelled' && $outcomeAt !== '' && !$this->enrollmentTimelineHasTitle($events, ['Cancelled'])) {
            $events[] = [
                'title' => 'Cancelled',
                'description' => $errorMessage !== '' ? $errorMessage : 'This enrollment job was cancelled.',
                'status' => 'Cancelled',
                'occurred_at' => $outcomeAt,
                'rank' => 6,
            ];
        }

        if ($status === 'cancelled' && $errorMessage !== '') {
            foreach ($events as &$event) {
                if (
                    (string) ($event['title'] ?? '') === 'Cancelled'
                    && !str_contains(strtolower((string) ($event['description'] ?? '')), strtolower($errorMessage))
                ) {
                    $event['description'] = rtrim((string) $event['description'], '.') . '. ' . $errorMessage;
                }
            }
            unset($event);
        }

        if ($finishedAt !== '') {
            foreach ($events as &$event) {
                if (
                    in_array((string) ($event['title'] ?? ''), ['Enrolled', 'Updated', 'Failed'], true)
                    && strcmp((string) ($event['occurred_at'] ?? ''), $finishedAt) < 0
                ) {
                    $event['occurred_at'] = $finishedAt;
                    $event['rank'] = 6;
                }
            }
            unset($event);
        }

        usort($events, static function (array $left, array $right): int {
            $time = strcmp((string) $left['occurred_at'], (string) $right['occurred_at']);

            if ($time !== 0) {
                return $time;
            }

            return ((int) $left['rank']) <=> ((int) $right['rank']);
        });

        return array_map(static function (array $event): array {
            return [
                'title' => (string) $event['title'],
                'description' => (string) $event['description'],
                'status' => (string) $event['status'],
                'occurred_at' => (string) $event['occurred_at'],
            ];
        }, $events);
    }

    /**
     * @param array<int, array<string, mixed>> $events
     * @param array<int, string> $titles
     */
    private function enrollmentTimelineHasTitle(array $events, array $titles): bool
    {
        foreach ($events as $event) {
            if (in_array((string) ($event['title'] ?? ''), $titles, true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<int, array<string, mixed>> $events
     */
    private function enrollmentTimelineHasText(array $events, string $text): bool
    {
        $needle = strtolower(trim($text));

        if ($needle === '') {
            return false;
        }

        foreach ($events as $event) {
            if (str_contains(strtolower((string) ($event['description'] ?? '')), $needle)) {
                return true;
            }
        }

        return false;
    }

    private function enrollmentTimelineTitle(string $activityType, string $description): string
    {
        $text = strtolower($description);

        if (str_starts_with($text, 'created ')) {
            return 'Created';
        }

        if (str_starts_with($text, 'retried ')) {
            return 'Retried';
        }

        if (str_starts_with($text, 'cancelled ')) {
            return 'Cancelled';
        }

        if (str_starts_with($text, 'enrolled ')) {
            return 'Enrolled';
        }

        if (str_starts_with($text, 'updated ')) {
            return 'Updated';
        }

        if (str_contains($text, 'failed')) {
            return 'Failed';
        }

        $type = trim($activityType);

        return $type !== '' ? $type : 'Update';
    }
}
