<?php

date_default_timezone_set('Asia/Manila');

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'POST'], true)) {
    http_response_code(405);
    echo json_encode(['message' => 'Method not allowed']);
    exit;
}

require_once dirname(__DIR__) . '/services/UserRegistrationService.php';

require_once dirname(__DIR__) . '/config/connection.php';

function fetchUsersByRole(PDO $pdo, string $roleKey): array
{
    $profileTable = match ($roleKey) {
        'students' => 'student_info',
        'faculty' => 'faculty_info',
        'staff' => 'staff_info',
        'admins' => 'admin_info',
    };
    $idColumn = $roleKey === 'students' ? 'school_id' : 'employee_id';
    $roleCondition = $roleKey === 'admins'
        ? "users.role IN ('admin', 'super_admin')"
        : 'users.role = :role';

    $statement = $pdo->prepare(
        "SELECT
            users.id,
            users.username,
            users.email,
            users.role,
            users.is_active,
            users.approval_status,
            DATE_FORMAT(users.created_at, '%b %e, %Y') AS joined_at,
            {$profileTable}.{$idColumn} AS profile_identifier,
            {$profileTable}.first_name,
            {$profileTable}.middle_name,
            {$profileTable}.last_name,
            {$profileTable}.extension_name,
            {$profileTable}.sex,
            {$profileTable}.contact_number,
            " . ($roleKey === 'students'
                ? "{$profileTable}.college,
                   {$profileTable}.program_department,
                   {$profileTable}.year_level,
                   {$profileTable}.section,
                   NULL AS office_department,
                   NULL AS work_position"
                : "NULL AS college,
                   NULL AS program_department,
                   NULL AS year_level,
                   NULL AS section,
                   {$profileTable}.office_department,
                   {$profileTable}.work_position") . ",
            COALESCE(rfid_cards.status, 'unassigned') AS rfid_status,
            COUNT(fingerprints.fingerprint_id) AS fingerprint_count
         FROM users
         LEFT JOIN {$profileTable} ON {$profileTable}.user_id = users.id
         LEFT JOIN rfid_cards ON rfid_cards.user_id = users.id
         LEFT JOIN fingerprints ON fingerprints.user_id = users.id AND fingerprints.status = 'active'
         WHERE {$roleCondition}
         GROUP BY
            users.id,
            users.username,
            users.email,
            users.role,
            users.is_active,
            users.approval_status,
            users.created_at,
            {$profileTable}.{$idColumn},
            {$profileTable}.first_name,
            {$profileTable}.middle_name,
            {$profileTable}.last_name,
            {$profileTable}.extension_name,
            {$profileTable}.sex,
            {$profileTable}.contact_number,
            {$profileTable}." . ($roleKey === 'students' ? 'college' : 'office_department') . ",
            {$profileTable}." . ($roleKey === 'students' ? 'program_department' : 'work_position') . ",
            " . ($roleKey === 'students' ? "{$profileTable}.year_level,
            {$profileTable}.section," : '') . "
            rfid_cards.status
         ORDER BY {$profileTable}.last_name ASC, {$profileTable}.first_name ASC, users.username ASC"
    );

    if ($roleKey !== 'admins') {
        $statement->bindValue(':role', rtrim($roleKey, 's'));
    }

    $statement->execute();

    return array_map(
        static function ($user) {
            $nameParts = [
                $user['first_name'],
                $user['middle_name'],
                $user['last_name'],
                $user['extension_name'],
            ];
            $fullName = trim(implode(' ', array_filter($nameParts)));

            return [
                'id' => (int) $user['id'],
                'name' => $fullName ?: $user['username'],
                'username' => $user['username'],
                'email' => $user['email'],
                'role' => $user['role'],
                'identifier' => $user['profile_identifier'] ?: 'Not assigned',
                'sex' => $user['sex'] ?: 'N/A',
                'contactNumber' => $user['contact_number'] ?: 'Not provided',
                'college' => $user['college'],
                'programDepartment' => $user['program_department'],
                'yearLevel' => $user['year_level'],
                'section' => $user['section'],
                'officeDepartment' => $user['office_department'],
                'workPosition' => $user['work_position'],
                'rfidStatus' => $user['rfid_status'],
                'fingerprintCount' => (int) $user['fingerprint_count'],
                'status' => match ($user['approval_status'] ?? 'approved') {
                    'pending' => 'pending',
                    'rejected' => 'rejected',
                    default => (bool) $user['is_active'] ? 'active' : 'inactive',
                },
                'joinedAt' => $user['joined_at'],
            ];
        },
        $statement->fetchAll()
    );
}

try {
    $pdo = entrivo_pdo();
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);

        if (!is_array($input)) {
            http_response_code(400);
            echo json_encode(['message' => 'Invalid JSON payload.']);
            exit;
        }

        $service = new UserRegistrationService($pdo);
        $savedUser = $service->registerUser($input);

        http_response_code(201);
        echo json_encode([
            'message' => ($savedUser['role'] ?? null) === 'student'
                ? 'Student saved successfully.'
                : 'User saved successfully. Fingerprint enrollment is pending.',
            'user' => $savedUser,
        ]);
        exit;
    }

    echo json_encode([
        'message' => 'Users loaded.',
        'users' => [
            'faculty' => fetchUsersByRole($pdo, 'faculty'),
            'staff' => fetchUsersByRole($pdo, 'staff'),
            'admins' => fetchUsersByRole($pdo, 'admins'),
            'students' => fetchUsersByRole($pdo, 'students'),
        ],
    ]);
} catch (InvalidArgumentException $error) {
    http_response_code(422);
    echo json_encode([
        'message' => $error->getMessage(),
    ]);
} catch (PDOException $error) {
    $isDuplicate = $error->errorInfo[1] ?? null;
    http_response_code($isDuplicate === 1062 ? 409 : 500);
    echo json_encode([
        'message' => $isDuplicate === 1062
            ? 'Username, email, school ID, employee ID, or fingerprint slot already exists.'
            : 'Unable to save user.',
        'error' => $error->getMessage(),
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'message' => 'Unable to load or save users.',
        'error' => $error->getMessage(),
    ]);
}
