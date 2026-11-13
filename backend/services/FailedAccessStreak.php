<?php

/**
 * Failed door access attempts in a row by the same person, for the portal's
 * Security Warning (shown from the 3rd failure on).
 *
 * "Same person" is the account; an unregistered card by its UID; unregistered
 * fingerprints all together. The run counts back from the attempt to that
 * person's last granted access, within WINDOW_MINUTES before the attempt.
 */
final class FailedAccessStreak
{
    public const WINDOW_MINUTES = 10;

    /** @param array $row An access_log row with log_id, access_status, user_id, method_access, rfid_uid, access_timestamp. */
    public static function count(PDO $pdo, array $row, bool $hasRfidUid = true): int
    {
        if (($row['access_status'] ?? '') !== 'denied') return 0;
        if ($row['user_id'] !== null) {
            $who = 'user_id = ?';
            $key = [(int) $row['user_id']];
        } elseif (($row['method_access'] ?? '') === 'RFID' && $hasRfidUid && (string) ($row['rfid_uid'] ?? '') !== '') {
            $who = 'user_id IS NULL AND rfid_uid = ?';
            $key = [(string) $row['rfid_uid']];
        } elseif (($row['method_access'] ?? '') === 'Fingerprint') {
            $who = "user_id IS NULL AND method_access = 'Fingerprint'";
            $key = [];
        } else {
            return 1; // Nothing to group by: count this attempt alone.
        }
        $since = (new DateTimeImmutable((string) $row['access_timestamp'], new DateTimeZone('Asia/Manila')))
            ->modify('-' . self::WINDOW_MINUTES . ' minutes')->format('Y-m-d H:i:s');
        $recent = $pdo->prepare("SELECT access_status FROM access_log
            WHERE {$who} AND log_id <= ? AND access_timestamp >= ?
            ORDER BY log_id DESC LIMIT 50");
        $recent->execute([...$key, (int) $row['log_id'], $since]);
        $count = 0;
        foreach ($recent->fetchAll(PDO::FETCH_COLUMN) as $status) {
            if ($status !== 'denied') break;
            $count++;
        }
        return max(1, $count);
    }
}
