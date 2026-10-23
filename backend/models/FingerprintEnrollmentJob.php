<?php

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../services/DirectFingerprintImportSchema.php';
require_once __DIR__ . '/../services/SensorMemorySchema.php';

final class FingerprintSlotReservationException extends RuntimeException
{
}

class FingerprintEnrollmentJob
{
    public const PICKUP_TIMEOUT_MINUTES = 3;

    private PDO $conn;
    private ?bool $hasFingerprintIdColumn = null;

    public function __construct(?PDO $pdo = null)
    {
        $this->conn = $pdo ?? entrivo_pdo();
    }

    private function hasFingerprintIdColumn(): bool
    {
        if ($this->hasFingerprintIdColumn !== null) {
            return $this->hasFingerprintIdColumn;
        }

        $statement = $this->conn->query("SHOW COLUMNS FROM fingerprint_enrollment_jobs LIKE 'fingerprint_id'");
        $this->hasFingerprintIdColumn = (bool) $statement->fetch(PDO::FETCH_ASSOC);

        return $this->hasFingerprintIdColumn;
    }

    /**
     * Create new enrollment job
     */
    public function hasPendingJob($userId)
    {
        $this->cancelIdleWaitingJobs();
        $sql = "SELECT COUNT(*) AS total

                FROM fingerprint_enrollment_jobs

                WHERE user_id = ?

                AND status IN ('waiting','processing')";

        $stmt = $this->conn->prepare($sql);

        $stmt->execute([$userId]);

        return $stmt->fetch()['total'] > 0;
    }

    public function userExists($userId)
    {
        $sql = "SELECT id
                FROM users
                WHERE id = ?";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([$userId]);

        return (bool) $stmt->fetch();
    }

    public function deviceExists($deviceId)
    {
        $sql = "SELECT device_id
                FROM fingerprint_devices
                WHERE device_id = ?
                  AND device_type = 'enrollment'
                  AND status = 'active'";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([$deviceId]);

        return (bool) $stmt->fetch();
    }

