<?php

final class DirectFingerprintSensorBusyException extends RuntimeException
{
}

/** Shared reservations for database-to-Sensor A restores. Read helpers never migrate. */
final class DirectFingerprintImportSchema
{
    public static function tableExists(PDO $pdo): bool
    {
        try {
            $pdo->query('SHOW COLUMNS FROM direct_fingerprint_import_jobs LIKE \'id\'');
            return true;
        } catch (PDOException $error) {
            if ($error->getCode() === '42S02') return false;
            throw $error;
        }
    }

    public static function ensure(PDO $pdo): void
    {
        $pdo->exec("CREATE TABLE IF NOT EXISTS direct_fingerprint_import_jobs (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            actor_id INT NOT NULL, user_id INT NOT NULL, fingerprint_id INT NOT NULL,
            enrollment_device_id INT NOT NULL, target_slot INT NOT NULL,
            employee_id VARCHAR(100) NOT NULL, user_name VARCHAR(255) NOT NULL,
            finger_name VARCHAR(50) NOT NULL, template_data LONGBLOB NOT NULL,
            template_hash CHAR(64) NOT NULL, source_enrolled_at DATETIME NULL,
            source_device_id INT NULL, source_slot INT NULL,
            status ENUM('pending','processing','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
            progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
            current_step VARCHAR(150) NOT NULL DEFAULT 'Waiting for Sensor A', error_message TEXT NULL,
            queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, processing_at DATETIME NULL,
            finished_at DATETIME NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            active_device_key INT NULL, active_fingerprint_key INT NULL,
            UNIQUE KEY unique_direct_import_device (active_device_key),
            UNIQUE KEY unique_direct_import_fingerprint (active_fingerprint_key),
            KEY idx_direct_import_device_status (enrollment_device_id,status,queued_at),
            KEY idx_direct_import_fingerprint (fingerprint_id,id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }

    public static function hasActiveForDevice(PDO $pdo, int $deviceId): bool
    {
        if (!self::tableExists($pdo)) return false;
        $query = $pdo->prepare("SELECT 1 FROM direct_fingerprint_import_jobs
            WHERE enrollment_device_id=? AND (
                (status='pending' AND queued_at > DATE_SUB(NOW(), INTERVAL 3 MINUTE)) OR
                (status='processing' AND processing_at > DATE_SUB(NOW(), INTERVAL 3 MINUTE))
            ) LIMIT 1");
        $query->execute([$deviceId]);
        return (bool) $query->fetchColumn();
    }

    public static function hasActiveForUserOrSlot(PDO $pdo, int $userId, int $deviceId, int $slot): bool
    {
        if (!self::tableExists($pdo)) return false;
        $query = $pdo->prepare("SELECT 1 FROM direct_fingerprint_import_jobs
            WHERE (user_id=? OR (enrollment_device_id=? AND target_slot=?)) AND (
                (status='pending' AND queued_at > DATE_SUB(NOW(), INTERVAL 3 MINUTE)) OR
                (status='processing' AND processing_at > DATE_SUB(NOW(), INTERVAL 3 MINUTE))
            ) LIMIT 1");
        $query->execute([$userId, $deviceId, $slot]);
        return (bool) $query->fetchColumn();
    }

    public static function expire(PDO $pdo): void
    {
        $pdo->exec("UPDATE direct_fingerprint_import_jobs SET
            error_message=CASE WHEN status='pending'
                THEN 'Import cancelled: Sensor A did not pick up this database restore within 3 minutes. Check its power, WiFi, and Direct Fingerprint firmware, then retry.'
                ELSE 'Import cancelled: Sensor A did not confirm the restored template within 3 minutes. Retry the same backup to verify the reserved sensor slot.' END,
            current_step='Import cancelled',finished_at=NOW(),active_device_key=NULL,active_fingerprint_key=NULL,status='cancelled'
            WHERE (status='pending' AND queued_at <= DATE_SUB(NOW(), INTERVAL 3 MINUTE))
               OR (status='processing' AND processing_at <= DATE_SUB(NOW(), INTERVAL 3 MINUTE))");
    }
}
