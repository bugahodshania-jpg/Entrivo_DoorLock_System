<?php

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/ScheduleStatusService.php';
require_once __DIR__ . '/DirectFingerprintImportSchema.php';
require_once __DIR__ . '/FingerprintTemplateFormat.php';

/** Online authorization for a sensor that both enrolls and scans its own slots. */
final class DirectFingerprintAccessService
{
    private PDO $pdo;

    public function __construct(?PDO $pdo = null)
    {
        $this->pdo = $pdo ?? entrivo_pdo();
    }

    public function verify(array $input, ?DateTimeImmutable $now = null): array
    {
        return $this->verifyWithPolicy($input, $now, true);
    }

    /** The combined controller must bind the live sensor template to its database backup. */
    public function verifyRegisteredIdentity(array $input, ?DateTimeImmutable $now = null): array
    {
        return $this->verifyWithPolicy($input, $now, false);
    }

    private function verifyWithPolicy(array $input, ?DateTimeImmutable $now, bool $requireSchedule): array
    {
        $deviceId = $this->positiveInteger($input['enrollment_device_id'] ?? null);
        $slot = $this->positiveInteger($input['matched_slot'] ?? null, 65535);
        $liveTemplateHash = $requireSchedule ? null : ($input['template_hash'] ?? null);
        $validLiveTemplateHash = $requireSchedule || (is_string($liveTemplateHash)
            && preg_match('/^[a-f0-9]{64}$/D', $liveTemplateHash) === 1);
        $now = ($now ?? new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->setTimezone(new DateTimeZone('Asia/Manila'));
        $this->pdo->beginTransaction();

        try {
            $decision = !$deviceId || !$slot || !$validLiveTemplateHash
                ? $this->decision(false, 'invalid_request', $requireSchedule
                    ? 'A valid enrollment device and matched sensor slot are required.'
                    : 'A valid enrollment device, matched sensor slot, and live template SHA-256 hash are required.', [], false)
                : $this->authorize((int) $deviceId, (int) $slot, $now, $requireSchedule, $liveTemplateHash);
            // A grant is returned only after its access log has been persisted.
            $this->recordDecision($decision, $now);
            $this->pdo->commit();
            return $decision;
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }
    }

    private function positiveInteger(mixed $value, int $maximum = PHP_INT_MAX): int|false
    {
        if (!is_int($value) && !is_string($value)) {
            return false;
        }
        return filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => $maximum]]);
    }

    private function authorize(int $deviceId, int $slot, DateTimeImmutable $now, bool $requireSchedule, ?string $liveTemplateHash): array
    {
        $device = $this->pdo->prepare('SELECT device_type, status FROM fingerprint_devices WHERE device_id = ? FOR SHARE');
        $device->execute([$deviceId]);
        $registry = $device->fetch(PDO::FETCH_ASSOC);
        if (!$registry || $registry['device_type'] !== 'enrollment' || $registry['status'] !== 'active') {
            return $this->decision(false, 'device_unavailable', 'The enrollment sensor is not registered and active.');
        }

        $lookup = $this->pdo->prepare(
            'SELECT f.*, u.username, u.is_active, u.approval_status, u.must_change_password, u.onboarding_step
             FROM fingerprints f INNER JOIN users u ON u.id = f.user_id
             WHERE f.enrollment_device_id = ? AND f.enrollment_slot = ? FOR SHARE'
        );
        $lookup->execute([$deviceId, $slot]);
        $matches = $lookup->fetchAll(PDO::FETCH_ASSOC);
        if (count($matches) !== 1) {
            return $this->decision(false, $matches === [] ? 'not_registered' : 'ambiguous_slot', $matches === []
                ? 'This sensor slot is not linked to a registered fingerprint.'
                : 'This sensor slot has conflicting fingerprint owners. Ask an administrator to correct the enrollment.');
        }

        $fingerprint = $matches[0];
        $identity = [
            'user_id' => (int) $fingerprint['user_id'],
            'fingerprint_id' => (int) $fingerprint['fingerprint_id'],
            'username' => (string) $fingerprint['username'],
            'finger_name' => (string) ($fingerprint['finger_name'] ?? ''),
        ];
        if ((int) $fingerprint['is_active'] !== 1 || $fingerprint['approval_status'] !== 'approved') {
            return $this->decision(false, 'account_inactive', 'This account is inactive or has not been approved.', $identity);
        }
        if ((int) $fingerprint['must_change_password'] !== 0 || $fingerprint['onboarding_step'] !== 'done') {
            return $this->decision(false, 'account_incomplete', 'Complete the account setup before using door access.', $identity);
        }
        if ($fingerprint['status'] !== 'active' || !$this->validTemplate($fingerprint)) {
            return $this->decision(false, 'invalid_fingerprint', 'This fingerprint enrollment is inactive or its stored template is invalid.', $identity);
        }
        if (!$requireSchedule && !hash_equals(strtolower(trim((string) $fingerprint['template_hash'])), $liveTemplateHash)) {
            return $this->decision(false, 'fingerprint_mismatch', 'The matched sensor template does not match this registered fingerprint backup.', $identity);
        }
        if (DirectFingerprintImportSchema::hasActiveForUserOrSlot($this->pdo, $identity['user_id'], $deviceId, $slot)) {
            return $this->decision(false, 'import_in_progress', 'A database backup is being restored for this fingerprint. Wait for Sensor A to confirm the import before trying door access.', $identity);
        }
        if (!$this->confirmedEnrollment($fingerprint, $deviceId, $slot)) {
            return $this->decision(false, 'enrollment_incomplete', 'This sensor enrollment is pending, failed, or has not been confirmed by the backend.', $identity);
        }

        if (!$requireSchedule) {
            return $this->decision(true, 'access_granted', 'Registered fingerprint verified.', $identity);
        }

        $schedules = $this->pdo->prepare('SELECT * FROM schedules WHERE user_id = ? ORDER BY schedule_id ASC FOR SHARE');
        $schedules->execute([$identity['user_id']]);
        $date = $now->format('Y-m-d');
        $time = $now->format('H:i:s');
        $futureToday = false;
        $endedToday = false;
        foreach ($schedules->fetchAll(PDO::FETCH_ASSOC) as $schedule) {
            if (ScheduleStatusService::normalizeStatus($schedule['status']) !== 'approved' || !$this->occursOn($schedule, $date)) {
                continue;
            }
            $start = (string) $schedule['time_start'];
            $end = (string) $schedule['time_end'];
            if (!preg_match('/^\d{2}:\d{2}:\d{2}$/', $start) || !preg_match('/^\d{2}:\d{2}:\d{2}$/', $end) || $end <= $start) {
                continue;
            }
            $futureToday = $futureToday || $time < $start;
            $endedToday = $endedToday || $time >= $end;
            if ($time < $start || $time >= $end) {
                continue;
            }

            $overrideId = null;
            $isOverride = $schedule['status'] === 'overridden' || ($schedule['schedule_kind'] ?? 'regular') === 'override';
            if ($isOverride) {
                // The schedule and its approved request must both still exist.
                $approval = $this->pdo->prepare(
                    'SELECT override_id FROM access_overrides
                     WHERE user_id = ? AND approved_by IS NOT NULL
                       AND override_start = ? AND override_end = ?
                     ORDER BY override_id ASC LIMIT 1 FOR SHARE'
                );
                $approval->execute([$identity['user_id'], $date . ' ' . $start, $date . ' ' . $end]);
                $overrideId = $approval->fetchColumn();
                if (!$overrideId) {
                    continue;
                }
            }

            return $this->decision(true, 'access_granted', 'Access granted for the current approved schedule.', [
                ...$identity,
                'schedule_id' => (int) $schedule['schedule_id'],
                'override_id' => $overrideId !== null ? (int) $overrideId : null,
            ]);
        }

        $reason = $futureToday ? 'schedule_not_started' : ($endedToday ? 'expired_schedule' : 'no_schedule');
        $message = match ($reason) {
            'schedule_not_started' => 'The approved access schedule has not started yet.',
            'expired_schedule' => 'The approved access schedule has already ended.',
            default => 'There is no current approved access schedule for this account.',
        };
        return $this->decision(false, $reason, $message, $identity);
    }

    private function validTemplate(array $fingerprint): bool
    {
        return FingerprintTemplateFormat::verifiedBinary(
            $fingerprint['template_data'] ?? null,
            $fingerprint['template_hash'] ?? null
        ) !== null;
    }

    private function confirmedEnrollment(array $fingerprint, int $deviceId, int $slot): bool
    {
        $jobs = $this->pdo->prepare(
            "SELECT * FROM fingerprint_enrollment_jobs
             WHERE (enrollment_device_id = :device_id AND assigned_slot = :slot)
                OR (user_id = :user_id AND status IN ('waiting', 'processing'))
             ORDER BY job_id DESC FOR SHARE"
        );
        $jobs->execute(['device_id' => $deviceId, 'slot' => $slot, 'user_id' => (int) $fingerprint['user_id']]);
        $latest = null;
        foreach ($jobs->fetchAll(PDO::FETCH_ASSOC) as $job) {
            if (in_array($job['status'], ['waiting', 'processing'], true)) {
                return false;
            }
            $latest ??= $job;
        }

        return $latest !== null && $latest['status'] === 'completed' && (int) $latest['progress'] === 100
            && (int) $latest['user_id'] === (int) $fingerprint['user_id']
            && (string) $latest['finger_name'] === (string) $fingerprint['finger_name']
            && (empty($latest['fingerprint_id']) || (int) $latest['fingerprint_id'] === (int) $fingerprint['fingerprint_id'])
            && !empty($fingerprint['enrolled_at']) && !empty($latest['finished_at'])
            && (string) $latest['finished_at'] >= (string) $fingerprint['enrolled_at'];
    }

    private function occursOn(array $schedule, string $date): bool
    {
        if ($schedule['schedule_type'] === 'single') {
            return (string) $schedule['schedule_date'] === $date;
        }
        if ($schedule['schedule_type'] !== 'recurring' || empty($schedule['start_date']) || empty($schedule['end_date'])
            || $date < $schedule['start_date'] || $date > $schedule['end_date']) {
            return false;
        }
        $day = (new DateTimeImmutable($date, new DateTimeZone('Asia/Manila')))->format('l');
        if ($schedule['repeat_type'] === 'daily') {
            return true;
        }
        if ($schedule['repeat_type'] === 'weekly') {
            $named = trim((string) ($schedule['repeat_day'] ?? ''));
            $expected = $named !== '' ? $named : (new DateTimeImmutable($schedule['start_date'], new DateTimeZone('Asia/Manila')))->format('l');
            return strcasecmp($day, $expected) === 0;
        }
        if ($schedule['repeat_type'] === 'weekly_selected') {
            $days = json_decode((string) ($schedule['repeat_days'] ?? '[]'), true);
            if (is_array($days)) {
                foreach ($days as $selected) {
                    if (is_string($selected) && strcasecmp($day, $selected) === 0) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private function decision(bool $granted, string $reason, string $message, array $identity = [], bool $success = true): array
    {
        return ['success' => $success, 'access_granted' => $granted, 'reason' => $reason, 'message' => $message, ...$identity];
    }

    private function recordDecision(array $decision, DateTimeImmutable $now): void
    {
        $denialReason = match ($decision['reason']) {
            'access_granted' => null,
            'not_registered' => 'not_registered',
            'invalid_request', 'ambiguous_slot', 'invalid_fingerprint', 'fingerprint_mismatch', 'enrollment_incomplete', 'import_in_progress' => 'invalid_fingerprint',
            'no_schedule', 'expired_schedule', 'schedule_not_started' => $decision['reason'],
            default => 'unauthorized',
        };
        $log = $this->pdo->prepare(
            "INSERT INTO access_log (user_id, fingerprint_id, schedule_id, override_id, access_timestamp, access_status, denial_reason, method_access)
             VALUES (:user_id, :fingerprint_id, :schedule_id, :override_id, :access_timestamp, :access_status, :denial_reason, 'Fingerprint')"
        );
        $log->execute([
            'user_id' => $decision['user_id'] ?? null,
            'fingerprint_id' => $decision['fingerprint_id'] ?? null,
            'schedule_id' => $decision['schedule_id'] ?? null,
            'override_id' => $decision['override_id'] ?? null,
            'access_timestamp' => $now->format('Y-m-d H:i:s'),
            'access_status' => $decision['access_granted'] ? 'granted' : 'denied',
            'denial_reason' => $denialReason,
        ]);
    }
}
