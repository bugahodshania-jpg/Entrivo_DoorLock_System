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
    echo json_encode(['message' => 'Method not allowed.']);
    exit;
}

require_once dirname(__DIR__) . '/config/connection.php';

function ensureRejectedStatus(PDO $pdo): void
{
    $column = $pdo->query("SHOW COLUMNS FROM users LIKE 'approval_status'")->fetch();
    $type = (string) ($column['Type'] ?? '');

    if ($type !== '' && !str_contains($type, 'rejected')) {
        $pdo->exec(
            "ALTER TABLE users
             MODIFY COLUMN approval_status ENUM('approved', 'pending', 'rejected') NOT NULL DEFAULT 'approved'"
        );
    }
}

function mapPendingRegistration(array $row, bool $includePhoto = false): array
{
    $name = trim(implode(' ', array_filter([
        $row['first_name'] ?? '',
        $row['middle_name'] ?? '',
        $row['last_name'] ?? '',
        $row['extension_name'] ?? '',
    ])));
    $address = trim(implode(', ', array_filter([
        $row['street_address'] ?? '',
        $row['barangay'] ?? '',
        $row['city_municipality'] ?? '',
        $row['province'] ?? '',
        $row['zip_code'] ?? '',
        $row['country'] ?? '',
    ])));

    $registration = [
        'id' => (int) $row['id'],
        'name' => $name !== '' ? $name : $row['username'],
        'username' => $row['username'],
        'email' => $row['email'],
        'schoolId' => $row['school_id'],
        'college' => $row['college'] ?? '',
        'program' => $row['program_department'],
        'yearLevel' => $row['year_level'],
        'section' => ($row['section'] ?? '') !== '' ? $row['section'] : 'No section',
        'sex' => $row['sex'] ?? '',
        'birthdate' => $row['birthdate'] ?? '',
        'age' => isset($row['age']) && $row['age'] !== '' && $row['age'] !== null ? (string) $row['age'] : '',
        'contactNumber' => $row['contact_number'] ?? '',
        'address' => $address,
        'rfidUid' => ($row['rfid_uid'] ?? '') !== '' ? $row['rfid_uid'] : 'Not provided',
        'submittedAt' => $row['submitted_at'],
        'approvalDueAt' => ($row['approval_due_at'] ?? '') !== '' ? $row['approval_due_at'] : 'Not set',
    ];

    if ($includePhoto) {
        $registration['schoolIdPhoto'] = $row['school_id_photo'] ?? '';
    }

    return $registration;
}

function fetchPendingRegistrations(PDO $pdo): array
{
    $statement = $pdo->query(
        "SELECT
            users.id,
            users.username,
            users.email,
            DATE_FORMAT(users.created_at, '%b %e, %Y %h:%i %p') AS submitted_at,
            DATE_FORMAT(users.approval_due_at, '%b %e, %Y %h:%i %p') AS approval_due_at,
            student_info.school_id,
            student_info.first_name,
            student_info.middle_name,
            student_info.last_name,
            student_info.extension_name,
            student_info.program_department,
            student_info.year_level,
            student_info.section,
            rfid_cards.rfid_uid
         FROM users
         INNER JOIN student_info ON student_info.user_id = users.id
         LEFT JOIN rfid_cards ON rfid_cards.user_id = users.id
         WHERE users.role = 'student'
           AND users.approval_status = 'pending'
         ORDER BY users.created_at ASC, student_info.last_name ASC"
    );

    return array_map(
        static fn ($row) => mapPendingRegistration($row),
        $statement->fetchAll()
    );
}

function fetchPendingRegistration(PDO $pdo, int $userId): ?array
{
    $statement = $pdo->prepare(
        "SELECT
            users.id,
            users.username,
            users.email,
            DATE_FORMAT(users.created_at, '%b %e, %Y %h:%i %p') AS submitted_at,
            DATE_FORMAT(users.approval_due_at, '%b %e, %Y %h:%i %p') AS approval_due_at,
            student_info.school_id,
            student_info.first_name,
            student_info.middle_name,
            student_info.last_name,
            student_info.extension_name,
            student_info.sex,
            DATE_FORMAT(student_info.date_of_birth, '%b %e, %Y') AS birthdate,
            student_info.age,
            student_info.contact_number,
            student_info.college,
            student_info.program_department,
            student_info.year_level,
            student_info.section,
            student_info.street_address,
            student_info.barangay,
            student_info.city_municipality,
            student_info.province,
            student_info.zip_code,
            student_info.country,
            student_info.school_id_photo,
            rfid_cards.rfid_uid
         FROM users
         INNER JOIN student_info ON student_info.user_id = users.id
         LEFT JOIN rfid_cards ON rfid_cards.user_id = users.id
         WHERE users.id = :id
           AND users.role = 'student'
           AND users.approval_status = 'pending'
         LIMIT 1"
    );
    $statement->execute(['id' => $userId]);
    $row = $statement->fetch();

    return $row ? mapPendingRegistration($row, true) : null;
}

try {
    $pdo = entrivo_pdo();

    if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['id'])) {
        $registration = fetchPendingRegistration($pdo, (int) $_GET['id']);

        if (!$registration) {
            http_response_code(404);
            echo json_encode(['message' => 'That pending registration was not found.']);
            exit;
        }

        echo json_encode([
            'message' => 'Pending registration loaded.',
            'registration' => $registration,
        ]);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $userId = (int) ($input['user_id'] ?? 0);
        $action = $input['action'] ?? 'approve';

        if ($userId <= 0) {
            http_response_code(422);
            echo json_encode(['message' => 'A student registration is required.']);
            exit;
        }

        if (!in_array($action, ['approve', 'reject'], true)) {
            http_response_code(422);
            echo json_encode(['message' => 'Choose approve or reject.']);
            exit;
        }

        if ($action === 'reject') {
            ensureRejectedStatus($pdo);
            $statement = $pdo->prepare(
                "UPDATE users
                 SET approval_status = 'rejected',
                     is_active = 0
                 WHERE id = :id
                   AND role = 'student'
                   AND approval_status = 'pending'"
            );
            $message = 'Student registration rejected. The account stays inactive.';
        } else {
            $statement = $pdo->prepare(
                "UPDATE users
                 SET approval_status = 'approved',
                     is_active = 1
                 WHERE id = :id
                   AND role = 'student'
                   AND approval_status = 'pending'"
            );
            $message = 'Student registration approved. The account is now active.';
        }

        $statement->execute(['id' => $userId]);

        if ($statement->rowCount() === 0) {
            http_response_code(404);
            echo json_encode(['message' => 'That pending registration was not found.']);
            exit;
        }

        echo json_encode([
            'message' => $message,
            'registrations' => fetchPendingRegistrations($pdo),
        ]);
        exit;
    }

    echo json_encode([
        'message' => 'Pending registrations loaded.',
        'registrations' => fetchPendingRegistrations($pdo),
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['message' => 'Unable to load pending registrations right now.']);
}
