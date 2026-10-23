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

try {
    $input = json_decode(file_get_contents('php://input'), true);
    $service = new RfidScanService(entrivo_pdo());
    echo json_encode($service->verifyForRegistration(is_array($input) ? ($input['rfid_uid'] ?? '') : ''));
} catch (RfidUidVerificationException $error) {
    http_response_code($error->httpStatus);
    echo json_encode([
        'message' => $error->getMessage(),
        'code' => $error->errorCode,
        'errors' => ['rfid_uid' => $error->getMessage()],
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['message' => 'Unable to verify the RFID UID right now.']);
}
