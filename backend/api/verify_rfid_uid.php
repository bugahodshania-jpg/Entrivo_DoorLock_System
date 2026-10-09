<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/RfidScanService.php';

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
$service = new RfidScanService(entrivo_pdo());
$rfidUid = $service->normalizeUid(is_array($input) ? ($input['rfid_uid'] ?? '') : '');

if ($rfidUid === '') {
    http_response_code(422);
    echo json_encode(['message' => 'Enter the RFID UID shown on the scanner.']);
    exit;
}

if (!$service->isValidUid($rfidUid)) {
    http_response_code(422);
    echo json_encode(['message' => 'The UID must match the scanner exactly.']);
    exit;
}

try {
    if ($service->isRegistered($rfidUid)) {
        http_response_code(409);
        echo json_encode(['message' => 'This UID is already registered.']);
        exit;
    }

    $scan = $service->latestScan($rfidUid);
    if ($scan === null) {
        http_response_code(422);
        echo json_encode([
            'message' => 'This UID was not scanned yet. Scan your school ID at the RFID station, then enter the UID shown on the screen.',
        ]);
        exit;
    }

    echo json_encode([
        'verified' => true,
        'rfid_uid' => $rfidUid,
        'scanned_at' => $scan['scanned_at'],
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['message' => 'Unable to verify the RFID UID right now.']);
}
