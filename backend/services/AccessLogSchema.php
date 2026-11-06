<?php

/** Additive schema support for RFID UIDs and enrollment VERIFY logs. */
final class AccessLogSchema
{
    public static function hasColumn(PDO $pdo, string $table, string $column): bool
    {
        if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite') {
            foreach ($pdo->query('PRAGMA table_info(' . $table . ')') as $row) {
                if (strcasecmp((string) ($row['name'] ?? ''), $column) === 0) return true;
            }
            return false;
        }
        $query = $pdo->query('SHOW COLUMNS FROM ' . $table . ' LIKE ' . $pdo->quote($column));
        return (bool) ($query ? $query->fetch() : false);
    }

    public static function ensureEnrollmentVerify(PDO $pdo): void
    {
        if ($pdo->inTransaction()) {
            throw new RuntimeException('Add access_log VERIFY columns before beginning a transaction.');
        }
        self::ensureRfidUid($pdo);
        if (!self::hasColumn($pdo, 'access_log', 'matched_slot')) {
            try {
                $pdo->exec('ALTER TABLE access_log ADD COLUMN matched_slot INT NULL DEFAULT NULL');
            } catch (PDOException $error) {
                if ((int) ($error->errorInfo[1] ?? 0) !== 1060) throw $error;
            }
        }
        if (!self::hasColumn($pdo, 'access_log', 'match_confidence')) {
            try {
                $pdo->exec('ALTER TABLE access_log ADD COLUMN match_confidence INT NULL DEFAULT NULL');
            } catch (PDOException $error) {
                if ((int) ($error->errorInfo[1] ?? 0) !== 1060) throw $error;
            }
        }
        if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite') return;
        $column = $pdo->query("SHOW COLUMNS FROM access_log LIKE 'access_type'")->fetch(PDO::FETCH_ASSOC);
        if ($column && stripos((string) ($column['Type'] ?? ''), 'verify') === false) {
            try {
                $pdo->exec("ALTER TABLE access_log MODIFY COLUMN access_type ENUM('IN','OUT','VERIFY') NOT NULL DEFAULT 'IN'");
            } catch (PDOException $error) {
                if (!str_contains($error->getMessage(), 'VERIFY')) {
                    throw $error;
                }
            }
        }
    }

    public static function ensureRfidUid(PDO $pdo): void
    {
        if (self::hasColumn($pdo, 'access_log', 'rfid_uid')) return;

        // MySQL ALTER TABLE commits implicitly, so never migrate a credential
        // transaction that must roll back if its access-log write fails.
        if ($pdo->inTransaction()) {
            throw new RuntimeException('Add the access_log RFID UID column before beginning a transaction.');
        }

        try {
            $pdo->exec('ALTER TABLE access_log ADD COLUMN rfid_uid VARCHAR(30) NULL DEFAULT NULL');
        } catch (PDOException $error) {
            // Another request may have added the same column after our check.
            if ((int) ($error->errorInfo[1] ?? 0) !== 1060) throw $error;
        }
    }
}
