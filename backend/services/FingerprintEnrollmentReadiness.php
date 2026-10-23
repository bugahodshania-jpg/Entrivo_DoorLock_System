<?php

require_once __DIR__ . '/FingerprintEnrollmentVerification.php';
require_once __DIR__ . '/FingerprintTemplateFormat.php';

/** Read-only proof for the current fingerprint mapping and backup, never a legacy status flag. */
final class FingerprintEnrollmentReadiness
{
    public static function verifiedMap(PDO $pdo, array $fingerprintIds): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $fingerprintIds), fn ($id) => $id > 0)));
        if ($ids === [] || !FingerprintEnrollmentVerification::tableExists($pdo)) return [];
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $statement = $pdo->prepare("SELECT v.*,
            f.user_id AS current_user_id, f.finger_name AS current_finger_name,
            f.status AS current_status, f.enrollment_device_id AS current_device_id,
            f.enrollment_slot AS current_slot, f.template_data AS current_template_data,
            f.template_hash AS current_template_hash, f.enrolled_at AS current_enrolled_at,
            j.status AS job_status, j.progress AS job_progress, j.user_id AS job_user_id,
            j.finger_name AS job_finger_name, j.enrollment_device_id AS job_device_id,
            j.assigned_slot AS job_slot, j.finished_at AS job_finished_at
            FROM fingerprint_enrollment_verifications v
            INNER JOIN fingerprints f ON f.fingerprint_id = v.fingerprint_id
            INNER JOIN fingerprint_enrollment_jobs j ON j.job_id = v.job_id
            WHERE v.fingerprint_id IN ({$placeholders})
              AND NOT EXISTS (SELECT 1 FROM fingerprint_enrollment_jobs pending
                  WHERE pending.user_id = f.user_id AND pending.status IN ('waiting', 'processing'))
              AND NOT EXISTS (SELECT 1 FROM fingerprint_enrollment_jobs newer
                  WHERE newer.enrollment_device_id = f.enrollment_device_id
                    AND newer.assigned_slot = f.enrollment_slot AND newer.job_id > v.job_id)
            ORDER BY v.job_id DESC");
        $statement->execute($ids);
        $map = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if (!self::matchesCurrentRecord($row)) continue;
            $map[(int) $row['fingerprint_id']] ??= FingerprintEnrollmentVerification::metadata($row);
        }
        return $map;
    }

    private static function matchesCurrentRecord(array $row): bool
    {
        $binary = FingerprintTemplateFormat::verifiedBinary($row['current_template_data'], $row['current_template_hash']);
        return $row['current_status'] === 'active' && $row['job_status'] === 'completed'
            && (int) $row['job_progress'] === 100 && (int) $row['fresh_scan_verified'] === 1
            && (int) $row['confidence'] > 0 && (int) $row['confidence'] <= 65535
            && (int) $row['stored_slot'] > 0 && (int) $row['stored_slot'] <= 65535
            && (int) $row['stored_slot'] === (int) $row['matched_slot']
            && (int) $row['stored_slot'] === (int) $row['current_slot']
            && (int) $row['stored_slot'] === (int) $row['job_slot']
            && (int) $row['enrollment_device_id'] === (int) $row['current_device_id']
            && (int) $row['enrollment_device_id'] === (int) $row['job_device_id']
            && (int) $row['user_id'] === (int) $row['current_user_id']
            && (int) $row['user_id'] === (int) $row['job_user_id']
            && $row['finger_name'] === $row['current_finger_name']
            && $row['finger_name'] === $row['job_finger_name']
            && !empty($row['current_enrolled_at']) && !empty($row['job_finished_at']) && !empty($row['verified_at'])
            && $row['verified_at'] >= $row['current_enrolled_at']
            && $row['job_finished_at'] >= $row['current_enrolled_at']
            && $binary !== null && (int) $row['template_bytes'] === strlen($binary)
            && hash_equals((string) $row['template_sha256'], hash('sha256', $binary));
    }
}
