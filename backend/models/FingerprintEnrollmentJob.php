<?php

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../services/DirectFingerprintImportSchema.php';
require_once __DIR__ . '/../services/SensorMemorySchema.php';
require_once __DIR__ . '/../services/FingerprintSlotRegistry.php';
require_once __DIR__ . '/../services/FingerprintEnrollmentBackup.php';

class FingerprintEnrollmentJob
{
    public const PICKUP_TIMEOUT_MINUTES = 10;
    public const OPEN_STATUSES = ['waiting', 'processing', 'stored_pending_commit', 'needs_reconciliation'];
    public const RECOVERABLE_STATUSES = ['stored_pending_commit', 'needs_reconciliation'];

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
        $this->expireStaleOpenJobs();
        $sql = "SELECT COUNT(*) AS total

                FROM fingerprint_enrollment_jobs

                WHERE user_id = ?

                AND status IN ('waiting','processing','stored_pending_commit','needs_reconciliation')";

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
        return FingerprintSlotRegistry::nextFreeSlot($this->conn);
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

            $occupiedSlots[] = $expectedSlot;
            $assignedSlot = FingerprintSlotRegistry::nextFreeSlot(
                $this->conn,
                $sensorCapacity,
                $occupiedSlots,
                $jobId
            );
            FingerprintSlotRegistry::markOrphaned($this->conn, $deviceId, $expectedSlot, $jobId);

