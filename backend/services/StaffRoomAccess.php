<?php

require_once __DIR__ . '/../config/connection.php';

/**
 * Staff room hours. The room's daily hours (default 06:00-21:00, per door)
 * and the staff members a Super Admin has allowed to enter during them
 * without a schedule, for example to clean or prepare the room. Least
 * privilege: nobody is allowed until a Super Admin turns it on for that
 * person, it applies only to staff accounts, and it changes nothing in the
 * portal (their privileges stay those of a staff account). Outside the room
 * hours they still need a schedule or an approved override.
 */
final class StaffRoomAccess
{
    public const DEFAULT_START = '06:00:00';
    public const DEFAULT_END = '21:00:00';

    /** DDL commits implicitly: call outside a transaction. */
    public static function ensureSchema(PDO $pdo): void
    {
        $pdo->exec('CREATE TABLE IF NOT EXISTS staff_room_access (
            user_id INT NOT NULL PRIMARY KEY,
            granted_by INT NULL DEFAULT NULL,
            granted_at DATETIME NOT NULL
        )');
        require_once __DIR__ . '/DoorControlService.php';
        DoorControlService::ensureSchema($pdo);
        foreach (['room_hours_start', 'room_hours_end'] as $column) {
            if ($pdo->query("SHOW COLUMNS FROM door_controller_controls LIKE '{$column}'")->fetch()) continue;
            try {
                $pdo->exec("ALTER TABLE door_controller_controls ADD COLUMN {$column} TIME NULL DEFAULT NULL");
            } catch (PDOException $error) {
                if ((int) ($error->errorInfo[1] ?? 0) !== 1060) throw $error; // added meanwhile
            }
        }
    }

    /** @return array{start: string, end: string} HH:MM:SS, defaults until a Super Admin sets them */
    public static function hours(PDO $pdo, int $deviceId = 1): array
    {
        try {
            $query = $pdo->prepare('SELECT room_hours_start, room_hours_end FROM door_controller_controls WHERE device_id = ?');
            $query->execute([$deviceId]);
            $row = $query->fetch(PDO::FETCH_ASSOC);
        } catch (PDOException) {
            $row = false; // table or columns not created yet
        }
        $start = is_array($row) ? (string) ($row['room_hours_start'] ?? '') : '';
        $end = is_array($row) ? (string) ($row['room_hours_end'] ?? '') : '';
        if (!self::validTime($start) || !self::validTime($end) || $end <= $start) {
            return ['start' => self::DEFAULT_START, 'end' => self::DEFAULT_END];
        }
        return ['start' => $start, 'end' => $end];
    }

    public static function isAllowed(PDO $pdo, int $userId): bool
    {
        try {
            $query = $pdo->prepare('SELECT 1 FROM staff_room_access WHERE user_id = ?');
            $query->execute([$userId]);
            return (bool) $query->fetchColumn();
        } catch (PDOException) {
            return false; // table not created yet: nobody is allowed
        }
    }

    /** @return list<int> */
    public static function allowedUserIds(PDO $pdo): array
    {
        try {
            return array_map('intval', $pdo->query('SELECT user_id FROM staff_room_access ORDER BY user_id')->fetchAll(PDO::FETCH_COLUMN));
        } catch (PDOException) {
            return [];
        }
    }

    /**
     * Entry decision for an allowed staff member at $now (Asia/Manila), when
     * no schedule applies. Null when room hours do not apply to them.
     * @return array{granted: bool, reason: string, time_end: ?string}|null
     */
    public static function evaluate(PDO $pdo, int $userId, ?string $role, DateTimeImmutable $now, int $deviceId = 1): ?array
    {
        if (strtolower(trim((string) $role)) !== 'staff' || !self::isAllowed($pdo, $userId)) return null;
        $hours = self::hours($pdo, $deviceId);
        $time = $now->setTimezone(new DateTimeZone('Asia/Manila'))->format('H:i:s');
        if ($time >= $hours['start'] && $time < $hours['end']) {
            return ['granted' => true, 'reason' => 'access_granted', 'time_end' => $hours['end']];
        }
        return ['granted' => false, 'reason' => $time < $hours['start'] ? 'schedule_not_started' : 'expired_schedule', 'time_end' => null];
    }

    public static function validTime(string $value): bool
    {
        return preg_match('/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/D', $value) === 1;
    }

    /** "06:00:00" -> "6:00 AM" */
    public static function label(string $time): string
    {
        return (new DateTimeImmutable('2000-01-01 ' . $time))->format('g:i A');
    }
}
