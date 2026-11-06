<?php

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/EnrollmentVerifySchema.php';
require_once __DIR__ . '/AccessLogSchema.php';
require_once __DIR__ . '/FingerprintTemplateFormat.php';
require_once __DIR__ . '/FingerprintEnrollmentVerification.php';

final class EnrollmentVerifyException extends RuntimeException
{
    public function __construct(string $message, public readonly int $httpStatus = 409)
    {
        parent::__construct($message);
    }
}

/** One post-download identify scan. Door stays locked; writes VERIFY access logs only. */
final class EnrollmentVerifyService
{
    private PDO $pdo;

    public function __construct(?PDO $pdo = null)
    {
        $this->pdo = $pdo ?? entrivo_pdo();
    }

    public function queueFromCompletedEnrollment(array $completed, ?int $actorId = null): ?array
    {
        $job = is_array($completed['job'] ?? null) ? $completed['job'] : [];
        $fingerprint = is_array($completed['fingerprint'] ?? null) ? $completed['fingerprint'] : [];
        $jobId = (int) ($job['job_id'] ?? 0);
        $deviceId = (int) ($job['enrollment_device_id'] ?? 0);
        $slot = (int) ($job['assigned_slot'] ?? $fingerprint['enrollment_slot'] ?? 0);
        $userId = (int) ($job['user_id'] ?? $fingerprint['user_id'] ?? 0);
        $fingerprintId = (int) ($fingerprint['fingerprint_id'] ?? $job['fingerprint_id'] ?? 0);
        $hash = strtolower((string) ($completed['verification']['template_sha256'] ?? $fingerprint['template_hash'] ?? ''));
        if ($jobId <= 0 || $deviceId <= 0 || $slot <= 0 || $userId <= 0 || $fingerprintId <= 0
            || preg_match('/^[a-f0-9]{64}$/D', $hash) !== 1) {
            return null;
        }
        EnrollmentVerifySchema::ensure($this->pdo);
        $existing = $this->pdo->prepare("SELECT * FROM fingerprint_enrollment_verify_jobs
            WHERE enrollment_job_id=? AND status IN ('pending','processing','completed') ORDER BY id DESC LIMIT 1");
        $existing->execute([$jobId]);
        $row = $existing->fetch(PDO::FETCH_ASSOC);
        if ($row) return $this->safe($row);

        $name = trim((string) ($job['user_name'] ?? ''));
        $finger = trim((string) ($job['finger_name'] ?? $fingerprint['finger_name'] ?? ''));
        $insert = $this->pdo->prepare('INSERT INTO fingerprint_enrollment_verify_jobs
            (enrollment_job_id,actor_id,user_id,fingerprint_id,enrollment_device_id,target_slot,user_name,finger_name,template_hash)
            VALUES (?,?,?,?,?,?,?,?,?)');
        $insert->execute([$jobId, $actorId, $userId, $fingerprintId, $deviceId, $slot, $name, $finger, $hash]);
        return $this->job((int) $this->pdo->lastInsertId());
    }

    public function readForAdmin(array $input): array
    {
        EnrollmentVerifySchema::ensure($this->pdo);
        EnrollmentVerifySchema::expire($this->pdo);
        $jobId = (int) ($input['enrollment_job_id'] ?? $input['job_id'] ?? 0);
        $verifyId = (int) ($input['verify_job_id'] ?? 0);
        $row = null;
        if ($verifyId > 0) $row = $this->find($verifyId);
        if (!$row && $jobId > 0) {
            $query = $this->pdo->prepare('SELECT * FROM fingerprint_enrollment_verify_jobs WHERE enrollment_job_id=? ORDER BY id DESC LIMIT 1');
            $query->execute([$jobId]);
            $row = $query->fetch(PDO::FETCH_ASSOC) ?: null;
        }
        if (!$row) {
            $query = $this->pdo->query("SELECT * FROM fingerprint_enrollment_verify_jobs
                WHERE queued_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
                ORDER BY id DESC LIMIT 1");
            $row = $query ? $query->fetch(PDO::FETCH_ASSOC) ?: null : null;
        }
        return ['success' => true, 'verify' => $row ? $this->safe($row) : null];
    }

    public function claim(array $input): array
    {
        $deviceId = $this->positive($input['enrollment_device_id'] ?? null);
        if (!$deviceId) $this->reject('A valid enrollment device is required.', 422);
        EnrollmentVerifySchema::ensure($this->pdo);
        EnrollmentVerifySchema::expire($this->pdo);
        $this->pdo->beginTransaction();
        try {
            $query = $this->pdo->prepare("SELECT * FROM fingerprint_enrollment_verify_jobs
                WHERE enrollment_device_id=? AND status IN ('pending','processing')
                ORDER BY id LIMIT 1 FOR UPDATE");
            $query->execute([$deviceId]);
            $job = $query->fetch(PDO::FETCH_ASSOC);
            if (!$job) {
                $this->pdo->commit();
                return ['success' => true, 'job' => null, 'message' => 'No queued enrollment verification.'];
            }
            if ($job['status'] === 'pending') {
                $token = bin2hex(random_bytes(32));
                $this->pdo->prepare("UPDATE fingerprint_enrollment_verify_jobs
                    SET status='processing',claim_token=?,processing_at=NOW(),active_device_key=?,current_step='Place the same finger to verify enrollment'
                    WHERE id=? AND status='pending'")->execute([$token, $deviceId, $job['id']]);
                $job = $this->find((int) $job['id']);
            }
            $safe = $this->safe($job);
            $safe['claim_token'] = $job['claim_token'];
            $this->pdo->commit();
            return ['success' => true, 'message' => 'Verification claimed by the sensor controller.', 'job' => $safe];
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw $error;
        }
    }

    public function deviceUpdate(array $input): array
    {
        $deviceId = $this->positive($input['enrollment_device_id'] ?? null);
        $jobId = $this->positive($input['job_id'] ?? null);
        $token = is_string($input['claim_token'] ?? null) ? $input['claim_token'] : '';
        $identified = ($input['identified'] ?? null) === true || ($input['identified'] ?? null) === 1;
        $slot = $this->positive($input['matched_slot'] ?? null, 65535);
        $confidence = $this->positive($input['confidence'] ?? null, 65535);
        $hash = is_string($input['template_hash'] ?? null) ? strtolower(trim($input['template_hash'])) : '';
        $errorMessage = is_string($input['error_message'] ?? null) ? trim($input['error_message']) : '';
        if (!$deviceId || !$jobId || $token === '') $this->reject('Job, device, and claim token are required.', 422);
        EnrollmentVerifySchema::ensure($this->pdo);
        AccessLogSchema::ensureEnrollmentVerify($this->pdo);

        $this->pdo->beginTransaction();
        try {
            $job = $this->find($jobId, true);
            if (!$job || (int) $job['enrollment_device_id'] !== $deviceId) $this->reject('Verification job not found for this device.', 404);
            if (!is_string($job['claim_token']) || !hash_equals($job['claim_token'], $token)) $this->reject('The verification claim token is invalid.', 403);
            if ($job['status'] === 'completed' || $job['status'] === 'failed') {
                $this->pdo->commit();
                return ['success' => true, 'message' => 'This verification result was already received.', 'verify' => $this->safe($job)];
            }
            if ($job['status'] !== 'processing') $this->reject('This verification is no longer processing.', 409);

            $matchedUser = null;
            $ok = $identified && $slot === (int) $job['target_slot'] && $confidence > 0
                && preg_match('/^[a-f0-9]{64}$/D', $hash) === 1
                && hash_equals($job['template_hash'], $hash);
            if ($ok) {
                $lookup = $this->pdo->prepare('SELECT f.fingerprint_id,f.user_id,f.finger_name,u.username
                    FROM fingerprints f INNER JOIN users u ON u.id=f.user_id
                    WHERE f.enrollment_device_id=? AND f.enrollment_slot=? AND f.fingerprint_id=?');
                $lookup->execute([$deviceId, $slot, $job['fingerprint_id']]);
                $matchedUser = $lookup->fetch(PDO::FETCH_ASSOC) ?: null;
                $ok = (bool) $matchedUser;
            }

            $logId = $this->writeVerifyLog($job, $ok, $slot ?: null, $confidence ?: null, $matchedUser);
            $step = $ok
                ? 'Identified ' . ($job['user_name'] ?: 'this user') . ' at slot ' . $slot . ', confidence ' . $confidence
                : 'Fingerprint was not identified after download.';
            $this->pdo->prepare("UPDATE fingerprint_enrollment_verify_jobs
                SET status=?,identified=?,matched_slot=?,confidence=?,access_log_id=?,error_message=?,current_step=?,finished_at=NOW(),active_device_key=NULL
                WHERE id=?")->execute([
                    $ok ? 'completed' : 'failed',
                    $ok ? 1 : 0,
                    $slot ?: null,
                    $confidence ?: null,
                    $logId,
                    $ok ? null : ($errorMessage !== '' ? $errorMessage : 'Sensor A did not identify the enrolled slot.'),
                    $step,
                    $jobId,
                ]);
            $fresh = $this->find($jobId);
            $this->pdo->commit();
            $safe = $this->safe($fresh);
            return ['success' => true, 'message' => $step, 'verify' => $safe, 'identified' => $ok,
                'user_name' => $safe['user_name'], 'slot' => $safe['matched_slot'], 'confidence' => $safe['confidence']];
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw $error;
        }
    }

    private function writeVerifyLog(array $job, bool $granted, ?int $slot, ?int $confidence, ?array $identity): ?int
    {
        $hasType = AccessLogSchema::hasColumn($this->pdo, 'access_log', 'access_type');
        $hasSlot = AccessLogSchema::hasColumn($this->pdo, 'access_log', 'matched_slot');
        $columns = 'user_id,fingerprint_id,schedule_id,override_id,access_timestamp,access_status,denial_reason,method_access';
        $values = ':user_id,:fingerprint_id,NULL,NULL,NOW(),:access_status,:denial_reason,\'Fingerprint\'';
        $payload = [
            'user_id' => $identity['user_id'] ?? $job['user_id'],
            'fingerprint_id' => $identity['fingerprint_id'] ?? $job['fingerprint_id'],
            'access_status' => $granted ? 'granted' : 'denied',
            'denial_reason' => $granted ? null : 'invalid_fingerprint',
        ];
        if ($hasType) {
            $columns .= ',access_type';
            $values .= ',:access_type';
            $payload['access_type'] = 'VERIFY';
        }
        if ($hasSlot) {
            $columns .= ',matched_slot,match_confidence';
            $values .= ',:matched_slot,:match_confidence';
            $payload['matched_slot'] = $slot;
            $payload['match_confidence'] = $confidence;
        }
        $this->pdo->prepare("INSERT INTO access_log ({$columns}) VALUES ({$values})")->execute($payload);
        return (int) $this->pdo->lastInsertId() ?: null;
    }

    private function find(int $id, bool $lock = false): ?array
    {
        $query = $this->pdo->prepare('SELECT * FROM fingerprint_enrollment_verify_jobs WHERE id=?' . ($lock ? ' FOR UPDATE' : ''));
        $query->execute([$id]);
        return $query->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    private function job(int $id): array
    {
        $row = $this->find($id);
        if (!$row) $this->reject('Verification job not found.', 404);
        return $this->safe($row);
    }

    private function safe(array $row): array
    {
        return [
            'verify_job_id' => (int) $row['id'],
            'enrollment_job_id' => (int) $row['enrollment_job_id'],
            'user_id' => (int) $row['user_id'],
            'fingerprint_id' => (int) $row['fingerprint_id'],
            'enrollment_device_id' => (int) $row['enrollment_device_id'],
            'target_slot' => (int) $row['target_slot'],
            'user_name' => (string) $row['user_name'],
            'finger_name' => (string) $row['finger_name'],
            'status' => $row['status'],
            'current_step' => $row['current_step'],
            'matched_slot' => isset($row['matched_slot']) ? (int) $row['matched_slot'] : null,
            'confidence' => isset($row['confidence']) ? (int) $row['confidence'] : null,
            'identified' => (int) ($row['identified'] ?? 0) === 1,
            'access_log_id' => isset($row['access_log_id']) ? (int) $row['access_log_id'] : null,
            'error_message' => $row['error_message'],
            'queued_at' => $row['queued_at'],
            'finished_at' => $row['finished_at'],
        ];
    }

    private function positive(mixed $value, int $maximum = PHP_INT_MAX): int|false
    {
        if (!is_int($value) && !is_string($value)) return false;
        return filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => $maximum]]);
    }

    private function reject(string $message, int $status = 409): never
    {
        throw new EnrollmentVerifyException($message, $status);
    }
}
