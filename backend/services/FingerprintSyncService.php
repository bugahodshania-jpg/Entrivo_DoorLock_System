<?php

require_once __DIR__ . '/../models/Fingerprint.php';
require_once __DIR__ . '/../models/FingerprintSyncQueue.php';
require_once __DIR__ . '/FingerprintTemplateFormat.php';

class FingerprintSyncService
{
    private Fingerprint $fingerprintModel;
    private FingerprintSyncQueue $queueModel;

    public function __construct()
    {
        $this->fingerprintModel = new Fingerprint();
        $this->queueModel = new FingerprintSyncQueue();
    }

    public function queueTemplateSync(array $input): array
    {
        $this->expireIdleSyncJobs();
        $fingerprintId = (int) ($input['fingerprint_id'] ?? 0);
        $deviceId = (int) ($input['device_id'] ?? 0);
        $deviceCode = trim((string) ($input['device_code'] ?? ''));

        if ($fingerprintId <= 0) {
            return $this->result(400, false, 'A valid fingerprint record is required.');
        }

        $fingerprint = $this->fingerprintModel->getById($fingerprintId);

        if (!$fingerprint) {
            return $this->result(404, false, 'Fingerprint record not found.');
        }

        $validation = $this->validateTemplateRecord($fingerprint);

        if (!$validation['success']) {
            return $this->result((int) $validation['status'], false, (string) $validation['message']);
        }

        $device = $this->resolveDoorDevice($deviceId, $deviceCode);

        if (!$device) {
            return $this->unavailableDoorDeviceResult($deviceId, $deviceCode);
        }

        $targetDeviceId = (int) $device['device_id'];
        $existingJob = $this->queueModel->findActiveJob($fingerprintId, $targetDeviceId);

        $this->fingerprintModel->markDoorSyncPending($fingerprintId);

        if ($existingJob) {
            return [
                'status' => 200,
                'body' => [
                    'success' => true,
                    'message' => 'Template sync is already pending for Sensor B.',
                    'job' => $this->normalizeJob($this->queueModel->getJobById((int) $existingJob['id']) ?: $existingJob),
                    'fingerprint' => $this->normalizeFingerprint($fingerprintId),
                ],
            ];
        }

        $queueId = $this->queueModel->createJob($fingerprintId, $targetDeviceId);
        $job = $this->queueModel->getJobById($queueId);

        return [
            'status' => 200,
            'body' => [
                'success' => true,
                'message' => 'Template sync queued for Sensor B.',
                'job' => $this->normalizeJob($job),
                'fingerprint' => $this->normalizeFingerprint($fingerprintId),
            ],
        ];
    }

    public function expireIdleSyncJobs(int $idleMinutes = 30): array
    {
        $jobs = $this->queueModel->failIdleJobs($idleMinutes);

        if ($jobs === []) {
            return [];
        }

        require_once __DIR__ . '/ActivityLogService.php';
        $activityLog = new ActivityLogService(entrivo_pdo());

        foreach ($jobs as $job) {
            $fingerprintId = (int) ($job['fingerprint_id'] ?? 0);

            if ($fingerprintId > 0 && !$this->queueModel->hasActiveJobForFingerprint($fingerprintId)) {
                $this->fingerprintModel->markDoorSyncStatus($fingerprintId, 'failed');
            }

            $cancelled = $this->pickupTimeoutControllerIssue($job) !== null;
            $activityLog->recordFingerprintSync($cancelled ? 'cancelled' : 'failed', $job, null, $cancelled ? 'Cancelled' : 'Failed');
        }

        return $jobs;
    }

