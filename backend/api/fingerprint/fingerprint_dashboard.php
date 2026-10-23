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
require_once dirname(__DIR__, 2) . '/services/SuperAdminDashboardSession.php';
require_once dirname(__DIR__, 2) . '/services/FingerprintEnrollmentReadiness.php';

function getFingerprintStandbyMap(PDO $pdo): array
{
    try {
        return (new SuperAdminDashboardSession($pdo))->standbyUserIdMap();
    } catch (Throwable) {
        return [];
    }
}

function resolveFingerprintUserStatus(bool $isActive, string $role, int $userId, array $standbyMap = []): string
{
    if ($isActive) {
        return 'active';
    }

    if ($role === 'super_admin' && !empty($standbyMap[$userId])) {
        return 'inactive';
    }

    return 'blocked';
}

function ensurePendingFingerprintsForAccounts(PDO $pdo): void
{
    // Registration creates one pending fingerprint per account. Recreate that
    // row when an account has none, so Enroll stays available after a reset.
    $pdo->exec(
        "INSERT INTO fingerprints (user_id, finger_name, status, enrolled_at)
         SELECT users.id, NULL, 'pending', NULL
         FROM users
         WHERE users.role IN ('faculty', 'staff', 'admin', 'super_admin')
           AND NOT EXISTS (
                SELECT 1 FROM fingerprints WHERE fingerprints.user_id = users.id
           )"
    );
}

function fetchFingerprintsByRole(PDO $pdo, string $roleKey, array $standbyMap = []): array
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
    $hasEnrolledAt = in_array('enrolled_at', $columns, true);
    $hasRegisteredAt = in_array('registered_at', $columns, true);
    $hasDoorSyncedAt = in_array('door_synced_at', $columns, true);
    $enrolledAtSource = $hasEnrolledAt
        ? 'fingerprints.enrolled_at'
        : ($hasRegisteredAt ? 'fingerprints.registered_at' : 'NULL');
    $enrolledAtExpression = $enrolledAtSource === 'NULL'
        ? 'NULL'
        : "DATE_FORMAT({$enrolledAtSource}, '%b %e, %Y %h:%i %p')";
    $syncedAtExpression = $hasDoorSyncedAt
        ? "DATE_FORMAT(fingerprints.door_synced_at, '%b %e, %Y %h:%i %p')"
        : 'NULL';
    $orderTimestampColumn = $enrolledAtSource === 'NULL'
        ? 'fingerprints.fingerprint_id'
        : $enrolledAtSource;

    $statement = $pdo->prepare(
        "SELECT
            fingerprints.fingerprint_id,
            fingerprints.finger_name,
            fingerprints.status AS fingerprint_status,
            fingerprints.enrollment_device_id,
            fingerprints.enrollment_slot,
            fingerprints.shared_door_slot,
            fingerprints.door_sync_status,
            {$syncedAtExpression} AS door_synced_at,
            CASE
                WHEN fingerprints.template_data IS NULL OR OCTET_LENGTH(fingerprints.template_data) = 0 THEN 0
                ELSE 1
            END AS has_template_data,
            COALESCE(OCTET_LENGTH(fingerprints.template_data), 0) AS template_bytes,
            {$enrolledAtExpression} AS enrolled_at,
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

    $rows = $statement->fetchAll();
    $verifiedMap = FingerprintEnrollmentReadiness::verifiedMap($pdo, array_column($rows, 'fingerprint_id'));

    return array_map(
        static function ($row) use ($standbyMap, $verifiedMap) {
            $nameParts = [
                $row['first_name'],
                $row['middle_name'],
                $row['last_name'],
                $row['extension_name'],
            ];
            $fullName = trim(implode(' ', array_filter($nameParts)));
            $userId = (int) $row['user_id'];
            $role = (string) $row['role'];

            return [
                'id' => (int) $row['fingerprint_id'],
                'userId' => $userId,
                'name' => $fullName ?: $row['username'],
                'username' => $row['username'],
                'email' => $row['email'],
                'role' => $role,
                'identifier' => $row['profile_identifier'] ?: 'Not assigned',
                'userPhoto' => $row['users_photo'] ?? null,
                'officeDepartment' => $row['office_department'],
                'workPosition' => $row['work_position'],
                'fingerName' => $row['finger_name'] ?: 'Pending Enrollment',
                'enrolledAt' => $row['enrolled_at'],
                'registeredAt' => $row['enrolled_at'],
                'status' => $row['fingerprint_status'],
                'enrollmentDeviceId' => isset($row['enrollment_device_id']) ? (int) $row['enrollment_device_id'] : null,
                'enrollmentSlot' => isset($row['enrollment_slot']) ? (int) $row['enrollment_slot'] : null,
                'sharedDoorSlot' => isset($row['shared_door_slot']) ? (int) $row['shared_door_slot'] : null,
                'doorSyncStatus' => $row['door_sync_status'],
                'syncedAt' => $row['door_synced_at'],
                'hasTemplateData' => (bool) ($row['has_template_data'] ?? false),
                'templateBytes' => (int) ($verifiedMap[(int) $row['fingerprint_id']]['template_bytes'] ?? $row['template_bytes'] ?? 0),
                'enrollmentVerified' => isset($verifiedMap[(int) $row['fingerprint_id']]),
                'enrollmentVerification' => $verifiedMap[(int) $row['fingerprint_id']] ?? null,
                'userStatus' => resolveFingerprintUserStatus(
                    (bool) $row['is_active'],
                    $role,
                    $userId,
                    $standbyMap
                ),
                'joinedAt' => $row['joined_at'],
            ];
        },
        $rows
    );
}

try {
    $pdo = entrivo_pdo();
    ensurePendingFingerprintsForAccounts($pdo);
    $standbyMap = getFingerprintStandbyMap($pdo);
    echo json_encode([
        'message' => 'Fingerprints loaded.',
        'fingerprints' => [
            'faculty' => fetchFingerprintsByRole($pdo, 'faculty', $standbyMap),
            'staff' => fetchFingerprintsByRole($pdo, 'staff', $standbyMap),
            'admins' => fetchFingerprintsByRole($pdo, 'admins', $standbyMap),
        ],
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'message' => 'Unable to load fingerprints.',
        'error' => $error->getMessage(),
    ]);
}
