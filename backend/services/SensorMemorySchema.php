<?php

/** Read-only sensor snapshots never change fingerprint enrollments or permissions. */
final class SensorMemorySchema
{
    public static function tableExists(PDO $pdo, string $table = 'sensor_memory_jobs'): bool
    {
        if (!in_array($table, ['sensor_memory_jobs', 'sensor_memory_inventories', 'sensor_memory_templates'], true)) {
            throw new InvalidArgumentException('Unknown sensor memory table.');
        }
        try {
            $pdo->query('SELECT 1 FROM ' . $table . ' LIMIT 0');
            return true;
        } catch (PDOException $error) {
            if ($error->getCode() === '42S02') return false;
            throw $error;
        }
    }

    /** Called by the explicit additive migration, never inside a request transaction. */
    public static function ensure(PDO $pdo): void
    {
        if ($pdo->inTransaction()) throw new LogicException('Migrate sensor memory before starting a transaction.');
        foreach (self::definitions() as $definition) $pdo->exec($definition);
        // Existing installations keep the original enum until this additive change.
        $pdo->exec("ALTER TABLE sensor_memory_jobs MODIFY kind ENUM('inventory','template','empty') NOT NULL");
    }

    public static function definitions(): array
    {
        return [
            "CREATE TABLE IF NOT EXISTS sensor_memory_jobs (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                actor_id INT NOT NULL, device_id INT NOT NULL,
                kind ENUM('inventory','template','empty') NOT NULL,
                inventory_id BIGINT UNSIGNED NULL, target_slot INT UNSIGNED NULL,
                status ENUM('pending','processing','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
                claim_token CHAR(64) NULL, report_hash CHAR(64) NULL,
                error_message VARCHAR(1000) NULL,
                queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                processing_at DATETIME NULL, finished_at DATETIME NULL,
                active_device_key INT NULL,
                UNIQUE KEY unique_sensor_memory_device (active_device_key),
                KEY idx_sensor_memory_device (device_id,kind,status,id),
                KEY idx_sensor_memory_parent (inventory_id,target_slot,id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS sensor_memory_inventories (
                job_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
                device_id INT NOT NULL, capacity INT UNSIGNED NOT NULL,
                template_count INT UNSIGNED NOT NULL, occupied_slots LONGTEXT NOT NULL,
                captured_at DATETIME NULL, received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                KEY idx_sensor_memory_inventory_device (device_id,job_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
            "CREATE TABLE IF NOT EXISTS sensor_memory_templates (
                job_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
                inventory_id BIGINT UNSIGNED NOT NULL, device_id INT NOT NULL, slot_id INT UNSIGNED NOT NULL,
                template_data BLOB NOT NULL, template_hash CHAR(64) NOT NULL,
                template_bytes INT UNSIGNED NOT NULL,
                captured_at DATETIME NULL, received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                KEY idx_sensor_memory_template_slot (inventory_id,slot_id,job_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        ];
    }

    /** Shared physical-sensor guard. Pending reads yield to enrollment/import work. */
    public static function hasProcessingForDevice(PDO $pdo, int $deviceId): bool
    {
        if (!self::tableExists($pdo)) return false;
        $query = $pdo->prepare("SELECT 1 FROM sensor_memory_jobs WHERE device_id=? AND (
            (status='processing' AND processing_at > DATE_SUB(NOW(), INTERVAL 3 MINUTE))
            OR (kind='empty' AND status='pending' AND queued_at > DATE_SUB(NOW(), INTERVAL 3 MINUTE))
        ) LIMIT 1");
        $query->execute([$deviceId]);
        return (bool) $query->fetchColumn();
    }

    public static function expire(PDO $pdo): void
    {
        $pdo->exec("UPDATE sensor_memory_jobs SET
            error_message=CASE
                WHEN kind='empty' AND status='pending' THEN 'Sensor did not pick up the erase within 3 minutes. Check its power, WiFi, and Sensor Memory firmware, then retry.'
                WHEN kind='empty' THEN 'Sensor did not finish erasing templates within 3 minutes. Read the sensor before enrolling again.'
                WHEN status='pending' THEN 'Sensor did not pick up the read within 3 minutes. Check its power, WiFi, and Sensor Memory firmware, then retry.'
                ELSE 'Sensor did not finish the read within 3 minutes. The last completed inventory is preserved; retry the read.' END,
            status=CASE WHEN status='pending' THEN 'cancelled' ELSE 'failed' END,
            finished_at=NOW(),active_device_key=NULL
            WHERE (status='pending' AND queued_at <= DATE_SUB(NOW(), INTERVAL 3 MINUTE))
               OR (status='processing' AND processing_at <= DATE_SUB(NOW(), INTERVAL 3 MINUTE))");
    }
}