    public function listSyncJobs(array $query = []): array
    {
        $expiredJobs = array_map(
            fn (array $job): array => $this->normalizeJob($job),
            $this->expireIdleSyncJobs()
        );
        $queueId = (int) ($query['queue_id'] ?? 0);

        if ($queueId > 0) {
            $job = $this->queueModel->getJobById($queueId);
            $normalized = $job ? $this->normalizeJob($job) : null;

            if ($normalized) {
                $normalized['events'] = $this->buildSyncTimeline($job);
            }

            return [
                'status' => 200,
                'body' => [
                    'success' => true,
                    'jobs' => $normalized ? [$normalized] : [],
                    'expired_jobs' => $expiredJobs,
                ],
            ];
        }

        $limit = (int) ($query['limit'] ?? 25);
        $jobs = array_map(
            fn (array $job): array => $this->normalizeJob($job),
            $this->queueModel->listJobs($limit)
        );

        return [
            'status' => 200,
            'body' => [
                'success' => true,
                'jobs' => $jobs,
                'expired_jobs' => $expiredJobs,
            ],
        ];
    }

    public function retrySyncJob(array $input): array
    {
        $this->expireIdleSyncJobs();
        $queueId = (int) ($input['queue_id'] ?? ($input['id'] ?? 0));

        if ($queueId <= 0) {
            return $this->result(400, false, 'A valid sync job ID is required.');
        }

        $job = $this->queueModel->getJobById($queueId);

        if (!$job) {
            return $this->result(404, false, 'Sync job not found.');
        }

        if ((string) $job['status'] !== 'failed') {
            return $this->result(409, false, 'Only failed sync jobs can be retried.');
        }

        $validation = $this->validateTemplateRecord($this->fingerprintModel->getById((int) $job['fingerprint_id']) ?: []);

        if (!$validation['success']) {
            return $this->result((int) $validation['status'], false, (string) $validation['message']);
        }

        if (!$this->resolveDoorDevice((int) $job['device_id'])) {
            return $this->unavailableDoorDeviceResult((int) $job['device_id']);
        }

        $retried = $this->queueModel->retryJob($queueId);
        $freshJob = $this->queueModel->getJobById($queueId);

        if ($retried) {
            $this->fingerprintModel->markDoorSyncPending((int) $job['fingerprint_id']);
        }

        return [
            'status' => $retried ? 200 : 409,
            'body' => [
                'success' => $retried,
                'message' => $retried ? 'Sync job queued again.' : 'Unable to retry sync job.',
                'job' => $this->normalizeJob($freshJob ?: $job),
                'fingerprint' => $this->normalizeFingerprint((int) $job['fingerprint_id']),
            ],
        ];
    }

    public function cancelSyncJob(array $input): array
    {
        $queueId = (int) ($input['queue_id'] ?? ($input['id'] ?? 0));

        if ($queueId <= 0) {
            return $this->result(400, false, 'A valid sync job ID is required.');
        }

        $job = $this->queueModel->getJobById($queueId);

        if (!$job) {
            return $this->result(404, false, 'Sync job not found.');
        }

        $status = (string) $job['status'];

        if (!in_array($status, ['pending', 'syncing'], true)) {
            return $this->result(409, false, 'Only a queued or in-progress sync can be cancelled.');
        }

        $cancelled = $status === 'pending'
            ? $this->queueModel->cancelPendingJob($queueId)
            : $this->queueModel->cancelSyncingJob($queueId);

        if ($cancelled && $status === 'syncing') {
            $this->fingerprintModel->markDoorSyncStatus((int) $job['fingerprint_id'], 'failed');
        }

        $freshJob = $this->queueModel->getJobById($queueId);

        return [
            'status' => $cancelled ? 200 : 409,
            'body' => [
                'success' => $cancelled,
                'message' => $cancelled ? 'Sync job cancelled.' : 'Unable to cancel sync job.',
                'job' => $this->normalizeJob($freshJob ?: $job),
                'fingerprint' => $this->normalizeFingerprint((int) $job['fingerprint_id']),
            ],
        ];
    }

