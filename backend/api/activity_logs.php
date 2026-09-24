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

function activityDetails(string $status, ?string $reason, string $username): array
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
        'inactive' => 'This account is disabled.',
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

try {
    $pdo = entrivo_pdo();
    $statement = $pdo->query(
        "SELECT
            login_attempts.attempt_id,
            login_attempts.username_attempted,
            login_attempts.attempt_status,
            login_attempts.failure_reason,
            login_attempts.user_agent,
            DATE_FORMAT(login_attempts.created_at, '%Y-%m-%d') AS activity_date_value,
            DATE_FORMAT(login_attempts.created_at, '%b %e, %Y') AS activity_date,
            DATE_FORMAT(login_attempts.created_at, '%l:%i %p') AS activity_time,
            users.role,
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
            ) AS identifier
         FROM login_attempts
         LEFT JOIN users ON users.id = login_attempts.user_id
         LEFT JOIN student_info ON student_info.user_id = users.id
         LEFT JOIN faculty_info ON faculty_info.user_id = users.id
         LEFT JOIN staff_info ON staff_info.user_id = users.id
         LEFT JOIN admin_info ON admin_info.user_id = users.id
         ORDER BY login_attempts.created_at DESC, login_attempts.attempt_id DESC
         LIMIT 300"
    );

    $logs = array_map(static function ($row) {
        $username = $row['account_username'] ?: $row['username_attempted'];
        $name = trim(implode(' ', array_filter([
            $row['first_name'] ?? '',
            $row['middle_name'] ?? '',
            $row['last_name'] ?? '',
            $row['extension_name'] ?? '',
        ])));
        [$activity, $description, $result] = activityDetails(
            (string) $row['attempt_status'],
            $row['failure_reason'],
            $username
        );
        [$device, $deviceDetail] = activityDevice($row['user_agent']);
        $initialSource = $name !== '' ? $name : $username;

        return [
            'id' => (int) $row['attempt_id'],
            'userId' => $row['identifier'] ?: 'Not assigned',
            'name' => $name !== '' ? $name : $username,
            'username' => $username,
            'initial' => strtoupper(substr($initialSource, 0, 1)),
            'role' => activityRoleLabel($row['role']),
            'activity' => $activity,
            'description' => $description,
            'status' => $result,
            'device' => $device,
            'deviceDetail' => $deviceDetail,
            'date' => $row['activity_date'],
            'time' => trim($row['activity_time']),
            'dateValue' => $row['activity_date_value'],
        ];
    }, $statement->fetchAll());

    echo json_encode([
        'message' => 'Activity logs loaded.',
        'logs' => $logs,
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['message' => 'Unable to load activity logs right now.']);
}
