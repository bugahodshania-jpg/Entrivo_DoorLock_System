<?php

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/SensorMemorySchema.php';
require_once __DIR__ . '/FingerprintTemplateFormat.php';
require_once __DIR__ . '/UserPrivilegeService.php';
require_once __DIR__ . '/DirectFingerprintImportSchema.php';
require_once __DIR__ . '/DoorStatusService.php';

final class SensorMemoryException extends RuntimeException
{
    public function __construct(string $message, public readonly int $httpStatus = 409)
    {
        parent::__construct($message);
    }
}

/** Sensor reports are stored separately from, and never written into, enrollments. */
final class SensorMemoryService
{
    public const MAX_CAPACITY = 4096;
    private PDO $pdo;

    public function __construct(?PDO $pdo = null, private bool $checkSchema = true)
    {
        $this->pdo = $pdo ?? entrivo_pdo();
    }

    public static function deviceTokenMatches(mixed $configured, mixed $provided): bool
    {
        return is_string($configured) && trim($configured) !== '' && is_string($provided)
            && hash_equals($configured, $provided);
    }

    public function read(array $input): array
    {
        $this->actor($input['actor_id'] ?? null);
        $this->ready();
        $devices = $this->devices();
        $deviceId = isset($input['device_id']) ? $this->integer($input['device_id']) : ($devices[0]['device_id'] ?? null);
        $response = ['success' => true, 'devices' => $devices, 'device' => null, 'inventory' => null,
            'active_job' => null, 'rows' => [], 'summary' => $this->emptySummary()];
        $response['database_compared_at'] = (string) $this->pdo->query('SELECT NOW()')->fetchColumn();
        $response['time_zone'] = 'Asia/Manila';
        if ($deviceId === null) return $response;
        $response['device'] = $this->device($deviceId);
        $inventoryId = isset($input['inventory_id']) ? $this->integer($input['inventory_id']) : null;
        if (isset($input['template_job_id'])) {
            $templateJob = $this->job($this->integer($input['template_job_id']));
            $this->sameDevice($templateJob, $deviceId);
            if ($templateJob['kind'] !== 'template' || $templateJob['status'] !== 'completed') {
                $this->reject('This sensor template has not been read successfully.');
            }
            if ($inventoryId !== null && $inventoryId !== (int) $templateJob['inventory_id']) {
                $this->reject('The template belongs to a different inventory.', 422);
            }
            $inventoryId = (int) $templateJob['inventory_id'];
            $response['template'] = $this->template($templateJob['id'], true);
        }
        if (isset($input['job_id'])) {
            $job = $this->job($this->integer($input['job_id']));
            $this->sameDevice($job, $deviceId);
            $response['job'] = $this->safeJob($job);
        }
        $query = $this->pdo->prepare("SELECT * FROM sensor_memory_jobs WHERE device_id=? AND status IN ('pending','processing') ORDER BY id LIMIT 1");
        $query->execute([$deviceId]);
        $active = $query->fetch(PDO::FETCH_ASSOC);
        $response['active_job'] = $active ? $this->safeJob($active) : null;
        $inventory = $inventoryId === null ? $this->latestInventory($deviceId) : $this->inventory($inventoryId, $deviceId);
        // Database mappings are still reviewable when there is no sensor snapshot.
        // They never create sensor-present rows or an invented empty inventory.
        [$rows, $summary] = $this->comparison($deviceId, $inventory);
        $response['inventory'] = $inventory;
        $response['rows'] = $rows;
        $response['summary'] = $summary;
        return $response;
    }