    public function getPendingDeviceJob(array $query = []): array
    {
        $this->expireIdleSyncJobs();
        $requestedDeviceId = (int) ($query['device_id'] ?? 0);
        $requestedDeviceCode = trim((string) ($query['device_code'] ?? ''));
        $device = $this->resolveDoorDevice(
            $requestedDeviceId,
            $requestedDeviceCode
        );

        if (!$device) {
            return $this->unavailableDoorDeviceResult($requestedDeviceId, $requestedDeviceCode);
        }

        $deviceId = (int) $device['device_id'];
        $this->queueModel->requeueStaleSyncingJobs($deviceId, 1);
        $job = $this->queueModel->claimNextPendingJob($deviceId);

        if (!$job) {
            return [
                'status' => 200,
                'body' => [
                    'success' => false,
                    'message' => 'No pending template sync.',
                ],
            ];
        }

        $fingerprint = $this->fingerprintModel->getById((int) $job['fingerprint_id']);
        $validation = $this->validateTemplateRecord($fingerprint ?: []);

        if (!$validation['success']) {
            $this->queueModel->markJobFailed((int) $job['id'], (string) $validation['message']);
            $this->fingerprintModel->markDoorSyncStatus((int) $job['fingerprint_id'], 'failed');

            return $this->result((int) $validation['status'], false, (string) $validation['message']);
        }

        $normalizedJob = $this->normalizeJob($job);

        return [
            'status' => 200,
            'body' => [
                'success' => true,
                'job' => array_merge(
                    $normalizedJob ?: [],
                    [
                    'target_slot' => isset($fingerprint['shared_door_slot']) ? (int) $fingerprint['shared_door_slot'] : null,
                    'reserved_slots' => $this->fingerprintModel->listOtherSharedDoorSlots((int) $fingerprint['fingerprint_id']),
                    'template_bytes' => strlen((string) $validation['template_binary']),
                    'template_hash' => (string) $fingerprint['template_hash'],
                    'template_data_base64' => base64_encode((string) $validation['template_binary']),
                    ]
                ),
            ],
        ];
    }

    public function completeDeviceJob(array $input): array
    {
        return $this->closeDeviceJob($input, true);
    }

    public function failDeviceJob(array $input): array
    {
        return $this->closeDeviceJob($input, false);
    }

    public function updateDeviceProgress(array $input): array
    {
        $queueId = (int) ($input['queue_id'] ?? ($input['id'] ?? 0));
        $progressStep = strtolower(trim((string) ($input['progress_step'] ?? '')));

        if ($queueId <= 0) {
            return $this->result(400, false, 'A valid sync job ID is required.');
        }

        $job = $this->queueModel->getJobById($queueId);

        if (!$job) {
            return $this->result(404, false, 'Sync job not found.');
        }

        if ((string) $job['status'] !== 'syncing') {
            return $this->result(409, false, 'Only a syncing job can report progress.');
        }

        $updated = $this->queueModel->updateProgressStep($queueId, $progressStep);

        return [
            'status' => $updated ? 200 : 409,
            'body' => [
                'success' => $updated,
                'message' => $updated ? 'Sync progress updated.' : 'Unable to update sync progress.',
                'job' => $this->normalizeJob($this->queueModel->getJobById($queueId) ?: $job),
            ],
        ];
    }

    private function closeDeviceJob(array $input, bool $synced): array
    {
        $queueId = (int) ($input['queue_id'] ?? ($input['id'] ?? 0));
        $message = trim((string) ($input['error_message'] ?? 'Sensor B sync failed.'));

        if ($queueId <= 0) {
            return $this->result(400, false, 'A valid sync job ID is required.');
        }

        $job = $this->queueModel->getJobById($queueId);

        if (!$job) {
            return $this->result(404, false, 'Sync job not found.');
        }

        if ($synced) {
            $storedSlot = (int) ($input['stored_slot'] ?? 0);

            if ($storedSlot > 0) {
                $claim = $this->fingerprintModel->claimSharedDoorSlot((int) $job['fingerprint_id'], $storedSlot);

                if (!$claim['success']) {
                    $claimMessage = (string) $claim['message'];
                    $this->queueModel->markJobFailed($queueId, $claimMessage);
                    $this->fingerprintModel->markDoorSyncStatus((int) $job['fingerprint_id'], 'failed');

                    return [
                        'status' => 409,
                        'body' => [
                            'success' => false,
                            'message' => $claimMessage,
                            'job' => $this->normalizeJob($this->queueModel->getJobById($queueId) ?: $job),
                            'fingerprint' => $this->normalizeFingerprint((int) $job['fingerprint_id']),
                        ],
                    ];
                }
            }
        }

        $updated = $synced
            ? $this->queueModel->markJobSynced($queueId)
            : $this->queueModel->markJobFailed($queueId, $message);

        $this->fingerprintModel->markDoorSyncStatus((int) $job['fingerprint_id'], $synced ? 'synced' : 'failed');

        return [
            'status' => $updated ? 200 : 409,
            'body' => [
                'success' => $updated,
                'message' => $synced ? 'Sync job marked as synced.' : 'Sync job marked as failed.',
                'job' => $this->normalizeJob($this->queueModel->getJobById($queueId) ?: $job),
                'fingerprint' => $this->normalizeFingerprint((int) $job['fingerprint_id']),
            ],
        ];
    }

