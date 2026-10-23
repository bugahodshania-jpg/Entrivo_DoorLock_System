<?php

require_once dirname(__DIR__) . '/services/FingerprintTemplateService.php';
require_once dirname(__DIR__) . '/services/FingerprintSyncService.php';

function expectTemplateSize(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

// Keep transfer tests independent of a live database and sensor.
class TemplateSizeFingerprint extends Fingerprint
{
    public array $record;
    public int $writes = 0;
    public ?string $syncStatus = null;

    public function __construct()
    {
        $this->record = [
            'fingerprint_id' => 1, 'user_id' => 2, 'finger_name' => 'Right thumb',
            'status' => 'active', 'shared_door_slot' => 7,
        ];
    }

    public function getById(int $fingerprintId): ?array
    {
        return $this->record;
    }

    public function getTemplateExportData(int $fingerprintId): ?array
    {
        return $this->record;
    }

    public function importTemplateData(
        int $fingerprintId,
        string $templateBinary,
        string $templateHash,
        ?string $fingerName = null,
        ?int $enrollmentDeviceId = null,
        ?int $enrollmentSlot = null,
        ?int $sharedDoorSlot = null
    ): ?array {
        ++$this->writes;
        $this->record['template_data'] = $templateBinary;
        $this->record['template_hash'] = $templateHash;
        return $this->record;
    }

    public function listOtherSharedDoorSlots(int $fingerprintId): array
    {
        return [8];
    }

    public function markDoorSyncStatus(int $fingerprintId, string $status): bool
    {
        $this->syncStatus = $status;
        return true;
    }
}

class TemplateSizeQueue extends FingerprintSyncQueue
{
    public ?string $failure = null;

    public function __construct() {}

    public function failIdleJobs(int $idleMinutes = 30): array
    {
        return [];
    }

    public function getDoorDeviceByIdentity(?int $deviceId = null, ?string $deviceCode = null): ?array
    {
        return ['device_id' => 3];
    }

    public function requeueStaleSyncingJobs(int $deviceId, int $staleMinutes = 5): void {}

    public function claimNextPendingJob(int $deviceId): ?array
    {
        return ['id' => 4, 'fingerprint_id' => 1, 'device_id' => 3, 'status' => 'syncing'];
    }

    public function markJobFailed(int $queueId, string $errorMessage): bool
    {
        $this->failure = $errorMessage;
        return true;
    }
}

$fingerprint = new TemplateSizeFingerprint();
$templates = new FingerprintTemplateService($fingerprint);
$queue = new TemplateSizeQueue();
$syncReflection = new ReflectionClass(FingerprintSyncService::class);
$sync = $syncReflection->newInstanceWithoutConstructor();
$syncReflection->getProperty('fingerprintModel')->setValue($sync, $fingerprint);
$syncReflection->getProperty('queueModel')->setValue($sync, $queue);

foreach ([512, 768, 1024, 1536] as $size) {
    // Include bytes that trim() would remove, plus a raw template whose entire
    // content is valid base64 and whose decoded length can also be supported.
    foreach (["\0" . str_repeat("\xFF", $size - 2) . "\n", str_repeat('AB', $size / 2)] as $binary) {
        $upload = $templates->uploadTemplate(['fingerprint_id' => 1, 'template_data_base64' => base64_encode($binary)]);
        expectTemplateSize($upload['status'] === 200, "A complete {$size}-byte template must upload.");
        expectTemplateSize($fingerprint->record['template_data'] === $binary, 'Uploads must preserve every byte.');
        expectTemplateSize($fingerprint->record['template_hash'] === hash('sha256', $binary), 'Uploads must hash the complete template.');

        $export = $templates->exportTemplate(['fingerprint_id' => 1])['body']['fingerprint'];
        expectTemplateSize($export['template_bytes'] === $size && base64_decode($export['template_data_base64'], true) === $binary, 'Exports must report the actual size and preserve the complete template.');

        foreach ([$binary, base64_encode($binary)] as $stored) {
            $fingerprint->record['template_data'] = $stored;
            $export = $templates->exportTemplate(['fingerprint_id' => 1])['body']['fingerprint'];
            expectTemplateSize($export['template_bytes'] === $size && base64_decode($export['template_data_base64'], true) === $binary,
                'Exports must verify raw and legacy base64 backups without changing their bytes.');
            $result = $sync->getPendingDeviceJob(['device_id' => 3]);
            $job = $result['body']['job'] ?? [];
            expectTemplateSize($result['status'] === 200 && ($job['template_bytes'] ?? 0) === $size, 'Sync must advertise the actual decoded length for raw and legacy base64 storage.');
            expectTemplateSize(base64_decode($job['template_data_base64'], true) === $binary, 'Sync must preserve the complete binary without confusing raw base64-looking bytes with encoded storage.');
        }
    }
}

foreach ([1, 511, 513, 640, 767, 769, 1023, 1025, 1535, 1537, 2048] as $size) {
    $binary = str_repeat("\xFF", $size);
    $writesBefore = $fingerprint->writes;
    $upload = $templates->uploadTemplate(['fingerprint_id' => 1, 'template_data_base64' => base64_encode($binary)]);
    expectTemplateSize($upload['status'] === 422 && $fingerprint->writes === $writesBefore, "Unsupported or truncated {$size}-byte uploads must not be saved.");

    $fingerprint->record['template_data'] = $binary;
    $fingerprint->record['template_hash'] = hash('sha256', $binary);
    $queue->failure = null;
    $result = $sync->getPendingDeviceJob(['device_id' => 3]);
    expectTemplateSize($result['status'] === 422 && !isset($result['body']['job']), 'Invalid sizes must not reach a sync device.');
    expectTemplateSize($queue->failure !== null && $fingerprint->syncStatus === 'failed', 'An invalid transfer must close the claimed sync job with its validation error.');
}

$fingerprint->record['template_data'] = str_repeat('AB', 512);
$fingerprint->record['template_hash'] = str_repeat('0', 64);
$result = $sync->getPendingDeviceJob(['device_id' => 3]);
expectTemplateSize($result['status'] === 422 && str_contains($result['body']['message'], 'hash'), 'Supporting larger sizes must preserve hash validation.');

foreach ([512, 768, 1024, 1536] as $size) {
    foreach (["\xFF", "\0", 'A'] as $value) {
        $binary = str_repeat($value, $size);
        $before = $fingerprint->record;
        $writesBefore = $fingerprint->writes;
        $upload = $templates->uploadTemplate(['fingerprint_id' => 1, 'template_data_base64' => base64_encode($binary),
            'enrollment_slot' => 99, 'shared_door_slot' => 99]);
        expectTemplateSize($upload['status'] === 422 && str_contains($upload['body']['message'], 'repeated byte')
            && $fingerprint->writes === $writesBefore && $fingerprint->record === $before,
            'Uniform uploads must preserve the existing record and slot mapping.');

        foreach ([$binary, base64_encode($binary)] as $stored) {
            $fingerprint->record['template_data'] = $stored;
            $fingerprint->record['template_hash'] = hash('sha256', $binary);
            $before = $fingerprint->record;
            $export = $templates->exportTemplate(['fingerprint_id' => 1]);
            expectTemplateSize($export['status'] === 422 && !isset($export['body']['fingerprint']),
                'Uniform raw and legacy backups must not be exported.');
            $queue->failure = null;
            $result = $sync->getPendingDeviceJob(['device_id' => 3]);
            expectTemplateSize($result['status'] === 422 && !isset($result['body']['job'])
                && str_contains($result['body']['message'], 'repeated byte'),
                'Uniform raw and legacy backups must not reach a sync device.');
            expectTemplateSize($queue->failure !== null && $fingerprint->syncStatus === 'failed'
                && $fingerprint->record === $before, 'Uniform sync rejection must fail the job and preserve its backup and slot mapping.');
        }
    }
}

echo "PASS: supported transfer sizes, exact upload/export/sync bytes and hashes, actual size metadata, legacy base64, ambiguous raw storage, truncated and uniform-buffer rejection, unchanged backups/mappings, failed-job handling, and hash validation.\n";
