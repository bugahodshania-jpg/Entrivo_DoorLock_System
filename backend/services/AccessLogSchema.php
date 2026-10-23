<?php

/** Additive schema support for retaining the RFID value presented at the door. */
final class AccessLogSchema
{
    public static function ensureRfidUid(PDO $pdo): void
    {
        if ($pdo->query("SHOW COLUMNS FROM access_log LIKE 'rfid_uid'")->fetch()) return;

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
