<?php

require_once __DIR__ . '/FingerprintTemplateFormat.php';

/** Temporary MySQL copy of the stored-slot template waiting for superadmin download. */
final class FingerprintEnrollmentBackup
{
    public static function tableExists(PDO $pdo): bool
    {
        try {
            $pdo->query('SELECT job_id FROM fingerprint_enrollment_backups WHERE 1 = 0');
            return true;
        } catch (PDOException $error) {
            if ($error->getCode() === '42S02' ||
                ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' && str_contains($error->getMessage(), 'no such table'))) return false;
            throw $error;
        }
    }

    public static function ensure(PDO $pdo): void
    {
        if ($pdo->inTransaction()) throw new LogicException('Create backup storage before starting a transaction.');
        if (self::tableExists($pdo)) {
            self::ensureIdentifyColumns($pdo);
            return;
        }
        $suffix = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql'
            ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
        $pdo->exec('CREATE TABLE IF NOT EXISTS fingerprint_enrollment_backups (
            job_id INT NOT NULL PRIMARY KEY,
            enrollment_device_id INT NOT NULL,
            stored_slot INT NOT NULL,
            template_data BLOB NOT NULL,
            template_bytes INT NOT NULL,
            template_sha256 CHAR(64) NOT NULL,
            matched_slot INT NULL,
            confidence INT NULL,
            fresh_scan_verified TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )' . $suffix);
        self::ensureIdentifyColumns($pdo);
    }

    private static function ensureIdentifyColumns(PDO $pdo): void
    {
        foreach ([
            'ALTER TABLE fingerprint_enrollment_backups ADD COLUMN matched_slot INT NULL',
            'ALTER TABLE fingerprint_enrollment_backups ADD COLUMN confidence INT NULL',
            'ALTER TABLE fingerprint_enrollment_backups ADD COLUMN fresh_scan_verified TINYINT(1) NOT NULL DEFAULT 0',
        ] as $sql) {
            try {
                $pdo->exec($sql);
            } catch (PDOException $error) {
                if (!str_contains($error->getMessage(), 'Duplicate column')
                    && !str_contains($error->getMessage(), 'duplicate column')) {
                    throw $error;
                }
            }
        }
    }

    public static function stage(PDO $pdo, int $jobId, int $deviceId, int $slot, string $binary, string $hash): void
    {
        if ($jobId <= 0 || $deviceId <= 0 || $slot <= 0 || $slot > 65535 ||
            !FingerprintTemplateFormat::isUsableTemplate($binary) ||
            preg_match('/^[a-f0-9]{64}$/D', $hash) !== 1 ||
            !hash_equals(hash('sha256', $binary), $hash)) {
            throw new InvalidArgumentException('The sensor backup bytes, slot, or hash are invalid.');
        }
        $pdo->beginTransaction();
        try {
            $jobQuery = $pdo->prepare('SELECT enrollment_device_id, assigned_slot, status FROM fingerprint_enrollment_jobs WHERE job_id = ? FOR UPDATE');
            $jobQuery->execute([$jobId]);
            $job = $jobQuery->fetch(PDO::FETCH_ASSOC);
            if (!$job || (int) $job['enrollment_device_id'] !== $deviceId ||
                (int) $job['assigned_slot'] !== $slot ||
                !in_array($job['status'], ['processing', 'stored_pending_commit'], true)) {
                throw new DomainException('The backup does not belong to an active enrollment at this sensor slot.');
            }
            $existingQuery = $pdo->prepare('SELECT * FROM fingerprint_enrollment_backups WHERE job_id = ? FOR UPDATE');
            $existingQuery->execute([$jobId]);
            $existing = $existingQuery->fetch(PDO::FETCH_ASSOC);
            if ($existing) {
                if ((int) $existing['enrollment_device_id'] !== $deviceId ||
                    (int) $existing['stored_slot'] !== $slot ||
                    $existing['template_data'] !== $binary ||
                    !hash_equals((string) $existing['template_sha256'], $hash)) {
                    throw new DomainException('This enrollment already has a different staged backup. Recover the existing job.');
                }
            } else {
                $insert = $pdo->prepare('INSERT INTO fingerprint_enrollment_backups
                    (job_id, enrollment_device_id, stored_slot, template_data, template_bytes, template_sha256)
                    VALUES (?, ?, ?, ?, ?, ?)');
                $insert->execute([$jobId, $deviceId, $slot, $binary, strlen($binary), $hash]);
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
    }

    public static function find(PDO $pdo, int $jobId): ?array
    {
        if (!self::tableExists($pdo)) return null;
        $query = $pdo->prepare('SELECT * FROM fingerprint_enrollment_backups WHERE job_id = ?');
        $query->execute([$jobId]);
        return $query->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public static function delete(PDO $pdo, int $jobId): void
    {
        if (!self::tableExists($pdo)) return;
        $query = $pdo->prepare('DELETE FROM fingerprint_enrollment_backups WHERE job_id = ?');
        $query->execute([$jobId]);
    }

    public static function recordIdentifyMatch(PDO $pdo, int $jobId, int $matchedSlot, int $confidence, bool $freshScanVerified): void
    {
        if ($jobId <= 0 || $matchedSlot <= 0 || $matchedSlot > 65535 || $confidence <= 0 || $confidence > 65535) {
            throw new InvalidArgumentException('Identify match slot and confidence must be positive sensor values.');
        }
        $query = $pdo->prepare('UPDATE fingerprint_enrollment_backups
            SET matched_slot = ?, confidence = ?, fresh_scan_verified = ?
            WHERE job_id = ?');
        $query->execute([$matchedSlot, $confidence, $freshScanVerified ? 1 : 0, $jobId]);
        if ($query->rowCount() === 0 && !self::find($pdo, $jobId)) {
            throw new DomainException('The identify match has no staged template for this job.');
        }
    }

    public static function hasIdentifyMatch(PDO $pdo, int $jobId): bool
    {
        return self::identifyMatch($pdo, $jobId) !== null;
    }

    public static function identifyMatch(PDO $pdo, int $jobId): ?array
    {
        $row = self::find($pdo, $jobId);
        if (!$row) {
            return null;
        }
        $storedSlot = (int) ($row['stored_slot'] ?? 0);
        $matchedSlot = (int) ($row['matched_slot'] ?? 0) ?: $storedSlot;
        $confidence = (int) ($row['confidence'] ?? 0) ?: 1;
        $binary = (string) ($row['template_data'] ?? '');
        if ($storedSlot <= 0 || $matchedSlot <= 0 || $binary === ''
            || !FingerprintTemplateFormat::isUsableTemplate($binary)) {
            return null;
        }
        return [
            'stored_slot' => $storedSlot,
            'matched_slot' => $matchedSlot,
            'confidence' => $confidence,
            'template_bytes' => (int) $row['template_bytes'] ?: strlen($binary),
            'template_sha256' => (string) $row['template_sha256'],
            'template_data_base64' => base64_encode($binary),
            'template_data_hex' => bin2hex($binary),
            'fresh_scan_verified' => (int) ($row['fresh_scan_verified'] ?? 0) === 1,
            'storage_confirmed' => true,
        ];
    }
}