            $update = $this->conn->prepare("UPDATE fingerprint_enrollment_jobs SET assigned_slot=?,
                current_step='Empty sensor slot reserved; continuing enrollment', updated_at=NOW() WHERE job_id=?");
            $update->execute([$assignedSlot, $jobId]);
            FingerprintSlotRegistry::reserve(
                $this->conn,
                $deviceId,
                $assignedSlot,
                $jobId,
                isset($job['fingerprint_id']) ? (int) $job['fingerprint_id'] : null
            );
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

    public function annotateJobMode(int $jobId, string $mode, ?int $previousSlot, ?int $fingerprintId = null): void
    {
        $assignments = [];
        $params = [];
        if ($this->hasColumn('job_mode')) {
            $assignments[] = 'job_mode = ?';
            $params[] = $mode === 'update' ? 'update' : 'enroll';
        }
        if ($this->hasColumn('previous_slot')) {
            $assignments[] = 'previous_slot = ?';
            $params[] = $previousSlot !== null && $previousSlot > 0 ? $previousSlot : null;
        }
        if ($fingerprintId !== null && $fingerprintId > 0 && $this->hasFingerprintIdColumn()) {
            $assignments[] = 'fingerprint_id = ?';
            $params[] = $fingerprintId;
        }
        if ($assignments === []) {
            return;
        }
        $params[] = $jobId;
        $this->conn->prepare('UPDATE fingerprint_enrollment_jobs SET ' . implode(', ', $assignments) . ' WHERE job_id = ?')
            ->execute($params);
    }

    private function hasColumn(string $column): bool
    {
        static $cache = [];
        if (array_key_exists($column, $cache)) {
            return $cache[$column];
        }
        try {
            $this->conn->query('SELECT ' . $column . ' FROM fingerprint_enrollment_jobs WHERE 1 = 0');
            return $cache[$column] = true;
        } catch (PDOException $error) {
            if ($error->getCode() === '42S22' || str_contains($error->getMessage(), 'no such column') ||
                str_contains($error->getMessage(), 'Unknown column')) {
                return $cache[$column] = false;
            }
            throw $error;
        }
    }

    /**
     * Get oldest waiting job
     */
    public function getNextWaitingJob(?int $deviceId = null)
    {
        $this->expireStaleOpenJobs();
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

    public function getRecoverableJob(?int $deviceId = null): ?array
    {
        if ($deviceId === null || $deviceId <= 0) {
            return null;
        }
        $sql = "SELECT *
                FROM fingerprint_enrollment_jobs
                WHERE enrollment_device_id = :device_id
                  AND status = 'stored_pending_commit'
                  AND finished_at IS NULL
                  AND assigned_slot IS NOT NULL
                ORDER BY updated_at ASC,
                    job_id ASC
                LIMIT 1";
        $stmt = $this->conn->prepare($sql);
        $stmt->bindValue(':device_id', $deviceId, PDO::PARAM_INT);
        $stmt->execute();
        $job = $stmt->fetch(PDO::FETCH_ASSOC);
        return $job ?: null;
    }

    public function markStoredPending(int $jobId, int $deviceId, int $slot, ?string $step = null): bool
    {
        $sql = "UPDATE fingerprint_enrollment_jobs
                SET status = 'stored_pending_commit',
                    progress = GREATEST(progress, 85),
                    current_step = ?,
                    assigned_slot = ?,
                    error_message = NULL
                WHERE job_id = ?
                  AND enrollment_device_id = ?
                  AND status IN ('processing', 'stored_pending_commit', 'needs_reconciliation')
                  AND finished_at IS NULL";
        $stmt = $this->conn->prepare($sql);
        return $stmt->execute([
            $step ?: 'Stored at slot ' . $slot,
            $slot,
            $jobId,
            $deviceId,
        ]) && $stmt->rowCount() > 0;
    }

    public function claimJob(int $jobId, ?int $deviceId = null): bool
    {
        $this->expireStaleOpenJobs(self::PICKUP_TIMEOUT_MINUTES, $jobId);
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
                "SELECT *
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
            $previousSlot = $this->hasColumn('previous_slot') ? (int) ($job['previous_slot'] ?? 0) : 0;

            if ($assignedSlot <= 0) {
                $mode = $this->hasColumn('job_mode') ? (string) ($job['job_mode'] ?? '') : '';
                $fingerprintId = (int) ($job['fingerprint_id'] ?? 0);
                if ($previousSlot <= 0 && $fingerprintId > 0) {
                    try {
                        $lookup = $this->conn->prepare(
                            'SELECT enrollment_slot FROM fingerprints WHERE fingerprint_id = ? LIMIT 1'
                        );
                        $lookup->execute([$fingerprintId]);
                        $previousSlot = (int) ($lookup->fetchColumn() ?: 0);
                    } catch (PDOException $error) {
                        $previousSlot = 0;
                    }
                }
                if ($previousSlot <= 0) {
                    try {
                        $lookup = $this->conn->prepare(
                            "SELECT enrollment_slot FROM fingerprints
                             WHERE user_id = ? AND finger_name = ? AND status = 'active'
                               AND enrollment_slot IS NOT NULL
                             ORDER BY fingerprint_id DESC LIMIT 1"
                        );
                        $lookup->execute([(int) ($job['user_id'] ?? 0), (string) ($job['finger_name'] ?? '')]);
                        $previousSlot = (int) ($lookup->fetchColumn() ?: 0);
                    } catch (PDOException $error) {
                        $previousSlot = 0;
                    }
                }
                $assignedSlot = (($mode === 'update' || $fingerprintId > 0) && $previousSlot > 0)
                    ? $previousSlot
                    : $this->getNextAvailableSlot();
            }

            $updateStatement = $this->conn->prepare(
                "UPDATE fingerprint_enrollment_jobs
                 SET
                    enrollment_device_id = COALESCE(:device_id, enrollment_device_id),
                    assigned_slot = :assigned_slot,"
                . ($this->hasColumn('previous_slot') ? "\n                    previous_slot = COALESCE(:previous_slot, previous_slot)," : "")
                . "
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
            if ($this->hasColumn('previous_slot')) {
                if ($previousSlot > 0) {
                    $updateStatement->bindValue(':previous_slot', $previousSlot, PDO::PARAM_INT);
                } else {
                    $updateStatement->bindValue(':previous_slot', null, PDO::PARAM_NULL);
                }
            }
            $updateStatement->execute();

            $claimed = $updateStatement->rowCount() > 0;

            if ($claimed) {
                FingerprintSlotRegistry::reserve(
                    $this->conn,
                    (int) ($effectiveDeviceId ?? 0),
                    $assignedSlot,
                    $jobId,
                    isset($job['fingerprint_id']) ? (int) $job['fingerprint_id'] : null
                );
                $this->conn->commit();
                return true;
            }

            // The row is still locked and waiting: its pickup deadline passed
            // between cleanup and the guarded claim. Persist cancellation now.
            $this->expireStaleOpenJobs(self::PICKUP_TIMEOUT_MINUTES, $jobId);
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
        $this->expireStaleOpenJobs(self::PICKUP_TIMEOUT_MINUTES, $jobId);
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
                  AND progress < 90
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
        $this->expireStaleOpenJobs(self::PICKUP_TIMEOUT_MINUTES, (int) $jobId);
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
                  AND status IN ('waiting', 'processing', 'stored_pending_commit')
                  AND finished_at IS NULL
                  AND (status IN ('processing', 'stored_pending_commit') OR COALESCE(updated_at, created_at) > DATE_SUB(NOW(), INTERVAL {$pickupTimeoutMinutes} MINUTE))";

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
        if (!$executed) return false;
        if ($stmt->rowCount() > 0) return true;

        // MySQL reports changed rows by default. Repeating an already saved
        // step changes nothing, but the same active job still acknowledged it.
        $check = $this->conn->prepare('SELECT status, progress, current_step, finished_at, enrollment_device_id
            FROM fingerprint_enrollment_jobs WHERE job_id = ?');
        $check->execute([$jobId]);
        $current = $check->fetch(PDO::FETCH_ASSOC);
        if ($current && in_array($current['status'], ['processing', 'stored_pending_commit'], true)
            && $current['finished_at'] === null
            && (int) $current['progress'] === $progress
            && (string) $current['current_step'] === $step
            && ($deviceId === null || (int) $current['enrollment_device_id'] === $deviceId)) return true;

        $this->expireStaleOpenJobs(self::PICKUP_TIMEOUT_MINUTES, (int) $jobId);
        return false;
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
                  AND status IN ('processing', 'stored_pending_commit')
                  AND finished_at IS NULL
                  AND assigned_slot = ?
                  AND EXISTS (
                      SELECT 1 FROM fingerprint_enrollment_verifications AS proof
                      WHERE proof.job_id = fingerprint_enrollment_jobs.job_id
                        AND proof.enrollment_device_id = fingerprint_enrollment_jobs.enrollment_device_id
                        AND proof.stored_slot = fingerprint_enrollment_jobs.assigned_slot
                        AND proof.matched_slot = proof.stored_slot
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
        // Unsuccessful enrollment always closes as failed so Download cannot open
        // and the admin must restart a fresh Adafruit two-scan enrollment.
        $ownTransaction = !$this->conn->inTransaction();
        if ($ownTransaction) {
            $this->conn->beginTransaction();
        }

        try {
            $deviceFilter = '';
            $params = [];
            if ($deviceId !== null && $deviceId > 0) {
                $deviceFilter = ' AND enrollment_device_id = ?';
            }

            $lock = $this->conn->prepare(
                "SELECT * FROM fingerprint_enrollment_jobs
                 WHERE job_id = ?
                   AND status IN ('waiting', 'processing', 'stored_pending_commit', 'needs_reconciliation')
                   AND finished_at IS NULL
                   {$deviceFilter}
                 FOR UPDATE"
            );
            $params[] = $jobId;
            if ($deviceId !== null && $deviceId > 0) {
                $params[] = $deviceId;
            }
            $lock->execute($params);
            $job = $lock->fetch(PDO::FETCH_ASSOC);
            if (!$job) {
                if ($ownTransaction) {
                    $this->conn->rollBack();
                }
                return false;
            }

            FingerprintEnrollmentBackup::delete($this->conn, (int) $jobId);

            $device = (int) ($job['enrollment_device_id'] ?? 0);
            $slot = (int) ($job['assigned_slot'] ?? 0);
            if ($device > 0 && $slot > 0) {
                // Firmware should already have erased a newly stored slot. Release the
                // reservation so a restarted enrollment can reserve a free page again.
                FingerprintSlotRegistry::releaseIfOwnedByJob($this->conn, $device, $slot, (int) $jobId);
            }

            $update = $this->conn->prepare(
                "UPDATE fingerprint_enrollment_jobs
                 SET status = 'failed',
                     current_step = 'Enrollment failed. Start again.',
                     error_message = ?,
                     finished_at = NOW(),
                     updated_at = NOW()
                 WHERE job_id = ?
                   AND status IN ('waiting', 'processing', 'stored_pending_commit', 'needs_reconciliation')
                   AND finished_at IS NULL"
            );
            $ok = $update->execute([$message, $jobId]) && $update->rowCount() > 0;
            if ($ownTransaction) {
                if ($ok) {
                    $this->conn->commit();
                } else {
                    $this->conn->rollBack();
                }
            }
            return $ok;
        } catch (Throwable $error) {
            if ($ownTransaction && $this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $error;
        }
    }

    public function retryJob(int $jobId): bool
    {
        // Always restart a fresh two-scan enrollment. Partial Store recovery is
        // unsafe after sensor rollback on unsuccessful attempts.
        $sql = "UPDATE fingerprint_enrollment_jobs
                SET
                    assigned_slot = NULL,
                    status = 'waiting',
                    progress = 0,
                    current_step = 'Waiting for ESP32',
                    error_message = NULL,
                    started_at = NULL,
                    finished_at = NULL,
                    updated_at = NOW()
                WHERE job_id = ?
                  AND status IN ('failed', 'cancelled', 'needs_reconciliation')";

        $stmt = $this->conn->prepare($sql);

        return $stmt->execute([$jobId]) && $stmt->rowCount() > 0;
    }

    public function cancelIdleWaitingJobs(int $timeoutMinutes = self::PICKUP_TIMEOUT_MINUTES, ?int $jobId = null): int
    {
        return $this->expireStaleOpenJobs($timeoutMinutes, $jobId);
    }

    public function expireStaleOpenJobs(int $timeoutMinutes = self::PICKUP_TIMEOUT_MINUTES, ?int $jobId = null): int
    {
        $timeoutMinutes = max(1, min($timeoutMinutes, 24 * 60));
        $jobFilter = $jobId !== null ? ' AND job_id = :job_id' : '';
        $open = "'" . implode("','", self::OPEN_STATUSES) . "'";
        $ownTransaction = !$this->conn->inTransaction();
        if ($ownTransaction) {
            $this->conn->beginTransaction();
        }

        try {
            $sql = "SELECT * FROM fingerprint_enrollment_jobs
                    WHERE status IN ({$open})
                      AND finished_at IS NULL
                      AND COALESCE(updated_at, created_at) <= DATE_SUB(NOW(), INTERVAL {$timeoutMinutes} MINUTE)
                      {$jobFilter}
                    ORDER BY job_id ASC
                    FOR UPDATE";
            $statement = $this->conn->prepare($sql);
            $params = [];
            if ($jobId !== null) {
                $params['job_id'] = $jobId;
            }
            $statement->execute($params);
            $jobs = $statement->fetchAll(PDO::FETCH_ASSOC);
            foreach ($jobs as $job) {
                $this->rollbackUnsuccessfulJob($job, $this->staleJobMessage($job, $timeoutMinutes));
            }
            if ($ownTransaction) {
                $this->conn->commit();
            }
            return count($jobs);
        } catch (Throwable $error) {
            if ($ownTransaction && $this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $error;
        }
    }

    private function staleJobMessage(array $job, int $timeoutMinutes): string
    {
        if (($job['status'] ?? '') === 'waiting') {
            return "Enrollment cancelled: Sensor A did not pick up this enrollment within {$timeoutMinutes} minutes. Check its power and connection, then retry.";
        }

        return "Enrollment cancelled: this enrollment did not progress within {$timeoutMinutes} minutes. Incomplete reservations and staged backups from this attempt were rolled back. Start enrollment again.";
    }

    private function rollbackUnsuccessfulJob(array $job, string $message): void
    {
        $jobId = (int) ($job['job_id'] ?? 0);
        if ($jobId <= 0) {
            return;
        }

        FingerprintEnrollmentBackup::delete($this->conn, $jobId);

        $deviceId = (int) ($job['enrollment_device_id'] ?? 0);
        $slot = (int) ($job['assigned_slot'] ?? 0);
        $status = (string) ($job['status'] ?? '');
        $progress = (int) ($job['progress'] ?? 0);
        $step = strtolower((string) ($job['current_step'] ?? ''));
        $templateMayExist = in_array($status, self::RECOVERABLE_STATUSES, true)
            || $progress >= 85
            || str_contains($step, 'stored');
        if ($deviceId > 0 && $slot > 0) {
            // Cancel/timeout rolls the DB reservation back. If a template may still
            // sit on the R307S, mark awaiting cleanup so Sensor Memory can clear it;
            // otherwise free the slot for a restarted enrollment.
            if ($templateMayExist) {
                FingerprintSlotRegistry::markAwaitingCleanup($this->conn, $deviceId, $slot);
            } else {
                FingerprintSlotRegistry::releaseIfOwnedByJob($this->conn, $deviceId, $slot, $jobId);
            }
        }

        $update = $this->conn->prepare("UPDATE fingerprint_enrollment_jobs
            SET status = 'cancelled',
                current_step = 'Enrollment cancelled. Start again.',
                error_message = ?,
                finished_at = NOW()
            WHERE job_id = ?
              AND status IN ('waiting','processing','stored_pending_commit','needs_reconciliation')
              AND finished_at IS NULL");
        $update->execute([$message, $jobId]);
    }

    public function cancelWaitingJob(int $jobId, string $message): bool
    {
        return $this->cancelOpenJob($jobId, $message);
    }

    public function cancelOpenJob(int $jobId, string $message): bool
    {
        $ownTransaction = !$this->conn->inTransaction();
        if ($ownTransaction) {
            $this->conn->beginTransaction();
        }
        try {
            $statement = $this->conn->prepare('SELECT * FROM fingerprint_enrollment_jobs WHERE job_id = ? FOR UPDATE');
            $statement->execute([$jobId]);
            $job = $statement->fetch(PDO::FETCH_ASSOC);
            if (!$job || !in_array((string) ($job['status'] ?? ''), self::OPEN_STATUSES, true)
                || !empty($job['finished_at'])) {
                if ($ownTransaction) {
                    $this->conn->rollBack();
                }
                return false;
            }
            $this->rollbackUnsuccessfulJob($job, $message);
            if ($ownTransaction) {
                $this->conn->commit();
            }
            return true;
        } catch (Throwable $error) {
            if ($ownTransaction && $this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $error;
        }
    }

}
