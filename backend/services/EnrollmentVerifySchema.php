<?php

/** Short-lived post-download identify jobs. Read helpers never migrate. */
final class EnrollmentVerifySchema
{
    public static function tableExists(PDO $pdo): bool
    {
        try {
            $pdo->query('SELECT id FROM fingerprint_enrollment_verify_jobs WHERE 1 = 0');
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
            throw new LogicException('Create enrollment verify storage before starting a transaction.');
        }
        if (self::tableExists($pdo)) {
            self::expire($pdo);
            return;
        }
        $mysql = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
        $id = $mysql ? 'id INT NOT NULL PRIMARY KEY AUTO_INCREMENT' : 'id INTEGER PRIMARY KEY AUTOINCREMENT';
        $suffix = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
        $pdo->exec("CREATE TABLE IF NOT EXISTS fingerprint_enrollment_verify_jobs (
            {$id},
            enrollment_job_id INT NOT NULL,
            actor_id INT NULL,
            user_id INT NOT NULL,
            fingerprint_id INT NOT NULL,
            enrollment_device_id INT NOT NULL,
            target_slot INT NOT NULL,
            user_name VARCHAR(255) NOT NULL DEFAULT '',
            finger_name VARCHAR(50) NOT NULL DEFAULT '',
            template_hash CHAR(64) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            current_step VARCHAR(180) NOT NULL DEFAULT 'Place the same finger to verify enrollment',
            claim_token CHAR(64) NULL,
            matched_slot INT NULL,
            confidence INT NULL,
            identified TINYINT(1) NOT NULL DEFAULT 0,
            access_log_id INT NULL,
            error_message TEXT NULL,
            queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            processing_at DATETIME NULL,
            finished_at DATETIME NULL,
            active_device_key INT NULL
        ){$suffix}");
        self::expire($pdo);
    }

    public static function expire(PDO $pdo): void
    {
        if (!self::tableExists($pdo)) return;
        $cutoff = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite'
            ? "datetime('now', '-3 minutes')"
            : 'DATE_SUB(NOW(), INTERVAL 3 MINUTE)';
        $now = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' ? "datetime('now')" : 'NOW()';
        $pdo->exec("UPDATE fingerprint_enrollment_verify_jobs SET
            status='cancelled',
            error_message=CASE WHEN status='pending'
                THEN 'Verification cancelled: Sensor A did not pick up this scan within 3 minutes.'
                ELSE 'Verification cancelled: Sensor A did not finish this scan within 3 minutes.' END,
            current_step='Verification cancelled',
            finished_at={$now},
            active_device_key=NULL
            WHERE finished_at IS NULL AND (
                (status='pending' AND queued_at <= {$cutoff})
                OR (status='processing' AND processing_at <= {$cutoff})
            )");
    }

    public static function hasActiveForDevice(PDO $pdo, int $deviceId): bool
    {
        if (!self::tableExists($pdo)) return false;
        $cutoff = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite'
            ? "datetime('now', '-3 minutes')"
            : 'DATE_SUB(NOW(), INTERVAL 3 MINUTE)';
        $query = $pdo->prepare("SELECT 1 FROM fingerprint_enrollment_verify_jobs
            WHERE enrollment_device_id=? AND status IN ('pending','processing')
              AND COALESCE(processing_at, queued_at) > {$cutoff}
            LIMIT 1");
        $query->execute([$deviceId]);
        return (bool) $query->fetchColumn();
    }
}