    private function validateTemplateRecord(array $fingerprint): array
    {
        if (!$fingerprint) {
            return ['success' => false, 'status' => 404, 'message' => 'Fingerprint record not found.'];
        }

        $storedTemplate = $fingerprint['template_data'] ?? null;

        if (!is_string($storedTemplate) || $storedTemplate === '') {
            return ['success' => false, 'status' => 409, 'message' => 'No stored template data was found for this fingerprint.'];
        }

        $storedHash = strtolower(trim((string) ($fingerprint['template_hash'] ?? '')));

        if ($storedHash === '') {
            return ['success' => false, 'status' => 409, 'message' => 'No template hash was found for this fingerprint.'];
        }

        // Current records contain raw bytes; older records can contain base64.
        // Some raw templates also happen to be valid base64, so use the stored
        // hash to identify the representation before choosing either candidate.
        $decodedTemplate = base64_decode(trim($storedTemplate), true);
        $templateBinary = $storedTemplate;
        if (
            !hash_equals($storedHash, hash('sha256', $storedTemplate))
            && $decodedTemplate !== false
            && (
                hash_equals($storedHash, hash('sha256', $decodedTemplate))
                || !FingerprintTemplateFormat::isSupportedSize(strlen($storedTemplate))
            )
        ) {
            $templateBinary = $decodedTemplate;
        }

        $templateBytes = strlen($templateBinary);

        if (!FingerprintTemplateFormat::isSupportedSize($templateBytes)) {
            return [
                'success' => false,
                'status' => 422,
                'message' => sprintf(
                    'Invalid fingerprint template size. Expected %s bytes, got %d bytes.',
                    FingerprintTemplateFormat::describeSupportedSizes(),
                    $templateBytes
                ),
            ];
        }

        if (!hash_equals($storedHash, strtolower(hash('sha256', $templateBinary)))) {
            return ['success' => false, 'status' => 422, 'message' => 'Stored template hash does not match the fingerprint template bytes.'];
        }

        if (!FingerprintTemplateFormat::isUsableTemplate($templateBinary)) {
            return ['success' => false, 'status' => 422, 'message' => 'The stored fingerprint template contains only one repeated byte and cannot be synced. Enroll the finger again.'];
        }

        return [
            'success' => true,
            'status' => 200,
            'message' => 'Template is valid.',
            'template_binary' => $templateBinary,
        ];
    }

    private function resolveDoorDevice(int $deviceId = 0, string $deviceCode = ''): ?array
    {
        if ($deviceId > 0 || trim($deviceCode) !== '') {
            return $this->queueModel->getDoorDeviceByIdentity($deviceId > 0 ? $deviceId : null, $deviceCode);
        }

        return $this->queueModel->getPreferredDoorDevice();
    }

    private function unavailableDoorDeviceResult(int $deviceId = 0, string $deviceCode = ''): array
    {
        $issue = $this->queueModel->getDoorDeviceSyncIssue($deviceId, $deviceCode) ?? 'not_registered';
        $message = $issue === 'inactive'
            ? 'The fingerprint cannot sync because the door controller is inactive. Activate the Sensor B door controller, then try again.'
            : 'The fingerprint cannot sync because no door controller is registered for this request. Register an active Sensor B door controller, then try again.';
        $result = $this->result(404, false, $message);
        $result['body']['controller_issue'] = $issue;

        return $result;
    }

