<?php

require_once __DIR__ . '/DirectFingerprintAccessService.php';
require_once __DIR__ . '/AccessLogSchema.php';
require_once __DIR__ . '/ScheduleAccessPolicy.php';
require_once __DIR__ . '/DoorEventLog.php';
require_once __DIR__ . '/OfflineExitService.php';

/**
 * Door decisions for the combined door/enrollment controller. Entry needs a
 * registered credential, an active account, and the role's schedule rule
 * (ScheduleAccessPolicy::evaluateEntry): faculty/staff a current REGULAR or
 * OVERRIDE schedule, students an approved OVERRIDE only, admins none.
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
        // An exit the controller already allowed offline: record it, never re-decide it.
        if (($input['offline_exit'] ?? null) === true) {
            return (new OfflineExitService($this->pdo))->record($input, $now);
        }
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
        // The controller numbers each exit; if its reply is lost and it uploads
        // the same exit later from its offline queue, it is not logged twice.
        $eventId = DoorEventLog::validId($input['event_id'] ?? null);
        if ($eventId !== null) DoorEventLog::ensure($this->pdo);
        $this->pdo->beginTransaction();
        try {
            $decision = $this->authorizeRfid($input, $hasRole, $now);
            $this->recordRfidDecision($decision, $now);
            if ($eventId !== null) DoorEventLog::remember($this->pdo, $eventId, (int) $this->pdo->lastInsertId(), $now);
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
        // RFID is open to every role (students, and backup cards for faculty,
        // staff and administrators). Entry and exit are separate decisions.
        // The exit reader is inside the room. Exit is never schedule-gated, so
        // a user who stays past the schedule (or is locked in) can always
        // leave; it is linked to the user's session and marked EXTENDED when
        // that schedule has already ended. The exit card only unlocks / arms
        // the touch sensor; the touch that follows it locks the door.
        $policy = new ScheduleAccessPolicy($this->pdo);
        if ($direction === 'exit') {
            $exit = $policy->exitContext($identity['user_id'], $now);
            return $this->decision(true, 'access_granted', $exit['message'], [...$identity, ...ScheduleAccessPolicy::exitFields($exit)]);
        }
        // Entry by role: faculty/staff need a regular or override schedule,
        // students an approved override only, admins have a permanent override.
        $schedule = $policy->evaluateEntry($identity['user_id'], $hasRole ? (string) ($card['role'] ?? '') : null, $now);
        // An emergency access card (DOOR_EMERGENCY_RFID_UIDS) has a permanent
        // override for entry, like an admin, whatever its owner's role. The
        // card and its account must still be registered and active (above).
        if (!$schedule['granted'] && in_array($uid, self::emergencyCardUids(), true)) {
            $schedule = ['granted' => true, 'message' => 'Access granted: emergency access card (permanent override).',
                'schedule_id' => null, 'override_id' => null, 'schedule_kind' => 'permanent_override', 'time_end' => null];
        }
        if (!$schedule['granted']) {
            return $this->decision(false, $schedule['reason'], $schedule['message'], $identity);
        }
        return $this->decision(true, 'access_granted', $schedule['message'], [
            ...$identity,
            'schedule_id' => $schedule['schedule_id'],
            'override_id' => $schedule['override_id'],
            'schedule_kind' => $schedule['schedule_kind'],
            // The 15-minute reminder: remaining time, the schedule end and the server time.
            ...ScheduleAccessPolicy::reminderFields($schedule['time_end'] ?? null, $now),
        ]);
    }

    /**
     * Emergency access cards from DOOR_EMERGENCY_RFID_UIDS (comma-separated
     * 10-digit hex UIDs, e.g. "0A1B2C3D4E"). Unset or empty = none.
     *
     * @return list<string>
     */
    public static function emergencyCardUids(): array
    {
        $configured = getenv('DOOR_EMERGENCY_RFID_UIDS');
        if (!is_string($configured)) return [];
        $uids = array_map(static fn (string $uid): string => strtoupper(trim($uid)), explode(',', $configured));
        return array_values(array_filter($uids, static fn (string $uid): bool => preg_match('/^[A-F0-9]{10}$/D', $uid) === 1));
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
