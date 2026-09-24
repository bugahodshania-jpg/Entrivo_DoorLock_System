<?php

require_once dirname(__DIR__) . '/config/connection.php';

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? $allowedOrigins[0];
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['message' => 'Method not allowed.']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$rfidUid = strtoupper(preg_replace('/\s+/', '', (string) ($input['rfid_uid'] ?? '')));

if ($rfidUid === '') {
    http_response_code(422);
    echo json_encode(['message' => 'Enter the RFID UID shown on the scanner.']);
    exit;
}

if (strlen($rfidUid) > 30 || !preg_match('/^[A-Z0-9]+$/', $rfidUid)) {
    http_response_code(422);
    echo json_encode(['message' => 'The UID must match the scanner exactly.']);
    exit;
}

try {
    $pdo = entrivo_pdo();
    $statement = $pdo->prepare(
        'SELECT card_id FROM rfid_cards WHERE rfid_uid = :rfid_uid LIMIT 1'
    );
    $statement->execute(['rfid_uid' => $rfidUid]);

    if ($statement->fetch()) {
        http_response_code(409);
        echo json_encode(['message' => 'This UID is already registered.']);
        exit;
    }

    echo json_encode([
        'verified' => true,
        'rfid_uid' => $rfidUid,
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['message' => 'Unable to verify the RFID UID right now.']);
}
