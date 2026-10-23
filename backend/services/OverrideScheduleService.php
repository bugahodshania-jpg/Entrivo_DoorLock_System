<?php

require_once __DIR__ . '/NotificationService.php';
require_once __DIR__ . '/ScheduleStatusService.php';

/** Admin-created override schedules: keep the regular row, stamp it, and notify the owner. */
final class OverrideScheduleService
{
    public function __construct(private PDO $pdo)
    {
    }

    public function ensureStampColumn(): void
    {
        try {
            $this->pdo->query('SELECT overridden_by_schedule_id FROM schedules LIMIT 0')->closeCursor();
            return;
        } catch (PDOException $error) {
            $missing = ($error->errorInfo[0] ?? '') === '42S02'
                || str_contains($error->getMessage(), 'no such column: overridden_by_schedule_id')
                || str_contains($error->getMessage(), "Unknown column 'overridden_by_schedule_id'");
            if (!$missing) {
                throw $error;
            }
        }

        $sqlite = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
        $this->pdo->exec(
            $sqlite
                ? 'ALTER TABLE schedules ADD COLUMN overridden_by_schedule_id INTEGER NULL'
                : 'ALTER TABLE schedules ADD COLUMN overridden_by_schedule_id INT NULL AFTER approved_at'
        );
    }

    public function preview(int $userId, string $date, string $timeStart, string $timeEnd, int $sourceScheduleId = 0, int $excludeScheduleId = 0): array
    {
        $this->ensureStampColumn();
        $start = self::normalizeTime($timeStart);
        $end = self::normalizeTime($timeEnd);
        $affected = $this->mergeSourceSchedule(
            $this->findOverlappingRegulars($userId, $date, $start, $end),
            $sourceScheduleId,
        );
        $sourceOwnerId = $this->scheduleOwnerId($sourceScheduleId);
        $others = array_values(array_filter(
            $this->findOtherAffectedUsers($userId, $date, $start, $end),
            static fn (array $user): bool => $sourceOwnerId <= 0 || (int) $user['userId'] !== $sourceOwnerId,
        ));

        return [
            'affected' => $affected,
            'blockingOverrides' => $this->findOverlappingOverrides($userId, $date, $start, $end, $excludeScheduleId),
            'others' => $others,
        ];
    }

    /**
     * Create an approved override as a NEW schedule row. The overlapping regular
     * schedule keeps its times and kind; it is only stamped as overridden.
     */
    public function createFromAdmin(array $payload): array
    {
        $userId = (int) ($payload['userId'] ?? 0);
        $date = (string) ($payload['scheduleDate'] ?? '');
        $timeStart = self::normalizeTime((string) ($payload['timeStart'] ?? ''));
        $timeEnd = self::normalizeTime((string) ($payload['timeEnd'] ?? ''));
        $gracePeriodMinutes = (int) ($payload['gracePeriodMinutes'] ?? 15);
        $createdBy = isset($payload['createdBy']) ? (int) $payload['createdBy'] : 0;
        $sourceScheduleId = (int) ($payload['sourceScheduleId'] ?? 0);
        $reason = trim((string) ($payload['reason'] ?? ''));
        $requesterName = trim((string) ($payload['requesterName'] ?? ''));

        if ($userId <= 0 || !self::validDate($date) || $timeStart === null || $timeEnd === null || $timeEnd <= $timeStart) {
            throw new InvalidArgumentException('A valid user, date, and time window are required.');
        }

        if ($createdBy <= 0) {
            throw new InvalidArgumentException('An approving administrator is required.');
        }

        if ($reason === '') {
            $reason = 'An administrator created an override schedule.';
        }

        $preview = $this->preview($userId, $date, $timeStart, $timeEnd, $sourceScheduleId);
        if ($preview['blockingOverrides'] !== []) {
            throw new RuntimeException('This override overlaps another override. An approved override can share a time with one regular schedule only.');
        }

        $notifications = new NotificationService($this->pdo);
        $notifications->ensureSchema();

        $overrideStart = $date . ' ' . $timeStart;
        $overrideEnd = $date . ' ' . $timeEnd;
        $approvedAt = (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d H:i:s');
        $requesterName = $requesterName !== '' ? $requesterName : $this->userDisplayName($userId);

        $this->pdo->beginTransaction();

        try {
            $insertOverride = $this->pdo->prepare(
                'INSERT INTO access_overrides (user_id, approved_by, reason, override_start, override_end)
                 VALUES (:user_id, :approved_by, :reason, :override_start, :override_end)'
            );
            $insertOverride->execute([
                ':user_id' => $userId,
                ':approved_by' => $createdBy,
                ':reason' => $reason,
                ':override_start' => $overrideStart,
                ':override_end' => $overrideEnd,
            ]);
            $overrideId = (int) $this->pdo->lastInsertId();

            $insertSchedule = $this->pdo->prepare(
                "INSERT INTO schedules (
                    user_id, schedule_type, schedule_kind, schedule_date, time_start, time_end,
                    start_date, end_date, repeat_type, repeat_days, repeat_day,
                    grace_period_minutes, status, created_by, approved_by, approved_at
                 ) VALUES (
                    :user_id, 'single', 'override', :schedule_date, :time_start, :time_end,
                    NULL, NULL, 'none', NULL, NULL,
                    :grace_period_minutes, 'approved', :created_by, :approved_by, :approved_at
                 )"
            );
            $insertSchedule->execute([
                ':user_id' => $userId,
                ':schedule_date' => $date,
                ':time_start' => $timeStart,
                ':time_end' => $timeEnd,
                ':grace_period_minutes' => $gracePeriodMinutes,
                ':created_by' => $createdBy,
                ':approved_by' => $createdBy,
                ':approved_at' => $approvedAt,
            ]);
            $scheduleId = (int) $this->pdo->lastInsertId();

            $affected = $this->stampOverlappingRegulars($userId, $date, $timeStart, $timeEnd, $scheduleId, $sourceScheduleId);
            $notificationIds = $notifications->createForApprovedOverride([
                'id' => $overrideId,
                'name' => $requesterName !== '' ? $requesterName : 'Another user',
            ], true);

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $error;
        }

        return [
            'overrideId' => $overrideId,
            'scheduleId' => $scheduleId,
            'affectedSchedules' => $affected,
            'notificationIds' => $notificationIds,
        ];
    }