    public function adminAction(array $input): array
    {
        $actorId = $this->actor($input['actor_id'] ?? null);
        $deviceId = $this->integer($input['device_id'] ?? null);
        $action = $input['action'] ?? null;
        if (!in_array($action, ['scan', 'read_template', 'cancel', 'empty_sensor'], true)) $this->reject('Use scan, read_template, empty_sensor, or cancel.', 422);
        $this->ready();
        return $this->transaction(function () use ($input, $actorId, $deviceId, $action): array {
            $this->device($deviceId, true, $action !== 'cancel');
            if ($action === 'cancel') {
                $job = $this->job($this->integer($input['job_id'] ?? null), true);
                $this->sameDevice($job, $deviceId);
                if (in_array($job['status'], ['pending', 'processing'], true)) {
                    $this->pdo->prepare("UPDATE sensor_memory_jobs SET status='cancelled',error_message='Read cancelled by an administrator.',finished_at=NOW(),active_device_key=NULL WHERE id=?")
                        ->execute([$job['id']]);
                }
                return $this->jobResponse($this->job((int) $job['id']), 'Sensor memory read status loaded.');
            }
            $door = (new DoorStatusService($this->pdo))->snapshot($deviceId);
            if (!$door['can_read_sensor']) {
                $this->reject($door['state'] === 'unlocked'
                    ? ($action === 'empty_sensor'
                        ? 'The door is unlocked. Lock the door before erasing sensor templates.'
                        : 'The door is unlocked. Lock the door before reading sensor memory.')
                    : 'Door status is unavailable. Wait for the controller to confirm the door is locked before using the sensor.');
            }
            if ($action === 'empty_sensor' && $this->writeWorkActive($deviceId)) {
                $this->reject('Finish or cancel fingerprint enrollment and database restore before erasing the sensor.');
            }
            $kind = $action === 'empty_sensor' ? 'empty' : ($action === 'scan' ? 'inventory' : 'template');
            $inventoryId = null;
            $slot = null;
            if ($kind === 'template') {
                $inventoryId = $this->integer($input['inventory_id'] ?? null);
                $slot = $this->integer($input['slot_id'] ?? null, true);
                $inventory = $this->inventory($inventoryId, $deviceId);
                if (!in_array($slot, $inventory['occupied_slots'], true)) $this->reject('This slot was not occupied in the selected sensor inventory.', 422);
            }
            $query = $this->pdo->prepare("SELECT * FROM sensor_memory_jobs WHERE device_id=? AND status IN ('pending','processing') ORDER BY id LIMIT 1 FOR UPDATE");
            $query->execute([$deviceId]);
            $active = $query->fetch(PDO::FETCH_ASSOC);
            if ($active) {
                if ($active['kind'] === $kind && ($inventoryId === null || (int) $active['inventory_id'] === $inventoryId)
                    && ($slot === null || (int) $active['target_slot'] === $slot)) {
                    return $this->jobResponse($active, 'This sensor memory read is already queued or running.');
                }
                $this->reject('A sensor memory read is already queued or running for this device. Wait for it to finish.');
            }
            $this->pdo->prepare('INSERT INTO sensor_memory_jobs (actor_id,device_id,kind,inventory_id,target_slot,active_device_key) VALUES (?,?,?,?,?,?)')
                ->execute([$actorId, $deviceId, $kind, $inventoryId, $slot, $deviceId]);
            return $this->jobResponse($this->job((int) $this->pdo->lastInsertId()), $kind === 'empty'
                ? 'Erase queued. The controller will delete every fingerprint template and slot ID on the R307S.'
                : 'Read queued. Waiting for the physical R307S controller.');
        });
    }

    /** Authentication happens in the device endpoint before a database is opened. */
    public function claim(array $input): array
    {
        $deviceId = $this->integer($input['device_id'] ?? null);
        $this->ready();
        return $this->transaction(function () use ($deviceId): array {
            $this->device($deviceId, true, true);
            if (!(new DoorStatusService($this->pdo))->snapshot($deviceId)['can_read_sensor']) {
                return ['success' => true, 'job' => null, 'message' => 'Sensor reads require a recent locked door status.'];
            }
            $query = $this->pdo->prepare("SELECT * FROM sensor_memory_jobs WHERE device_id=? AND status IN ('pending','processing') ORDER BY id LIMIT 1 FOR UPDATE");
            $query->execute([$deviceId]);
            $job = $query->fetch(PDO::FETCH_ASSOC);
            if (!$job) return ['success' => true, 'job' => null, 'message' => 'No queued sensor memory read.'];
            if (!$this->leaseIsLive($job)) {
                $this->expireLockedJob($job);
                return ['success' => true, 'job' => null, 'message' => 'The queued sensor memory read expired.'];
            }
            // Resuming an owned read must remain possible even if an enrollment
            // has been queued since its claim. New reads yield to physical writes.
            if ($job['status'] === 'pending') {
                if ($this->writeWorkActive($deviceId)) return ['success' => true, 'job' => null, 'message' => 'Sensor memory read is waiting for enrollment or restore work to finish.'];
                $token = bin2hex(random_bytes(32));
                $this->pdo->prepare("UPDATE sensor_memory_jobs SET status='processing',claim_token=?,processing_at=NOW() WHERE id=? AND status='pending'")
                    ->execute([$token, $job['id']]);
                $job = $this->job((int) $job['id']);
            }
            $safe = $this->safeJob($job);
            $safe['claim_token'] = $job['claim_token'];
            return ['success' => true, 'message' => 'Read claimed by the sensor controller.', 'job' => $safe];
        });
    }

