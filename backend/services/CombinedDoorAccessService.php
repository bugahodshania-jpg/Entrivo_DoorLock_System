<?php

require_once __DIR__ . '/DirectFingerprintAccessService.php';
require_once __DIR__ . '/AccessLogSchema.php';
require_once __DIR__ . '/ScheduleAccessPolicy.php';

/**
 * Door decisions for the combined door/enrollment controller. Entry needs a
 * registered credential, an active account, and a current REGULAR or
 * OVERRIDE schedule of that same user (ScheduleAccessPolicy).
 */
final class CombinedDoorAccessService
{
    private PDO $pdo;
    private ?bool $hasAccessType = null;

    public function __construct(?PDO $pdo = null)
    {
        $this->pdo = $pdo ?? entrivo_pdo();
    }

    public static function deviceTokenMatches(mixed $configured, mixed $provided): bool
    {
        return is_string($configured) && trim($configured) !== ''
            && is_string($provided) && $provided !== '' && hash_equals($configured, $provided);
    }

    public function verify(array $input, ?DateTimeImmutable $now = null): array
    {
        $method = $input['method'] ?? null;
        if ($method === 'fingerprint') {
            return (new DirectFingerprintAccessService($this->pdo))->verifyRegisteredIdentity($input, $now);
        }
        if ($method !== 'rfid') {
            return $this->decision(false, 'invalid_request', 'Use fingerprint or rfid verification.', [], false);
        }

        $now = ($now ?? new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))
            ->setTimezone(new DateTimeZone('Asia/Manila'));
        $hasRole = (bool) $this->pdo->query("SHOW COLUMNS FROM users LIKE 'role'")->fetch();
        AccessLogSchema::ensureRfidUid($this->pdo);
        $this->pdo->beginTransaction();
        try {
            $decision = $this->authorizeRfid($input, $hasRole, $now);
            $this->recordRfidDecision($decision, $now);
            $this->pdo->commit();
            return $decision;
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw $error;
        }
    }

    private function authorizeRfid(array $input, bool $hasRole, DateTimeImmutable $now): array
    {
        $rawDeviceId = $input['enrollment_device_id'] ?? null;
        $deviceId = (is_int($rawDeviceId) || is_string($rawDeviceId))
            ? filter_var($rawDeviceId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) : false;
        $uid = is_string($input['rfid_uid'] ?? null) ? strtoupper(trim($input['rfid_uid'])) : '';
        $direction = $input['direction'] ?? null;
        $validUid = preg_match('/^[A-F0-9]{10}$/D', $uid) === 1;
        $scan = $validUid ? ['rfid_uid' => $uid] : [];
        if (!$deviceId || !$validUid || !in_array($direction, ['entry', 'exit'], true)) {
            return $this->decision(false, 'invalid_request', 'A valid enrollment device, 10-digit hexadecimal RFID UID, and entry or exit direction are required.', $scan, false);
        }
        $scan['direction'] = $direction;
        $query = $this->pdo->prepare('SELECT device_type,status FROM fingerprint_devices WHERE device_id=? FOR SHARE');
        $query->execute([$deviceId]);
        $device = $query->fetch(PDO::FETCH_ASSOC);
        if (!$device || $device['device_type'] !== 'enrollment' || $device['status'] !== 'active') {
            return $this->decision(false, 'device_unavailable', 'The combined controller is not registered and active.', $scan);
        }

        $query = $this->pdo->prepare('SELECT c.card_id,c.user_id,c.status AS card_status,u.username,u.is_active,u.approval_status,u.must_change_password,u.onboarding_step'
            . ($hasRole ? ',u.role' : '') . '
            FROM rfid_cards c LEFT JOIN users u ON u.id=c.user_id
            WHERE UPPER(c.rfid_uid)=? FOR SHARE');
        $query->execute([$uid]);
        $cards = $query->fetchAll(PDO::FETCH_ASSOC);
        if (count($cards) !== 1) {
            return $this->decision(false, $cards === [] ? 'not_registered' : 'ambiguous_card', $cards === []
                ? 'This RFID card is not registered.' : 'This RFID UID has conflicting registrations.', $scan);
        }
        $card = $cards[0];
        // Orphaned registrations are never an identity, even on a legacy schema.
        if ($card['username'] === null) {
            return $this->decision(false, 'not_registered', 'This RFID card is not linked to an available account.', $scan);
        }
        $identity = [...$scan, 'user_id' => (int) $card['user_id'], 'card_id' => (int) $card['card_id'], 'username' => (string) $card['username']];
        if ($card['card_status'] !== 'active') {
            return $this->decision(false, 'invalid_rfid', 'This RFID card is inactive or marked lost.', $identity);
        }
        if ((int) $card['is_active'] !== 1 || $card['approval_status'] !== 'approved') {
            return $this->decision(false, 'account_inactive', 'This account is inactive or has not been approved.', $identity);
        }
        if ((int) $card['must_change_password'] !== 0 || $card['onboarding_step'] !== 'done') {
            return $this->decision(false, 'account_incomplete', 'Complete the account setup before using door access.', $identity);
        }
        // RFID is open to every role: a registered, active card follows the same
        // rules as a fingerprint (entry needs the user's current approved
        // schedule; exit is never refused).
        // The exit reader is inside the room. Exit is never schedule-gated, so
        // a user who stays past the schedule (or is locked in) can always
        // leave; it is linked to the user's session and marked EXTENDED when
        // that schedule has already ended. Entry still needs a valid schedule.
        if ($direction === 'exit') {
            $exit = (new ScheduleAccessPolicy($this->pdo))->exitContext($identity['user_id'], $now);
            return $this->decision(true, 'access_granted', $exit['message'], [...$identity, ...ScheduleAccessPolicy::exitFields($exit)]);
        }
        $schedule = (new ScheduleAccessPolicy($this->pdo))->evaluate($identity['user_id'], $now);
        // A student never opens the room first: entry needs a faculty, staff
        // member or administrator already inside. The one exception is an
        // admin-approved temporary access (override) for a vacant room.
        // Students can always exit (handled above).
        if ($hasRole && (string) ($card['role'] ?? '') === 'student'
            && !($schedule['granted'] && $schedule['schedule_kind'] === 'override')) {
            $host = $this->staffInside($now);
            if ($host === null) {
                return $this->decision(false, 'faculty_not_present',
                    'Students can enter only after a faculty member, staff member, or administrator has entered the room.', $identity);
            }
            return $this->decision(true, 'access_granted', 'Entry allowed: ' . $host['username'] . ' is already inside.', [
                ...$identity,
                // The class session the student joins (the instructor's schedule).
                'schedule_id' => $host['schedule_id'],
                'override_id' => null,
                'schedule_kind' => 'with_faculty',
            ]);
        }
        if (!$schedule['granted']) {
            return $this->decision(false, $schedule['reason'], $schedule['message'], $identity);
        }
        return $this->decision(true, 'access_granted', $schedule['message'], [
            ...$identity,
            'schedule_id' => $schedule['schedule_id'],
            'override_id' => $schedule['override_id'],
            'schedule_kind' => $schedule['schedule_kind'],
        ]);
    }

    /**
     * A faculty, staff member or administrator who is inside right now: their
     * latest granted access today is an entry (IN) with no later exit (OUT),
     * and the schedule they entered on has not ended yet. Null when nobody
     * qualifies, or when the log has no IN/OUT column (fails closed).
     *
     * @return array{user_id: int, username: string, schedule_id: int}|null
     */
    private function staffInside(DateTimeImmutable $now): ?array
    {
        $this->hasAccessType ??= (bool) $this->pdo->query("SHOW COLUMNS FROM access_log LIKE 'access_type'")->fetch();
        if (!$this->hasAccessType) return null;
        // Entries today on a schedule that is still running, newest first.
        $entries = $this->pdo->prepare(
            "SELECT entry.log_id, entry.user_id, u.username, entry.schedule_id
             FROM access_log entry
             INNER JOIN users u ON u.id = entry.user_id
             INNER JOIN schedules s ON s.schedule_id = entry.schedule_id AND s.user_id = entry.user_id
             WHERE entry.access_status = 'granted' AND entry.access_type = 'IN'
               AND u.role <> 'student'
               AND entry.access_timestamp >= :day_start AND entry.access_timestamp <= :now
               AND s.time_end > :time_now
             ORDER BY entry.log_id DESC"
        );
        $entries->execute([
            'day_start' => $now->format('Y-m-d 00:00:00'),
            'now' => $now->format('Y-m-d H:i:s'),
            'time_now' => $now->format('H:i:s'),
        ]);
        // Still inside = no later granted access (an exit, or a newer entry that
        // is checked on its own) by the same person.
        $later = $this->pdo->prepare(
            "SELECT 1 FROM access_log
             WHERE user_id = ? AND access_status = 'granted' AND log_id > ? AND access_timestamp <= ?
             LIMIT 1"
        );
        foreach ($entries->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $later->execute([(int) $row['user_id'], (int) $row['log_id'], $now->format('Y-m-d H:i:s')]);
            if ($later->fetchColumn() === false) {
                return ['user_id' => (int) $row['user_id'], 'username' => (string) $row['username'], 'schedule_id' => (int) $row['schedule_id']];
            }
        }
        return null;
    }

    private function decision(bool $granted, string $reason, string $message, array $identity = [], bool $success = true): array
    {
        return ['success' => $success, 'access_granted' => $granted, 'reason' => $reason, 'message' => $message, ...$identity];
    }

    private function recordRfidDecision(array $decision, DateTimeImmutable $now): void
    {
        $this->hasAccessType ??= (bool) $this->pdo->query("SHOW COLUMNS FROM access_log LIKE 'access_type'")->fetch();
        $denialReason = match ($decision['reason']) {
            'access_granted' => null,
            'not_registered' => 'not_registered',
            'invalid_request', 'invalid_rfid', 'ambiguous_card' => 'invalid_rfid',
            'no_schedule', 'expired_schedule', 'schedule_not_started' => $decision['reason'],
            default => 'unauthorized',
        };
        $extraColumn = $this->hasAccessType ? ',access_type' : '';
        $extraValue = $this->hasAccessType ? ',:access_type' : '';
        $query = $this->pdo->prepare("INSERT INTO access_log
            (user_id,card_id,rfid_uid,fingerprint_id,schedule_id,override_id,access_timestamp,access_status,denial_reason,method_access{$extraColumn})
            VALUES (:user_id,:card_id,:rfid_uid,NULL,:schedule_id,:override_id,:access_timestamp,:access_status,:denial_reason,'RFID'{$extraValue})");
        $values = [
            'user_id' => $decision['user_id'] ?? null,
            'card_id' => $decision['card_id'] ?? null,
            'rfid_uid' => $decision['rfid_uid'] ?? null,
            'schedule_id' => $decision['schedule_id'] ?? null,
            'override_id' => $decision['override_id'] ?? null,
            'access_timestamp' => $now->format('Y-m-d H:i:s'),
            'access_status' => $decision['access_granted'] ? 'granted' : 'denied',
            'denial_reason' => $denialReason,
        ];
        if ($this->hasAccessType) $values['access_type'] = ($decision['direction'] ?? '') === 'exit' ? 'OUT' : 'IN';
        $query->execute($values);
    }
}
