<?php

final class FingerprintSlotReservationException extends RuntimeException
{
}

/**
 * Sensor A slot ownership. Free slots are reused only when the ESP32 reports
 * them empty and no active, reserved, orphaned, or cleanup-owned slot exists.
 */
final class FingerprintSlotRegistry
{
    public const STATE_FREE = 'free';
    public const STATE_RESERVED = 'reserved';
    public const STATE_ACTIVE = 'active';
    public const STATE_ORPHANED = 'orphaned';
    public const STATE_AWAITING_CLEANUP = 'awaiting_cleanup';
    public const DEFAULT_CAPACITY = 512;
    public const OWNED_STATES = [
        self::STATE_RESERVED,
        self::STATE_ACTIVE,
        self::STATE_ORPHANED,
        self::STATE_AWAITING_CLEANUP,
    ];

    public static function tableExists(PDO $pdo): bool
    {
        try {
            $pdo->query('SELECT device_id FROM fingerprint_sensor_slots WHERE 1 = 0');
            return true;
        } catch (PDOException $error) {
            if ($error->getCode() === '42S02' ||
                ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' && str_contains($error->getMessage(), 'no such table'))) {
                return false;
            }
            throw $error;
        }
    }

    public static function ensure(PDO $pdo): void
    {
        if ($pdo->inTransaction()) {
            throw new LogicException('Create the slot registry before starting a transaction.');
        }
        $pdo->exec("CREATE TABLE IF NOT EXISTS fingerprint_sensor_slots (
            device_id INT NOT NULL,
            slot INT NOT NULL,
            state ENUM('free','reserved','active','orphaned','awaiting_cleanup') NOT NULL DEFAULT 'free',
            fingerprint_id INT NULL,
            job_id INT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (device_id, slot),
            KEY idx_sensor_slot_state (device_id, state, slot),
            KEY idx_sensor_slot_fingerprint (fingerprint_id),
            KEY idx_sensor_slot_job (job_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }

    /** @return array<int, true> */
    public static function unavailableSlots(PDO $pdo, int $exceptJobId = 0): array
    {
        $unavailable = [0 => true];

        foreach ($pdo->query('SELECT * FROM fingerprints') as $mapping) {
            if ((string) ($mapping['status'] ?? 'active') === 'inactive') {
                continue;
            }
            foreach (['enrollment_slot', 'shared_door_slot'] as $field) {
                $slot = (int) ($mapping[$field] ?? 0);
                if ($slot > 0) {
                    $unavailable[$slot] = true;
                }
            }
        }

        $jobs = $pdo->prepare("SELECT assigned_slot FROM fingerprint_enrollment_jobs
            WHERE job_id <> ? AND assigned_slot IS NOT NULL AND (
                status IN ('waiting','processing','stored_pending_commit','needs_reconciliation')
                OR (status = 'failed' AND progress >= 90)
            )");
        $jobs->execute([$exceptJobId]);
        foreach ($jobs as $job) {
            $unavailable[(int) $job['assigned_slot']] = true;
        }

        if (class_exists('DirectFingerprintImportSchema', false) ||
            is_file(__DIR__ . '/DirectFingerprintImportSchema.php')) {
            require_once __DIR__ . '/DirectFingerprintImportSchema.php';
            if (DirectFingerprintImportSchema::tableExists($pdo)) {
                foreach ($pdo->query('SELECT target_slot FROM direct_fingerprint_import_jobs') as $import) {
                    $unavailable[(int) $import['target_slot']] = true;
                }
            }
        }

        if (self::tableExists($pdo)) {
            foreach ($pdo->query("SELECT slot FROM fingerprint_sensor_slots
                WHERE state IN ('reserved','active','orphaned','awaiting_cleanup')") as $owned) {
                $unavailable[(int) $owned['slot']] = true;
            }
        }

        return $unavailable;
    }

    public static function nextFreeSlot(
        PDO $pdo,
        int $capacity = self::DEFAULT_CAPACITY,
        array $occupiedSlots = [],
        int $exceptJobId = 0
    ): int {
        $unavailable = self::unavailableSlots($pdo, $exceptJobId);
        foreach ($occupiedSlots as $slot) {
            $unavailable[(int) $slot] = true;
        }

        $assigned = 1;
        while ($assigned < $capacity && isset($unavailable[$assigned])) {
            ++$assigned;
        }
        if ($assigned >= $capacity) {
            throw new FingerprintSlotReservationException(
                'No empty unreserved fingerprint slot is available on this sensor. Existing fingerprints were preserved.',
                409
            );
        }

        return $assigned;
    }

    public static function reserve(PDO $pdo, int $deviceId, int $slot, int $jobId, ?int $fingerprintId = null): void
    {
        if (!self::tableExists($pdo) || $deviceId <= 0 || $slot <= 0 || $jobId <= 0) {
            return;
        }
        $statement = $pdo->prepare("INSERT INTO fingerprint_sensor_slots
            (device_id, slot, state, fingerprint_id, job_id, updated_at)
            VALUES (?, ?, 'reserved', ?, ?, CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE
                state = 'reserved',
                fingerprint_id = VALUES(fingerprint_id),
                job_id = VALUES(job_id),
                updated_at = CURRENT_TIMESTAMP");
        $statement->execute([$deviceId, $slot, $fingerprintId, $jobId]);
    }

    public static function markActive(PDO $pdo, int $deviceId, int $slot, int $fingerprintId, int $jobId): void
    {
        self::writeState($pdo, $deviceId, $slot, self::STATE_ACTIVE, $fingerprintId, $jobId);
    }

    public static function markOrphaned(PDO $pdo, int $deviceId, int $slot, int $jobId, ?int $fingerprintId = null): void
    {
        self::writeState($pdo, $deviceId, $slot, self::STATE_ORPHANED, $fingerprintId, $jobId);
    }

    public static function markAwaitingCleanup(PDO $pdo, int $deviceId, int $slot, ?int $fingerprintId = null): void
    {
        self::writeState($pdo, $deviceId, $slot, self::STATE_AWAITING_CLEANUP, $fingerprintId, null);
    }

    public static function release(PDO $pdo, int $deviceId, int $slot): void
    {
        self::writeState($pdo, $deviceId, $slot, self::STATE_FREE, null, null);
    }

    public static function releaseDevice(PDO $pdo, int $deviceId): void
    {
        if (!self::tableExists($pdo) || $deviceId <= 0) {
            return;
        }
        $statement = $pdo->prepare("UPDATE fingerprint_sensor_slots
            SET state = 'free', fingerprint_id = NULL, job_id = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE device_id = ?");
        $statement->execute([$deviceId]);
    }

    /** Free a reserved slot only when this unfinished job still owns it. */
    public static function releaseIfOwnedByJob(PDO $pdo, int $deviceId, int $slot, int $jobId): void
    {
        if (!self::tableExists($pdo) || $deviceId <= 0 || $slot <= 0 || $jobId <= 0) {
            return;
        }
        $statement = $pdo->prepare("UPDATE fingerprint_sensor_slots
            SET state = 'free', fingerprint_id = NULL, job_id = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE device_id = ? AND slot = ? AND job_id = ? AND state = 'reserved'");
        $statement->execute([$deviceId, $slot, $jobId]);
    }

    public static function owner(PDO $pdo, int $deviceId, int $slot): ?array
    {
        $fingerprint = $pdo->prepare("SELECT fingerprint_id, user_id, finger_name, status, enrollment_slot
            FROM fingerprints
            WHERE enrollment_device_id = ? AND enrollment_slot = ? AND status = 'active'
            LIMIT 1");
        $fingerprint->execute([$deviceId, $slot]);
        $row = $fingerprint->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    private static function writeState(
        PDO $pdo,
        int $deviceId,
        int $slot,
        string $state,
        ?int $fingerprintId,
        ?int $jobId
    ): void {
        if (!self::tableExists($pdo) || $deviceId <= 0 || $slot <= 0) {
            return;
        }
        $statement = $pdo->prepare("INSERT INTO fingerprint_sensor_slots
            (device_id, slot, state, fingerprint_id, job_id, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE
                state = VALUES(state),
                fingerprint_id = VALUES(fingerprint_id),
                job_id = VALUES(job_id),
                updated_at = CURRENT_TIMESTAMP");
        $statement->execute([$deviceId, $slot, $state, $fingerprintId, $jobId]);
    }
}
