<?php

require_once __DIR__ . '/FingerprintTemplateFormat.php';

/** Durable board proof. Read paths never create or migrate database tables. */
final class FingerprintEnrollmentVerification
{
    public static function tableExists(PDO $pdo): bool
    {
        try {
            $pdo->query('SELECT job_id FROM fingerprint_enrollment_verifications WHERE 1 = 0');
            return true;
        } catch (PDOException $error) {
            if ($error->getCode() === '42S02' ||
                ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' && str_contains($error->getMessage(), 'no such table'))) {
                return false;
            }
            throw $error;
        }
    }

    public static function deviceTokenMatches(mixed $configured, mixed $provided): bool
    {
        return is_string($configured) && trim($configured) !== ''
            && is_string($provided) && $provided !== '' && hash_equals($configured, $provided);
    }

    /** Validate sensor facts independently of the advisory progress text. */
    public static function normalize(mixed $proof, string $binary): array
    {
        if (is_array($proof) && !array_is_list($proof) && ($proof['storage_confirmed'] ?? null) === true
            && ($proof['fresh_scan_verified'] ?? null) !== true) {
            return self::normalizeStored($proof, $binary);
        }
        if (!is_array($proof) || array_is_list($proof) || ($proof['fresh_scan_verified'] ?? null) !== true) {
            throw new InvalidArgumentException('Fresh sensor verification proof is required. Update the enrollment firmware and verify the saved finger again.');
        }
        foreach (['stored_slot', 'matched_slot', 'confidence', 'template_bytes'] as $field) {
            if (!isset($proof[$field]) || !is_int($proof[$field]) || $proof[$field] <= 0) {
                throw new InvalidArgumentException('Sensor verification slots, confidence, and template byte count must be positive integers.');
            }
        }
        foreach (['stored_slot', 'matched_slot', 'confidence'] as $field) {
            if ($proof[$field] > 65535) {
                throw new InvalidArgumentException('Sensor verification slots and confidence must fit the sensor protocol.');
            }
        }
        $hash = $proof['template_sha256'] ?? null;
        if (!is_string($hash) || preg_match('/^[a-f0-9]{64}$/D', $hash) !== 1 ||
            !hash_equals(hash('sha256', $binary), $hash) || $proof['template_bytes'] !== strlen($binary)) {
            throw new InvalidArgumentException('Sensor verification byte count and SHA-256 must match the complete stored template.');
        }
        return [
            'fresh_scan_verified' => true,
            'storage_confirmed' => true,
            'stored_slot' => $proof['stored_slot'],
            'matched_slot' => $proof['matched_slot'],
            'confidence' => $proof['confidence'],
            'template_bytes' => $proof['template_bytes'],
            'template_sha256' => $hash,
        ];
    }

    /** Sensor A storage succeeded; a later 0x17 or backup export must not discard the slot. */
    private static function normalizeStored(array $proof, string $binary): array
    {
        $slot = $proof['stored_slot'] ?? null;
        if (!is_int($slot) || $slot <= 0 || $slot > 65535) {
            throw new InvalidArgumentException('A confirmed Sensor A slot is required after storage.');
        }
        if ($binary === '') {
            return [
                'fresh_scan_verified' => false,
                'storage_confirmed' => true,
                'stored_slot' => $slot,
                'matched_slot' => $slot,
                'confidence' => 1,
                'template_bytes' => 0,
                'template_sha256' => '',
            ];
        }
        if (!FingerprintTemplateFormat::isSupportedSize(strlen($binary)) || !FingerprintTemplateFormat::isUsableTemplate($binary)) {
            throw new InvalidArgumentException('Stored template backup is incomplete. Sensor A storage can still be committed without Sensor B sync.');
        }
        $hash = $proof['template_sha256'] ?? hash('sha256', $binary);
        if (!is_string($hash) || preg_match('/^[a-f0-9]{64}$/D', $hash) !== 1 || !hash_equals(hash('sha256', $binary), $hash)) {
            throw new InvalidArgumentException('Stored template SHA-256 must match the downloaded backup.');
        }
        $matched = $proof['matched_slot'] ?? $slot;
        $confidence = $proof['confidence'] ?? 1;
        return [
            'fresh_scan_verified' => false,
            'storage_confirmed' => true,
            'stored_slot' => $slot,
            'matched_slot' => is_int($matched) && $matched > 0 ? $matched : $slot,
            'confidence' => is_int($confidence) && $confidence > 0 ? $confidence : 1,
            'template_bytes' => strlen($binary),
            'template_sha256' => $hash,
        ];
    }

    public static function findByJobId(PDO $pdo, int $jobId): ?array
    {
        if (!self::tableExists($pdo)) return null;
        $statement = $pdo->prepare('SELECT * FROM fingerprint_enrollment_verifications WHERE job_id = ?');
        $statement->execute([$jobId]);
        return $statement->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public static function findForFingerprint(PDO $pdo, int $fingerprintId): ?array
    {
        if (!self::tableExists($pdo)) return null;
        $statement = $pdo->prepare('SELECT * FROM fingerprint_enrollment_verifications
            WHERE fingerprint_id = ? ORDER BY job_id DESC LIMIT 1');
        $statement->execute([$fingerprintId]);
        return $statement->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public static function metadata(array $row): array
    {
        return [
            'fresh_scan_verified' => (int) $row['fresh_scan_verified'] === 1,
            'stored_slot' => (int) $row['stored_slot'],
            'matched_slot' => (int) $row['matched_slot'],
            'confidence' => (int) $row['confidence'],
            'template_bytes' => (int) $row['template_bytes'],
            'template_sha256' => (string) $row['template_sha256'],
            'fingerprint_id' => (int) $row['fingerprint_id'],
            'verified_at' => (string) $row['verified_at'],
            'storage_confirmed' => true,
        ];
    }

    public static function record(PDO $pdo, array $job, array $fingerprint, array $proof): array
    {
        $statement = $pdo->prepare('INSERT INTO fingerprint_enrollment_verifications
            (job_id, fingerprint_id, user_id, finger_name, enrollment_device_id, fresh_scan_verified,
             stored_slot, matched_slot, confidence, template_bytes, template_sha256, verified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)');
        $statement->execute([
            (int) $job['job_id'], (int) $fingerprint['fingerprint_id'], (int) $job['user_id'],
            (string) $job['finger_name'], (int) $job['enrollment_device_id'],
            !empty($proof['fresh_scan_verified']) ? 1 : 0,
            $proof['stored_slot'], $proof['matched_slot'], $proof['confidence'],
            $proof['template_bytes'], $proof['template_sha256'] ?: str_repeat('0', 64),
        ]);
        return self::findByJobId($pdo, (int) $job['job_id']) ?? [];
    }

    /** Only the explicit additive migration calls this method. */
    public static function ensure(PDO $pdo): void
    {
        $pdo->exec("CREATE TABLE IF NOT EXISTS fingerprint_enrollment_verifications (
            job_id INT NOT NULL PRIMARY KEY,
            fingerprint_id INT NOT NULL, user_id INT NOT NULL, finger_name VARCHAR(50) NOT NULL,
            enrollment_device_id INT NOT NULL, fresh_scan_verified TINYINT(1) NOT NULL,
            stored_slot INT NOT NULL, matched_slot INT NOT NULL, confidence INT NOT NULL,
            template_bytes INT NOT NULL, template_sha256 CHAR(64) NOT NULL,
            verified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_enrollment_verification_fingerprint (fingerprint_id, job_id),
            KEY idx_enrollment_verification_device_slot (enrollment_device_id, stored_slot)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