    public function deviceUpdate(array $input): array
    {
        $deviceId = $this->integer($input['device_id'] ?? null);
        $jobId = $this->integer($input['job_id'] ?? null);
        $action = $input['action'] ?? null;
        if (!in_array($action, ['complete', 'fail'], true)) $this->reject('Use complete or fail for a claimed sensor read.', 422);
        $this->ready();
        return $this->transaction(function () use ($input, $deviceId, $jobId, $action): array {
            $this->device($deviceId, true);
            $job = $this->job($jobId, true);
            $this->sameDevice($job, $deviceId);
            if (!is_string($input['claim_token'] ?? null) || !is_string($job['claim_token'])
                || !hash_equals($job['claim_token'], $input['claim_token'])) $this->reject('The sensor read claim token is invalid.', 403);
            $report = $this->report($job, $input, $action);
            if (in_array($job['status'], ['completed', 'failed'], true) && is_string($job['report_hash'])
                && hash_equals($job['report_hash'], $report['report_hash'])) {
                return $this->jobResponse($job, 'This exact sensor result was already received.');
            }
            if ($job['status'] !== 'processing') $this->reject('This sensor read is no longer processing. Queue a new read.');
            if (!$this->leaseIsLive($job)) $this->reject('The sensor read lease expired. Queue a new read.');
            if ($action === 'fail') {
                $this->pdo->prepare("UPDATE sensor_memory_jobs SET status='failed',error_message=?,report_hash=?,finished_at=NOW(),active_device_key=NULL WHERE id=?")
                    ->execute([$report['error_message'], $report['report_hash'], $jobId]);
            } else {
                if ($job['kind'] === 'inventory' || $job['kind'] === 'empty') {
                    $this->pdo->prepare('INSERT INTO sensor_memory_inventories (job_id,device_id,capacity,template_count,occupied_slots,captured_at) VALUES (?,?,?,?,?,?)')
                        ->execute([$jobId, $deviceId, $report['capacity'], $report['template_count'], json_encode($report['occupied_slots']), $report['captured_at']]);
                } else {
                    // Validate the parent again: a template never becomes an
                    // inventory, or attaches to another device or unlisted slot.
                    $parent = $this->inventory((int) $job['inventory_id'], $deviceId);
                    if (!in_array((int) $job['target_slot'], $parent['occupied_slots'], true)) $this->reject('The template slot does not belong to its inventory.');
                    $this->pdo->prepare('INSERT INTO sensor_memory_templates (job_id,inventory_id,device_id,slot_id,template_data,template_hash,template_bytes,captured_at) VALUES (?,?,?,?,?,?,?,?)')
                        ->execute([$jobId, $job['inventory_id'], $deviceId, $job['target_slot'], $report['binary'], $report['template_hash'], strlen($report['binary']), $report['captured_at']]);
                }
                $this->pdo->prepare("UPDATE sensor_memory_jobs SET status='completed',report_hash=?,error_message=NULL,finished_at=NOW(),active_device_key=NULL WHERE id=?")
                    ->execute([$report['report_hash'], $jobId]);
            }
            return $this->jobResponse($this->job($jobId), $action === 'complete' ? 'Actual R307S data received.' : 'Sensor read failure recorded. The last completed inventory is preserved.');
        });
    }

