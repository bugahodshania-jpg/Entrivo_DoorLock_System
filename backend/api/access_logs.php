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

$limit = filter_input(INPUT_GET, 'limit', FILTER_VALIDATE_INT, [
    'options' => [
        'default' => 200,
        'min_range' => 1,
        'max_range' => 1000,
    ],
]);
$offset = filter_input(INPUT_GET, 'offset', FILTER_VALIDATE_INT, [
    'options' => [
        'default' => 0,
        'min_range' => 0,
    ],
]);

try {
    $pdo = entrivo_pdo();
$todayCounts = $pdo->query(
        "SELECT
            SUM(DATE(access_timestamp) = CURDATE()) AS total_today,
            SUM(access_status = 'granted' AND DATE(access_timestamp) = CURDATE()) AS granted_today,
            SUM(access_status = 'denied' AND DATE(access_timestamp) = CURDATE()) AS denied_today
         FROM access_log"
    )->fetch();

    $accessTypeColumn = $pdo->query("SHOW COLUMNS FROM access_log LIKE 'access_type'")->fetch()
        ? 'access_log.access_type'
        : "'IN'";

    $statement = $pdo->prepare(
        "SELECT
            access_log.log_id,
            DATE_FORMAT(access_log.access_timestamp, '%Y-%m-%d') AS access_date_value,
            DATE_FORMAT(access_log.access_timestamp, '%b %e, %Y') AS access_date,
            TIME_FORMAT(access_log.access_timestamp, '%h:%i %p') AS access_time,
            COALESCE(
                NULLIF(TRIM(CONCAT_WS(' ', student_info.first_name, student_info.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', faculty_info.first_name, faculty_info.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', staff_info.first_name, staff_info.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', admin_info.first_name, admin_info.last_name)), ''),
                users.username,
                'Unknown User'
            ) AS user_name,
            users.email AS user_email,
            users.role AS user_role,
            COALESCE(
                student_info.school_id,
                faculty_info.employee_id,
                staff_info.employee_id,
                admin_info.employee_id,
                'No ID'
            ) AS user_identifier,
            access_log.schedule_id,
            schedules.schedule_type,
            schedules.repeat_type,
            DATE_FORMAT(schedules.schedule_date, '%b %e, %Y') AS schedule_date,
            DATE_FORMAT(schedules.start_date, '%b %e, %Y') AS schedule_start_date,
            DATE_FORMAT(schedules.end_date, '%b %e, %Y') AS schedule_end_date,
            TIME_FORMAT(schedules.time_start, '%h:%i %p') AS schedule_time_start,
            TIME_FORMAT(schedules.time_end, '%h:%i %p') AS schedule_time_end,
            access_log.method_access,
            {$accessTypeColumn} AS access_type,
            access_log.access_status
         FROM access_log
         LEFT JOIN users ON users.id = access_log.user_id
         LEFT JOIN schedules ON schedules.schedule_id = access_log.schedule_id
         LEFT JOIN student_info ON student_info.user_id = users.id
         LEFT JOIN faculty_info ON faculty_info.user_id = users.id
         LEFT JOIN staff_info ON staff_info.user_id = users.id
         LEFT JOIN admin_info ON admin_info.user_id = users.id
         ORDER BY access_log.access_timestamp DESC
         LIMIT :limit OFFSET :offset"
    );
    $statement->bindValue(':limit', (int) $limit, PDO::PARAM_INT);
    $statement->bindValue(':offset', (int) $offset, PDO::PARAM_INT);
    $statement->execute();

    $accessLogs = array_map(
        static function ($log) {
            $scheduleWindow = null;

            if ($log['schedule_id'] !== null) {
                $timeRange = trim(($log['schedule_time_start'] ?: '') . ' - ' . ($log['schedule_time_end'] ?: ''));

                if (($log['schedule_type'] ?? '') === 'recurring') {
                    $repeatType = $log['repeat_type'] ?: 'recurring';
                    $dateRange = trim(($log['schedule_start_date'] ?: '') . ' - ' . ($log['schedule_end_date'] ?: ''));
                    $scheduleWindow = trim($repeatType . ' ' . $dateRange . ' ' . $timeRange);
                } else {
                    $scheduleWindow = trim(($log['schedule_date'] ?: '') . ' ' . $timeRange);
                }
            }

            return [
            'id' => (int) $log['log_id'],
            'dateValue' => $log['access_date_value'],
            'date' => $log['access_date'],
            'time' => $log['access_time'],
            'userName' => $log['user_name'],
            'userEmail' => $log['user_email'] ?: '',
            'userRole' => $log['user_role'] ?: '',
            'userIdentifier' => $log['user_identifier'],
            'scheduleId' => $log['schedule_id'] !== null ? (int) $log['schedule_id'] : null,
            'scheduleWindow' => $scheduleWindow,
            'method' => $log['method_access'],
            'accessType' => $log['access_type'],
            'status' => $log['access_status'],
            ];
        },
        $statement->fetchAll()
    );

    echo json_encode([
        'message' => 'Access logs loaded.',
        'summary' => [
            'totalToday' => (int) ($todayCounts['total_today'] ?? 0),
            'grantedToday' => (int) ($todayCounts['granted_today'] ?? 0),
            'deniedToday' => (int) ($todayCounts['denied_today'] ?? 0),
        ],
        'pagination' => [
            'limit' => (int) $limit,
            'offset' => (int) $offset,
        ],
        'accessLogs' => $accessLogs,
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'message' => 'Unable to load access logs.',
        'error' => $error->getMessage(),
    ]);
}
