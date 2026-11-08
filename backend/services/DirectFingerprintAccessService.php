<?php

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/ScheduleStatusService.php';
require_once __DIR__ . '/ScheduleAccessPolicy.php';
require_once __DIR__ . '/DirectFingerprintImportSchema.php';
require_once __DIR__ . '/FingerprintTemplateFormat.php';
require_once __DIR__ . '/FingerprintEnrollmentVerification.php';
require_once __DIR__ . '/../tools/agent_debug_log.php';

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
        $direction = $input['direction'] ?? 'entry';
        $validDirection = is_string($direction) && in_array($direction, ['entry', 'exit'], true);
        $hasRole = (bool) $this->pdo->query("SHOW COLUMNS FROM users LIKE 'role'")->fetch();
        // #region agent log
        agent_debug_log('A', 'DirectFingerprintAccessService.php:verifyWithPolicy', 'Fingerprint verify request received', [
            'deviceId' => $deviceId === false ? null : $deviceId,
            'matched_slot' => $slot === false ? null : $slot,
            'direction' => $direction,
            'requireSchedule' => $requireSchedule,
            'hash_prefix' => is_string($liveTemplateHash) ? substr($liveTemplateHash, 0, 16) : null,
            'hash_valid' => $validLiveTemplateHash,
        ]);
        // #endregion
        $this->pdo->beginTransaction();

        try {
            $decision = !$validDirection
                ? $this->decision(false, 'invalid_request', 'Fingerprint direction must be entry or exit.', [], false)
                : (!$deviceId || !$slot || !$validLiveTemplateHash
                ? $this->decision(false, 'invalid_request', $requireSchedule
                    ? 'A valid enrollment device and matched sensor slot are required.'
                    : 'A valid enrollment device, matched sensor slot, and live template SHA-256 hash are required.', [], false)
                : $this->authorize((int) $deviceId, (int) $slot, $now, $requireSchedule, $liveTemplateHash, $hasRole,
                    // Entry unlocks the door, so it needs a current schedule. A
                    // combined-controller exit only records leaving and arms the
                    // lock on an already-open door, so it is never schedule-gated.
                    $requireSchedule || $direction !== 'exit'));
            // A locked-door scan by someone still inside after the schedule
            // ended is granted as an exit only (see authorize).
            $decision['direction'] = !empty($decision['exit_only']) ? 'exit' : ($validDirection ? $direction : 'entry');
            if (($decision['access_granted'] ?? false) && $decision['direction'] === 'exit' && !array_key_exists('extended', $decision)) {
                $decision['message'] = 'Registered fingerprint verified. Exit recorded.';
            }
            // #region agent log
            agent_debug_log('B', 'DirectFingerprintAccessService.php:verifyWithPolicy:decision', 'Fingerprint verify decision', [
                'access_granted' => (bool) ($decision['access_granted'] ?? false),
                'reason' => $decision['reason'] ?? null,
                'message' => $decision['message'] ?? null,
                'user_id' => $decision['user_id'] ?? null,
                'fingerprint_id' => $decision['fingerprint_id'] ?? null,
                'matched_slot' => $slot === false ? null : $slot,
            ]);
            // #endregion
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

    private function authorize(int $deviceId, int $slot, DateTimeImmutable $now, bool $requireSchedule, ?string $liveTemplateHash, bool $hasRole, bool $checkSchedule): array
    {
        $device = $this->pdo->prepare('SELECT device_type, status FROM fingerprint_devices WHERE device_id = ? FOR SHARE');
        $device->execute([$deviceId]);
        $registry = $device->fetch(PDO::FETCH_ASSOC);
        if (!$registry || $registry['device_type'] !== 'enrollment' || $registry['status'] !== 'active') {
            return $this->decision(false, 'device_unavailable', 'The enrollment sensor is not registered and active.');
        }

        $lookup = $this->pdo->prepare(
            'SELECT f.*, u.username, u.is_active, u.approval_status, u.must_change_password, u.onboarding_step'
            . ($hasRole ? ', u.role' : '') . '
             FROM fingerprints f INNER JOIN users u ON u.id = f.user_id
             WHERE f.enrollment_device_id = ? AND f.enrollment_slot = ? FOR SHARE'
        );
        $lookup->execute([$deviceId, $slot]);
        $matches = $lookup->fetchAll(PDO::FETCH_ASSOC);
        if (count($matches) !== 1) {
            // #region agent log
            $slotOwners = $this->pdo->prepare('SELECT fingerprint_id,user_id,finger_name,status,enrollment_slot FROM fingerprints WHERE enrollment_device_id=? ORDER BY fingerprint_id DESC LIMIT 20');
            $slotOwners->execute([$deviceId]);
            agent_debug_log('C', 'DirectFingerprintAccessService.php:authorize:slotLookup', 'Slot has no unique active fingerprint mapping', [
                'deviceId' => $deviceId,
                'matched_slot' => $slot,
                'match_count' => count($matches),
                'device_fingerprint_rows' => $slotOwners->fetchAll(PDO::FETCH_ASSOC),
            ]);
            // #endregion
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
        if ($hasRole && !in_array((string) ($fingerprint['role'] ?? ''), ['faculty', 'staff', 'admin', 'super_admin'], true)) {
            return $this->decision(false, 'unauthorized', 'Students use an RFID card to enter and leave. Fingerprint access is for faculty, staff, and administrators.', $identity);
        }
        if ($fingerprint['status'] !== 'active' || !$this->validTemplate($fingerprint)) {
            return $this->decision(false, 'invalid_fingerprint', 'This fingerprint enrollment is inactive or its stored template is invalid.', $identity);
        }
        if (!$requireSchedule && !hash_equals(strtolower(trim((string) $fingerprint['template_hash'])), $liveTemplateHash)) {
            // #region agent log
            agent_debug_log('D', 'DirectFingerprintAccessService.php:authorize:hash', 'Live template hash mismatch', [
                'fingerprint_id' => (int) $fingerprint['fingerprint_id'],
                'slot' => $slot,
                'db_hash_prefix' => substr(strtolower(trim((string) $fingerprint['template_hash'])), 0, 16),
                'live_hash_prefix' => is_string($liveTemplateHash) ? substr($liveTemplateHash, 0, 16) : null,
            ]);
            // #endregion
            return $this->decision(false, 'fingerprint_mismatch', 'The matched sensor template does not match this registered fingerprint backup.', $identity);
        }
        if (DirectFingerprintImportSchema::hasActiveForUserOrSlot($this->pdo, $identity['user_id'], $deviceId, $slot)) {
            return $this->decision(false, 'import_in_progress', 'A database backup is being restored for this fingerprint. Wait for Sensor A to confirm the import before trying door access.', $identity);
        }
        if (!$this->confirmedEnrollment($fingerprint, $deviceId, $slot)) {
            // #region agent log
            agent_debug_log('E', 'DirectFingerprintAccessService.php:authorize:confirmedEnrollment', 'confirmedEnrollment returned false', [
                'fingerprint_id' => (int) $fingerprint['fingerprint_id'],
                'user_id' => (int) $fingerprint['user_id'],
                'finger_name' => (string) ($fingerprint['finger_name'] ?? ''),
                'deviceId' => $deviceId,
                'slot' => $slot,
                'enrolled_at' => $fingerprint['enrolled_at'] ?? null,
            ]);
            // #endregion
            return $this->decision(false, 'enrollment_incomplete', 'This sensor enrollment is pending, failed, or has not been confirmed by the backend.', $identity);
        }

        $policy = new ScheduleAccessPolicy($this->pdo);
        if (!$checkSchedule) {
            // Combined-controller exit: never schedule-gated, linked to the
            // session, and marked EXTENDED after the schedule end.
            $exit = $policy->exitContext($identity['user_id'], $now);
            return $this->decision(true, 'access_granted', $exit['message'], [...$identity, ...ScheduleAccessPolicy::exitFields($exit)]);
        }

        $schedule = $policy->evaluate($identity['user_id'], $now);
        if (!$schedule['granted']) {
            // The fingerprint sensor is inside the room. On the combined
            // controller, a user who entered and has not exited yet (open
            // session) may still LEAVE after the schedule ended, for example
            // when the door was locked with them inside. This is an exit only:
            // it is logged OUT, and without an open session entry stays denied.
            if (!$requireSchedule && $policy->openSession($identity['user_id'], $now) !== null) {
                $exit = $policy->exitContext($identity['user_id'], $now);
                return $this->decision(true, 'access_granted', 'Exit only: ' . $exit['message'],
                    [...$identity, ...ScheduleAccessPolicy::exitFields($exit), 'exit_only' => true]);
            }
            return $this->decision(false, $schedule['reason'], $schedule['message'], $identity);
        }
        return $this->decision(true, 'access_granted', $schedule['message'], [
            ...$identity,
            'schedule_id' => $schedule['schedule_id'],
            'override_id' => $schedule['override_id'],
            'schedule_kind' => $schedule['schedule_kind'],
        ]);
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
        $openJobId = null;
        foreach ($jobs->fetchAll(PDO::FETCH_ASSOC) as $job) {
            if (in_array($job['status'], ['waiting', 'processing'], true)) {
                $openJobId = (int) ($job['job_id'] ?? 0);
                // #region agent log
                agent_debug_log('E', 'DirectFingerprintAccessService.php:confirmedEnrollment', 'Blocked by open enrollment job', [
                    'open_job_id' => $openJobId,
                    'open_status' => $job['status'] ?? null,
                    'slot' => $slot,
                ]);
                // #endregion
                return false;
            }
            $latest ??= $job;
        }

        if ($latest === null || $latest['status'] !== 'completed' || (int) $latest['progress'] !== 100
            || (int) $latest['user_id'] !== (int) $fingerprint['user_id']
            || (string) $latest['finger_name'] !== (string) $fingerprint['finger_name']
            || (!empty($latest['fingerprint_id']) && (int) $latest['fingerprint_id'] !== (int) $fingerprint['fingerprint_id'])
            || empty($fingerprint['enrolled_at']) || empty($latest['finished_at'])
            || (string) $latest['finished_at'] < (string) $fingerprint['enrolled_at']) {
            // #region agent log
            agent_debug_log('E', 'DirectFingerprintAccessService.php:confirmedEnrollment', 'Latest job failed completion checks', [
                'latest_job_id' => isset($latest['job_id']) ? (int) $latest['job_id'] : null,
                'latest_status' => $latest['status'] ?? null,
                'latest_progress' => isset($latest['progress']) ? (int) $latest['progress'] : null,
                'latest_user_id' => isset($latest['user_id']) ? (int) $latest['user_id'] : null,
                'latest_finger' => $latest['finger_name'] ?? null,
                'latest_fingerprint_id' => isset($latest['fingerprint_id']) ? (int) $latest['fingerprint_id'] : null,
                'latest_finished_at' => $latest['finished_at'] ?? null,
                'fp_user_id' => (int) $fingerprint['user_id'],
                'fp_finger' => (string) ($fingerprint['finger_name'] ?? ''),
                'fp_id' => (int) $fingerprint['fingerprint_id'],
                'fp_enrolled_at' => $fingerprint['enrolled_at'] ?? null,
                'finished_before_enrolled' => isset($latest['finished_at'], $fingerprint['enrolled_at'])
                    ? ((string) $latest['finished_at'] < (string) $fingerprint['enrolled_at'])
                    : null,
            ]);
            // #endregion
            return false;
        }
        $proof = FingerprintEnrollmentVerification::findByJobId($this->pdo, (int) $latest['job_id']);
        if ($proof && (int) $proof['stored_slot'] === $slot) {
            $ok = (int) $proof['matched_slot'] === $slot;
            // #region agent log
            agent_debug_log('E', 'DirectFingerprintAccessService.php:confirmedEnrollment', 'Proof slot check', [
                'job_id' => (int) $latest['job_id'],
                'stored_slot' => (int) $proof['stored_slot'],
                'matched_slot' => (int) $proof['matched_slot'],
                'expected_slot' => $slot,
                'ok' => $ok,
            ]);
            // #endregion
            return $ok;
        }
        return true;
    }

    private function decision(bool $granted, string $reason, string $message, array $identity = [], bool $success = true): array
    {
        return ['success' => $success, 'access_granted' => $granted, 'reason' => $reason, 'message' => $message, ...$identity];
    }

    private ?bool $hasAccessType = null;

    private function recordDecision(array $decision, DateTimeImmutable $now): void
    {
        $this->hasAccessType ??= (bool) $this->pdo->query("SHOW COLUMNS FROM access_log LIKE 'access_type'")->fetch();
        $denialReason = match ($decision['reason']) {
            'access_granted' => null,
            'not_registered' => 'not_registered',
            'invalid_request', 'ambiguous_slot', 'invalid_fingerprint', 'fingerprint_mismatch', 'enrollment_incomplete', 'import_in_progress' => 'invalid_fingerprint',
            'no_schedule', 'expired_schedule', 'schedule_not_started' => $decision['reason'],
            default => 'unauthorized',
        };
        $extraColumn = $this->hasAccessType ? ', access_type' : '';
        $extraValue = $this->hasAccessType ? ', :access_type' : '';
        $log = $this->pdo->prepare(
            "INSERT INTO access_log (user_id, fingerprint_id, schedule_id, override_id, access_timestamp, access_status, denial_reason, method_access{$extraColumn})
             VALUES (:user_id, :fingerprint_id, :schedule_id, :override_id, :access_timestamp, :access_status, :denial_reason, 'Fingerprint'{$extraValue})"
        );
        $values = [
            'user_id' => $decision['user_id'] ?? null,
            'fingerprint_id' => $decision['fingerprint_id'] ?? null,
            'schedule_id' => $decision['schedule_id'] ?? null,
            'override_id' => $decision['override_id'] ?? null,
            'access_timestamp' => $now->format('Y-m-d H:i:s'),
            'access_status' => $decision['access_granted'] ? 'granted' : 'denied',
            'denial_reason' => $denialReason,
        ];
        if ($this->hasAccessType) $values['access_type'] = ($decision['direction'] ?? '') === 'exit' ? 'OUT' : 'IN';
        $log->execute($values);
    }
}
