<?php

require_once __DIR__ . '/../models/FingerprintEnrollmentJob.php';
require_once __DIR__ . '/../models/Fingerprint.php';

class FingerprintEnrollmentService
{
    private FingerprintEnrollmentJob $jobModel;
    private Fingerprint $fingerprintModel;
    private const EXPECTED_TEMPLATE_BYTES = 512;

    public function __construct()
    {
        $this->jobModel = new FingerprintEnrollmentJob();
        $this->fingerprintModel = new Fingerprint();
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

        if ($this->jobModel->hasPendingJob($userId)) {
            return [
                "success" => false,
                "message" => "User already has a pending enrollment."
            ];
        }

        $jobId = $this->jobModel->createJob(
            $userId,
            $fingerName,
            $deviceId,
            $fingerprintId
        );

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
        $this->jobModel->cancelIdleWaitingJobs();

        return $this->jobModel->getNextWaitingJob($deviceId);
    }

    public function claimJob(int $jobId, ?int $deviceId = null): bool
    {
        return $this->jobModel->claimJob($jobId, $deviceId);
    }

    public function getJobById(int $jobId)
    {
        return $this->jobModel->getJobById($jobId);
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
        ];
    }

    public function listEnrollmentJobs(array $query = []): array
    {
        $this->jobModel->cancelIdleWaitingJobs();
        $jobId = isset($query['job_id']) && $query['job_id'] > 0 ? (int) $query['job_id'] : 0;

        if ($jobId > 0) {
            $job = $this->getSingleJobProgress($jobId);

            return [
                'status' => 200,
                'body' => [
                    'success' => true,
                    'jobs' => $job ? [$job] : [],
                ],
            ];
        }

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

    public function completeEnrollment(array $input): array
    {
        $jobId = (int) ($input['job_id'] ?? 0);
        $deviceId = (int) ($input['enrollment_device_id'] ?? 0);
        $assignedSlot = (int) ($input['assigned_slot'] ?? 0);
        $templateDataBase64 = trim((string) ($input['template_data_base64'] ?? ''));

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

        if ($job['status'] === 'completed') {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => 'This enrollment job is already completed.'
                ],
            ];
        }

        if (in_array($job['status'], ['failed', 'cancelled'], true)) {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => 'This enrollment job can no longer be completed.'
                ],
            ];
        }

        $reservedSlot = (int) ($job['assigned_slot'] ?? 0);

        if ($assignedSlot <= 0) {
            $assignedSlot = $reservedSlot;
        }

        if ($assignedSlot <= 0) {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => 'This enrollment job has no reserved sensor slot.'
                ],
            ];
        }

        if ($reservedSlot > 0 && $assignedSlot !== $reservedSlot) {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => 'Assigned slot does not match the reserved job slot.'
                ],
            ];
        }

        if ($templateDataBase64 === '') {
            return [
                'status' => 400,
                'body' => [
                    'success' => false,
                    'message' => 'Actual fingerprint template data is required before completion.'
                ],
            ];
        }

        $templateBinary = '';

        if ($templateDataBase64 !== '') {
            $decodedTemplate = base64_decode($templateDataBase64, true);

            if ($decodedTemplate === false) {
                return [
                    'status' => 400,
                    'body' => [
                        'success' => false,
                        'message' => 'Template data must be valid base64.'
                    ],
                ];
            }

            $templateBytes = strlen($decodedTemplate);
            if ($templateBytes !== self::EXPECTED_TEMPLATE_BYTES) {
                $message = sprintf(
                    'Invalid fingerprint template size. Expected %d bytes, got %d bytes.',
                    self::EXPECTED_TEMPLATE_BYTES,
                    $templateBytes
                );

                // Treat as a failed enrollment so the dashboard/progress modal can show the reason.
                $this->jobModel->failJob($jobId, $message, $deviceId);
                $freshJob = $this->jobModel->getJobById($jobId);

                return [
                    'status' => 422,
                    'body' => [
                        'success' => false,
                        'message' => $message,
                        'job' => $freshJob,
                    ],
                ];
            }

            $templateBinary = $decodedTemplate;
        }

        $templateHashSource = $templateBinary !== ''
            ? $templateBinary
            : implode('|', [
                (string) $jobId,
                (string) ($job['user_id'] ?? ''),
                (string) $assignedSlot,
                (string) ($job['finger_name'] ?? ''),
            ]);

        $targetFingerprintId = isset($job['fingerprint_id']) ? (int) $job['fingerprint_id'] : 0;

        $fingerprint = $this->fingerprintModel->saveEnrollment(
            (int) $job['user_id'],
            (string) $job['finger_name'],
            (int) ($job['enrollment_device_id'] ?? $deviceId),
            $assignedSlot,
            $templateBinary,
            hash('sha256', $templateHashSource),
            $targetFingerprintId > 0 ? $targetFingerprintId : null
        );

        $completed = $this->jobModel->completeJob($jobId, $assignedSlot, $deviceId);
        $freshJob = $this->jobModel->getJobById($jobId);

        return [
            'status' => $completed ? 200 : 409,
            'body' => [
                'success' => $completed,
                'message' => $completed ? 'Enrollment completed successfully.' : 'Unable to complete enrollment job.',
                'job' => $freshJob,
                'fingerprint' => $fingerprint,
            ],
        ];
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
}
