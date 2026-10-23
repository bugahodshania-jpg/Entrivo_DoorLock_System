<?php

require_once __DIR__ . '/../config/connection.php';

class FingerprintSyncQueue
{
    public const PICKUP_TIMEOUT_MINUTES = 5;
    public const PICKUP_TIMEOUT_MESSAGES = [
        'not_registered' => 'Sync cancelled: no registered door controller is available for this job. It was not picked up within 5 minutes, so the fingerprint could not be synced. Register an active Sensor B door controller, then retry.',
        'inactive' => 'Sync cancelled: the target door controller is inactive. It did not pick up the job within 5 minutes, so the fingerprint could not be synced. Activate the controller, then retry.',
        'no_response' => 'Sync cancelled: the door controller did not pick up this job within 5 minutes. It may be disconnected or unreachable, so the fingerprint could not be synced. Check the controller power and network connection, then retry.',
    ];

    private PDO $conn;
    private static bool $progressColumnReady = false;

    public function __construct()
    {
        $this->conn = entrivo_pdo();
        $this->ensureProgressStepColumn();
    }

    private function ensureProgressStepColumn(): void
    {
        if (self::$progressColumnReady) {
            return;
        }

        $statement = $this->conn->query("SHOW COLUMNS FROM fingerprint_sync_queue LIKE 'progress_step'");
        if (!$statement->fetch()) {
            $this->conn->exec(
                "ALTER TABLE fingerprint_sync_queue
                 ADD COLUMN progress_step VARCHAR(32) NULL DEFAULT NULL AFTER status"
            );
        }

        self::$progressColumnReady = true;
    }

    public function getPreferredDoorDevice(): ?array
    {
        $statement = $this->conn->query(
            "SELECT device_id, device_name, device_code, location, description, status
             FROM fingerprint_devices
             WHERE device_type = 'door'
               AND status = 'active'
             ORDER BY
                CASE
                    WHEN LOWER(COALESCE(device_name, '')) LIKE '%sensor b%' THEN 0
                    WHEN LOWER(COALESCE(device_code, '')) LIKE '%sensorb%' THEN 0
                    WHEN LOWER(COALESCE(description, '')) LIKE '%sensor b%' THEN 0
                    WHEN LOWER(COALESCE(device_name, '')) LIKE '%door%' THEN 1
                    WHEN LOWER(COALESCE(device_code, '')) LIKE '%door%' THEN 1
                    ELSE 2
                END,
                device_id ASC
             LIMIT 1"
        );

        $device = $statement->fetch();

        return $device ?: null;
    }

    public function getDoorDeviceByIdentity(?int $deviceId = null, ?string $deviceCode = null): ?array
    {
        if ($deviceId !== null && $deviceId > 0) {
            $statement = $this->conn->prepare(
                "SELECT device_id, device_name, device_code, location, description, status
                 FROM fingerprint_devices
                 WHERE device_id = :device_id
                   AND device_type = 'door'
                   AND status = 'active'
                 LIMIT 1"
            );
            $statement->bindValue(':device_id', $deviceId, PDO::PARAM_INT);
            $statement->execute();

            $device = $statement->fetch();

            return $device ?: null;
        }

        $normalizedDeviceCode = trim((string) $deviceCode);

        if ($normalizedDeviceCode === '') {
            return null;
        }

        $statement = $this->conn->prepare(
            "SELECT device_id, device_name, device_code, location, description, status
             FROM fingerprint_devices
             WHERE device_code = :device_code
               AND device_type = 'door'
               AND status = 'active'
             LIMIT 1"
        );
        $statement->bindValue(':device_code', $normalizedDeviceCode);
        $statement->execute();

        $device = $statement->fetch();

        return $device ?: null;
    }