    public function stampOverlappingRegulars(int $userId, string $date, string $timeStart, string $timeEnd, int $overrideScheduleId, int $sourceScheduleId = 0): array
    {
        $this->ensureStampColumn();
        $start = self::normalizeTime($timeStart);
        $end = self::normalizeTime($timeEnd);
        $regulars = $this->mergeSourceSchedule(
            $this->findOverlappingRegulars($userId, $date, $start, $end, $overrideScheduleId),
            $sourceScheduleId,
        );

        if ($regulars === []) {
            return [];
        }

        $ids = array_values(array_unique(array_map(static fn (array $row): int => (int) $row['id'], $regulars)));
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $statement = $this->pdo->prepare(
            "UPDATE schedules
             SET overridden_by_schedule_id = ?
             WHERE schedule_id IN ({$placeholders})
               AND COALESCE(schedule_kind, 'regular') = 'regular'"
        );
        $statement->execute([$overrideScheduleId, ...$ids]);

        return $this->schedulesByIds($ids);
    }

    private function findOverlappingRegulars(int $userId, string $date, string $timeStart, string $timeEnd, int $excludeId = 0): array
    {
        return $this->findOverlapping($userId, $date, $timeStart, $timeEnd, 'regular', $excludeId);
    }

    private function findOverlappingOverrides(int $userId, string $date, string $timeStart, string $timeEnd, int $excludeId = 0): array
    {
        return $this->findOverlapping(0, $date, $timeStart, $timeEnd, 'override', $excludeId, false);
    }

    private function findOverlapping(int $userId, string $date, string $timeStart, string $timeEnd, string $kind, int $excludeId = 0, bool $openStatusesOnly = true): array
    {
        $statusSql = $openStatusesOnly
            ? "s.status IN ('pending', 'approved', 'overridden')"
            : "s.status <> 'cancelled'";
        $sql = "SELECT s.schedule_id, s.user_id, s.schedule_type, s.schedule_kind, s.schedule_date,
                       s.time_start, s.time_end, s.status, s.overridden_by_schedule_id, s.grace_period_minutes,
                       s.created_at, u.username, u.email
                FROM schedules s
                INNER JOIN users u ON u.id = s.user_id
                WHERE s.schedule_date = :schedule_date
                  AND s.time_start < :time_end
                  AND s.time_end > :time_start
                  AND {$statusSql}
                  AND COALESCE(s.schedule_kind, 'regular') = :kind";
        $params = [
            ':schedule_date' => $date,
            ':time_end' => $timeEnd,
            ':time_start' => $timeStart,
            ':kind' => $kind,
        ];

        if ($userId > 0) {
            $sql .= ' AND s.user_id = :user_id';
            $params[':user_id'] = $userId;
        }

        if ($excludeId > 0) {
            $sql .= ' AND s.schedule_id <> :exclude_id';
            $params[':exclude_id'] = $excludeId;
        }

        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);