    public function ensureEnrollmentDevice(int $deviceId): void
    {
        if ($deviceId <= 0 || $this->deviceExists($deviceId)) {
            return;
        }

        $sql = "INSERT INTO fingerprint_devices
                    (device_id, device_name, device_code, device_type, location, description, status)
                VALUES
                    (:device_id, 'Enrollment Station', :device_code, 'enrollment', 'Enrollment Station', 'Default fingerprint enrollment sensor', 'active')
                ON DUPLICATE KEY UPDATE
                    device_type = 'enrollment',
                    status = 'active'";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([
            'device_id' => $deviceId,
            'device_code' => 'enrollment-station-' . $deviceId,
        ]);
    }

    public function getNextAvailableSlot()
    {
        $mapped = (int) $this->conn->query('SELECT GREATEST(COALESCE(MAX(shared_door_slot),0),COALESCE(MAX(enrollment_slot),0)) FROM fingerprints')->fetchColumn();
        $reserved = (int) $this->conn->query("SELECT COALESCE(MAX(assigned_slot),0) FROM fingerprint_enrollment_jobs WHERE status IN ('waiting','processing') OR (status='failed' AND progress>=90)")->fetchColumn();
        $imported = DirectFingerprintImportSchema::tableExists($this->conn)
            ? (int) $this->conn->query('SELECT COALESCE(MAX(target_slot),0) FROM direct_fingerprint_import_jobs')->fetchColumn()
            : 0;
        return max($mapped,$reserved,$imported)+1;
    }

    /** Move a claimed enrollment only after the device reports its physical slot index. */
    public function reserveEmptySlot(
        int $jobId,
        int $deviceId,
        int $expectedSlot,
        int $sensorCapacity,
        array $occupiedSlots
    ): int
    {
        $this->conn->beginTransaction();
        try {
            // Slot numbers share a database namespace across sensors. Lock registry
            // rows in one order, before job rows or snapshot reads, to serialize
            // replacements with each other and with device-scoped claims/imports.
            // A locking read observes current data; the first consistent read below
            // starts only after a previous reservation holder has committed.
            $devices = $this->conn->query('SELECT device_id FROM fingerprint_devices ORDER BY device_id FOR UPDATE');
            $registeredDevices = array_map('intval', $devices->fetchAll(PDO::FETCH_COLUMN));
            if (!in_array($deviceId, $registeredDevices, true)) {
                throw new FingerprintSlotReservationException('Enrollment device not found.', 404);
            }

            $query = $this->conn->prepare('SELECT * FROM fingerprint_enrollment_jobs WHERE job_id=? FOR UPDATE');
            $query->execute([$jobId]);
            $job = $query->fetch(PDO::FETCH_ASSOC);
            if (!$job) {
                throw new FingerprintSlotReservationException('Enrollment job not found.', 404);
            }
            if ((int) ($job['enrollment_device_id'] ?? 0) !== $deviceId) {
                throw new FingerprintSlotReservationException('This job belongs to a different enrollment device.', 409);
            }
            if ($job['status'] !== 'processing' || $job['finished_at'] !== null || (int) $job['progress'] >= 90) {
                throw new FingerprintSlotReservationException('The sensor slot can only change before this active enrollment starts saving.', 409);
            }
            if ((int) ($job['assigned_slot'] ?? 0) !== $expectedSlot) {
                throw new FingerprintSlotReservationException('The reserved slot changed. Reload this enrollment before retrying.', 409);
            }
            if (DirectFingerprintImportSchema::hasActiveForDevice($this->conn, $deviceId)) {
                throw new FingerprintSlotReservationException('A database fingerprint restore currently owns this sensor.', 409);
            }
            if (SensorMemorySchema::hasProcessingForDevice($this->conn, $deviceId)) {
                throw new FingerprintSlotReservationException('Sensor A is reading its memory. Wait for the read to finish before changing enrollment slots.', 409);
            }
            $other = $this->conn->prepare("SELECT job_id FROM fingerprint_enrollment_jobs
                WHERE enrollment_device_id=? AND job_id<>? AND status='processing' AND finished_at IS NULL LIMIT 1");
            $other->execute([$deviceId, $jobId]);
            if ($other->fetchColumn()) {
                throw new FingerprintSlotReservationException('Another enrollment is processing on this sensor.', 409);
            }

            // The device index protects templates unknown to the database. The database
            // reservations also protect slots that may be empty on this particular device.
            $unavailable = array_fill_keys($occupiedSlots, true);
            $unavailable[0] = true;
            $unavailable[$expectedSlot] = true;
            foreach ($this->conn->query('SELECT enrollment_slot, shared_door_slot FROM fingerprints') as $mapping) {
                foreach (['enrollment_slot', 'shared_door_slot'] as $field) {
                    if ($mapping[$field] !== null) $unavailable[(int) $mapping[$field]] = true;
                }
            }
            $reservations = $this->conn->prepare("SELECT assigned_slot FROM fingerprint_enrollment_jobs
                WHERE job_id<>? AND (status IN ('waiting','processing') OR (status='failed' AND progress>=90))");
            $reservations->execute([$jobId]);
            foreach ($reservations as $reservation) {
                if ($reservation['assigned_slot'] !== null) $unavailable[(int) $reservation['assigned_slot']] = true;
            }
            if (DirectFingerprintImportSchema::tableExists($this->conn)) {
                foreach ($this->conn->query('SELECT target_slot FROM direct_fingerprint_import_jobs') as $reservation) {
                    $unavailable[(int) $reservation['target_slot']] = true;
                }
            }

            $assignedSlot = 1;
            while ($assignedSlot < $sensorCapacity && isset($unavailable[$assignedSlot])) ++$assignedSlot;
            if ($assignedSlot >= $sensorCapacity) {
                throw new FingerprintSlotReservationException('No empty unreserved fingerprint slot is available on this sensor. Existing fingerprints were preserved.', 409);
            }

            $update = $this->conn->prepare("UPDATE fingerprint_enrollment_jobs SET assigned_slot=?,
                current_step='Empty sensor slot reserved; continuing enrollment', updated_at=NOW() WHERE job_id=?");
            $update->execute([$assignedSlot, $jobId]);
            $this->conn->commit();
            return $assignedSlot;
        } catch (Throwable $error) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            throw $error;
        }
    }

    public function createJob(
        $userId,
        $fingerName,
        $deviceId = null,
        ?int $fingerprintId = null
    )
    {
        $this->conn->beginTransaction();
        try {
            if ((int) $deviceId > 0) {
                $deviceLock=$this->conn->prepare('SELECT device_id FROM fingerprint_devices WHERE device_id=? FOR UPDATE');
                $deviceLock->execute([(int)$deviceId]);
                if (SensorMemorySchema::hasProcessingForDevice($this->conn, (int) $deviceId)) {
                    throw new DirectFingerprintSensorBusyException('Sensor A is reading its memory. Wait for the read to finish before enrolling.');
                }
                if (DirectFingerprintImportSchema::hasActiveForDevice($this->conn,(int)$deviceId)) {
                    throw new DirectFingerprintSensorBusyException('A database fingerprint restore is queued or running on this sensor. Finish it before starting enrollment.');
                }
            }
            $id=$this->insertEnrollmentJob($userId,$fingerName,$deviceId,$fingerprintId);
            $this->conn->commit();
            return $id;
        } catch(Throwable $error) {
            if($this->conn->inTransaction())$this->conn->rollBack();
            throw $error;
        }
    }

    private function insertEnrollmentJob(
        $userId,
        $fingerName,
        $deviceId = null,
        ?int $fingerprintId = null
    )
    {
        if ($this->hasFingerprintIdColumn()) {
            $sql = "INSERT INTO fingerprint_enrollment_jobs
                    (
                        user_id,
                        fingerprint_id,
                        finger_name,
                        enrollment_device_id,
                        status,
                        progress,
                        current_step
                    )
                    VALUES (?, ?, ?, ?, 'waiting', 0, 'Waiting for ESP32')";

            $stmt = $this->conn->prepare($sql);

            $stmt->execute([
                $userId,
                $fingerprintId !== null && $fingerprintId > 0 ? $fingerprintId : null,
                $fingerName,
                $deviceId
            ]);
        } else {
            $sql = "INSERT INTO fingerprint_enrollment_jobs
                    (
                        user_id,
                        finger_name,
                        enrollment_device_id,
                        status,
                        progress,
                        current_step
                    )
                    VALUES (?, ?, ?, 'waiting', 0, 'Waiting for ESP32')";

            $stmt = $this->conn->prepare($sql);

            $stmt->execute([
                $userId,
                $fingerName,
                $deviceId
            ]);
        }

        return $this->conn->lastInsertId();
    }

    /**
     * Get oldest waiting job
     */
    public function getNextWaitingJob(?int $deviceId = null)
    {
        $this->cancelIdleWaitingJobs();
        $pickupTimeoutMinutes = self::PICKUP_TIMEOUT_MINUTES;
        if ($deviceId !== null && $deviceId > 0) {
            $sql = "SELECT *
                    FROM fingerprint_enrollment_jobs
                    WHERE status = 'waiting'
                      AND finished_at IS NULL
                      AND COALESCE(updated_at, created_at) > DATE_SUB(NOW(), INTERVAL {$pickupTimeoutMinutes} MINUTE)
                      AND (
                            enrollment_device_id = :device_id
                            OR enrollment_device_id IS NULL
                          )
                    ORDER BY
                        CASE
                            WHEN enrollment_device_id = :device_id THEN 0
                            ELSE 1
                        END,
                        created_at ASC,
                        job_id ASC
                    LIMIT 1";

            $stmt = $this->conn->prepare($sql);
            $stmt->bindValue(':device_id', $deviceId, PDO::PARAM_INT);
            $stmt->execute();
        } else {
            $sql = "SELECT *
                    FROM fingerprint_enrollment_jobs
                    WHERE status = 'waiting'
                      AND finished_at IS NULL
                      AND COALESCE(updated_at, created_at) > DATE_SUB(NOW(), INTERVAL {$pickupTimeoutMinutes} MINUTE)
                    ORDER BY created_at ASC, job_id ASC
                    LIMIT 1";

            $stmt = $this->conn->prepare($sql);
            $stmt->execute();
        }

        return $stmt->fetch();
    }

    public function getPendingJob(?int $deviceId = null)
    {
        return $this->getNextWaitingJob($deviceId);
    }

    public function claimJob(int $jobId, ?int $deviceId = null): bool
    {
        $this->cancelIdleWaitingJobs(self::PICKUP_TIMEOUT_MINUTES, $jobId);
        $pickupTimeoutMinutes = self::PICKUP_TIMEOUT_MINUTES;
        try {
            // Discover the device outside the transaction so this read cannot
            // establish a stale snapshot before waiting for the registry lock.
            $candidate = $this->conn->prepare('SELECT enrollment_device_id FROM fingerprint_enrollment_jobs WHERE job_id=?');
            $candidate->execute([$jobId]);
            $candidateRow = $candidate->fetch(PDO::FETCH_ASSOC);
            $claimDeviceId = $deviceId !== null && $deviceId > 0 ? $deviceId : (int) ($candidateRow['enrollment_device_id'] ?? 0);
            $this->conn->beginTransaction();

            // Import and enrollment share the same physical sensor. Serialize both
            // claims on its registry row before either reserves or writes a slot.
            if ($claimDeviceId > 0) {
                $deviceLock = $this->conn->prepare('SELECT device_id FROM fingerprint_devices WHERE device_id=? FOR UPDATE');
                $deviceLock->execute([$claimDeviceId]);
                if (!$deviceLock->fetch()
                    || DirectFingerprintImportSchema::hasActiveForDevice($this->conn,$claimDeviceId)
                    || SensorMemorySchema::hasProcessingForDevice($this->conn, $claimDeviceId)) {
                    $this->conn->rollBack();
                    return false;
                }
            }

            $lockStatement = $this->conn->prepare(
                "SELECT job_id, enrollment_device_id, assigned_slot, status
                 FROM fingerprint_enrollment_jobs
                 WHERE job_id = :job_id
                 FOR UPDATE"
            );
            $lockStatement->bindValue(':job_id', $jobId, PDO::PARAM_INT);
            $lockStatement->execute();

            $job = $lockStatement->fetch(PDO::FETCH_ASSOC);

            if (!$job || $job['status'] !== 'waiting') {
                $this->conn->rollBack();
                return false;
            }

            $assignedDeviceId = isset($job['enrollment_device_id']) ? (int) $job['enrollment_device_id'] : 0;

            if ($deviceId !== null && $deviceId > 0 && $assignedDeviceId > 0 && $assignedDeviceId !== $deviceId) {
                $this->conn->rollBack();
                return false;
            }

            $effectiveDeviceId = $deviceId !== null && $deviceId > 0
                ? $deviceId
                : ($assignedDeviceId > 0 ? $assignedDeviceId : null);

            $assignedSlot = isset($job['assigned_slot']) ? (int) $job['assigned_slot'] : 0;

            if ($assignedSlot <= 0) {
                $assignedSlot = $this->getNextAvailableSlot();
            }

            $updateStatement = $this->conn->prepare(
                "UPDATE fingerprint_enrollment_jobs
                 SET
                    enrollment_device_id = COALESCE(:device_id, enrollment_device_id),
                    assigned_slot = :assigned_slot,
                    status = 'processing',
                    progress = CASE
                        WHEN progress < 5 THEN 5
                        ELSE progress
                    END,
                    current_step = 'Job claimed by ESP32',
                    started_at = COALESCE(started_at, NOW()),
                    error_message = NULL
                 WHERE job_id = :job_id
                   AND status = 'waiting'
                   AND finished_at IS NULL
                   AND COALESCE(updated_at, created_at) > DATE_SUB(NOW(), INTERVAL {$pickupTimeoutMinutes} MINUTE)"
            );
            $updateStatement->bindValue(':job_id', $jobId, PDO::PARAM_INT);
            if ($effectiveDeviceId !== null) {
                $updateStatement->bindValue(':device_id', $effectiveDeviceId, PDO::PARAM_INT);
            } else {
                $updateStatement->bindValue(':device_id', null, PDO::PARAM_NULL);
            }
            $updateStatement->bindValue(':assigned_slot', $assignedSlot, PDO::PARAM_INT);
            $updateStatement->execute();

            $claimed = $updateStatement->rowCount() > 0;

            if ($claimed) {
                $this->conn->commit();
                return true;
            }

            // The row is still locked and waiting: its pickup deadline passed
            // between cleanup and the guarded claim. Persist cancellation now.
            $this->cancelIdleWaitingJobs(self::PICKUP_TIMEOUT_MINUTES, $jobId);
            $this->conn->commit();
            return false;
        } catch (Throwable $error) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }

            throw $error;
        }
    }

    public function getJobById(int $jobId)
    {
        $this->cancelIdleWaitingJobs(self::PICKUP_TIMEOUT_MINUTES, $jobId);
        $sql = "SELECT *
                FROM fingerprint_enrollment_jobs
                WHERE job_id = ?";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([$jobId]);

        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    /** Completion owns the transaction; this read never expires or changes a job. */
    public function lockJobById(int $jobId): ?array
    {
        $statement = $this->conn->prepare('SELECT * FROM fingerprint_enrollment_jobs WHERE job_id = ? FOR UPDATE');
        $statement->execute([$jobId]);
        return $statement->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public function getRecentJobs(int $limit = 12): array
    {
        $limit = max(1, min($limit, 50));
        $fingerprintIdSelect = $this->hasFingerprintIdColumn()
            ? 'COALESCE(jobs.fingerprint_id, fingerprints.fingerprint_id) AS fingerprint_id,'
            : 'fingerprints.fingerprint_id AS fingerprint_id,';
        $fingerprintJoin = $this->hasFingerprintIdColumn()
            ? "LEFT JOIN fingerprints
                    ON (
                        (jobs.fingerprint_id IS NOT NULL AND fingerprints.fingerprint_id = jobs.fingerprint_id)
                        OR (
                            jobs.fingerprint_id IS NULL
                            AND fingerprints.user_id = jobs.user_id
                            AND fingerprints.finger_name COLLATE utf8mb4_0900_ai_ci = jobs.finger_name COLLATE utf8mb4_0900_ai_ci
                            AND fingerprints.status = 'active'
                        )
                    )"
            : "LEFT JOIN fingerprints
                    ON fingerprints.user_id = jobs.user_id
                   AND fingerprints.finger_name COLLATE utf8mb4_0900_ai_ci = jobs.finger_name COLLATE utf8mb4_0900_ai_ci
                   AND fingerprints.status = 'active'";

        $sql = "SELECT
                    jobs.job_id,
                    jobs.user_id,
                    {$fingerprintIdSelect}
                    jobs.finger_name,
                    jobs.enrollment_device_id,
                    jobs.status,
                    jobs.progress,
                    jobs.current_step,
                    jobs.assigned_slot,
                    jobs.error_message,
                    jobs.started_at,
                    jobs.finished_at,
                    jobs.created_at,
                    jobs.updated_at,
                    users.username,
                    users.email,
                    users.role,
                    TRIM(CONCAT_WS(
                        ' ',
                        COALESCE(faculty_info.first_name, staff_info.first_name, admin_info.first_name),
                        COALESCE(faculty_info.middle_name, staff_info.middle_name, admin_info.middle_name),
                        COALESCE(faculty_info.last_name, staff_info.last_name, admin_info.last_name),
                        COALESCE(faculty_info.extension_name, staff_info.extension_name, admin_info.extension_name)
                    )) AS full_name,
                    CASE
                        WHEN fingerprints.template_data IS NULL THEN 0
                        ELSE 1
                    END AS has_template_data,
                    COALESCE(OCTET_LENGTH(fingerprints.template_data), 0) AS template_bytes
                FROM fingerprint_enrollment_jobs AS jobs
                INNER JOIN users
                    ON users.id = jobs.user_id
                LEFT JOIN faculty_info
                    ON faculty_info.user_id = users.id
                LEFT JOIN staff_info
                    ON staff_info.user_id = users.id
                LEFT JOIN admin_info
                    ON admin_info.user_id = users.id
                {$fingerprintJoin}
                ORDER BY
                    COALESCE(jobs.updated_at, jobs.created_at) DESC,
                    jobs.job_id DESC
                LIMIT {$limit}";

        $stmt = $this->conn->query($sql);

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * Mark job as processing
     */
    public function markProcessing($jobId)
    {
        return $this->claimJob((int) $jobId);
    }

    /**
     * Update progress
     */
    public function requeueStaleProcessingJobs(?int $deviceId = null, int $timeoutSeconds = 120): int
    {
        $timeoutSeconds = max(30, min($timeoutSeconds, 3600));
        $deviceFilter = '';

        if ($deviceId !== null && $deviceId > 0) {
            $deviceFilter = " AND enrollment_device_id = :device_id";
        }

        $sql = "UPDATE fingerprint_enrollment_jobs
                SET
                    status = 'waiting',
                    progress = 0,
                    current_step = 'Waiting for ESP32',
                    error_message = 'Enrollment station timed out. Job was re-queued.',
                    started_at = NULL,
                    updated_at = NOW()
                WHERE status = 'processing'
                  AND finished_at IS NULL
                  AND updated_at < DATE_SUB(NOW(), INTERVAL {$timeoutSeconds} SECOND)
                  {$deviceFilter}";

        $stmt = $this->conn->prepare($sql);

        if ($deviceId !== null && $deviceId > 0) {
            $stmt->bindValue(':device_id', $deviceId, PDO::PARAM_INT);
        }

        $stmt->execute();

        return $stmt->rowCount();
    }

    public function updateProgress(
        $jobId,
        $progress,
        $step,
        ?int $deviceId = null
    )
    {
        $this->cancelIdleWaitingJobs(self::PICKUP_TIMEOUT_MINUTES, (int) $jobId);
        $pickupTimeoutMinutes = self::PICKUP_TIMEOUT_MINUTES;
        $progress = max(0, min(99, (int) $progress));

        $sql = "UPDATE fingerprint_enrollment_jobs

                SET progress = :progress,
                    current_step = :step,
                    status = CASE
                        WHEN status = 'waiting' THEN 'processing'
                        ELSE status
                    END,
                    started_at = COALESCE(started_at, NOW()),
                    error_message = NULL

                WHERE job_id = :job_id
                  AND status IN ('waiting', 'processing')
                  AND finished_at IS NULL
                  AND (status = 'processing' OR COALESCE(updated_at, created_at) > DATE_SUB(NOW(), INTERVAL {$pickupTimeoutMinutes} MINUTE))";

        $params = [
            ':progress' => $progress,
            ':step' => $step,
            ':job_id' => $jobId,
        ];

        if ($deviceId !== null && $deviceId > 0) {
            $sql .= " AND enrollment_device_id = :device_id";
            $params[':device_id'] = $deviceId;
        }

        $stmt = $this->conn->prepare($sql);
        $executed = $stmt->execute($params);

        if ($executed && $stmt->rowCount() === 0) $this->cancelIdleWaitingJobs(self::PICKUP_TIMEOUT_MINUTES, (int) $jobId);

        return $executed && $stmt->rowCount() > 0;
    }

    /**
     * Complete enrollment
     */
    public function completeJob(
        $jobId,
        $assignedSlot,
        ?int $deviceId = null
    )
    {
        $deviceFilter = '';

        if ($deviceId !== null && $deviceId > 0) {
            $deviceFilter = " AND enrollment_device_id = ?";
        }

        $sql = "UPDATE fingerprint_enrollment_jobs

                SET status = 'completed',
                    progress = 100,
                    current_step = 'Enrollment completed after final verification',
                    assigned_slot = ?,
                    error_message = NULL,
                    finished_at = NOW()

                WHERE job_id = ?
                  AND status = 'processing'
                  AND finished_at IS NULL
                  AND assigned_slot = ?
                  AND EXISTS (
                      SELECT 1 FROM fingerprint_enrollment_verifications AS proof
                      WHERE proof.job_id = fingerprint_enrollment_jobs.job_id
                        AND proof.enrollment_device_id = fingerprint_enrollment_jobs.enrollment_device_id
                        AND proof.stored_slot = fingerprint_enrollment_jobs.assigned_slot
                        AND proof.matched_slot = proof.stored_slot
                        AND proof.fresh_scan_verified = 1
                        AND proof.confidence > 0
                  )
                  {$deviceFilter}";

        $stmt = $this->conn->prepare($sql);

        if ($deviceId !== null && $deviceId > 0) {
            $executed = $stmt->execute([
                $assignedSlot,
                $jobId,
                $assignedSlot,
                $deviceId
            ]);

            return $executed && $stmt->rowCount() > 0;
        }

        $executed = $stmt->execute([
            $assignedSlot,
            $jobId,
            $assignedSlot
        ]);

        return $executed && $stmt->rowCount() > 0;
    }

    /**
     * Mark failed
     */
    public function failJob(
        $jobId,
        $message,
        ?int $deviceId = null
    )
    {
        $deviceFilter = '';

        if ($deviceId !== null && $deviceId > 0) {
            $deviceFilter = " AND enrollment_device_id = ?";
        }

        $sql = "UPDATE fingerprint_enrollment_jobs

                SET status = 'failed',
                    current_step = 'Enrollment failed',
                    error_message = ?,
                    finished_at = NOW()

                WHERE job_id = ?
                  AND status IN ('waiting', 'processing')
                  AND finished_at IS NULL
                  {$deviceFilter}";

        $stmt = $this->conn->prepare($sql);

        if ($deviceId !== null && $deviceId > 0) {
            $executed = $stmt->execute([
                $message,
                $jobId,
                $deviceId
            ]);

            return $executed && $stmt->rowCount() > 0;
        }

        $executed = $stmt->execute([
            $message,
            $jobId
        ]);

        return $executed && $stmt->rowCount() > 0;
    }

    public function retryJob(int $jobId): bool
    {
        $sql = "UPDATE fingerprint_enrollment_jobs
                SET
                    status = 'waiting',
                    progress = 0,
                    current_step = 'Waiting for ESP32',
                    error_message = NULL,
                    started_at = NULL,
                    finished_at = NULL,
                    updated_at = NOW()
                WHERE job_id = ?
                  AND status IN ('failed', 'cancelled')";

        $stmt = $this->conn->prepare($sql);

        return $stmt->execute([$jobId]) && $stmt->rowCount() > 0;
    }

    public function cancelIdleWaitingJobs(int $timeoutMinutes = self::PICKUP_TIMEOUT_MINUTES, ?int $jobId = null): int
    {
        $timeoutMinutes = max(1, min($timeoutMinutes, 24 * 60));
        $message = "Enrollment cancelled: Sensor A did not pick up this enrollment within {$timeoutMinutes} minutes. Check its power and connection, then retry.";
        $jobFilter = $jobId !== null ? ' AND job_id = :job_id' : '';

        $sql = "UPDATE fingerprint_enrollment_jobs
                SET
                    status = 'cancelled',
                    progress = 0,
                    current_step = 'Enrollment cancelled',
                    error_message = :message,
                    finished_at = NOW()
                WHERE status = 'waiting'
                  AND finished_at IS NULL
                  AND COALESCE(updated_at, created_at) <= DATE_SUB(NOW(), INTERVAL {$timeoutMinutes} MINUTE)
                  {$jobFilter}";

        $stmt = $this->conn->prepare($sql);
        $params = ['message' => $message];
        if ($jobId !== null) $params['job_id'] = $jobId;
        $stmt->execute($params);

        return $stmt->rowCount();
    }

    public function cancelWaitingJob(int $jobId, string $message): bool
    {
        $sql = "UPDATE fingerprint_enrollment_jobs
                SET
                    status = 'cancelled',
                    progress = 0,
                    current_step = 'Enrollment cancelled',
                    error_message = ?,
                    finished_at = NOW()
                WHERE job_id = ?
                  AND status = 'waiting'";

        $stmt = $this->conn->prepare($sql);

        return $stmt->execute([$message, $jobId]) && $stmt->rowCount() > 0;
    }

}
