<?php

require_once __DIR__ . '/../models/Fingerprint.php';
require_once __DIR__ . '/../models/FingerprintSyncQueue.php';

class FingerprintSyncService
{
    private Fingerprint $fingerprintModel;
    private FingerprintSyncQueue $queueModel;
    private const EXPECTED_TEMPLATE_BYTES = 512;

    public function __construct()
    {
        $this->fingerprintModel = new Fingerprint();
        $this->queueModel = new FingerprintSyncQueue();
    }

    public function queueTemplateSync(array $input): array
    {
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
            return $this->result(404, false, 'No active Sensor B door device was found.');
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

    public function listSyncJobs(array $query = []): array
    {
        $queueId = (int) ($query['queue_id'] ?? 0);

        if ($queueId > 0) {
            $job = $this->queueModel->getJobById($queueId);

            return [
                'status' => 200,
                'body' => [
                    'success' => true,
                    'jobs' => $job ? [$this->normalizeJob($job)] : [],
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
            ],
        ];
    }

    public function retrySyncJob(array $input): array
    {
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

        $retried = $this->queueModel->retryJob($queueId);
        $freshJob = $this->queueModel->getJobById($queueId);
        $this->fingerprintModel->markDoorSyncPending((int) $job['fingerprint_id']);

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

        if ((string) $job['status'] !== 'pending') {
            return $this->result(409, false, 'Only pending sync jobs can be cancelled.');
        }

        $cancelled = $this->queueModel->cancelPendingJob($queueId);

        return [
            'status' => $cancelled ? 200 : 409,
            'body' => [
                'success' => $cancelled,
                'message' => $cancelled ? 'Pending sync job cancelled.' : 'Unable to cancel sync job.',
                'job' => $this->normalizeJob($job),
                'fingerprint' => $this->normalizeFingerprint((int) $job['fingerprint_id']),
            ],
        ];
    }

    public function getPendingDeviceJob(array $query = []): array
    {
        $device = $this->resolveDoorDevice(
            (int) ($query['device_id'] ?? 0),
            trim((string) ($query['device_code'] ?? ''))
        );

        if (!$device) {
            return $this->result(404, false, 'No active Sensor B door device was found.');
        }

        $deviceId = (int) $device['device_id'];
        $this->queueModel->requeueStaleSyncingJobs($deviceId);
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
                    'template_bytes' => self::EXPECTED_TEMPLATE_BYTES,
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

        $decodedTemplate = base64_decode(trim($storedTemplate), true);
        $templateBinary = $decodedTemplate !== false ? $decodedTemplate : '';

        if (strlen($templateBinary) !== self::EXPECTED_TEMPLATE_BYTES && strlen($storedTemplate) === self::EXPECTED_TEMPLATE_BYTES) {
            $roundTripTemplate = base64_decode(base64_encode($storedTemplate), true);
            $templateBinary = $roundTripTemplate !== false ? $roundTripTemplate : '';
        }

        if ($templateBinary === '') {
            return ['success' => false, 'status' => 400, 'message' => 'Template data must be valid base64.'];
        }

        $templateBytes = strlen($templateBinary);

        if ($templateBytes !== self::EXPECTED_TEMPLATE_BYTES) {
            return [
                'success' => false,
                'status' => 422,
                'message' => sprintf('Invalid fingerprint template size. Expected %d bytes, got %d bytes.', self::EXPECTED_TEMPLATE_BYTES, $templateBytes),
            ];
        }

        if (!hash_equals($storedHash, strtolower(hash('sha256', $templateBinary)))) {
            return ['success' => false, 'status' => 422, 'message' => 'Stored template hash does not match the fingerprint template bytes.'];
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
        $device = $this->queueModel->getDoorDeviceByIdentity($deviceId > 0 ? $deviceId : null, $deviceCode);

        return $device ?: $this->queueModel->getPreferredDoorDevice();
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

        return [
            'id' => (int) $job['id'],
            'queue_id' => (int) $job['id'],
            'fingerprint_id' => (int) $job['fingerprint_id'],
            'device_id' => (int) $job['device_id'],
            'device_name' => (string) ($job['device_name'] ?? ''),
            'device_code' => (string) ($job['device_code'] ?? ''),
            'location' => (string) ($job['location'] ?? ''),
            'status' => $status,
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