        return array_map(fn (array $row): array => $this->mapScheduleRow($row), $statement->fetchAll(PDO::FETCH_ASSOC));
    }

    private function findOtherAffectedUsers(int $userId, string $date, string $timeStart, string $timeEnd): array
    {
        $start = new DateTimeImmutable($date . ' ' . $timeStart, new DateTimeZone('Asia/Manila'));
        $end = new DateTimeImmutable($date . ' ' . $timeEnd, new DateTimeZone('Asia/Manila'));
        $statement = $this->pdo->prepare(
            "SELECT s.*, u.email, u.username
             FROM schedules s
             INNER JOIN users u ON u.id = s.user_id
             WHERE s.user_id <> :user_id AND u.is_active = 1
               AND s.status IN ('approved', 'overridden')
               AND s.time_start < :time_end AND s.time_end > :time_start
               AND ((s.schedule_type = 'single' AND s.schedule_date = :single_date)
                 OR (s.schedule_type = 'recurring' AND s.start_date <= :range_end AND s.end_date >= :range_start))"
        );
        $statement->execute([
            ':user_id' => $userId,
            ':time_start' => $timeStart,
            ':time_end' => $timeEnd,
            ':single_date' => $date,
            ':range_start' => $date,
            ':range_end' => $date,
        ]);

        $users = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $schedule) {
            if (($schedule['schedule_kind'] ?? 'regular') === 'override') {
                continue;
            }
            if (NotificationService::affectedOccurrences($schedule, $start, $end) === []) {
                continue;
            }
            $otherId = (int) $schedule['user_id'];
            $users[$otherId] ??= [
                'userId' => $otherId,
                'name' => trim((string) ($schedule['username'] ?? '')) ?: 'Another user',
                'email' => (string) ($schedule['email'] ?? ''),
            ];
        }

        return array_values($users);
    }

    private function mergeSourceSchedule(array $affected, int $sourceScheduleId): array
    {
        if ($sourceScheduleId <= 0) {
            return $affected;
        }

        $source = $this->schedulesByIds([$sourceScheduleId])[0] ?? null;
        if (!$source || ($source['scheduleKind'] ?? 'regular') !== 'regular') {
            return $affected;
        }

        foreach ($affected as $schedule) {
            if ((int) $schedule['id'] === $sourceScheduleId) {
                return $affected;
            }
        }

        array_unshift($affected, $source);
        return $affected;
    }

    private function scheduleOwnerId(int $scheduleId): int
    {
        if ($scheduleId <= 0) {
            return 0;
        }

        $statement = $this->pdo->prepare('SELECT user_id FROM schedules WHERE schedule_id = ?');
        $statement->execute([$scheduleId]);
        return (int) $statement->fetchColumn();
    }

    private function schedulesByIds(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $statement = $this->pdo->prepare(
            "SELECT s.schedule_id, s.user_id, s.schedule_type, s.schedule_kind, s.schedule_date,
                    s.time_start, s.time_end, s.status, s.overridden_by_schedule_id, s.grace_period_minutes,
                    s.created_at, u.username, u.email
             FROM schedules s
             INNER JOIN users u ON u.id = s.user_id
             WHERE s.schedule_id IN ({$placeholders})"
        );
        $statement->execute($ids);

        return array_map(fn (array $row): array => $this->mapScheduleRow($row), $statement->fetchAll(PDO::FETCH_ASSOC));
    }

    private function mapScheduleRow(array $row): array
    {
        $date = substr((string) ($row['schedule_date'] ?? ''), 0, 10);
        $timeStart = self::normalizeTime((string) ($row['time_start'] ?? '')) ?? (string) $row['time_start'];
        $timeEnd = self::normalizeTime((string) ($row['time_end'] ?? '')) ?? (string) $row['time_end'];
        $createdAt = (string) ($row['created_at'] ?? '');

        return ScheduleStatusService::normalizeSchedule([
            'id' => (int) $row['schedule_id'],
            'userId' => (int) $row['user_id'],
            'scheduleType' => $row['schedule_type'] ?? 'single',
            'scheduleKind' => $row['schedule_kind'] ?? 'regular',
            'scheduleDate' => $date,
            'scheduleDateLabel' => self::formatDateLabel($date),
            'timeStart' => substr($timeStart, 0, 5),
            'timeEnd' => substr($timeEnd, 0, 5),
            'timeStartLabel' => self::formatTimeLabel($timeStart),
            'timeEndLabel' => self::formatTimeLabel($timeEnd),
            'window' => self::formatTimeLabel($timeStart) . ' - ' . self::formatTimeLabel($timeEnd),
            'gracePeriodMinutes' => (int) ($row['grace_period_minutes'] ?? 15),
            'status' => $row['status'] ?? 'pending',
            'overriddenByScheduleId' => $row['overridden_by_schedule_id'] ?? null,
            'ownerName' => $this->scheduleOwnerName((int) $row['user_id'], (string) ($row['username'] ?? '')),
            'ownerIdentifier' => $this->scheduleOwnerIdentifier((int) $row['user_id']) ?: 'No ID',
            'createdAt' => self::formatCreatedAt($createdAt),
            'createdAtValue' => $createdAt,
        ]);
    }

    private function scheduleOwnerName(int $userId, string $fallback): string
    {
        $name = $this->userDisplayName($userId);
        return $name !== '' ? $name : ($fallback !== '' ? $fallback : 'Unknown User');
    }

    private function scheduleOwnerIdentifier(int $userId): string
    {
        if (!$this->hasUserInfoTables()) {
            return '';
        }

        $statement = $this->pdo->prepare(
            "SELECT COALESCE(si.school_id, fi.employee_id, st.employee_id, ai.employee_id, '') AS identifier
             FROM users u
             LEFT JOIN student_info si ON si.user_id = u.id
             LEFT JOIN faculty_info fi ON fi.user_id = u.id AND si.user_id IS NULL
             LEFT JOIN staff_info st ON st.user_id = u.id AND si.user_id IS NULL AND fi.user_id IS NULL
             LEFT JOIN admin_info ai ON ai.user_id = u.id AND si.user_id IS NULL AND fi.user_id IS NULL AND st.user_id IS NULL
             WHERE u.id = ?"
        );
        $statement->execute([$userId]);
        return trim((string) $statement->fetchColumn());
    }

    public function userDisplayName(int $userId): string
    {
        if ($this->hasUserInfoTables()) {
            $statement = $this->pdo->prepare(
                "SELECT COALESCE(
                    NULLIF(TRIM(CONCAT_WS(' ', si.first_name, si.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', fi.first_name, fi.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', st.first_name, st.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), ''),
                    u.username,
                    ''
                 ) AS display_name
                 FROM users u
                 LEFT JOIN student_info si ON si.user_id = u.id
                 LEFT JOIN faculty_info fi ON fi.user_id = u.id AND si.user_id IS NULL
                 LEFT JOIN staff_info st ON st.user_id = u.id AND si.user_id IS NULL AND fi.user_id IS NULL
                 LEFT JOIN admin_info ai ON ai.user_id = u.id AND si.user_id IS NULL AND fi.user_id IS NULL AND st.user_id IS NULL
                 WHERE u.id = ?"
            );
            $statement->execute([$userId]);
            return trim((string) $statement->fetchColumn());
        }

        $statement = $this->pdo->prepare('SELECT username FROM users WHERE id = ?');
        $statement->execute([$userId]);
        return trim((string) $statement->fetchColumn());
    }

    private function hasUserInfoTables(): bool
    {
        static $has = null;

        if ($has !== null) {
            return $has;
        }

        try {
            $this->pdo->query('SELECT 1 FROM student_info LIMIT 0')->closeCursor();
            $has = true;
        } catch (Throwable $error) {
            $has = false;
        }

        return $has;
    }

    private static function normalizeTime(string $value): ?string
    {
        if (!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/D', $value)) {
            return null;
        }

        return strlen($value) === 5 ? $value . ':00' : $value;
    }

    private static function validDate(string $value): bool
    {
        return (bool) preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $value, $parts)
            && checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1]);
    }

    private static function formatTimeLabel(string $time): string
    {
        $date = DateTimeImmutable::createFromFormat('!H:i:s', $time, new DateTimeZone('Asia/Manila'));
        return $date ? $date->format('g:i A') : $time;
    }

    private static function formatDateLabel(string $date): string
    {
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date, new DateTimeZone('Asia/Manila'));
        return $parsed ? $parsed->format('l, M j, Y') : $date;
    }

    private static function formatCreatedAt(string $value): string
    {
        $parsed = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $value, new DateTimeZone('Asia/Manila'));
        if (!$parsed) {
            $parsed = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', str_replace('T', ' ', substr($value, 0, 19)), new DateTimeZone('Asia/Manila'));
        }

        return $parsed ? $parsed->format('M j, Y g:i A') : $value;
    }
}
