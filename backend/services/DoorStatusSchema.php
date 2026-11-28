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

    private static ?bool $hasCacheColumns = null;

    /** True when door_controller_status stores which offline schedule copy the door has saved. */
    public static function hasCacheColumns(PDO $pdo): bool
    {
        if (self::$hasCacheColumns !== null) return self::$hasCacheColumns;
        try {
            return self::$hasCacheColumns = (bool) $pdo->query("SHOW COLUMNS FROM door_controller_status LIKE 'cache_saved_at'")->fetch();
        } catch (PDOException) {
            return false;
        }
    }

    /**
     * Adds the offline schedule copy columns when missing: the version the
     * door reports, the end of the days it covers (Unix time), and when the
     * door first reported that version. Call outside a transaction.
     */
    public static function ensureCacheColumns(PDO $pdo): bool
    {
        if (self::hasCacheColumns($pdo) || $pdo->inTransaction()) return self::hasCacheColumns($pdo);
        foreach ([
            'cache_version INT UNSIGNED NULL DEFAULT NULL',
            'cache_valid_until INT UNSIGNED NULL DEFAULT NULL',
            'cache_saved_at DATETIME NULL DEFAULT NULL',
        ] as $column) {
            try {
                $pdo->exec("ALTER TABLE door_controller_status ADD COLUMN {$column}");
            } catch (PDOException $error) {
                // 1060: the column exists already (another request, or a partial earlier run).
                if ((int) ($error->errorInfo[1] ?? 0) !== 1060) return false;
            }
        }
        return self::$hasCacheColumns = true;
    }

    public static function definition(): string
    {
        return "CREATE TABLE IF NOT EXISTS door_controller_status (
            device_id INT NOT NULL PRIMARY KEY,
            door_state ENUM('locked','unlocked') NOT NULL,
            boot_id CHAR(32) NOT NULL,
            report_sequence BIGINT UNSIGNED NOT NULL,
            received_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            wifi_rssi SMALLINT NULL DEFAULT NULL,
            cache_version INT UNSIGNED NULL DEFAULT NULL,
            cache_valid_until INT UNSIGNED NULL DEFAULT NULL,
            cache_saved_at DATETIME NULL DEFAULT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
    }
}
