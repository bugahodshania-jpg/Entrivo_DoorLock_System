<?php

require_once __DIR__ . '/../models/FingerprintEnrollmentJob.php';
require_once __DIR__ . '/../models/Fingerprint.php';
require_once __DIR__ . '/FingerprintTemplateFormat.php';
require_once __DIR__ . '/FingerprintEnrollmentVerification.php';

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

        $this->jobModel->ensureEnrollmentDevice((int) $deviceId);

        if (!$this->jobModel->deviceExists($deviceId)) {
            return [
                "success" => false,
                "message" => "Enrollment device not found."
            ];
        }

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

        try {
            $jobId = $this->jobModel->createJob(
                $userId,
                $fingerName,
                $deviceId,
                $fingerprintId
            );
        } catch (DirectFingerprintSensorBusyException $error) {
            return ['success' => false, 'message' => $error->getMessage()];
        }

        return [
            "success" => true,
            "job_id" => $jobId,
            "fingerprint_id" => $fingerprintId,
            "message" => "Enrollment job created."
        ];
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

        $this->jobModel->requeueStaleProcessingJobs($deviceId);

        return $this->jobModel->getNextWaitingJob($deviceId);
    }

    public function claimJob(int $jobId, ?int $deviceId = null): bool
    {
        return $this->jobModel->claimJob($jobId, $deviceId);
    }

    public function getJobById(int $jobId)
    {
        return $this->withVerification($this->jobModel->getJobById($jobId));
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
            'is_live' => in_array($status, ['waiting', 'processing'], true),
            'is_closed' => in_array($status, ['completed', 'failed', 'cancelled'], true),
            'can_retry' => in_array($status, ['failed', 'cancelled'], true),
            'can_cancel' => $status === 'waiting',
            'verification' => $this->verificationForJob($job),
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

        $this->jobModel->cancelIdleWaitingJobs();
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
                'is_live' => in_array($status, ['waiting', 'processing'], true),
                'is_closed' => in_array($status, ['completed', 'failed', 'cancelled'], true),
                'can_retry' => in_array($status, ['failed', 'cancelled'], true),
                'can_cancel' => $status === 'waiting',
                'verification' => $this->verificationForJob($job),
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

        $encoded = $input['template_data_base64'] ?? null;
        if (!is_string($encoded) || trim($encoded) === '') {
            return $this->completionFailure(400, 'Actual fingerprint template data is required before completion.');
        }
        $binary = base64_decode(trim($encoded), true);
        if ($binary === false) {
            return $this->completionFailure(400, 'Template data must be valid base64.');
        }
        if (!FingerprintTemplateFormat::isSupportedSize(strlen($binary))) {
            return $this->completionFailure(422, sprintf(
                'Invalid fingerprint template size. Supported sizes: %s bytes; got %d bytes.',
                FingerprintTemplateFormat::describeSupportedSizes(), strlen($binary)
            ));
        }
        if (!FingerprintTemplateFormat::isUsableTemplate($binary)) {
            return $this->completionFailure(422, 'The sensor returned invalid fingerprint template data containing only one repeated byte. Enroll the finger again; the existing fingerprint was preserved.');
        }
        try {
            $proof = FingerprintEnrollmentVerification::normalize($input['verification'] ?? null, $binary);
        } catch (InvalidArgumentException $error) {
            return $this->completionFailure(422, $error->getMessage());
        }
        if ($proof['stored_slot'] !== $assignedSlot || $proof['matched_slot'] !== $assignedSlot) {
            return $this->completionFailure(409, 'The freshly matched and stored sensor slots must both equal the reserved job slot.');
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
            if (!in_array($job['status'], ['processing', 'completed'], true) ||
                ($job['status'] === 'processing' && !empty($job['finished_at']))) {
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
            $targetId = (int) ($job['fingerprint_id'] ?? 0);
            $previous = $targetId > 0 ? $this->fingerprintModel->getById($targetId) : null;
            if ($targetId > 0 && (!$previous || (int) $previous['user_id'] !== (int) $job['user_id'])) {
                throw new FingerprintEnrollmentCompletionException('The fingerprint update target no longer belongs to this user.', 409);
            }
            $job['is_update'] = $previous !== null && (!empty($previous['enrollment_slot']) || !empty($previous['template_data']));
            $fingerprint = $this->fingerprintModel->saveEnrollment(
                (int) $job['user_id'], (string) $job['finger_name'], $deviceId, $assignedSlot,
                $binary, $proof['template_sha256'], $targetId > 0 ? $targetId : null
            );
            $fingerprint = $this->fingerprintModel->getById((int) ($fingerprint['fingerprint_id'] ?? 0));
            $this->assertSavedEnrollment($fingerprint, $job, $binary, $proof);
            $stored = FingerprintEnrollmentVerification::record($this->conn, $job, $fingerprint, $proof);
            if (!$stored || !$this->jobModel->completeJob($jobId, $assignedSlot, $deviceId)) {
                throw new FingerprintEnrollmentCompletionException('Unable to atomically confirm the saved fingerprint and enrollment job.', 409);
            }
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
            ($fingerprint['status'] ?? null) !== 'active' ||
            ($fingerprint['template_data'] ?? null) !== $binary ||
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
            'success' => true, 'message' => 'Enrollment completed after verified sensor storage and a fresh matching scan.',
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

    private function withVerification($job): ?array
    {
        if (!$job) return null;
        $job = $this->normalizeBoardJob($job);
        $job['verification'] = $this->verificationForJob($job);
        return $job;
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

        if ($job['status'] === 'completed') {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => 'Completed enrollment jobs cannot be retried.'
                ],
            ];
        }

        if (!in_array($job['status'], ['failed', 'cancelled'], true)) {
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
                'message' => $retried ? 'Enrollment job queued again.' : 'Unable to retry enrollment job.',
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

        if ($job['status'] !== 'waiting') {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => 'Only waiting jobs can be cancelled safely.'
                ],
            ];
        }

        $cancelled = $this->jobModel->cancelWaitingJob($jobId, $reason);
        $freshJob = $this->jobModel->getJobById($jobId);

        return [
            'status' => $cancelled ? 200 : 409,
            'body' => [
                'success' => $cancelled,
                'message' => $cancelled ? 'Enrollment job cancelled.' : 'Unable to cancel enrollment job.',
                'job' => $freshJob,
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
