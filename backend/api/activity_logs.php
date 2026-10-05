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
    echo json_encode(['message' => 'Method not allowed.']);
    exit;
}

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/ActivityLogService.php';

function activityRoleLabel(?string $role): string
{
    return match ($role) {
        'super_admin' => 'Super Admin',
        'admin' => 'Admin',
        'faculty' => 'Faculty',
        'staff' => 'Staff',
        'student' => 'Student',
        default => 'User',
    };
}

function activityLoginDetails(string $status, ?string $reason, string $username): array
{
    $handle = '@' . $username;

    if ($status === 'logout') {
        return ['Logout', "User {$handle} logged out", 'Success'];
    }

    if ($status === 'success') {
        return ['Login', "Login attempt (Success) for {$handle}", 'Success'];
    }

    if ($status === 'blocked') {
        return ['Login', "Login attempt blocked for {$handle}. The account is temporarily locked.", 'Failed'];
    }

    $detail = match ($reason) {
        'user_not_found' => 'The username was not found.',
        'wrong_password' => 'The password was incorrect.',
        'pending_approval' => 'The account is still waiting for approval.',
        'rejected' => 'The registration was not approved.',
        'inactive' => 'This account has been blocked.',
        default => 'The sign-in was not accepted.',
    };

    return ['Login', "Login attempt failed for {$handle}. {$detail}", 'Failed'];
}

function activityDevice(?string $userAgent): array
{
    $agent = $userAgent ?? '';
    $browser = 'Browser';

    if (stripos($agent, 'Edg/') !== false) {
        $browser = 'Edge';
    } elseif (stripos($agent, 'Chrome/') !== false) {
        $browser = 'Chrome';
    } elseif (stripos($agent, 'Firefox/') !== false) {
        $browser = 'Firefox';
    } elseif (stripos($agent, 'Safari/') !== false) {
        $browser = 'Safari';
    }

    if (stripos($agent, 'Windows') !== false) {
        return ['Desktop (Windows)', "{$browser} / Windows"];
    }

    if (stripos($agent, 'Android') !== false) {
        return ['Mobile (Android)', "{$browser} / Android"];
    }

    if (stripos($agent, 'iPhone') !== false || stripos($agent, 'iPad') !== false) {
        return ['Mobile (iOS)', "{$browser} / iOS"];
    }

    if (stripos($agent, 'Mac OS') !== false) {
        return ['Desktop (Mac)', "{$browser} / macOS"];
    }

    if (stripos($agent, 'Linux') !== false) {
        return ['Desktop (Linux)', "{$browser} / Linux"];
    }

    return ['Unknown device', $browser];
}

function activityUserDisplayName(array $row, string $fallbackUsername): array
{
    $name = trim(implode(' ', array_filter([
        $row['first_name'] ?? '',
        $row['middle_name'] ?? '',
        $row['last_name'] ?? '',
        $row['extension_name'] ?? '',
    ])));
    $username = $row['account_username'] ?: $fallbackUsername;
    $displayName = $name !== '' ? $name : ($username !== '' ? $username : 'System');
    $initialSource = $displayName !== 'System' ? $displayName : 'S';

    return [
        'name' => $displayName,
        'username' => $username !== '' ? $username : 'system',
        'initial' => strtoupper(substr($initialSource, 0, 1)),
        'userId' => $row['identifier'] ?: 'Not assigned',
        'role' => activityRoleLabel($row['role'] ?? null),
    ];
}

function activityProfileJoinSql(string $usersAlias = 'users'): string
{
    return "LEFT JOIN student_info ON student_info.user_id = {$usersAlias}.id
         LEFT JOIN faculty_info ON faculty_info.user_id = {$usersAlias}.id
         LEFT JOIN staff_info ON staff_info.user_id = {$usersAlias}.id
         LEFT JOIN admin_info ON admin_info.user_id = {$usersAlias}.id";
}

