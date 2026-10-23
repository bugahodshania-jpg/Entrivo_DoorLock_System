<?php

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/DoorStatusSchema.php';

final class DoorStatusException extends RuntimeException
{
    public function __construct(string $message, public readonly int $httpStatus = 409)
    {
        parent::__construct($message);
    }
}

/** Reports describe the controller's lock relay, not a door-position switch. */
final class DoorStatusService
{
    public const FRESH_SECONDS = 15;
    private PDO $pdo;

    public function __construct(?PDO $pdo = null)
    {
        $this->pdo = $pdo ?? entrivo_pdo();
    }

    public function read(array $input): array
    {
        $actorId = $this->positiveInteger($input['actor_id'] ?? null);
        $query = $this->pdo->prepare('SELECT role,is_active,approval_status FROM users WHERE id=?');
        $query->execute([$actorId]);
        $actor = $query->fetch(PDO::FETCH_ASSOC);
        if (!$actor || (int) $actor['is_active'] !== 1 || $actor['approval_status'] !== 'approved'
            || !in_array($actor['role'], ['super_admin', 'admin', 'faculty', 'staff'], true)) {
            throw new DoorStatusException('An active approved portal account is required to view door status.', 403);
        }
        $ids = $this->pdo->query("SELECT device_id FROM fingerprint_devices WHERE device_type='enrollment' ORDER BY (status='active') DESC,device_id")->fetchAll(PDO::FETCH_COLUMN);
        return ['success' => true, 'doors' => array_map(fn($id) => $this->snapshot((int) $id), $ids)];
    }

    public function snapshot(int $deviceId): array
    {
        $query = $this->pdo->prepare("SELECT device_id,device_name,status FROM fingerprint_devices WHERE device_id=? AND device_type='enrollment'");
        $query->execute([$deviceId]);
        $device = $query->fetch(PDO::FETCH_ASSOC);
        $report = false;
        if (DoorStatusSchema::exists($this->pdo)) {
            $query = $this->pdo->prepare('SELECT door_state,received_at,TIMESTAMPDIFF(MICROSECOND,received_at,NOW(6))/1000000 AS age_seconds FROM door_controller_status WHERE device_id=?');
            $query->execute([$deviceId]);
            $report = $query->fetch(PDO::FETCH_ASSOC);
        }
        $age = $report ? (float) $report['age_seconds'] : null;
        $online = $device && $device['status'] === 'active' && $age !== null && $age >= 0 && $age < self::FRESH_SECONDS;
        $state = $online ? $report['door_state'] : 'unknown';
        return [
            'device_id' => $deviceId,
            'device_name' => $device['device_name'] ?? 'Door controller',
            'state' => $state,
            'reported_state' => $report['door_state'] ?? null,
            'online' => (bool) $online,
            'can_read_sensor' => $state === 'locked',
            'received_at' => $report['received_at'] ?? null,
            'expires_in_ms' => $online ? max(0, (int) floor((self::FRESH_SECONDS - $age) * 1000)) : 0,
        ];
    }

    /** Called only after device-token authentication in the device endpoint. */
    public function report(array $input): array
    {
        $deviceId = $this->positiveInteger($input['device_id'] ?? null);
        $sequence = $this->positiveInteger($input['sequence'] ?? null);
        $bootId = $input['boot_id'] ?? null;
        $state = $input['door_state'] ?? null;
        if (!is_string($bootId) || preg_match('/^[a-f0-9]{32}$/D', $bootId) !== 1
            || !in_array($state, ['locked', 'unlocked'], true)) {
            throw new DoorStatusException('A valid controller boot ID and locked/unlocked state are required.', 422);
        }
        if (!DoorStatusSchema::exists($this->pdo)) {
            throw new DoorStatusException('Run backend/migrations/create_door_status.php before reporting door status.', 503);
        }
        $this->pdo->beginTransaction();
        try {
            // Sensor read requests lock the same device row, serializing their guard
            // with status changes rather than racing a separate status-table write.
            $query = $this->pdo->prepare('SELECT device_type,status FROM fingerprint_devices WHERE device_id=? FOR UPDATE');
            $query->execute([$deviceId]);
            $device = $query->fetch(PDO::FETCH_ASSOC);
            if (!$device || $device['device_type'] !== 'enrollment' || $device['status'] !== 'active') {
                throw new DoorStatusException('The reporting enrollment controller is not active.', 403);
            }
            $query = $this->pdo->prepare('SELECT boot_id,report_sequence FROM door_controller_status WHERE device_id=? FOR UPDATE');
            $query->execute([$deviceId]);
            $previous = $query->fetch(PDO::FETCH_ASSOC);
            if ($previous && $previous['boot_id'] === $bootId && $sequence <= (int) $previous['report_sequence']) {
                throw new DoorStatusException('An older or duplicate door status report cannot refresh the connection.');
            }
            $this->pdo->prepare('INSERT INTO door_controller_status (device_id,door_state,boot_id,report_sequence,received_at) VALUES (?,?,?,?,NOW(6))
                ON DUPLICATE KEY UPDATE door_state=VALUES(door_state),boot_id=VALUES(boot_id),report_sequence=VALUES(report_sequence),received_at=NOW(6)')
                ->execute([$deviceId, $state, $bootId, $sequence]);
            if ($state === 'unlocked') {
                // A read queued just before an unlock must not start or resume later.
                require_once __DIR__ . '/SensorMemorySchema.php';
                if (SensorMemorySchema::tableExists($this->pdo)) {
                    $this->pdo->prepare("UPDATE sensor_memory_jobs SET status='cancelled',error_message=CASE WHEN kind='empty' THEN 'The door was unlocked. Lock the door and request the sensor erase again.' ELSE 'The door was unlocked. Lock the door and request a new sensor read.' END,finished_at=NOW(),active_device_key=NULL WHERE device_id=? AND status IN ('pending','processing')")
                        ->execute([$deviceId]);
                }
            }
            $this->pdo->commit();
            return ['success' => true];
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw $error;
        }
    }

    private function positiveInteger(mixed $value): int
    {
        if (is_bool($value) || (!is_int($value) && (!is_string($value) || !ctype_digit($value)))
            || filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false) {
            throw new DoorStatusException('A positive integer account, device, or report ID is required.', 422);
        }
        return (int) $value;
    }
}