    private function report(array $job, array $input, string $action): array
    {
        if ($action === 'fail') {
            $reason = is_string($input['error_message'] ?? null) ? trim($input['error_message']) : '';
            $reason = $reason === '' ? 'The physical sensor could not complete this read.' : mb_substr($reason, 0, 1000);
            return ['error_message' => $reason, 'report_hash' => hash('sha256', json_encode(['fail', $reason]))];
        }
        $capture = $this->capturedAt($input['captured_at'] ?? null);
        if ($job['kind'] === 'inventory' || $job['kind'] === 'empty') {
            $capacity = $this->integer($input['capacity'] ?? null);
            $count = $this->integer($input['template_count'] ?? null, true);
            $slots = $input['occupied_slots'] ?? null;
            if ($capacity > self::MAX_CAPACITY || $count > $capacity || !is_array($slots) || !array_is_list($slots) || count($slots) !== $count) {
                $this->reject('The sensor capacity, template count, and occupied-slot list are inconsistent.', 422);
            }
            $seen = [];
            foreach ($slots as $slot) {
                if (!is_int($slot) || $slot < 0 || $slot >= $capacity || isset($seen[$slot])) $this->reject('Occupied slots must be unique integer IDs inside the sensor capacity, including slot 0 when occupied.', 422);
                $seen[$slot] = true;
            }
            sort($slots, SORT_NUMERIC);
            if ($job['kind'] === 'empty' && ($count !== 0 || $slots !== [])) {
                $this->reject('The sensor erase is complete only when every fingerprint template and slot ID is gone.', 422);
            }
            return ['capacity' => $capacity, 'template_count' => $count, 'occupied_slots' => $slots, 'captured_at' => $capture,
                'report_hash' => hash('sha256', json_encode([$job['kind'], $capacity, $count, $slots, $capture]))];
        }
        $slot = $this->integer($input['target_slot'] ?? null, true);
        if ($slot !== (int) $job['target_slot']) $this->reject('The returned template belongs to a different sensor slot.', 422);
        if (isset($input['inventory_id']) && $this->integer($input['inventory_id']) !== (int) $job['inventory_id']) $this->reject('The returned template belongs to a different inventory.', 422);
        $encoded = $input['template_data_base64'] ?? null;
        if (!is_string($encoded) || strlen($encoded) > 2048) $this->reject('A complete supported sensor template in canonical Base64 is required.', 422);
        $binary = base64_decode($encoded, true);
        if (!is_string($binary) || base64_encode($binary) !== $encoded || !FingerprintTemplateFormat::isSupportedSize(strlen($binary))) {
            $this->reject('A valid complete sensor template of ' . FingerprintTemplateFormat::describeSupportedSizes() . ' bytes is required.', 422);
        }
        $hash = hash('sha256', $binary);
        return ['binary' => $binary, 'template_hash' => $hash, 'captured_at' => $capture,
            'report_hash' => hash('sha256', json_encode(['template', (int) $job['inventory_id'], $slot, $hash, strlen($binary), $capture]))];
    }

