<?php

/**
 * Builds the five classroom reports from access_log and schedules.
 * Occupancy ("still inside") is reported only when this period contains
 * recorded exit scans (access_type = OUT). Entry-only logs are not treated
 * as proof that a user is still in the room.
 */
class ReportsService
{
    private PDO $pdo;
    private bool $hasAccessType = false;
    private bool $hasScheduleKind = false;
    private bool $hasDenialReason = false;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
        $this->hasAccessType = (bool) $pdo->query("SHOW COLUMNS FROM access_log LIKE 'access_type'")->fetch();
        $this->hasScheduleKind = (bool) $pdo->query("SHOW COLUMNS FROM schedules LIKE 'schedule_kind'")->fetch();
        $this->hasDenialReason = (bool) $pdo->query("SHOW COLUMNS FROM access_log LIKE 'denial_reason'")->fetch();
    }

    public function build(string $dateFrom, string $dateTo, string $role, string $search = ''): array
    {
        $logs = $this->loadAccessLogs($dateFrom, $dateTo, $role, 0);
        $occurrences = $this->loadOccurrences($dateFrom, $dateTo, $role, 0);
        $search = trim($search);

        if ($search !== '') {
            $logs = array_values(array_filter(
                $logs,
                fn (array $log) => $this->recordMatches($log['userName'], $log['identifier'], $log['userId'], $search)
            ));
            $occurrences = array_values(array_filter(
                $occurrences,
                fn (array $row) => $this->recordMatches($row['userName'], $row['identifier'], $row['userId'], $search)
            ));
        }

        $exitTracking = $this->periodHasExitScans($dateFrom, $dateTo);
        $focusedUserId = $search === '' ? 0 : $this->singleMatchedUserId($logs, $occurrences, $search);

        return [
            'generatedAt' => date('M j, Y g:i A'),
            'period' => [
                'from' => $dateFrom,
                'to' => $dateTo,
                'label' => $this->periodLabel($dateFrom, $dateTo),
            ],
            'exitTracking' => $exitTracking,
            'users' => $this->loadUsers(),
            'accessActivity' => $this->buildAccessActivity($logs),
            'userAccess' => $this->buildUserAccess($logs, $occurrences, $focusedUserId, $dateFrom, $dateTo, $search),
            'lateAccess' => $this->buildLateAccess($logs, $occurrences),
            'extendedAccess' => $this->buildExtendedAccess($logs, $occurrences, $exitTracking),
            'deniedAccess' => $this->buildDeniedAccess($logs),
        ];
    }

    private function loadUsers(): array
    {
        $statement = $this->pdo->query(
            "SELECT
                users.id,
                users.role,
                COALESCE(
                    NULLIF(TRIM(CONCAT_WS(' ', student_info.first_name, student_info.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', faculty_info.first_name, faculty_info.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', staff_info.first_name, staff_info.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', admin_info.first_name, admin_info.last_name)), ''),
                    users.username
                ) AS name,
                COALESCE(
                    student_info.school_id,
                    faculty_info.employee_id,
                    staff_info.employee_id,
                    admin_info.employee_id,
                    ''
                ) AS identifier
             FROM users
             LEFT JOIN student_info ON student_info.user_id = users.id
             LEFT JOIN faculty_info ON faculty_info.user_id = users.id
             LEFT JOIN staff_info ON staff_info.user_id = users.id
             LEFT JOIN admin_info ON admin_info.user_id = users.id
             ORDER BY name ASC"
        );

        return array_map(function ($row) {
            return [
                'id' => (int) $row['id'],
                'name' => $row['name'],
                'identifier' => $row['identifier'] ?: '',
                'role' => $row['role'],
                'roleLabel' => $this->roleLabel($row['role']),
            ];
        }, $statement->fetchAll());
    }

    private function loadAccessLogs(string $dateFrom, string $dateTo, string $role, int $userId): array
    {
        $accessType = $this->hasAccessType ? 'access_log.access_type' : "'IN'";
        $denial = $this->hasDenialReason ? 'access_log.denial_reason' : 'NULL';
        $kind = $this->hasScheduleKind ? "COALESCE(schedules.schedule_kind, 'regular')" : "'regular'";
        $roleSql = $this->roleSql($role);
        $userSql = $userId > 0 ? ' AND access_log.user_id = :user_id' : '';
        $dateSql = $this->dateBoundSql('DATE(access_log.access_timestamp)', $dateFrom, $dateTo, ':date_from', ':date_to');

        $statement = $this->pdo->prepare(
            "SELECT
                access_log.log_id,
                access_log.user_id,
                access_log.schedule_id,
                access_log.override_id,
                access_log.access_timestamp,
                DATE_FORMAT(access_log.access_timestamp, '%Y-%m-%d') AS access_date,
                DATE_FORMAT(access_log.access_timestamp, '%H:%i:%s') AS access_clock,
                access_log.access_status,
                {$denial} AS denial_reason,
                access_log.method_access,
                {$accessType} AS access_type,
                COALESCE(
                    NULLIF(TRIM(CONCAT_WS(' ', student_info.first_name, student_info.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', faculty_info.first_name, faculty_info.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', staff_info.first_name, staff_info.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', admin_info.first_name, admin_info.last_name)), ''),
                    users.username,
                    'Unknown user'
                ) AS user_name,
                users.role AS user_role,
                COALESCE(
                    student_info.school_id,
                    faculty_info.employee_id,
                    staff_info.employee_id,
                    admin_info.employee_id,
                    ''
                ) AS user_identifier,
                schedules.time_start,
                schedules.time_end,
                schedules.grace_period_minutes,
                schedules.status AS schedule_status,
                {$kind} AS schedule_kind
             FROM access_log
             LEFT JOIN users ON users.id = access_log.user_id
             LEFT JOIN schedules ON schedules.schedule_id = access_log.schedule_id
             LEFT JOIN student_info ON student_info.user_id = users.id
             LEFT JOIN faculty_info ON faculty_info.user_id = users.id
             LEFT JOIN staff_info ON staff_info.user_id = users.id
             LEFT JOIN admin_info ON admin_info.user_id = users.id
             WHERE 1 = 1
               {$dateSql}
               {$roleSql}
               {$userSql}
             ORDER BY access_log.access_timestamp ASC"
        );
        $this->bindDateBounds($statement, $dateFrom, $dateTo, ':date_from', ':date_to');
        if ($userId > 0) {
            $statement->bindValue(':user_id', $userId, PDO::PARAM_INT);
        }
        $statement->execute();

        return array_map(function ($row) {
            return [
                'id' => (int) $row['log_id'],
                'userId' => $row['user_id'] !== null ? (int) $row['user_id'] : 0,
                'scheduleId' => $row['schedule_id'] !== null ? (int) $row['schedule_id'] : 0,
                'overrideId' => $row['override_id'] !== null ? (int) $row['override_id'] : 0,
                'date' => $row['access_date'],
                'clock' => $row['access_clock'],
                'minutes' => $this->clockToMinutes($row['access_clock']),
                'status' => $row['access_status'],
                'denialReason' => $row['denial_reason'],
                'method' => $row['method_access'] ?: '',
                'accessType' => strtoupper((string) ($row['access_type'] ?: 'IN')),
                'userName' => $row['user_name'],
                'role' => $row['user_role'] ?: '',
                'identifier' => $row['user_identifier'] ?: '',
                'timeStart' => $row['time_start'],
                'timeEnd' => $row['time_end'],
                'grace' => $row['grace_period_minutes'] !== null ? (int) $row['grace_period_minutes'] : 15,
                'scheduleStatus' => $row['schedule_status'],
                'scheduleKind' => $row['schedule_kind'] ?: 'regular',
            ];
        }, $statement->fetchAll());
    }

    private function loadOccurrences(string $dateFrom, string $dateTo, string $role, int $userId): array
    {
        $kind = $this->hasScheduleKind ? "COALESCE(schedules.schedule_kind, 'regular')" : "'regular'";
        $roleSql = $this->roleSql($role, 'users.role');
        $userSql = $userId > 0 ? ' AND schedules.user_id = :user_id' : '';
        $singleDateSql = $this->dateBoundSql('schedules.schedule_date', $dateFrom, $dateTo, ':date_from', ':date_to');
        $recurFrom = $dateFrom !== '' ? ' AND schedules.end_date >= :date_from_recur' : '';
        $recurTo = $dateTo !== '' ? ' AND schedules.start_date <= :date_to_recur' : '';

        $statement = $this->pdo->prepare(
            "SELECT
                schedules.schedule_id,
                schedules.user_id,
                schedules.schedule_type,
                schedules.schedule_date,
                schedules.time_start,
                schedules.time_end,
                schedules.start_date,
                schedules.end_date,
                schedules.repeat_type,
                schedules.repeat_days,
                schedules.repeat_day,
                schedules.grace_period_minutes,
                schedules.status,
                {$kind} AS schedule_kind,
                COALESCE(
                    NULLIF(TRIM(CONCAT_WS(' ', student_info.first_name, student_info.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', faculty_info.first_name, faculty_info.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', staff_info.first_name, staff_info.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', admin_info.first_name, admin_info.last_name)), ''),
                    users.username
                ) AS user_name,
                users.role AS user_role,
                COALESCE(
                    student_info.school_id,
                    faculty_info.employee_id,
                    staff_info.employee_id,
                    admin_info.employee_id,
                    ''
                ) AS user_identifier
             FROM schedules
             INNER JOIN users ON users.id = schedules.user_id
             LEFT JOIN student_info ON student_info.user_id = users.id
             LEFT JOIN faculty_info ON faculty_info.user_id = users.id
             LEFT JOIN staff_info ON staff_info.user_id = users.id
             LEFT JOIN admin_info ON admin_info.user_id = users.id
             WHERE schedules.status IN ('approved', 'overridden', 'completed')
               AND (
                    (schedules.schedule_type = 'single' {$singleDateSql})
                    OR (
                        schedules.schedule_type = 'recurring'
                        {$recurFrom}
                        {$recurTo}
                    )
               )
               {$roleSql}
               {$userSql}"
        );
        $this->bindDateBounds($statement, $dateFrom, $dateTo, ':date_from', ':date_to');
        if ($dateFrom !== '') {
            $statement->bindValue(':date_from_recur', $dateFrom);
        }
        if ($dateTo !== '') {
            $statement->bindValue(':date_to_recur', $dateTo);
        }
        if ($userId > 0) {
            $statement->bindValue(':user_id', $userId, PDO::PARAM_INT);
        }
        $statement->execute();

        $occurrences = [];
        foreach ($statement->fetchAll() as $schedule) {
            foreach ($this->occurrenceDates($schedule, $dateFrom, $dateTo) as $date) {
                $occurrences[] = [
                    'id' => (int) $schedule['schedule_id'] . '-' . $date,
                    'scheduleId' => (int) $schedule['schedule_id'],
                    'userId' => (int) $schedule['user_id'],
                    'userName' => $schedule['user_name'],
                    'identifier' => $schedule['user_identifier'] ?: '',
                    'role' => $schedule['user_role'] ?: '',
                    'date' => $date,
                    'start' => $this->clockToMinutes($schedule['time_start']),
                    'end' => $this->clockToMinutes($schedule['time_end']),
                    'startLabel' => $this->formatClock($schedule['time_start']),
                    'endLabel' => $this->formatClock($schedule['time_end']),
                    'grace' => (int) ($schedule['grace_period_minutes'] ?? 15),
                    'kind' => $schedule['schedule_kind'] ?: 'regular',
                ];
            }
        }

        usort($occurrences, function ($left, $right) {
            return [$left['date'], $left['start'], $left['userName']] <=> [$right['date'], $right['start'], $right['userName']];
        });

        return $occurrences;
    }

    private function occurrenceDates(array $schedule, string $dateFrom, string $dateTo): array
    {
        if (($schedule['schedule_type'] ?? '') === 'single') {
            $date = (string) $schedule['schedule_date'];
            if ($date === '') {
                return [];
            }
            if ($dateFrom !== '' && $date < $dateFrom) {
                return [];
            }
            if ($dateTo !== '' && $date > $dateTo) {
                return [];
            }

            return [$date];
        }

        $cursor = $dateFrom !== '' ? max($dateFrom, (string) $schedule['start_date']) : (string) $schedule['start_date'];
        $end = $dateTo !== '' ? min($dateTo, (string) $schedule['end_date']) : (string) $schedule['end_date'];
        if ($cursor === '' || $end === '' || $cursor > $end) {
            return [];
        }

        $dates = [];
        $guard = 0;
        while ($cursor <= $end && $guard < 400) {
            if ($this->repeatsOn($schedule, $cursor)) {
                $dates[] = $cursor;
            }
            $cursor = date('Y-m-d', strtotime($cursor . ' +1 day'));
            $guard++;
        }

        return $dates;
    }

    private function repeatsOn(array $schedule, string $date): bool
    {
        $weekday = date('l', strtotime($date . ' 12:00:00'));
        $repeat = $schedule['repeat_type'] ?: 'none';

        if ($repeat === 'daily') {
            return true;
        }

        if ($repeat === 'weekly') {
            $named = trim((string) ($schedule['repeat_day'] ?? ''));
            if ($named !== '') {
                return strcasecmp($named, $weekday) === 0;
            }

            $anchor = $schedule['start_date'] ?: $date;
            return date('l', strtotime($anchor . ' 12:00:00')) === $weekday;
        }

        if ($repeat === 'weekly_selected') {
            $days = json_decode((string) ($schedule['repeat_days'] ?? '[]'), true);
            if (!is_array($days)) {
                return false;
            }
            foreach ($days as $day) {
                if (strcasecmp((string) $day, $weekday) === 0) {
                    return true;
                }
            }
        }

        return false;
    }

    private function buildAccessActivity(array $logs): array
    {
        $rows = [];
        $granted = 0;
        $denied = 0;
        $overrides = 0;

        foreach (array_reverse($logs) as $log) {
            $isOverride = $this->isOverride($log);
            if ($log['status'] === 'granted') {
                $granted++;
            } else {
                $denied++;
            }
            if ($isOverride) {
                $overrides++;
            }

            $rows[] = [
                'id' => $log['id'],
                'dateTime' => $this->formatDate($log['date']) . ' ' . $this->formatMinutes($log['minutes']),
                'user' => $log['userName'],
                'role' => $this->roleLabel($log['role']),
                'method' => $this->methodLabel($log['method']),
                'result' => $log['status'] === 'granted' ? 'Granted' : 'Denied',
                'scheduleStatus' => $this->scheduleStatusLabel($log),
                'remarks' => $this->activityRemarks($log),
            ];
        }

        return [
            'summary' => [
                'total' => count($logs),
                'granted' => $granted,
                'denied' => $denied,
                'overrides' => $overrides,
            ],
            'rows' => $rows,
        ];
    }

    private function buildUserAccess(array $logs, array $occurrences, int $userId, string $dateFrom, string $dateTo, string $search = ''): array
    {
        $empty = [
            'requiresUser' => true,
            'profile' => null,
            'summary' => [
                'total' => 0,
                'successful' => 0,
                'denied' => 0,
                'late' => 0,
                'extended' => 0,
            ],
            'rows' => [],
        ];

        if ($userId <= 0 && $search === '') {
            return $empty;
        }

        $profileSource = null;
        foreach ($logs as $log) {
            if ($log['userId'] === $userId) {
                $profileSource = $log;
                break;
            }
        }
        if ($profileSource === null) {
            foreach ($occurrences as $occurrence) {
                if ($occurrence['userId'] === $userId) {
                    $profileSource = $occurrence;
                    break;
                }
            }
        }
        if ($profileSource === null) {
            foreach ($this->loadUsers() as $user) {
                if ($user['id'] === $userId) {
                    $profileSource = [
                        'userName' => $user['name'],
                        'identifier' => $user['identifier'],
                        'role' => $user['role'],
                    ];
                    break;
                }
            }
        }

        $lateIds = [];
        foreach ($this->buildLateAccess($logs, $occurrences)['rows'] as $row) {
            if ($row['status'] === 'Late') {
                $lateIds[$row['dateValue'] . '|' . $row['scheduleId']] = true;
            }
        }
        $extendedIds = [];
        foreach ($this->buildExtendedAccess($logs, $occurrences, $this->periodHasExitScans($dateFrom, $dateTo))['rows'] as $row) {
            if ($row['status'] === 'Extended') {
                $extendedIds[$row['dateValue'] . '|' . $row['scheduleId']] = true;
            }
        }

        $rows = [];
        $successful = 0;
        $denied = 0;

        foreach (array_reverse($logs) as $log) {
            if ($log['status'] === 'granted') {
                $successful++;
            } else {
                $denied++;
            }

            $scheduled = '—';
            if ($log['timeStart'] && $log['timeEnd']) {
                $scheduled = $this->formatClock($log['timeStart']) . ' – ' . $this->formatClock($log['timeEnd']);
            }

            $rows[] = [
                'id' => $log['id'],
                'date' => $this->formatDate($log['date']),
                'scheduledTime' => $scheduled,
                'accessTime' => $this->formatMinutes($log['minutes']),
                'method' => $this->methodLabel($log['method']),
                'result' => $log['status'] === 'granted' ? 'Granted' : 'Denied',
                'scheduleStatus' => $this->scheduleStatusLabel($log),
                'remarks' => $this->activityRemarks($log),
            ];
        }

        $profile = null;
        if ($userId > 0 && $profileSource) {
            $profile = [
                'name' => $profileSource['userName'] ?? 'Selected user',
                'userId' => $profileSource['identifier'] ?? '',
                'role' => $this->roleLabel($profileSource['role'] ?? ''),
                'period' => $this->periodLabel($dateFrom, $dateTo),
            ];
        }

        return [
            'requiresUser' => true,
            'profile' => $profile,
            'summary' => [
                'total' => count($logs),
                'successful' => $successful,
                'denied' => $denied,
                'late' => count($lateIds),
                'extended' => count($extendedIds),
            ],
            'rows' => $rows,
        ];
    }

    private function buildLateAccess(array $logs, array $occurrences): array
    {
        $rows = [];
        $onTime = 0;
        $late = 0;
        $lateMinutes = [];

        foreach ($occurrences as $occurrence) {
            $entry = $this->firstEntry($logs, $occurrence);
            if ($entry === null) {
                continue;
            }

            $deadline = $occurrence['start'] + $occurrence['grace'];
            $isLate = $entry['minutes'] > $deadline;
            $minutesLate = $isLate ? $entry['minutes'] - $deadline : 0;
            if ($isLate) {
                $late++;
                $lateMinutes[] = $minutesLate;
            } else {
                $onTime++;
            }

            $rows[] = [
                'id' => $occurrence['id'],
                'scheduleId' => $occurrence['scheduleId'],
                'date' => $this->formatDate($occurrence['date']),
                'dateValue' => $occurrence['date'],
                'user' => $occurrence['userName'],
                'role' => $this->roleLabel($occurrence['role']),
                'scheduledStart' => $occurrence['startLabel'],
                'gracePeriod' => $occurrence['grace'] . ' min',
                'actualAccess' => $this->formatMinutes($entry['minutes']),
                'lateBy' => $isLate ? $this->formatDuration($minutesLate) : '—',
                'status' => $isLate ? 'Late' : 'On Time',
            ];
        }

        $average = count($lateMinutes) > 0
            ? $this->formatDuration((int) round(array_sum($lateMinutes) / count($lateMinutes)))
            : '—';

        return [
            'summary' => [
                'scheduled' => count($occurrences),
                'onTime' => $onTime,
                'late' => $late,
                'averageLate' => $average,
            ],
            'rows' => array_reverse($rows),
        ];
    }

    private function buildExtendedAccess(array $logs, array $occurrences, bool $exitTracking): array
    {
        $rows = [];
        $extended = 0;
        $stillInside = 0;
        $extendedMinutes = [];
        $nowMinutes = ((int) date('G')) * 60 + (int) date('i');
        $today = date('Y-m-d');

        foreach ($occurrences as $occurrence) {
            $entry = $this->firstEntry($logs, $occurrence);
            if ($entry === null) {
                continue;
            }

            $exit = $exitTracking ? $this->matchingExit($logs, $occurrence, $entry) : null;
            $status = 'Exit not recorded';
            $actualExit = '—';
            $extendedBy = '—';

            if ($exit !== null) {
                $actualExit = $this->formatMinutes($exit['minutes']);
                if ($exit['minutes'] > $occurrence['end']) {
                    $minutes = $exit['minutes'] - $occurrence['end'];
                    $status = 'Extended';
                    $extendedBy = $this->formatDuration($minutes);
                    $extended++;
                    $extendedMinutes[] = $minutes;
                } else {
                    $status = 'On Time';
                }
            } elseif ($exitTracking && $this->sessionHasEnded($occurrence, $today, $nowMinutes)) {
                $status = 'Still Inside';
                $stillInside++;
            }

            $rows[] = [
                'id' => $occurrence['id'],
                'scheduleId' => $occurrence['scheduleId'],
                'date' => $this->formatDate($occurrence['date']),
                'dateValue' => $occurrence['date'],
                'user' => $occurrence['userName'],
                'role' => $this->roleLabel($occurrence['role']),
                'scheduledStart' => $occurrence['startLabel'],
                'scheduledEnd' => $occurrence['endLabel'],
                'actualExit' => $actualExit,
                'extendedBy' => $extendedBy,
                'status' => $status,
            ];
        }

        $average = count($extendedMinutes) > 0
            ? $this->formatDuration((int) round(array_sum($extendedMinutes) / count($extendedMinutes)))
            : '—';

        return [
            'exitTracking' => $exitTracking,
            'note' => $exitTracking
                ? 'Still inside is shown only when an entry was granted, the scheduled end has passed, and no later exit scan was recorded.'
                : 'Entrivo has no recorded exit scans in this period, so users are not marked as still inside. Extended time is shown only when an exit scan is later than the scheduled end.',
            'summary' => [
                'total' => count($rows),
                'stillInside' => $exitTracking ? $stillInside : null,
                'extended' => $extended,
                'totalExtended' => count($extendedMinutes) > 0 ? $this->formatDuration(array_sum($extendedMinutes)) : '—',
                'averageExtended' => $average,
            ],
            'rows' => array_reverse($rows),
        ];
    }

    private function buildDeniedAccess(array $logs): array
    {
        $rows = [];
        $noSchedule = 0;
        $expired = 0;
        $invalid = 0;
        $other = 0;

        foreach (array_reverse($logs) as $log) {
            if ($log['status'] !== 'denied') {
                continue;
            }

            $reason = $this->denialLabel($log['denialReason']);
            $bucket = $this->denialBucket($log['denialReason']);
            if ($bucket === 'noSchedule') {
                $noSchedule++;
            } elseif ($bucket === 'expired') {
                $expired++;
            } elseif ($bucket === 'invalid') {
                $invalid++;
            } else {
                $other++;
            }

            $scheduled = '—';
            if ($log['timeStart'] && $log['timeEnd']) {
                $scheduled = $this->formatClock($log['timeStart']) . ' – ' . $this->formatClock($log['timeEnd']);
            }

            $rows[] = [
                'id' => $log['id'],
                'dateTime' => $this->formatDate($log['date']) . ' ' . $this->formatMinutes($log['minutes']),
                'user' => $log['userName'],
                'role' => $this->roleLabel($log['role']),
                'method' => $this->methodLabel($log['method']),
                'scheduledTime' => $scheduled,
                'result' => 'Denied',
                'reason' => $reason,
            ];
        }

        return [
            'summary' => [
                'total' => count($rows),
                'noSchedule' => $noSchedule,
                'expired' => $expired,
                'invalidAuth' => $invalid,
                'other' => $other,
            ],
            'rows' => $rows,
        ];
    }

    private function firstEntry(array $logs, array $occurrence): ?array
    {
        $matches = [];
        foreach ($logs as $log) {
            if ($log['userId'] !== $occurrence['userId'] || $log['date'] !== $occurrence['date']) {
                continue;
            }
            if ($log['status'] !== 'granted' || $log['accessType'] === 'OUT') {
                continue;
            }
            if ($log['scheduleId'] === $occurrence['scheduleId'] || $this->fallsInWindow($log, $occurrence)) {
                $matches[] = $log;
            }
        }

        if ($matches === []) {
            return null;
        }

        usort($matches, function ($left, $right) use ($occurrence) {
            $leftMatch = $left['scheduleId'] === $occurrence['scheduleId'] ? 0 : 1;
            $rightMatch = $right['scheduleId'] === $occurrence['scheduleId'] ? 0 : 1;
            return [$leftMatch, $left['minutes']] <=> [$rightMatch, $right['minutes']];
        });

        return $matches[0];
    }

    private function matchingExit(array $logs, array $occurrence, array $entry): ?array
    {
        $exit = null;
        foreach ($logs as $log) {
            if ($log['userId'] !== $occurrence['userId'] || $log['date'] !== $occurrence['date']) {
                continue;
            }
            if ($log['status'] !== 'granted' || $log['accessType'] !== 'OUT' || $log['minutes'] < $entry['minutes']) {
                continue;
            }
            if ($log['scheduleId'] !== $occurrence['scheduleId'] && $log['scheduleId'] !== 0 && !$this->fallsInWindow($log, $occurrence)) {
                continue;
            }
            if ($exit === null || $log['minutes'] > $exit['minutes']) {
                $exit = $log;
            }
        }

        return $exit;
    }

    private function fallsInWindow(array $log, array $occurrence): bool
    {
        return $log['minutes'] >= max(0, $occurrence['start'] - 30)
            && $log['minutes'] <= min(24 * 60, $occurrence['end'] + 180);
    }

    private function sessionHasEnded(array $occurrence, string $today, int $nowMinutes): bool
    {
        if ($occurrence['date'] < $today) {
            return true;
        }

        return $occurrence['date'] === $today && $nowMinutes > $occurrence['end'];
    }

    private function periodHasExitScans(string $dateFrom, string $dateTo): bool
    {
        if (!$this->hasAccessType) {
            return false;
        }

        $dateSql = $this->dateBoundSql('DATE(access_timestamp)', $dateFrom, $dateTo, ':date_from', ':date_to');
        $statement = $this->pdo->prepare(
            "SELECT 1
             FROM access_log
             WHERE access_type = 'OUT'
               {$dateSql}
             LIMIT 1"
        );
        $this->bindDateBounds($statement, $dateFrom, $dateTo, ':date_from', ':date_to');
        $statement->execute();

        return (bool) $statement->fetch();
    }

    private function isOverride(array $log): bool
    {
        return $log['method'] === 'Override' || $log['overrideId'] > 0 || $log['scheduleKind'] === 'override';
    }

    private function scheduleStatusLabel(array $log): string
    {
        if ($this->isOverride($log)) {
            return 'Override';
        }
        if ($log['scheduleId'] === 0 || !$log['timeStart']) {
            return 'No schedule';
        }
        $start = $this->clockToMinutes($log['timeStart']);
        $end = $this->clockToMinutes($log['timeEnd']);
        if ($log['minutes'] < $start) {
            return 'Before schedule';
        }
        if ($log['minutes'] > $end) {
            return 'After schedule';
        }

        return 'Within schedule';
    }

    private function activityRemarks(array $log): string
    {
        if ($log['status'] === 'denied') {
            return $this->denialLabel($log['denialReason']);
        }
        if ($this->isOverride($log)) {
            return 'Approved override';
        }
        if ($log['accessType'] === 'OUT') {
            return 'Exit scan';
        }
        if ($log['timeStart']) {
            $deadline = $this->clockToMinutes($log['timeStart']) + $log['grace'];
            if ($log['minutes'] > $deadline) {
                return 'Entered ' . $this->formatDuration($log['minutes'] - $deadline) . ' late';
            }
        }

        return '—';
    }

    private function denialLabel(?string $reason): string
    {
        if ($reason === null || $reason === '') {
            return 'Reason not recorded';
        }

        $labels = [
            'no_schedule' => 'No Active Schedule',
            'expired_schedule' => 'Access Time Expired',
            'schedule_not_started' => 'Access Before Schedule',
            'invalid_fingerprint' => 'Fingerprint Not Recognized',
            'invalid_rfid' => 'RFID Not Recognized',
            'unauthorized' => 'Account Inactive',
            'not_registered' => 'Other',
            'offline' => 'Other',
        ];

        return $labels[$reason] ?? 'Other';
    }

    private function denialBucket(?string $reason): string
    {
        if ($reason === 'no_schedule') {
            return 'noSchedule';
        }
        if ($reason === 'expired_schedule') {
            return 'expired';
        }
        if (in_array($reason, ['invalid_fingerprint', 'invalid_rfid', 'not_registered'], true)) {
            return 'invalid';
        }

        return 'other';
    }

    private function recordMatches(string $name, string $identifier, int $userId, string $search): bool
    {
        $haystack = trim($name . ' ' . $identifier . ' ' . $userId);

        return $haystack !== '' && stripos($haystack, trim($search)) !== false;
    }

    private function singleMatchedUserId(array $logs, array $occurrences, string $search): int
    {
        $ids = [];
        foreach ($logs as $log) {
            if ($log['userId'] > 0) {
                $ids[$log['userId']] = true;
            }
        }
        foreach ($occurrences as $row) {
            if ($row['userId'] > 0) {
                $ids[$row['userId']] = true;
            }
        }

        if (count($ids) === 1) {
            return (int) array_key_first($ids);
        }
        if (count($ids) > 1) {
            return 0;
        }

        $hits = [];
        foreach ($this->loadUsers() as $user) {
            if ($this->recordMatches($user['name'], $user['identifier'], $user['id'], $search)) {
                $hits[] = $user['id'];
            }
        }

        return count($hits) === 1 ? (int) $hits[0] : 0;
    }

    private function roleSql(string $role, string $column = 'users.role'): string
    {
        $allowed = ['student', 'faculty', 'staff', 'admin'];
        if (!in_array($role, $allowed, true)) {
            return '';
        }

        return " AND {$column} = " . $this->pdo->quote($role);
    }

    private function roleLabel(string $role): string
    {
        $labels = [
            'student' => 'Student',
            'faculty' => 'Instructor',
            'staff' => 'Staff',
            'admin' => 'Admin',
            'super_admin' => 'Super Admin',
        ];

        return $labels[$role] ?? ($role !== '' ? ucfirst(str_replace('_', ' ', $role)) : '—');
    }

    private function methodLabel(string $method): string
    {
        $labels = [
            'Fingerprint' => 'Fingerprint',
            'RFID' => 'RFID',
            'Override' => 'Override',
        ];

        return $labels[$method] ?? ($method !== '' ? $method : '—');
    }

    private function clockToMinutes(?string $clock): int
    {
        if (!$clock) {
            return 0;
        }
        $parts = explode(':', $clock);
        return ((int) $parts[0]) * 60 + (int) ($parts[1] ?? 0);
    }

    private function formatMinutes(int $minutes): string
    {
        $minutes = max(0, $minutes);
        $hour = intdiv($minutes, 60) % 24;
        $minute = $minutes % 60;
        $suffix = $hour >= 12 ? 'PM' : 'AM';
        $hour12 = $hour % 12;
        if ($hour12 === 0) {
            $hour12 = 12;
        }

        return sprintf('%d:%02d %s', $hour12, $minute, $suffix);
    }

    private function formatClock(?string $clock): string
    {
        return $this->formatMinutes($this->clockToMinutes($clock));
    }

    private function periodLabel(string $dateFrom, string $dateTo): string
    {
        if ($dateFrom === '' && $dateTo === '') {
            return 'All dates';
        }
        if ($dateFrom === '') {
            return 'Through ' . $this->formatDate($dateTo);
        }
        if ($dateTo === '') {
            return 'From ' . $this->formatDate($dateFrom);
        }

        return $this->formatDate($dateFrom) . ' – ' . $this->formatDate($dateTo);
    }

    private function dateBoundSql(string $column, string $dateFrom, string $dateTo, string $fromParam, string $toParam): string
    {
        $sql = '';
        if ($dateFrom !== '') {
            $sql .= " AND {$column} >= {$fromParam}";
        }
        if ($dateTo !== '') {
            $sql .= " AND {$column} <= {$toParam}";
        }

        return $sql;
    }

    private function bindDateBounds(PDOStatement $statement, string $dateFrom, string $dateTo, string $fromParam, string $toParam): void
    {
        if ($dateFrom !== '') {
            $statement->bindValue($fromParam, $dateFrom);
        }
        if ($dateTo !== '') {
            $statement->bindValue($toParam, $dateTo);
        }
    }

    private function formatDate(string $date): string
    {
        $stamp = strtotime($date . ' 12:00:00');
        return $stamp ? date('M j, Y', $stamp) : $date;
    }

    private function formatDuration(int $minutes): string
    {
        $minutes = max(0, $minutes);
        if ($minutes < 60) {
            return $minutes . ' min';
        }
        $hours = intdiv($minutes, 60);
        $rest = $minutes % 60;

        return $rest > 0 ? "{$hours} hr {$rest} min" : "{$hours} hr";
    }
}
