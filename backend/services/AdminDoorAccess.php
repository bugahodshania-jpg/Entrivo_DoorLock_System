<?php

require_once __DIR__ . '/../config/connection.php';

/**
 * Door entry of Admin accounts. By default an Admin enters the room any time,
 * without a schedule (permanent override). A Super Admin can set an Admin to
 * "needs a schedule": that Admin then enters like faculty, with a current
 * approved regular or override schedule. Super Admins always enter any time.
 * A row in admin_schedule_required = that Admin needs a schedule.
 */
final class AdminDoorAccess
{
    /** DDL commits implicitly: call outside a transaction. */
    public static function ensureSchema(PDO $pdo): void
    {
        $pdo->exec('CREATE TABLE IF NOT EXISTS admin_schedule_required (
            user_id INT NOT NULL PRIMARY KEY,
            set_by INT NULL DEFAULT NULL,
            set_at DATETIME NOT NULL
        )');
    }

    /** Whether this account enters the door any time, without a schedule. */
    public static function entersAnyTime(PDO $pdo, int $userId, ?string $role): bool
    {
        $role = strtolower(trim((string) $role));
        if ($role === 'super_admin') return true;
        if ($role !== 'admin') return false;
        return !isset(array_flip(self::scheduleRequiredUserIds($pdo))[$userId]);
    }

    /** @return list<int> Admins a Super Admin set to need a schedule. */
    public static function scheduleRequiredUserIds(PDO $pdo): array
    {
        try {
            $ids = $pdo->query('SELECT user_id FROM admin_schedule_required ORDER BY user_id')->fetchAll(PDO::FETCH_COLUMN) ?: [];
        } catch (PDOException) {
            return []; // table not created yet: every Admin enters any time
        }
        return array_map('intval', $ids);
    }

    public static function set(PDO $pdo, int $userId, bool $anyTime, int $actorId): void
    {
        self::ensureSchema($pdo);
        if ($anyTime) {
            $pdo->prepare('DELETE FROM admin_schedule_required WHERE user_id = ?')->execute([$userId]);
            return;
        }
        $pdo->prepare('INSERT INTO admin_schedule_required (user_id, set_by, set_at) VALUES (?, ?, NOW())
            ON DUPLICATE KEY UPDATE set_by = VALUES(set_by), set_at = NOW()')->execute([$userId, $actorId]);
    }
}
