<?php

require_once __DIR__ . '/../config/connection.php';

class FingerprintSyncQueue
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = entrivo_pdo();
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
                q.attempts,
                q.error_message,
                q.queued_at,
                q.processing_at,
                q.synced_at,
                q.updated_at,
                d.device_name,
                d.device_code,
                d.location,
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
             INNER JOIN fingerprint_devices d
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
                q.attempts,
                q.error_message,
                q.queued_at,
                q.processing_at,
                q.synced_at,
                q.updated_at,
                d.device_name,
                d.device_code,
                d.location,
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
             INNER JOIN fingerprint_devices d
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

    public function requeueStaleSyncingJobs(int $deviceId, int $staleMinutes = 5): void
    {
        $statement = $this->conn->prepare(
            "UPDATE fingerprint_sync_queue
             SET
                status = 'pending',
                processing_at = NULL,
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
                 ORDER BY queued_at ASC, id ASC
                 LIMIT 1
                 FOR UPDATE"
            );
            $lockStatement->bindValue(':device_id', $deviceId, PDO::PARAM_INT);
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
                    attempts = attempts + 1,
                    processing_at = NOW(),
                    error_message = NULL,
                    active_sync_key = CONCAT(fingerprint_id, ':', device_id)
                 WHERE id = :queue_id
                   AND status = 'pending'"
            );
            $updateStatement->bindValue(':queue_id', (int) $job['id'], PDO::PARAM_INT);
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
                synced_at = NOW(),
                error_message = NULL,
                active_sync_key = NULL
             WHERE id = :queue_id"
        );
        $statement->bindValue(':queue_id', $queueId, PDO::PARAM_INT);

        return $statement->execute();
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
                processing_at = NULL,
                synced_at = NULL,
                error_message = NULL,
                active_sync_key = CONCAT(fingerprint_id, ':', device_id)
             WHERE id = :queue_id
               AND status = 'failed'"
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
