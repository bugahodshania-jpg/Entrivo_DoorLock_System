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

require_once dirname(__DIR__, 2) . '/config/connection.php';

function fetchFingerprintsByRole(PDO $pdo, string $roleKey): array
{
    $profileTable = match ($roleKey) {
        'faculty' => 'faculty_info',
        'staff' => 'staff_info',
        'admins' => 'admin_info',
    };
    $idColumn = 'employee_id';
    $roleCondition = $roleKey === 'admins'
        ? "users.role IN ('admin', 'super_admin')"
        : 'users.role = :role';
    $columns = $pdo->query('SHOW COLUMNS FROM fingerprints')->fetchAll(PDO::FETCH_COLUMN);
    $registeredAtExpression = in_array('registered_at', $columns, true)
        ? "DATE_FORMAT(fingerprints.registered_at, '%b %e, %Y %h:%i %p')"
        : "DATE_FORMAT(fingerprints.enrolled_at, '%b %e, %Y %h:%i %p')";
    $orderTimestampColumn = in_array('registered_at', $columns, true)
        ? 'fingerprints.registered_at'
        : 'fingerprints.enrolled_at';

    $statement = $pdo->prepare(
        "SELECT
            fingerprints.fingerprint_id,
            fingerprints.finger_name,
            fingerprints.status AS fingerprint_status,
            fingerprints.enrollment_device_id,
            fingerprints.enrollment_slot,
            fingerprints.shared_door_slot,
            fingerprints.door_sync_status,
            CASE
                WHEN fingerprints.template_data IS NULL OR OCTET_LENGTH(fingerprints.template_data) = 0 THEN 0
                ELSE 1
            END AS has_template_data,
            COALESCE(OCTET_LENGTH(fingerprints.template_data), 0) AS template_bytes,
            {$registeredAtExpression} AS registered_at,
            users.id AS user_id,
            users.username,
            users.email,
            users.role,
            users.is_active,
            DATE_FORMAT(users.created_at, '%b %e, %Y') AS joined_at,
            {$profileTable}.{$idColumn} AS profile_identifier,
            {$profileTable}.first_name,
            {$profileTable}.middle_name,
            {$profileTable}.last_name,
            {$profileTable}.extension_name,
            {$profileTable}.users_photo,
            {$profileTable}.office_department,
            {$profileTable}.work_position
         FROM fingerprints
         INNER JOIN users ON users.id = fingerprints.user_id
         LEFT JOIN {$profileTable} ON {$profileTable}.user_id = users.id
         WHERE {$roleCondition}
         ORDER BY {$orderTimestampColumn} DESC, {$profileTable}.last_name ASC, {$profileTable}.first_name ASC"
    );

    if ($roleKey !== 'admins') {
        $statement->bindValue(':role', rtrim($roleKey, 's'));
    }

    $statement->execute();

    return array_map(
        static function ($row) {
            $nameParts = [
                $row['first_name'],
                $row['middle_name'],
                $row['last_name'],
                $row['extension_name'],
            ];
            $fullName = trim(implode(' ', array_filter($nameParts)));

            return [
                'id' => (int) $row['fingerprint_id'],
                'userId' => (int) $row['user_id'],
                'name' => $fullName ?: $row['username'],
                'username' => $row['username'],
                'email' => $row['email'],
                'role' => $row['role'],
                'identifier' => $row['profile_identifier'] ?: 'Not assigned',
                'userPhoto' => $row['users_photo'] ?? null,
                'officeDepartment' => $row['office_department'],
                'workPosition' => $row['work_position'],
                'fingerName' => $row['finger_name'] ?: 'Pending Enrollment',
                'registeredAt' => $row['registered_at'],
                'status' => $row['fingerprint_status'],
                'enrollmentDeviceId' => isset($row['enrollment_device_id']) ? (int) $row['enrollment_device_id'] : null,
                'enrollmentSlot' => isset($row['enrollment_slot']) ? (int) $row['enrollment_slot'] : null,
                'sharedDoorSlot' => isset($row['shared_door_slot']) ? (int) $row['shared_door_slot'] : null,
                'doorSyncStatus' => $row['door_sync_status'],
                'hasTemplateData' => (bool) ($row['has_template_data'] ?? false),
                'templateBytes' => (int) ($row['template_bytes'] ?? 0),
                'userStatus' => (bool) $row['is_active'] ? 'active' : 'inactive',
                'joinedAt' => $row['joined_at'],
            ];
        },
        $statement->fetchAll()
    );
}

try {
    $pdo = entrivo_pdo();
echo json_encode([
        'message' => 'Fingerprints loaded.',
        'fingerprints' => [
            'faculty' => fetchFingerprintsByRole($pdo, 'faculty'),
            'staff' => fetchFingerprintsByRole($pdo, 'staff'),
            'admins' => fetchFingerprintsByRole($pdo, 'admins'),
        ],
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'message' => 'Unable to load fingerprints.',
        'error' => $error->getMessage(),
    ]);
}
