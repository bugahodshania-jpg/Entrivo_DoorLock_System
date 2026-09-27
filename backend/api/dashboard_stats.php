<?php

date_default_timezone_set('Asia/Manila');

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['message' => 'Method not allowed']);
    exit;
}

require_once dirname(__DIR__) . '/config/connection.php';

try {
    $pdo = entrivo_pdo();
$userCounts = $pdo->query(
        "SELECT
            COUNT(*) AS total_users,
            SUM(role = 'student') AS students,
            SUM(role = 'faculty') AS faculty
         FROM users"
    )->fetch();

    $scheduleCounts = $pdo->query(
        "SELECT COUNT(*) AS active_schedules
         FROM schedules
         WHERE status = 'approved'"
    )->fetch();

    $accessCounts = $pdo->query(
        "SELECT
            SUM(access_status = 'granted') AS granted_access,
            SUM(access_status = 'denied' AND DATE(access_timestamp) = CURDATE()) AS denied_today
         FROM access_log"
    )->fetch();

    $trendStatement = $pdo->query(
        "SELECT
            DATE(access_timestamp) AS access_date,
            access_status,
            COUNT(*) AS total
         FROM access_log
         WHERE access_timestamp >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
         GROUP BY DATE(access_timestamp), access_status
         ORDER BY access_date ASC"
    );
    $trendRows = $trendStatement->fetchAll();
    $trendByDate = [];

    foreach ($trendRows as $row) {
        $date = $row['access_date'];

        if (!isset($trendByDate[$date])) {
            $trendByDate[$date] = [
                'granted' => 0,
                'denied' => 0,
            ];
        }

        $trendByDate[$date][$row['access_status']] = (int) $row['total'];
    }

    $accessTrend = [];
    $today = new DateTimeImmutable('today');

    for ($dayOffset = 6; $dayOffset >= 0; $dayOffset--) {
        $date = $today->sub(new DateInterval('P' . $dayOffset . 'D'));
        $dateKey = $date->format('Y-m-d');

        $accessTrend[] = [
            'date' => $dateKey,
            'label' => $date->format('M j'),
            'granted' => $trendByDate[$dateKey]['granted'] ?? 0,
            'denied' => $trendByDate[$dateKey]['denied'] ?? 0,
        ];
    }

    $hourlyStatement = $pdo->query(
        "SELECT
            HOUR(access_timestamp) AS access_hour,
            access_status,
            COUNT(*) AS total
         FROM access_log
         WHERE DATE(access_timestamp) = CURDATE()
         GROUP BY HOUR(access_timestamp), access_status
         ORDER BY access_hour ASC"
    );
    $hourlyRows = $hourlyStatement->fetchAll();
    $hourlyByTime = [];

    foreach ($hourlyRows as $row) {
        $hour = (int) $row['access_hour'];

        if (!isset($hourlyByTime[$hour])) {
            $hourlyByTime[$hour] = [
                'granted' => 0,
                'denied' => 0,
            ];
        }

        $hourlyByTime[$hour][$row['access_status']] = (int) $row['total'];
    }

    $todayAccessTrend = [];

    for ($hour = 0; $hour < 24; $hour += 3) {
        $bucketGranted = 0;
        $bucketDenied = 0;

        for ($bucketHour = $hour; $bucketHour < min($hour + 3, 24); $bucketHour++) {
            $bucketGranted += $hourlyByTime[$bucketHour]['granted'] ?? 0;
            $bucketDenied += $hourlyByTime[$bucketHour]['denied'] ?? 0;
        }

        $todayAccessTrend[] = [
            'date' => 'today-' . $hour,
            'label' => DateTimeImmutable::createFromFormat('!H', (string) $hour)->format('g A'),
            'granted' => $bucketGranted,
            'denied' => $bucketDenied,
        ];
    }

    $currentTime = new DateTimeImmutable('now');
    $scheduleStatement = $pdo->query(
        "SELECT
            schedules.schedule_id,
            schedules.time_start AS time_start_value,
            schedules.time_end AS time_end_value,
            TIME_FORMAT(schedules.time_start, '%h:%i %p') AS time_start,
            TIME_FORMAT(schedules.time_end, '%h:%i %p') AS time_end,
            COALESCE(
                NULLIF(TRIM(CONCAT_WS(' ', student_info.first_name, student_info.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', faculty_info.first_name, faculty_info.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', staff_info.first_name, staff_info.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', admin_info.first_name, admin_info.last_name)), ''),
                users.username
            ) AS schedule_owner
         FROM schedules
         INNER JOIN users ON users.id = schedules.user_id
         LEFT JOIN student_info ON student_info.user_id = users.id
         LEFT JOIN faculty_info ON faculty_info.user_id = users.id
         LEFT JOIN staff_info ON staff_info.user_id = users.id
         LEFT JOIN admin_info ON admin_info.user_id = users.id
         WHERE schedules.status = 'approved'
            AND schedules.schedule_date = CURDATE()
         ORDER BY schedules.time_start ASC
        "
    );
    $todaySchedules = array_map(
        static function ($schedule) use ($currentTime) {
            $startTime = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $currentTime->format('Y-m-d') . ' ' . $schedule['time_start_value']);
            $endTime = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $currentTime->format('Y-m-d') . ' ' . $schedule['time_end_value']);

            $state = 'upcoming';
            $stateLabel = 'Incoming';

            if ($startTime && $endTime) {
                if ($currentTime > $endTime) {
                    $state = 'done';
                    $stateLabel = 'Done';
                } elseif ($currentTime >= $startTime) {
                    $state = 'active';
                    $stateLabel = 'Active';
                }
            }

            return [
                'id' => (int) $schedule['schedule_id'],
                'owner' => $schedule['schedule_owner'],
                'time' => $schedule['time_start'] . ' - ' . $schedule['time_end'],
                'state' => $state,
                'stateLabel' => $stateLabel,
            ];
        },
        $scheduleStatement->fetchAll()
    );

    $accessTypeColumn = $pdo->query("SHOW COLUMNS FROM access_log LIKE 'access_type'")->fetch()
        ? 'access_log.access_type'
        : "'IN'";
    $recentLogStatement = $pdo->query(
        "SELECT
            access_log.log_id,
            TIME_FORMAT(access_log.access_timestamp, '%h:%i %p') AS access_time,
            COALESCE(
                NULLIF(TRIM(CONCAT_WS(' ', student_info.first_name, student_info.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', faculty_info.first_name, faculty_info.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', staff_info.first_name, staff_info.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', admin_info.first_name, admin_info.last_name)), ''),
                users.username,
                'Unknown User'
            ) AS user_name,
            COALESCE(
                student_info.school_id,
                faculty_info.employee_id,
                staff_info.employee_id,
                admin_info.employee_id,
                'No ID'
            ) AS user_identifier,
            access_log.method_access,
            {$accessTypeColumn} AS access_type,
            access_log.access_status
         FROM access_log
         LEFT JOIN users ON users.id = access_log.user_id
         LEFT JOIN student_info ON student_info.user_id = users.id
         LEFT JOIN faculty_info ON faculty_info.user_id = users.id
         LEFT JOIN staff_info ON staff_info.user_id = users.id
         LEFT JOIN admin_info ON admin_info.user_id = users.id
         ORDER BY access_log.access_timestamp DESC
         LIMIT 5"
    );
    $recentAccessLogs = array_map(
        static fn ($log) => [
            'id' => (int) $log['log_id'],
            'time' => $log['access_time'],
            'userName' => $log['user_name'],
            'userIdentifier' => $log['user_identifier'],
            'method' => $log['method_access'],
            'accessType' => $log['access_type'],
            'status' => $log['access_status'],
        ],
        $recentLogStatement->fetchAll()
    );

    $overrideStatement = $pdo->query(
        "SELECT
            schedules.schedule_id,
            COALESCE(schedules.schedule_date, schedules.start_date) AS schedule_date,
            schedules.time_start AS time_start_value,
            schedules.time_end AS time_end_value,
            TIME_FORMAT(schedules.time_start, '%h:%i %p') AS time_start,
            TIME_FORMAT(schedules.time_end, '%h:%i %p') AS time_end,
            DATE_FORMAT(COALESCE(schedules.schedule_date, schedules.start_date), '%b %e') AS schedule_date_label,
            COALESCE(
                NULLIF(TRIM(CONCAT_WS(' ', student_info.first_name, student_info.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', faculty_info.first_name, faculty_info.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', staff_info.first_name, staff_info.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', admin_info.first_name, admin_info.last_name)), ''),
                users.username
            ) AS schedule_owner
         FROM schedules
         INNER JOIN users ON users.id = schedules.user_id
         LEFT JOIN student_info ON student_info.user_id = users.id
         LEFT JOIN faculty_info ON faculty_info.user_id = users.id
         LEFT JOIN staff_info ON staff_info.user_id = users.id
         LEFT JOIN admin_info ON admin_info.user_id = users.id
         WHERE schedules.status = 'overridden'
            AND COALESCE(schedules.schedule_date, schedules.start_date)
                BETWEEN DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
                    AND DATE_ADD(
                        DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY),
                        INTERVAL 6 DAY
                    )
         ORDER BY
            CASE
                WHEN COALESCE(schedules.schedule_date, schedules.start_date) = CURDATE()
                    AND CURTIME() BETWEEN schedules.time_start AND schedules.time_end THEN 0
                WHEN COALESCE(schedules.schedule_date, schedules.start_date) = CURDATE()
                    AND schedules.time_start > CURTIME() THEN 1
                WHEN COALESCE(schedules.schedule_date, schedules.start_date) > CURDATE() THEN 2
                WHEN COALESCE(schedules.schedule_date, schedules.start_date) = CURDATE() THEN 3
                ELSE 4
            END ASC,
            COALESCE(schedules.schedule_date, schedules.start_date) DESC,
            schedules.time_start ASC
         LIMIT 8"
    );
    $overrideRequests = array_map(
        static function ($schedule) use ($currentTime) {
            $scheduleDate = $schedule['schedule_date'] ?: $currentTime->format('Y-m-d');
            $startRaw = strlen((string) $schedule['time_start_value']) === 5
                ? $schedule['time_start_value'] . ':00'
                : $schedule['time_start_value'];
            $endRaw = strlen((string) $schedule['time_end_value']) === 5
                ? $schedule['time_end_value'] . ':00'
                : $schedule['time_end_value'];
            $startTime = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $scheduleDate . ' ' . $startRaw);
            $endTime = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $scheduleDate . ' ' . $endRaw);

            $state = 'upcoming';
            $stateLabel = 'Incoming';

            if ($startTime && $endTime) {
                if ($currentTime > $endTime) {
                    $state = 'done';
                    $stateLabel = 'Done';
                } elseif ($currentTime >= $startTime) {
                    $state = 'active';
                    $stateLabel = 'Active';
                }
            }

            $isToday = $scheduleDate === $currentTime->format('Y-m-d');
            $timeLabel = $isToday
                ? $schedule['time_start'] . ' - ' . $schedule['time_end']
                : $schedule['schedule_date_label'] . ', ' . $schedule['time_start'] . ' - ' . $schedule['time_end'];

            return [
                'id' => (int) $schedule['schedule_id'],
                'owner' => $schedule['schedule_owner'],
                'time' => $timeLabel,
                'state' => $state,
                'stateLabel' => $stateLabel,
            ];
        },
        $overrideStatement->fetchAll()
    );

    echo json_encode([
        'message' => 'Dashboard summary loaded.',
        'summary' => [
            'totalUsers' => (int) ($userCounts['total_users'] ?? 0),
            'students' => (int) ($userCounts['students'] ?? 0),
            'faculty' => (int) ($userCounts['faculty'] ?? 0),
            'activeSchedules' => (int) ($scheduleCounts['active_schedules'] ?? 0),
            'grantedAccess' => (int) ($accessCounts['granted_access'] ?? 0),
            'deniedToday' => (int) ($accessCounts['denied_today'] ?? 0),
        ],
        'accessTrend' => $accessTrend,
        'todayAccessTrend' => $todayAccessTrend,
        'todaySchedules' => $todaySchedules,
        'recentAccessLogs' => $recentAccessLogs,
        'overrideRequests' => $overrideRequests,
        'pendingOverrides' => $overrideRequests,
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'message' => 'Unable to load dashboard summary.',
        'error' => $error->getMessage(),
    ]);
}
