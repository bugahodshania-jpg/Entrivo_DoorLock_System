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

function fetchStudentRfidCards(PDO $pdo): array
{
    $statement = $pdo->prepare(
        "SELECT
            rfid_cards.card_id,
            rfid_cards.rfid_uid,
            rfid_cards.status AS rfid_status,
            DATE_FORMAT(rfid_cards.issued_at, '%b %e, %Y %h:%i %p') AS issued_at,
            users.id AS user_id,
            users.username,
            users.email,
            users.role,
            users.is_active,
            student_info.school_id,
            student_info.first_name,
            student_info.middle_name,
            student_info.last_name,
            student_info.extension_name,
            student_info.college,
            student_info.program_department,
            student_info.year_level
         FROM rfid_cards
         INNER JOIN users ON users.id = rfid_cards.user_id
         LEFT JOIN student_info ON student_info.user_id = users.id
         WHERE users.role = 'student'
         ORDER BY rfid_cards.issued_at DESC, student_info.last_name ASC, student_info.first_name ASC"
    );

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
                'id' => (int) $row['card_id'],
                'userId' => (int) $row['user_id'],
                'name' => $fullName ?: $row['username'],
                'email' => $row['email'],
                'studentId' => $row['school_id'] ?: 'Not assigned',
                'college' => $row['college'] ?: 'No college set',
                'programDepartment' => $row['program_department'] ?: 'Not assigned',
                'yearLevel' => $row['year_level'] ?: 'Not set',
                'rfidUid' => $row['rfid_uid'],
                'status' => $row['rfid_status'],
                'issuedAt' => $row['issued_at'],
                'userStatus' => (bool) $row['is_active'] ? 'active' : 'inactive',
            ];
        },
        $statement->fetchAll()
    );
}

try {
    $pdo = entrivo_pdo();
echo json_encode([
        'message' => 'RFID cards loaded.',
        'rfidCards' => fetchStudentRfidCards($pdo),
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'message' => 'Unable to load RFID cards.',
        'error' => $error->getMessage(),
    ]);
}
