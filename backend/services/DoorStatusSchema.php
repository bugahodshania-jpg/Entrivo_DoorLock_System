<?php

final class DoorStatusSchema
{
    public static function exists(PDO $pdo): bool
    {
        try {
            $pdo->query('SELECT 1 FROM door_controller_status LIMIT 0');
            return true;
        } catch (PDOException $error) {
            if ($error->getCode() === '42S02') return false;
            throw $error;
        }
    }

    private static ?bool $hasWifiColumn = null;

    /** True when door_controller_status stores the controller's WiFi signal strength. */
    public static function hasWifiColumn(PDO $pdo): bool
    {
        if (self::$hasWifiColumn !== null) return self::$hasWifiColumn;
        try {
            return self::$hasWifiColumn = (bool) $pdo->query("SHOW COLUMNS FROM door_controller_status LIKE 'wifi_rssi'")->fetch();
        } catch (PDOException) {
            return false;
        }
    }

    /**
     * Adds the nullable wifi_rssi column (dBm) when missing. DDL commits
     * implicitly, so call it outside a transaction. Returns whether it exists.
     */
    public static function ensureWifiColumn(PDO $pdo): bool
    {
        if (self::hasWifiColumn($pdo) || $pdo->inTransaction()) return self::hasWifiColumn($pdo);
        try {
            $pdo->exec('ALTER TABLE door_controller_status ADD COLUMN wifi_rssi SMALLINT NULL DEFAULT NULL');
        } catch (PDOException $error) {
            // 1060: another request added it first. Anything else: keep working without it.
            if ((int) ($error->errorInfo[1] ?? 0) !== 1060) return false;
        }
        return self::$hasWifiColumn = true;
    }

    public static function definition(): string
    {
        return "CREATE TABLE IF NOT EXISTS door_controller_status (
            device_id INT NOT NULL PRIMARY KEY,
            door_state ENUM('locked','unlocked') NOT NULL,
            boot_id CHAR(32) NOT NULL,
            report_sequence BIGINT UNSIGNED NOT NULL,
            received_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            wifi_rssi SMALLINT NULL DEFAULT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
    }
}