function activityProfileSelectSql(): string
{
    return "users.role,
            users.username AS account_username,
            COALESCE(
                student_info.first_name,
                faculty_info.first_name,
                staff_info.first_name,
                admin_info.first_name
            ) AS first_name,
            COALESCE(
                student_info.middle_name,
                faculty_info.middle_name,
                staff_info.middle_name,
                admin_info.middle_name
            ) AS middle_name,
            COALESCE(
                student_info.last_name,
                faculty_info.last_name,
                staff_info.last_name,
                admin_info.last_name
            ) AS last_name,
            COALESCE(
                student_info.extension_name,
                faculty_info.extension_name,
                staff_info.extension_name,
                admin_info.extension_name
            ) AS extension_name,
            COALESCE(
                student_info.school_id,
                faculty_info.employee_id,
                staff_info.employee_id,
                admin_info.employee_id
            ) AS identifier";
}

try {
    $pdo = entrivo_pdo();
    $activityLog = new ActivityLogService($pdo);
    $activityLog->ensureTable();
    $activityLog->syncFingerprintEnrollmentActivities();

    $previewLimit = filter_input(INPUT_GET, 'limit', FILTER_VALIDATE_INT);
    if (!is_int($previewLimit) || $previewLimit < 1) {
        $previewLimit = 0;
    } else {
        $previewLimit = min($previewLimit, 20);
    }

    $sourceLimit = $previewLimit > 0 ? $previewLimit + 1 : 300;
    $mergedLimit = $previewLimit > 0 ? $previewLimit + 1 : 400;

    $loginStatement = $pdo->query(
        'SELECT
            login_attempts.attempt_id,
            login_attempts.username_attempted,
            login_attempts.attempt_status,
            login_attempts.failure_reason,
            login_attempts.user_agent,
            login_attempts.created_at AS sort_at,
            DATE_FORMAT(login_attempts.created_at, \'%Y-%m-%d\') AS activity_date_value,
            DATE_FORMAT(login_attempts.created_at, \'%b %e, %Y\') AS activity_date,
            DATE_FORMAT(login_attempts.created_at, \'%l:%i %p\') AS activity_time,
            ' . activityProfileSelectSql() . '
         FROM login_attempts
         LEFT JOIN users ON users.id = login_attempts.user_id
         ' . activityProfileJoinSql() . '
         ORDER BY login_attempts.created_at DESC, login_attempts.attempt_id DESC
         LIMIT ' . $sourceLimit
    );

    $loginLogs = array_map(static function ($row) {
        $username = $row['account_username'] ?: $row['username_attempted'];
        $user = activityUserDisplayName($row, (string) $username);
        [$activity, $description, $result] = activityLoginDetails(
            (string) $row['attempt_status'],
            $row['failure_reason'],
            $username
        );
        [$device, $deviceDetail] = activityDevice($row['user_agent']);

        return [
            'id' => 'login-' . (int) $row['attempt_id'],
            'userId' => $user['userId'],
            'name' => $user['name'],
            'username' => $user['username'],
            'initial' => $user['initial'],
            'role' => $user['role'],
            'activity' => $activity,
            'description' => $description,
            'status' => $result,
            'device' => $device,
            'deviceDetail' => $deviceDetail,
            'date' => $row['activity_date'],
            'time' => trim($row['activity_time']),
            'dateValue' => $row['activity_date_value'],
            'sortAt' => $row['sort_at'],
        ];
    }, $loginStatement->fetchAll());

    $transactionStatement = $pdo->query(
        'SELECT
            activity_transactions.transaction_id,
            activity_transactions.activity_type,
            activity_transactions.entity_type,
            activity_transactions.description,
            activity_transactions.status,
            activity_transactions.user_agent,
            activity_transactions.created_at AS sort_at,
            DATE_FORMAT(activity_transactions.created_at, \'%Y-%m-%d\') AS activity_date_value,
            DATE_FORMAT(activity_transactions.created_at, \'%b %e, %Y\') AS activity_date,
            DATE_FORMAT(activity_transactions.created_at, \'%l:%i %p\') AS activity_time,
            ' . activityProfileSelectSql() . '
         FROM activity_transactions
         LEFT JOIN users ON users.id = COALESCE(
             activity_transactions.actor_user_id,
             activity_transactions.target_user_id
         )
         ' . activityProfileJoinSql() . '
         ORDER BY activity_transactions.created_at DESC, activity_transactions.transaction_id DESC
         LIMIT ' . $sourceLimit
    );

    $transactionLogs = array_map(static function ($row) {
        $user = activityUserDisplayName($row, (string) ($row['account_username'] ?? 'system'));
        [$device, $deviceDetail] = activityDevice($row['user_agent']);
        $status = strcasecmp((string) $row['status'], 'Failed') === 0 ? 'Failed' : 'Success';

        return [
            'id' => 'txn-' . (int) $row['transaction_id'],
            'userId' => $user['userId'],
            'name' => $user['name'],
            'username' => $user['username'],
            'initial' => $user['initial'],
            'role' => $user['role'],
            'activity' => ActivityLogService::category(
                (string) $row['activity_type'],
                $row['entity_type'] ?? null,
                (string) ($row['description'] ?? '')
            ),
            'activityType' => $row['activity_type'],
            'description' => $row['description'],
            'status' => $status,
            'device' => $device,
            'deviceDetail' => $deviceDetail,
            'date' => $row['activity_date'],
            'time' => trim($row['activity_time']),
            'dateValue' => $row['activity_date_value'],
            'sortAt' => $row['sort_at'],
        ];
    }, $transactionStatement->fetchAll());

    $accessLogs = [];

    try {
        $accessStatement = $pdo->query(
            'SELECT
                access_log.log_id,
                access_log.method_access,
                access_log.access_status,
                access_log.access_timestamp AS sort_at,
                DATE_FORMAT(access_log.access_timestamp, \'%Y-%m-%d\') AS activity_date_value,
                DATE_FORMAT(access_log.access_timestamp, \'%b %e, %Y\') AS activity_date,
                DATE_FORMAT(access_log.access_timestamp, \'%l:%i %p\') AS activity_time,
                ' . activityProfileSelectSql() . '
             FROM access_log
             LEFT JOIN users ON users.id = access_log.user_id
             ' . activityProfileJoinSql() . '
             ORDER BY access_log.access_timestamp DESC, access_log.log_id DESC
             LIMIT ' . $sourceLimit
        );

        $accessLogs = array_map(static function ($row) {
            $user = activityUserDisplayName($row, (string) ($row['account_username'] ?? 'system'));
            $method = trim((string) ($row['method_access'] ?? 'Door')) ?: 'Door';
            $statusRaw = strtolower(trim((string) ($row['access_status'] ?? '')));
            $granted = $statusRaw === 'granted' || $statusRaw === 'success';
            $description = $granted
                ? 'Door access granted via ' . $method . '.'
                : 'Door access denied via ' . $method . '.';

            return [
                'id' => 'access-' . (int) $row['log_id'],
                'userId' => $user['userId'],
                'name' => $user['name'],
                'username' => $user['username'],
                'initial' => $user['initial'],
                'role' => $user['role'],
                'activity' => 'Access',
                'activityType' => 'Access',
                'description' => $description,
                'status' => $granted ? 'Success' : 'Failed',
                'device' => $method,
                'deviceDetail' => 'Door access point',
                'date' => $row['activity_date'],
                'time' => trim((string) $row['activity_time']),
                'dateValue' => $row['activity_date_value'],
                'sortAt' => $row['sort_at'],
            ];
        }, $accessStatement->fetchAll());
    } catch (Throwable $accessError) {
        $accessLogs = [];
    }

    $logs = array_merge($loginLogs, $transactionLogs, $accessLogs);
    usort($logs, static function ($left, $right) {
        return strcmp((string) ($right['sortAt'] ?? ''), (string) ($left['sortAt'] ?? ''));
    });
    $logs = array_slice($logs, 0, $mergedLimit);
    $hasMore = $previewLimit > 0 && count($logs) > $previewLimit;
    if ($previewLimit > 0) {
        $logs = array_slice($logs, 0, $previewLimit);
    }
    $logs = array_map(static function ($log) {
        unset($log['sortAt']);
        return $log;
    }, $logs);

    $payload = [
        'message' => 'Activity logs loaded.',
        'logs' => $logs,
    ];

    if ($previewLimit > 0) {
        $payload['hasMore'] = $hasMore;
    }

    echo json_encode($payload);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['message' => 'Unable to load activity logs right now.']);
}
