<?php

require_once dirname(__DIR__, 2) . '/config/connection.php';

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? $allowedOrigins[0];
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Device-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'message' => 'Method not allowed.'
    ]);
    exit;
}

$query = [
    'enrollment_device_id' => filter_input(INPUT_GET, 'enrollment_device_id', FILTER_VALIDATE_INT) ?: null,
];

require_once dirname(__DIR__, 2) . '/controllers/FingerprintEnrollmentController.php';
require_once dirname(__DIR__, 2) . '/services/FingerprintEnrollmentService.php';
require_once dirname(__DIR__, 2) . '/services/DoorStatusService.php';
require_once dirname(__DIR__, 2) . '/models/FingerprintEnrollmentJob.php';

try {
    entrivo_db_config();
    $token = getenv('DOOR_DEVICE_TOKEN');
    $provided = $_SERVER['HTTP_X_DEVICE_TOKEN'] ?? null;
    $deviceId = (int) ($query['enrollment_device_id'] ?? 0);
    if ($deviceId > 0 && is_string($token) && trim($token) !== '' && is_string($provided)
        && hash_equals($token, $provided)) {
        (new DoorStatusService())->refreshLocked($deviceId);
    }

    $controller = new FingerprintEnrollmentController();
    $result = $controller->getPendingJob($query);

    http_response_code((int) ($result['status'] ?? 200));
    echo json_encode($result['body'] ?? ['message' => 'OK']);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'message' => 'Unable to load pending enrollment job.',
        'error' => $error->getMessage(),
    ]);
}