    private function pickupTimeoutControllerIssue(array $job): ?string
    {
        if ((string) ($job['status'] ?? '') !== 'failed') {
            return null;
        }

        $issue = array_search((string) ($job['error_message'] ?? ''), FingerprintSyncQueue::PICKUP_TIMEOUT_MESSAGES, true);

        return $issue !== false ? $issue : null;
    }

    private function normalizeFingerprint(int $fingerprintId): ?array
    {
        $fingerprint = $this->fingerprintModel->getById($fingerprintId);

        if (!$fingerprint) {
            return null;
        }

        return [
            'fingerprint_id' => (int) $fingerprint['fingerprint_id'],
            'door_sync_status' => (string) ($fingerprint['door_sync_status'] ?? 'pending'),
            'door_synced_at' => $fingerprint['door_synced_at'] ?? null,
        ];
    }

    private function normalizeJob(?array $job): ?array
    {
        if (!$job) {
            return null;
        }

        $status = (string) ($job['status'] ?? 'pending');
        $controllerIssue = $this->pickupTimeoutControllerIssue($job);
        $cancellationReason = $controllerIssue !== null
            ? 'pickup_timeout'
            : ($status === 'failed' && (string) ($job['error_message'] ?? '') === 'Cancelled from the sync dialog.' ? 'manual' : null);

        return [
            'id' => (int) $job['id'],
            'queue_id' => (int) $job['id'],
            'fingerprint_id' => (int) $job['fingerprint_id'],
            'device_id' => (int) $job['device_id'],
            'device_name' => (string) ($job['device_name'] ?? ''),
            'device_code' => (string) ($job['device_code'] ?? ''),
            'location' => (string) ($job['location'] ?? ''),
            'status' => $status,
            'is_cancelled' => $cancellationReason !== null,
            'cancellation_reason' => $cancellationReason,
            'controller_issue' => $controllerIssue,
            'cancelled_at' => $cancellationReason !== null ? ($job['updated_at'] ?? null) : null,
            'progress_step' => (string) ($job['progress_step'] ?? ''),
            'attempts' => (int) ($job['attempts'] ?? 0),
            'error_message' => (string) ($job['error_message'] ?? ''),
            'queued_at' => $job['queued_at'] ?? null,
            'processing_at' => $job['processing_at'] ?? null,
            'synced_at' => $job['synced_at'] ?? null,
            'updated_at' => $job['updated_at'] ?? null,
            'user_id' => isset($job['user_id']) ? (int) $job['user_id'] : null,
            'user_name' => (string) ($job['user_name'] ?? $job['username'] ?? 'Unknown user'),
            'email' => (string) ($job['email'] ?? ''),
            'role' => (string) ($job['role'] ?? ''),
            'finger_name' => (string) ($job['finger_name'] ?? ''),
            'shared_door_slot' => isset($job['shared_door_slot']) ? (int) $job['shared_door_slot'] : null,
            'door_sync_status' => (string) ($job['door_sync_status'] ?? ''),
            'is_live' => in_array($status, ['pending', 'syncing'], true),
            'is_closed' => in_array($status, ['synced', 'failed'], true),
            'can_retry' => $status === 'failed',
        ];
    }

