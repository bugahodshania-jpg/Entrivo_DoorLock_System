<?php

/**
 * One row per door event the controller has numbered (event_id), so an exit
 * is written to access_log exactly once: online, or later from the
 * controller's offline queue, never both.
 */
final class DoorEventLog
{
    public static function validId(mixed $value): ?string
    {
        return is_string($value) && preg_match('/^[a-f0-9]{32}$/D', $value) === 1 ? $value : null;
    }

    /** Creates the table when missing. DDL commits implicitly, so never inside a transaction. */
    public static function ensure(PDO $pdo): void
    {
        try {
            $pdo->query('SELECT 1 FROM door_event_log LIMIT 0');
            return;
        } catch (PDOException) {
            // Missing table: create it below.
        }
        if ($pdo->inTransaction()) {
            throw new RuntimeException('Create door_event_log before beginning a transaction.');
        }
        $pdo->exec('CREATE TABLE IF NOT EXISTS door_event_log (
            event_id CHAR(32) NOT NULL PRIMARY KEY,
            log_id INT NULL,
            recorded_at DATETIME NOT NULL
        ) ENGINE=InnoDB');
    }

    /** True when this event already has its access log. Locks the row inside a transaction. */
    public static function seen(PDO $pdo, string $eventId): bool
    {
        $query = $pdo->prepare('SELECT 1 FROM door_event_log WHERE event_id = ? FOR UPDATE');
        $query->execute([$eventId]);
        return $query->fetchColumn() !== false;
    }

    public static function remember(PDO $pdo, string $eventId, ?int $logId, DateTimeImmutable $now): void
    {
        $pdo->prepare('INSERT IGNORE INTO door_event_log (event_id, log_id, recorded_at) VALUES (?, ?, ?)')
            ->execute([$eventId, $logId, $now->format('Y-m-d H:i:s')]);
    }
}