    public function findActiveJob(int $fingerprintId, int $deviceId): ?array
    {
        $statement = $this->conn->prepare(
            "SELECT *
             FROM fingerprint_sync_queue
             WHERE fingerprint_id = :fingerprint_id
               AND device_id = :device_id
               AND status IN ('pending', 'syncing')
             ORDER BY queued_at ASC, id ASC
             LIMIT 1"
        );
        $statement->bindValue(':fingerprint_id', $fingerprintId, PDO::PARAM_INT);
        $statement->bindValue(':device_id', $deviceId, PDO::PARAM_INT);
        $statement->execute();

        $job = $statement->fetch();

        return $job ?: null;
    }

    public function getDoorDeviceSyncIssue(int $deviceId = 0, string $deviceCode = ''): ?string
    {
        $sql = "SELECT status FROM fingerprint_devices WHERE device_type = 'door'";
        $parameters = [];

        if ($deviceId > 0) {
            $sql .= ' AND device_id = :device_id';
            $parameters['device_id'] = $deviceId;
        } elseif (trim($deviceCode) !== '') {
            $sql .= ' AND device_code = :device_code';
            $parameters['device_code'] = trim($deviceCode);
        }

        $statement = $this->conn->prepare($sql . " ORDER BY (status = 'active') DESC, device_id ASC LIMIT 1");
        $statement->execute($parameters);
        $device = $statement->fetch();

        if (!$device) {
            return 'not_registered';
        }

        return (string) $device['status'] === 'active' ? null : 'inactive';
    }

    public function createJob(int $fingerprintId, int $deviceId): int
    {
        $statement = $this->conn->prepare(
            "INSERT INTO fingerprint_sync_queue (
                fingerprint_id,
                device_id,
                status,
                attempts,
                error_message,
                active_sync_key
             ) VALUES (
                :fingerprint_id,
                :device_id,
                'pending',
                0,
                NULL,
                :active_sync_key
             )"
        );
        $statement->bindValue(':fingerprint_id', $fingerprintId, PDO::PARAM_INT);
        $statement->bindValue(':device_id', $deviceId, PDO::PARAM_INT);
        $statement->bindValue(':active_sync_key', $fingerprintId . ':' . $deviceId);
        $statement->execute();

