<?php

date_default_timezone_set('Asia/Manila');

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: GET, PUT, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'PUT'], true)) {
    http_response_code(405);
    echo json_encode(['message' => 'Method not allowed']);
    exit;
}

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/ActivityLogService.php';
require_once dirname(__DIR__) . '/services/RfidScanService.php';

function mapStudentRfidCard(array $row): array
{
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
        'section' => $row['section'] ?: 'No section',
        'userPhoto' => $row['school_id_photo'] ?? null,
        'rfidUid' => $row['rfid_uid'],
        'status' => $row['rfid_status'],
        'issuedAt' => $row['issued_at'],
        'userStatus' => (bool) $row['is_active'] ? 'active' : 'blocked',
    ];
}

function fetchStudentRfidCardById(PDO $pdo, int $cardId): ?array
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
            student_info.year_level,
            student_info.section,
            student_info.school_id_photo
         FROM rfid_cards
         INNER JOIN users ON users.id = rfid_cards.user_id
         LEFT JOIN student_info ON student_info.user_id = users.id
         WHERE rfid_cards.card_id = :card_id
           AND users.role = 'student'
         LIMIT 1"
    );
    $statement->execute(['card_id' => $cardId]);
    $row = $statement->fetch();

    return $row ? mapStudentRfidCard($row) : null;
}

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
            student_info.year_level,
            student_info.section,
            student_info.school_id_photo
         FROM rfid_cards
         INNER JOIN users ON users.id = rfid_cards.user_id
         LEFT JOIN student_info ON student_info.user_id = users.id
         WHERE users.role = 'student'
         ORDER BY rfid_cards.issued_at DESC, student_info.last_name ASC, student_info.first_name ASC"
    );

    $statement->execute();

    return array_map('mapStudentRfidCard', $statement->fetchAll());
}

function updateStudentRfidCard(PDO $pdo, int $cardId, array $input): array
{
    $existing = fetchStudentRfidCardById($pdo, $cardId);

    if (!$existing) {
        throw new InvalidArgumentException('That RFID card was not found.');
    }

    $rfidUid = strtoupper(preg_replace('/\s+/', '', (string) ($input['rfidUid'] ?? $input['rfid_uid'] ?? $existing['rfidUid'])));
    $status = strtolower(trim((string) ($input['status'] ?? $existing['status'])));

    if ($rfidUid === '') {
        throw new InvalidArgumentException('RFID UID is required.');
    }

    if (strlen($rfidUid) > 30 || !preg_match('/^[A-Z0-9]+$/', $rfidUid)) {
        throw new InvalidArgumentException('RFID UID must be up to 30 letters or numbers.');
    }

    if (!in_array($status, ['active', 'inactive', 'lost'], true)) {
        throw new InvalidArgumentException('RFID status must be active, inactive, or lost.');
    }

    $duplicate = $pdo->prepare(
        'SELECT card_id
         FROM rfid_cards
         WHERE rfid_uid = :rfid_uid
           AND card_id <> :card_id
         LIMIT 1'
    );
    $duplicate->execute([
        'rfid_uid' => $rfidUid,
        'card_id' => $cardId,
    ]);

    if ($duplicate->fetch()) {
        throw new InvalidArgumentException('That RFID UID is already assigned to another card.');
    }

    $existingUid = strtoupper(preg_replace('/\s+/', '', (string) ($existing['rfidUid'] ?? '')));

    if ($rfidUid !== $existingUid) {
        $scans = new RfidScanService($pdo);

        if ($scans->latestScan($rfidUid) === null) {
            throw new InvalidArgumentException('This UID was not scanned yet. Scan the school ID at the RFID station, then enter the UID shown on the screen.');
        }
    }

    $update = $pdo->prepare(
        'UPDATE rfid_cards
         SET rfid_uid = :rfid_uid,
             status = :status
         WHERE card_id = :card_id'
    );
    $update->execute([
        'rfid_uid' => $rfidUid,
        'status' => $status,
        'card_id' => $cardId,
    ]);

    $updated = fetchStudentRfidCardById($pdo, $cardId);

    if (!$updated) {
        throw new RuntimeException('RFID card was updated but could not be reloaded.');
    }

    return $updated;
}

try {
    $pdo = entrivo_pdo();

    if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
        $input = json_decode(file_get_contents('php://input'), true);

        if (!is_array($input)) {
            http_response_code(400);
            echo json_encode(['message' => 'Invalid JSON payload.']);
            exit;
        }

        $cardId = filter_var($input['id'] ?? $input['card_id'] ?? null, FILTER_VALIDATE_INT);

        if (!$cardId) {
            http_response_code(422);
            echo json_encode(['message' => 'A valid RFID card id is required.']);
            exit;
        }

        $updatedCard = updateStudentRfidCard($pdo, $cardId, $input);
        $actorId = filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT) ?: null;

        (new ActivityLogService($pdo))->record(
            $actorId,
            'Update',
            'Updated RFID card for ' . ($updatedCard['name'] ?? 'a student')
                . ' (UID: ' . ($updatedCard['rfidUid'] ?? 'n/a') . ').',
            'Success',
            isset($updatedCard['userId']) ? (int) $updatedCard['userId'] : null,
            'rfid',
            (string) $cardId
        );

        echo json_encode([
            'message' => 'RFID card updated successfully.',
            'rfidCard' => $updatedCard,
        ]);
        exit;
    }

    echo json_encode([
        'message' => 'RFID cards loaded.',
        'rfidCards' => fetchStudentRfidCards($pdo),
    ]);
} catch (InvalidArgumentException $error) {
    http_response_code(422);
    echo json_encode([
        'message' => $error->getMessage(),
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'message' => 'Unable to process RFID cards.',
        'error' => $error->getMessage(),
    ]);
}