    /**
     * @param array<string, mixed> $job
     * @return array<int, array{title: string, description: string, status: string, occurred_at: string}>
     */
    private function buildSyncTimeline(array $job): array
    {
        require_once __DIR__ . '/ActivityLogService.php';
        $logged = (new ActivityLogService(entrivo_pdo()))->listFingerprintSyncEvents((int) ($job['id'] ?? 0));
        $events = [];

        foreach ($logged as $index => $event) {
            $description = trim((string) ($event['description'] ?? ''));
            $events[] = [
                'title' => $this->syncTimelineTitle((string) ($event['activity_type'] ?? ''), $description),
                'description' => $description,
                'status' => (string) ($event['status'] ?? 'Success'),
                'occurred_at' => (string) ($event['occurred_at'] ?? ''),
                'rank' => 10 + $index,
            ];
        }

        $status = (string) ($job['status'] ?? '');
        $queuedAt = trim((string) ($job['queued_at'] ?? ''));
        $processingAt = trim((string) ($job['processing_at'] ?? ''));
        $syncedAt = trim((string) ($job['synced_at'] ?? ''));
        $updatedAt = trim((string) ($job['updated_at'] ?? ''));
        $errorMessage = trim((string) ($job['error_message'] ?? ''));
        $progressStep = strtolower(trim((string) ($job['progress_step'] ?? '')));
        $isCancelled = $this->pickupTimeoutControllerIssue($job) !== null || $errorMessage === 'Cancelled from the sync dialog.';

        if ($queuedAt !== '' && !$this->timelineHasTitle($events, ['Queued', 'Retried'])) {
            $events[] = [
                'title' => 'Queued',
                'description' => 'This sync job was added to the Sensor B queue.',
                'status' => 'Pending',
                'occurred_at' => $queuedAt,
                'rank' => 1,
            ];
        }

        if ($processingAt !== '' && !$this->timelineHasTitle($events, ['Claimed'])) {
            $events[] = [
                'title' => 'Claimed',
                'description' => 'Sensor B claimed this sync job and started processing the template.',
                'status' => 'Pending',
                'occurred_at' => $processingAt,
                'rank' => 2,
            ];
        }

        if ($status === 'syncing' && $updatedAt !== '' && $updatedAt !== $processingAt) {
            if ($progressStep === 'writing') {
                $events[] = [
                    'title' => 'Writing',
                    'description' => 'Sensor B is writing the template into its memory.',
                    'status' => 'Pending',
                    'occurred_at' => $updatedAt,
                    'rank' => 3,
                ];
            } elseif ($progressStep === 'reporting') {
                $events[] = [
                    'title' => 'Confirming',
                    'description' => 'Sensor B is confirming that the template was stored.',
                    'status' => 'Pending',
                    'occurred_at' => $updatedAt,
                    'rank' => 4,
                ];
            }
        }

        if ($status === 'pending' && $errorMessage !== '' && $updatedAt !== '' && !$this->timelineHasText($events, $errorMessage)) {
            $events[] = [
                'title' => 'Waiting again',
                'description' => $errorMessage,
                'status' => 'Pending',
                'occurred_at' => $updatedAt,
                'rank' => 5,
            ];
        }

        if ($status === 'synced' && $syncedAt !== '' && !$this->timelineHasTitle($events, ['Synced'])) {
            $events[] = [
                'title' => 'Synced',
                'description' => 'Sensor B stored the fingerprint template.',
                'status' => 'Success',
                'occurred_at' => $syncedAt,
                'rank' => 6,
            ];
        }

        if (
            $status === 'failed'
            && $updatedAt !== ''
            && !$this->timelineHasTitle($events, ['Failed', 'Cancelled', 'Not transferred'])
        ) {
            $events[] = [
                'title' => $isCancelled ? 'Cancelled' : 'Failed',
                'description' => $errorMessage !== '' ? $errorMessage : 'This sync job did not finish.',
                'status' => $isCancelled ? 'Cancelled' : 'Failed',
                'occurred_at' => $updatedAt,
                'rank' => 6,
            ];
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
    private function timelineHasTitle(array $events, array $titles): bool
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
    private function timelineHasText(array $events, string $text): bool
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

    private function syncTimelineTitle(string $activityType, string $description): string
    {
        $text = strtolower($description);

        if (str_starts_with($text, 'queued ')) {
            return 'Queued';
        }

        if (str_starts_with($text, 'retried ')) {
            return 'Retried';
        }

        if (str_starts_with($text, 'cancelled ')) {
            return 'Cancelled';
        }

        if (str_starts_with($text, 'synced ')) {
            return 'Synced';
        }

        if (str_contains($text, 'was not synced') || str_contains($text, 'already waiting')) {
            return 'Not transferred';
        }

        if (str_contains($text, 'failed') || str_contains($text, 'cancelled')) {
            return 'Failed';
        }

        $type = trim($activityType);

        return $type !== '' ? $type : 'Update';
    }

    private function result(int $status, bool $success, string $message): array
    {
        return [
            'status' => $status,
            'body' => [
                'success' => $success,
                'message' => $message,
            ],
        ];
    }
}
