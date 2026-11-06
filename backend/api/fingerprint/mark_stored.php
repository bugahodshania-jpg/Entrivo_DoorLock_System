<?php

require_once dirname(__DIR__, 2) . '/config/connection.php';
require_once dirname(__DIR__, 2) . '/services/FingerprintEnrollmentVerification.php';

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Device-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'message' => 'Method not allowed.'
    ]);
    exit;
}

entrivo_db_config();
$configured = getenv('DOOR_DEVICE_TOKEN');
if (!is_string($configured) || trim($configured) === '') {
    http_response_code(503);
    echo json_encode(['success' => false, 'message' => 'The enrollment device token is not configured.']);
    exit;
}
if (!FingerprintEnrollmentVerification::deviceTokenMatches($configured, $_SERVER['HTTP_X_DEVICE_TOKEN'] ?? null)) {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'The enrollment device could not be authenticated.']);
    exit;
}
$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    $input = [];
}

require_once dirname(__DIR__, 2) . '/controllers/FingerprintEnrollmentController.php';
require_once dirname(__DIR__, 2) . '/services/FingerprintEnrollmentService.php';
require_once dirname(__DIR__, 2) . '/models/FingerprintEnrollmentJob.php';

try {
    $controller = new FingerprintEnrollmentController();
    $result = $controller->markStored($input);

    http_response_code((int) ($result['status'] ?? 200));
    echo json_encode($result['body'] ?? ['message' => 'OK']);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Unable to record sensor storage.',
        'error' => $error->getMessage(),
    ]);
}