        return (int) $this->conn->lastInsertId();
    }

    public function listJobs(int $limit = 20): array
    {
        $safeLimit = max(1, min(100, $limit));
        $statement = $this->conn->prepare(
            "SELECT
                q.id,
                q.fingerprint_id,
                q.device_id,
                q.status,
                q.progress_step,
                q.attempts,
                q.error_message,
                q.queued_at,
                q.processing_at,
                q.synced_at,
                q.updated_at,
                d.device_name,
                d.device_code,
                d.location,
                d.status AS device_status,
                d.device_type,
                f.user_id,
                f.finger_name,
                f.shared_door_slot,
                f.door_sync_status,
                u.username,
                u.email,
                u.role,
                COALESCE(
                    NULLIF(
                        TRIM(CONCAT_WS(
                            ' ',
                            p.first_name,
                            p.middle_name,
                            p.last_name,
                            p.extension_name
                        )),
                        ''
                    ),
                    u.username
                ) AS user_name
             FROM fingerprint_sync_queue q
             INNER JOIN fingerprints f
                ON f.fingerprint_id = q.fingerprint_id
             INNER JOIN users u
                ON u.id = f.user_id
             LEFT JOIN fingerprint_devices d
                ON d.device_id = q.device_id
             LEFT JOIN (
                SELECT user_id, first_name, middle_name, last_name, extension_name
                FROM faculty_info
                UNION ALL
                SELECT user_id, first_name, middle_name, last_name, extension_name
                FROM staff_info
                UNION ALL
                SELECT user_id, first_name, middle_name, last_name, extension_name
                FROM admin_info
             ) p
                ON p.user_id = u.id
             ORDER BY q.queued_at DESC, q.id DESC
             LIMIT :job_limit"
        );
        $statement->bindValue(':job_limit', $safeLimit, PDO::PARAM_INT);
        $statement->execute();

        return $statement->fetchAll();
    }

    public function getJobById(int $queueId): ?array
    {
        $statement = $this->conn->prepare(
            "SELECT
                q.id,
                q.fingerprint_id,
                q.device_id,
                q.status,
                q.progress_step,
                q.attempts,
                q.error_message,
                q.queued_at,
                q.processing_at,
                q.synced_at,
                q.updated_at,
                d.device_name,
                d.device_code,
                d.location,
                d.status AS device_status,
                d.device_type,
                f.user_id,
                f.finger_name,
                f.shared_door_slot,
                f.door_sync_status,
                u.username,
                u.email,
                u.role,
                COALESCE(
                    NULLIF(
                        TRIM(CONCAT_WS(
                            ' ',
                            p.first_name,
                            p.middle_name,
                            p.last_name,
                            p.extension_name
                        )),
                        ''
                    ),
                    u.username
                ) AS user_name
             FROM fingerprint_sync_queue q
             INNER JOIN fingerprints f
                ON f.fingerprint_id = q.fingerprint_id
             INNER JOIN users u
                ON u.id = f.user_id
             LEFT JOIN fingerprint_devices d
                ON d.device_id = q.device_id
             LEFT JOIN (
                SELECT user_id, first_name, middle_name, last_name, extension_name
                FROM faculty_info
                UNION ALL
                SELECT user_id, first_name, middle_name, last_name, extension_name
                FROM staff_info
                UNION ALL
                SELECT user_id, first_name, middle_name, last_name, extension_name
                FROM admin_info
             ) p
                ON p.user_id = u.id
             WHERE q.id = :queue_id
             LIMIT 1"
        );
        $statement->bindValue(':queue_id', $queueId, PDO::PARAM_INT);
        $statement->execute();

        $job = $statement->fetch();

        return $job ?: null;
    }

    /**
     * Cancels jobs waiting five minutes for pickup; claimed jobs retain their processing timeout.
     *
     * @return array<int, array<string, mixed>>
     */
    public function failIdleJobs(int $idleMinutes = 30): array
    {
        $minutes = max(1, $idleMinutes);
        $message = 'The sync job was not processed, so it was cancelled.';
        $this->conn->prepare(
            "UPDATE fingerprint_sync_queue
             SET error_message = :message
             WHERE error_message = 'The sync job was not processed for more than 1 hour, so it was cancelled.'"
        )->execute(['message' => $message]);
        $select = $this->conn->prepare(
            "SELECT id
             FROM fingerprint_sync_queue
             WHERE (
                    status = 'pending'
                    AND queued_at <= DATE_SUB(NOW(), INTERVAL :idle_pending MINUTE)
                ) OR (
                    status = 'syncing'
                    AND processing_at IS NOT NULL
                    AND processing_at < DATE_SUB(NOW(), INTERVAL :idle_syncing MINUTE)
                )"
        );
        $select->bindValue(':idle_pending', self::PICKUP_TIMEOUT_MINUTES, PDO::PARAM_INT);
        $select->bindValue(':idle_syncing', $minutes, PDO::PARAM_INT);
        $select->execute();
        $ids = array_map('intval', $select->fetchAll(PDO::FETCH_COLUMN));

        if ($ids === []) {
            return [];
        }

        $expired = [];

        foreach ($ids as $id) {
            $job = $this->getJobById($id);

            if (!$job || !in_array((string) $job['status'], ['pending', 'syncing'], true)) {
                continue;
            }

            $isPending = (string) $job['status'] === 'pending';
            $timestampColumn = $isPending ? 'queued_at' : 'processing_at';
            $timeout = $isPending ? self::PICKUP_TIMEOUT_MINUTES : $minutes;
            $errorMessage = $message;

            if ($isPending) {
                $issue = empty($job['device_type']) || (string) $job['device_type'] !== 'door'
                    ? 'not_registered'
                    : ((string) ($job['device_status'] ?? '') !== 'active' ? 'inactive' : 'no_response');
                $errorMessage = self::PICKUP_TIMEOUT_MESSAGES[$issue];
            }

            // Repeat both the deadline and the observed state atomically: a controller
            // may have claimed this job, or an admin may have retried it since selection.
            $update = $this->conn->prepare(
                "UPDATE fingerprint_sync_queue
                 SET status = 'failed', progress_step = NULL,
                     error_message = :error_message, active_sync_key = NULL
                 WHERE id = :id
                   AND status = :expected_status
                   AND {$timestampColumn} = :expected_timestamp
                   AND {$timestampColumn} <= DATE_SUB(NOW(), INTERVAL :timeout_minutes MINUTE)"
            );
            $update->bindValue(':error_message', $errorMessage);
            $update->bindValue(':id', $id, PDO::PARAM_INT);
            $update->bindValue(':expected_status', (string) $job['status']);
            $update->bindValue(':expected_timestamp', $job[$timestampColumn]);
            $update->bindValue(':timeout_minutes', $timeout, PDO::PARAM_INT);
            $update->execute();

            if ($update->rowCount() > 0) {
                $job['status'] = 'failed';
                $job['progress_step'] = null;
                $job['error_message'] = $errorMessage;
                $job['updated_at'] = entrivo_now();
                $expired[] = $job;
            }
        }

        return $expired;
    }

    public function hasActiveJobForFingerprint(int $fingerprintId): bool
    {
        $statement = $this->conn->prepare(
            "SELECT id
             FROM fingerprint_sync_queue
             WHERE fingerprint_id = :fingerprint_id
               AND status IN ('pending', 'syncing')
             LIMIT 1"
        );
        $statement->bindValue(':fingerprint_id', $fingerprintId, PDO::PARAM_INT);
        $statement->execute();

        return (bool) $statement->fetch();
    }

    public function requeueStaleSyncingJobs(int $deviceId, int $staleMinutes = 5): void
    {
        $statement = $this->conn->prepare(
            "UPDATE fingerprint_sync_queue
             SET
                status = 'pending',
                progress_step = NULL,
                processing_at = NULL,
                queued_at = NOW(),
                error_message = 'Sync job timed out while waiting for Sensor B acknowledgement.',
                active_sync_key = CONCAT(fingerprint_id, ':', device_id)
             WHERE device_id = :device_id
               AND status = 'syncing'
               AND processing_at IS NOT NULL
               AND processing_at < DATE_SUB(NOW(), INTERVAL :stale_minutes MINUTE)"
        );
        $statement->bindValue(':device_id', $deviceId, PDO::PARAM_INT);
        $statement->bindValue(':stale_minutes', max(1, $staleMinutes), PDO::PARAM_INT);
        $statement->execute();
    }

    public function claimNextPendingJob(int $deviceId): ?array
    {
        try {
            $this->conn->beginTransaction();

            $lockStatement = $this->conn->prepare(
                "SELECT id
                 FROM fingerprint_sync_queue
                 WHERE device_id = :device_id
                   AND status = 'pending'
                   AND queued_at > DATE_SUB(NOW(), INTERVAL :pickup_timeout_minutes MINUTE)
                 ORDER BY queued_at ASC, id ASC
                 LIMIT 1
                 FOR UPDATE"
            );
            $lockStatement->bindValue(':device_id', $deviceId, PDO::PARAM_INT);
            $lockStatement->bindValue(':pickup_timeout_minutes', self::PICKUP_TIMEOUT_MINUTES, PDO::PARAM_INT);
            $lockStatement->execute();

            $job = $lockStatement->fetch();

            if (!$job) {
                $this->conn->commit();
                return null;
            }

            $updateStatement = $this->conn->prepare(
                "UPDATE fingerprint_sync_queue
                 SET
                    status = 'syncing',
                    progress_step = 'claimed',
                    attempts = attempts + 1,
                    processing_at = NOW(),
                    error_message = NULL,
                    active_sync_key = CONCAT(fingerprint_id, ':', device_id)
                 WHERE id = :queue_id
                   AND status = 'pending'
                   AND queued_at > DATE_SUB(NOW(), INTERVAL :pickup_timeout_minutes MINUTE)"
            );
            $updateStatement->bindValue(':queue_id', (int) $job['id'], PDO::PARAM_INT);
            $updateStatement->bindValue(':pickup_timeout_minutes', self::PICKUP_TIMEOUT_MINUTES, PDO::PARAM_INT);
            $updateStatement->execute();

            if ($updateStatement->rowCount() <= 0) {
                $this->conn->rollBack();
                return null;
            }

            $this->conn->commit();

            return $this->getJobById((int) $job['id']);
        } catch (Throwable $error) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }

            throw $error;
        }
    }

    public function markJobSynced(int $queueId): bool
    {
        $statement = $this->conn->prepare(
            "UPDATE fingerprint_sync_queue
             SET
                status = 'synced',
                progress_step = 'synced',
                synced_at = NOW(),
                error_message = NULL,
                active_sync_key = NULL
             WHERE id = :queue_id
               AND status = 'syncing'"
        );
        $statement->bindValue(':queue_id', $queueId, PDO::PARAM_INT);
        $statement->execute();

        return $statement->rowCount() > 0;
    }

    public function markJobFailed(int $queueId, string $errorMessage): bool
    {
        $statement = $this->conn->prepare(
            "UPDATE fingerprint_sync_queue
             SET
                status = 'failed',
                synced_at = NULL,
                error_message = :error_message,
                active_sync_key = NULL
             WHERE id = :queue_id"
        );
        $statement->bindValue(':queue_id', $queueId, PDO::PARAM_INT);
        $statement->bindValue(':error_message', trim($errorMessage) !== '' ? trim($errorMessage) : 'Sensor B sync failed.');

        return $statement->execute();
    }

    public function retryJob(int $queueId): bool
    {
        $statement = $this->conn->prepare(
            "UPDATE fingerprint_sync_queue
             SET
                status = 'pending',
                progress_step = NULL,
                processing_at = NULL,
                synced_at = NULL,
                queued_at = NOW(),
                error_message = NULL,
                active_sync_key = CONCAT(fingerprint_id, ':', device_id)
             WHERE id = :queue_id
               AND status = 'failed'"
        );
        $statement->bindValue(':queue_id', $queueId, PDO::PARAM_INT);
        $statement->execute();

        return $statement->rowCount() > 0;
    }

    public function updateProgressStep(int $queueId, string $progressStep): bool
    {
        $allowedSteps = ['claimed', 'writing', 'reporting'];
        if (!in_array($progressStep, $allowedSteps, true)) {
            return false;
        }

        $statement = $this->conn->prepare(
            "UPDATE fingerprint_sync_queue
             SET progress_step = :progress_step
             WHERE id = :queue_id
               AND status = 'syncing'"
        );
        $statement->bindValue(':progress_step', $progressStep);
        $statement->bindValue(':queue_id', $queueId, PDO::PARAM_INT);
        $statement->execute();

        return $statement->rowCount() > 0;
    }

    public function cancelSyncingJob(int $queueId): bool
    {
        $statement = $this->conn->prepare(
            "UPDATE fingerprint_sync_queue
             SET
                status = 'failed',
                error_message = 'Cancelled from the sync dialog.',
                active_sync_key = NULL
             WHERE id = :queue_id
               AND status = 'syncing'"
        );
        $statement->bindValue(':queue_id', $queueId, PDO::PARAM_INT);
        $statement->execute();

        return $statement->rowCount() > 0;
    }

    public function cancelPendingJob(int $queueId): bool
    {
        $statement = $this->conn->prepare(
            "DELETE FROM fingerprint_sync_queue
             WHERE id = :queue_id
               AND status = 'pending'"
        );
        $statement->bindValue(':queue_id', $queueId, PDO::PARAM_INT);
        $statement->execute();

        return $statement->rowCount() > 0;
    }
}
