<?php

require_once __DIR__ . '/AccessEventType.php';

/**
 * Who is using the door while it is unlocked: the person behind the latest
 * granted entry, which is what unlocked it. Shown when the header door
 * status card is clicked.
 */
final class DoorOccupant
{
    // An entry older than this is not treated as the current user of an unlocked door.
    public const MAX_AGE_HOURS = 12;

    /** @param list<string> $emergencyUids Upper-case emergency card UIDs. */
    public static function current(PDO $pdo, array $emergencyUids = []): ?array
    {
        $columns = array_flip($pdo->query('SHOW COLUMNS FROM access_log')->fetchAll(PDO::FETCH_COLUMN));
        $optional = static fn (string $column) => isset($columns[$column]) ? "access_log.{$column}" : "NULL";
        $hasScheduleKind = (bool) $pdo->query("SHOW COLUMNS FROM schedules LIKE 'schedule_kind'")->fetch();
        $entryOnly = isset($columns['access_type']) ? "AND (access_log.access_type IS NULL OR access_log.access_type <> 'OUT')" : '';

        $statement = $pdo->prepare(
            "SELECT
                access_log.log_id,
                access_log.user_id,
                access_log.schedule_id,
                access_log.access_status,
                access_log.method_access,
                DATE_FORMAT(access_log.access_timestamp, '%h:%i:%s %p') AS entered_time,
                DATE_FORMAT(access_log.access_timestamp, '%b %e, %Y') AS entered_date,
                " . $optional('override_id') . " AS override_id,
                " . $optional('access_type') . " AS access_type,
                " . $optional('rfid_uid') . " AS rfid_uid,
                " . ($hasScheduleKind ? 'linked_schedule.schedule_kind' : 'NULL') . " AS schedule_kind,
                linked_schedule.status AS schedule_status,
                TIME_FORMAT(linked_schedule.time_start, '%h:%i %p') AS schedule_start,
                TIME_FORMAT(linked_schedule.time_end, '%h:%i %p') AS schedule_end,
                COALESCE(
                    NULLIF(TRIM(CONCAT_WS(' ', student_info.first_name, student_info.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', faculty_info.first_name, faculty_info.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', staff_info.first_name, staff_info.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', admin_info.first_name, admin_info.last_name)), ''),
                    users.username
                ) AS user_name,
                users.role AS user_role,
                COALESCE(student_info.school_id, faculty_info.employee_id, staff_info.employee_id, admin_info.employee_id) AS user_identifier
             FROM access_log
             LEFT JOIN users ON users.id = access_log.user_id
             LEFT JOIN schedules AS linked_schedule ON linked_schedule.schedule_id = access_log.schedule_id
             LEFT JOIN student_info ON student_info.user_id = users.id
             LEFT JOIN faculty_info ON faculty_info.user_id = users.id
             LEFT JOIN staff_info ON staff_info.user_id = users.id
             LEFT JOIN admin_info ON admin_info.user_id = users.id
             WHERE access_log.access_status = 'granted' {$entryOnly}
               AND access_log.access_timestamp >= NOW() - INTERVAL " . self::MAX_AGE_HOURS . " HOUR
             ORDER BY access_log.log_id DESC
             LIMIT 1"
        );
        $statement->execute();
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) return null;

        $type = AccessEventType::classify($row, $emergencyUids);
        $name = $row['user_name'];
        if ($name === null && $type === 'emergency_card') $name = 'Emergency card';
        return [
            'log_id' => (int) $row['log_id'],
            'user_id' => $row['user_id'] !== null ? (int) $row['user_id'] : null,
            'name' => $name ?? 'Unknown person',
            'role' => $row['user_role'],
            'identifier' => $row['user_identifier'],
            'method' => $row['method_access'],
            'access_type' => $type,
            'entered_time' => $row['entered_time'],
            'entered_date' => $row['entered_date'],
            'schedule' => $row['schedule_start'] !== null ? $row['schedule_start'] . ' – ' . $row['schedule_end'] : null,
        ];
    }
}
