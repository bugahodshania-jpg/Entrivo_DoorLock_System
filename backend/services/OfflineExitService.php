<?php

require_once __DIR__ . '/AccessLogSchema.php';
require_once __DIR__ . '/DoorEventLog.php';
require_once __DIR__ . '/ScheduleAccessPolicy.php';

/**
 * Exits the door controller allowed while the backend was unreachable. The
 * door already opened, so this is a record, not a decision: it is always
 * written as a granted OUT at the time it happened, linked to whoever the
 * card or fingerprint slot belongs to (or to no one for an unknown card).
 * Each event_id is written once, even when an upload is retried.
 */
final class OfflineExitService
{
    /** Older reports are still recorded, but their time is not trusted past this. */
    private const MAX_AGE_SECONDS = 30 * 24 * 3600;

    public function __construct(private PDO $pdo)
    {
    }

    public function record(array $input, ?DateTimeImmutable $now = null): array
    {
        $now = ($now ?? new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->setTimezone(new DateTimeZone('Asia/Manila'));
        $eventId = DoorEventLog::validId($input['event_id'] ?? null);
        $method = $input['method'] ?? null;
        $uid = is_string($input['rfid_uid'] ?? null) ? strtoupper(trim($input['rfid_uid'])) : '';
        $slot = filter_var($input['matched_slot'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 65535]]);
        $deviceId = filter_var($input['enrollment_device_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $validCredential = ($method === 'rfid' && preg_match('/^[A-F0-9]{10}$/D', $uid) === 1)
            || ($method === 'fingerprint' && $slot !== false);
        if ($eventId === null || $deviceId === false || !$validCredential || ($input['direction'] ?? 'exit') !== 'exit') {
            return ['success' => false, 'recorded' => false, 'reason' => 'invalid_request',
                'message' => 'An offline exit needs a 32-hex event_id, the device, and a card UID or sensor slot.'];
        }
        // When it happened: the controller reports how long ago, when it knows.
        $age = filter_var($input['age_seconds'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        $at = $age === false ? $now : $now->modify('-' . min($age, self::MAX_AGE_SECONDS) . ' seconds');

        DoorEventLog::ensure($this->pdo);
        AccessLogSchema::ensureRfidUid($this->pdo);
        $hasAccessType = AccessLogSchema::hasColumn($this->pdo, 'access_log', 'access_type');
        $this->pdo->beginTransaction();
        try {
            if (DoorEventLog::seen($this->pdo, $eventId)) {
                $this->pdo->commit();
                return ['success' => true, 'recorded' => false, 'duplicate' => true, 'message' => 'This exit is already in the access log.'];
            }
            $identity = $method === 'rfid' ? $this->cardOwner($uid) : $this->slotOwner((int) $deviceId, (int) $slot);
            $exit = $identity['user_id'] !== null
                ? ScheduleAccessPolicy::exitFields((new ScheduleAccessPolicy($this->pdo))->exitContext($identity['user_id'], $at))
                : ['schedule_id' => null, 'override_id' => null];

            $extraColumn = $hasAccessType ? ',access_type' : '';
            $extraValue = $hasAccessType ? ",'OUT'" : '';
            $this->pdo->prepare("INSERT INTO access_log
                (user_id,card_id,rfid_uid,fingerprint_id,schedule_id,override_id,access_timestamp,access_status,denial_reason,method_access{$extraColumn})
                VALUES (?,?,?,?,?,?,?,'granted',NULL,?{$extraValue})")
                ->execute([
                    $identity['user_id'], $identity['card_id'], $method === 'rfid' ? $uid : null, $identity['fingerprint_id'],
                    $exit['schedule_id'], $exit['override_id'], $at->format('Y-m-d H:i:s'),
                    $method === 'rfid' ? 'RFID' : 'Fingerprint',
                ]);
            $logId = (int) $this->pdo->lastInsertId();
            DoorEventLog::remember($this->pdo, $eventId, $logId, $now);
            $this->pdo->commit();
            return ['success' => true, 'recorded' => true, 'log_id' => $logId, 'user_id' => $identity['user_id'],
                'access_timestamp' => $at->format('Y-m-d H:i:s'), 'message' => 'Offline exit recorded.'];
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw $error;
        }
    }

    /** @return array{user_id: ?int, card_id: ?int, fingerprint_id: ?int} */
    private function cardOwner(string $uid): array
    {
        $query = $this->pdo->prepare('SELECT c.card_id, u.id AS user_id FROM rfid_cards c LEFT JOIN users u ON u.id = c.user_id WHERE UPPER(c.rfid_uid) = ?');
        $query->execute([$uid]);
        $rows = $query->fetchAll(PDO::FETCH_ASSOC);
        // An unknown or ambiguous card is still logged, by its UID only.
        if (count($rows) !== 1) return ['user_id' => null, 'card_id' => null, 'fingerprint_id' => null];
        return ['user_id' => $rows[0]['user_id'] !== null ? (int) $rows[0]['user_id'] : null,
            'card_id' => (int) $rows[0]['card_id'], 'fingerprint_id' => null];
    }

    /** @return array{user_id: ?int, card_id: ?int, fingerprint_id: ?int} */
    private function slotOwner(int $deviceId, int $slot): array
    {
        $query = $this->pdo->prepare('SELECT fingerprint_id, user_id FROM fingerprints WHERE enrollment_device_id = ? AND enrollment_slot = ?');
        $query->execute([$deviceId, $slot]);
        $rows = $query->fetchAll(PDO::FETCH_ASSOC);
        if (count($rows) !== 1) return ['user_id' => null, 'card_id' => null, 'fingerprint_id' => null];
        return ['user_id' => (int) $rows[0]['user_id'], 'card_id' => null, 'fingerprint_id' => (int) $rows[0]['fingerprint_id']];
    }
}