    private function comparison(int $deviceId, ?array $inventory): array
    {
        $query = $this->pdo->prepare('SELECT f.*,u.username FROM fingerprints f LEFT JOIN users u ON u.id=f.user_id WHERE f.enrollment_device_id=? AND f.enrollment_slot IS NOT NULL ORDER BY f.enrollment_slot,f.fingerprint_id');
        $query->execute([$deviceId]);
        $bySlot = [];
        $profiles = [];
        $profileRows = $this->pdo->query('SELECT user_id,employee_id,first_name,middle_name,last_name,extension_name FROM faculty_info UNION ALL SELECT user_id,employee_id,first_name,middle_name,last_name,extension_name FROM staff_info UNION ALL SELECT user_id,employee_id,first_name,middle_name,last_name,extension_name FROM admin_info')->fetchAll(PDO::FETCH_ASSOC);
        foreach ($profileRows as $profile) $profiles[(int) $profile['user_id']] ??= $profile;
        foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $record) {
            $slot = (int) $record['enrollment_slot'];
            if ($slot < 0) continue;
            $profile = $profiles[(int) $record['user_id']] ?? [];
            $name = trim(implode(' ', array_filter([$profile['first_name'] ?? '', $profile['middle_name'] ?? '', $profile['last_name'] ?? '', $profile['extension_name'] ?? ''])));
            $binary = FingerprintTemplateFormat::verifiedBinary($record['template_data'] ?? null, $record['template_hash'] ?? null);
            $bySlot[$slot][] = ['fingerprint_id' => (int) $record['fingerprint_id'], 'user_id' => (int) $record['user_id'],
                'full_name' => $name !== '' ? $name : ($record['username'] ?? 'Unknown user'), 'employee_id' => $profile['employee_id'] ?? '',
                'finger_name' => $record['finger_name'], 'status' => $record['status'], 'backup_valid' => $binary !== null,
                'template_bytes' => $binary === null ? null : strlen($binary), 'template_hash' => $binary === null ? null : hash('sha256', $binary)];
        }
        $sensor = $inventory === null ? [] : array_fill_keys($inventory['occupied_slots'], true);
        $slots = array_unique(array_merge(array_keys($bySlot), array_keys($sensor)));
        sort($slots, SORT_NUMERIC);
        $templates = [];
        $templateJobs = [];
        if ($inventory !== null) {
            $query = $this->pdo->prepare('SELECT * FROM sensor_memory_templates WHERE inventory_id=? ORDER BY job_id');
            $query->execute([$inventory['job_id']]);
            foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $template) $templates[(int) $template['slot_id']] = $this->safeTemplate($template);
            $query = $this->pdo->prepare("SELECT * FROM sensor_memory_jobs WHERE inventory_id=? AND kind='template' ORDER BY id");
            $query->execute([$inventory['job_id']]);
            foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $job) $templateJobs[(int) $job['target_slot']] = $this->safeJob($job);
        }
        $summary = $this->emptySummary();
        $rows = [];
        foreach ($slots as $slot) {
            $records = $bySlot[$slot] ?? [];
            $present = $inventory === null ? null : isset($sensor[$slot]);
            $template = $templates[$slot] ?? null;
            $mapping = count($records) > 1 ? 'conflict' : ($inventory === null ? 'not_scanned' : ($present ? ($records === [] ? 'sensor_only' : 'mapped') : 'database_only'));
            $state = $present === null ? 'not_scanned' : (!$present ? 'not_on_sensor' : 'not_read');
            if ($present === true && $template !== null) {
                if (!$template['template_valid']) $state = 'invalid_sensor_template';
                elseif (count($records) > 1) $state = 'conflict';
                elseif ($records === [] || !$records[0]['backup_valid']) $state = 'no_backup';
                else $state = hash_equals($records[0]['template_hash'], $template['template_hash']) ? 'match' : 'different';
            }
            if (isset($summary[$mapping])) $summary[$mapping]++;
            if ($state === 'match') $summary['matches']++;
            if ($state === 'different') $summary['different']++;
            if ($state === 'not_read') $summary['not_read']++;
            $rows[] = ['slot_id' => (int) $slot, 'sensor_present' => $present, 'mapping_status' => $mapping, 'template_status' => $state,
                'database_records' => $records, 'sensor_template' => $template, 'template_job' => $templateJobs[$slot] ?? null];
        }
        return [$rows, $summary];
    }

    private function emptySummary(): array
    {
        return ['sensor_only' => 0, 'database_only' => 0, 'mapped' => 0, 'conflict' => 0, 'matches' => 0, 'different' => 0, 'not_read' => 0, 'not_scanned' => 0];
    }

    private function actor(mixed $rawId): int
    {
        $id = $this->integer($rawId);
        $query = $this->pdo->prepare('SELECT role,is_active,approval_status FROM users WHERE id=?');
        $query->execute([$id]);
        $actor = $query->fetch(PDO::FETCH_ASSOC);
        if (!$actor || (int) $actor['is_active'] !== 1 || $actor['approval_status'] !== 'approved' || !in_array($actor['role'], ['admin', 'super_admin'], true)) {
            $this->reject('An active approved administrator is required to inspect sensor memory.', 403);
        }
        $query = $this->pdo->prepare('SELECT privilege_key FROM user_privileges WHERE user_id=?');
        $query->execute([$id]);
        $privileges = $query->fetchAll(PDO::FETCH_COLUMN);
        if ($privileges === []) $privileges = UserPrivilegeService::defaultsForRole($actor['role']);
        if (!in_array('fingerprint', $privileges, true)) $this->reject('Fingerprint permission is required to inspect sensor memory.', 403);
        return $id;
    }

    private function devices(): array
    {
        $devices = $this->pdo->query("SELECT device_id,device_name,device_type,status FROM fingerprint_devices WHERE device_type='enrollment' ORDER BY (status='active') DESC,device_id")->fetchAll(PDO::FETCH_ASSOC);
        foreach ($devices as &$device) $device['device_id'] = (int) $device['device_id'];
        return $devices;
    }

    private function device(int $id, bool $lock = false, bool $requireActive = false): array
    {
        $query = $this->pdo->prepare('SELECT device_id,device_name,device_type,status FROM fingerprint_devices WHERE device_id=?' . ($lock ? ' FOR UPDATE' : ''));
        $query->execute([$id]);
        $device = $query->fetch(PDO::FETCH_ASSOC);
        if (!$device || $device['device_type'] !== 'enrollment') $this->reject('The selected enrollment sensor is not registered.', 404);
        if ($requireActive && $device['status'] !== 'active') $this->reject('Activate this enrollment sensor before requesting a read.');
        $device['device_id'] = (int) $device['device_id'];
        return $device;
    }

    private function writeWorkActive(int $deviceId): bool
    {
        $query = $this->pdo->prepare("SELECT 1 FROM fingerprint_enrollment_jobs WHERE status IN ('waiting','processing') AND (enrollment_device_id=? OR enrollment_device_id IS NULL) LIMIT 1 FOR UPDATE");
        $query->execute([$deviceId]);
        return (bool) $query->fetchColumn() || DirectFingerprintImportSchema::hasActiveForDevice($this->pdo, $deviceId);
    }

    private function job(int $id, bool $lock = false): array
    {
        $query = $this->pdo->prepare('SELECT * FROM sensor_memory_jobs WHERE id=?' . ($lock ? ' FOR UPDATE' : ''));
        $query->execute([$id]);
        $job = $query->fetch(PDO::FETCH_ASSOC);
        if (!$job) $this->reject('Sensor memory job not found.', 404);
        return $job;
    }

    private function safeJob(array $job): array
    {
        return ['job_id' => (int) $job['id'], 'kind' => $job['kind'], 'device_id' => (int) $job['device_id'],
            'inventory_id' => isset($job['inventory_id']) ? (int) $job['inventory_id'] : null,
            'target_slot' => isset($job['target_slot']) ? (int) $job['target_slot'] : null,
            'status' => $job['status'], 'error_message' => $job['error_message'], 'queued_at' => $job['queued_at'],
            'processing_at' => $job['processing_at'], 'finished_at' => $job['finished_at']];
    }

    private function jobResponse(array $job, string $message): array
    {
        return ['success' => true, 'message' => $message, 'job' => $this->safeJob($job)];
    }

    private function sameDevice(array $job, int $deviceId): void
    {
        if ((int) $job['device_id'] !== $deviceId) $this->reject('This sensor memory job belongs to a different device.', 403);
    }

    private function latestInventory(int $deviceId): ?array
    {
        $query = $this->pdo->prepare("SELECT i.* FROM sensor_memory_inventories i INNER JOIN sensor_memory_jobs j ON j.id=i.job_id WHERE i.device_id=? AND j.status='completed' ORDER BY i.job_id DESC LIMIT 1");
        $query->execute([$deviceId]);
        $inventory = $query->fetch(PDO::FETCH_ASSOC);
        return $inventory ? $this->safeInventory($inventory) : null;
    }

    private function inventory(int $jobId, int $deviceId): array
    {
        $query = $this->pdo->prepare("SELECT i.* FROM sensor_memory_inventories i INNER JOIN sensor_memory_jobs j ON j.id=i.job_id WHERE i.job_id=? AND j.status='completed'");
        $query->execute([$jobId]);
        $inventory = $query->fetch(PDO::FETCH_ASSOC);
        if (!$inventory) $this->reject('A completed physical sensor inventory is required.', 404);
        if ((int) $inventory['device_id'] !== $deviceId) $this->reject('The inventory belongs to a different device.', 403);
        return $this->safeInventory($inventory);
    }

    private function safeInventory(array $row): array
    {
        return ['job_id' => (int) $row['job_id'], 'device_id' => (int) $row['device_id'], 'capacity' => (int) $row['capacity'],
            'template_count' => (int) $row['template_count'], 'occupied_slots' => json_decode($row['occupied_slots'], true, 512, JSON_THROW_ON_ERROR),
            'captured_at' => $row['captured_at'], 'received_at' => $row['received_at'], 'source' => 'r307s', 'time_zone' => 'Asia/Manila'];
    }

    private function template(int $jobId, bool $raw = false): array
    {
        $query = $this->pdo->prepare('SELECT * FROM sensor_memory_templates WHERE job_id=?');
        $query->execute([$jobId]);
        $row = $query->fetch(PDO::FETCH_ASSOC);
        if (!$row) $this->reject('The sensor template snapshot is unavailable.', 404);
        $safe = $this->safeTemplate($row);
        if ($raw) {
            $safe['template_data_base64'] = base64_encode($row['template_data']);
            $safe['template_data_hex'] = bin2hex($row['template_data']);
        }
        return $safe;
    }

    private function safeTemplate(array $row): array
    {
        return ['job_id' => (int) $row['job_id'], 'inventory_id' => (int) $row['inventory_id'], 'slot_id' => (int) $row['slot_id'],
            'template_bytes' => (int) $row['template_bytes'], 'template_hash' => $row['template_hash'],
            'template_valid' => FingerprintTemplateFormat::isUsableTemplate($row['template_data']),
            'captured_at' => $row['captured_at'], 'received_at' => $row['received_at'], 'source' => 'r307s', 'time_zone' => 'Asia/Manila'];
    }

    private function leaseIsLive(array $job): bool
    {
        $query = $this->pdo->prepare("SELECT CASE WHEN status='pending' THEN queued_at ELSE processing_at END > DATE_SUB(NOW(),INTERVAL 3 MINUTE) FROM sensor_memory_jobs WHERE id=?");
        $query->execute([$job['id']]);
        return (bool) $query->fetchColumn();
    }

    private function expireLockedJob(array $job): void
    {
        $pending = $job['status'] === 'pending';
        $this->pdo->prepare('UPDATE sensor_memory_jobs SET status=?,error_message=?,finished_at=NOW(),active_device_key=NULL WHERE id=?')
            ->execute([$pending ? 'cancelled' : 'failed', $pending
                ? 'Sensor did not pick up the read within 3 minutes. Check its power, WiFi, and Sensor Memory firmware, then retry.'
                : 'Sensor did not finish the read within 3 minutes. The last completed inventory is preserved; retry the read.', $job['id']]);
    }

    private function integer(mixed $value, bool $allowZero = false): int
    {
        if ((!is_int($value) && (!is_string($value) || preg_match('/^\d{1,10}$/D', $value) !== 1))
            || (int) $value < ($allowZero ? 0 : 1) || (int) $value > 2147483647) $this->reject('A valid integer ID, count, or slot is required.', 422);
        return (int) $value;
    }

    private function capturedAt(mixed $value): ?string
    {
        if ($value === null || $value === '') return null;
        if (!is_string($value) || preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/D', $value) !== 1) {
            $this->reject('captured_at must be an ISO timestamp with a timezone, or omitted when the sensor clock is unavailable.', 422);
        }
        try {
            $date = new DateTimeImmutable($value);
            if (DateTimeImmutable::getLastErrors() !== false) $this->reject('The sensor capture timestamp is invalid.', 422);
            return $date->setTimezone(new DateTimeZone('Asia/Manila'))->format('Y-m-d H:i:s');
        } catch (Exception $error) {
            $this->reject('The sensor capture timestamp is invalid.', 422);
        }
    }

    private function ready(): void
    {
        if ($this->checkSchema) {
            foreach (['sensor_memory_jobs', 'sensor_memory_inventories', 'sensor_memory_templates'] as $table) {
                if (!SensorMemorySchema::tableExists($this->pdo, $table)) $this->reject('Sensor Memory is not installed. Run backend/migrations/create_sensor_memory.php, then retry.', 503);
            }
        }
        SensorMemorySchema::expire($this->pdo);
    }

    private function transaction(callable $work): array
    {
        $this->pdo->beginTransaction();
        try {
            $result = $work();
            $this->pdo->commit();
            return $result;
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw $error;
        }
    }

    private function reject(string $message, int $status = 409): never
    {
        throw new SensorMemoryException($message, $status);
    }
}
