<?php

require_once dirname(__DIR__, 2) . '/config/connection.php';
require_once dirname(__DIR__, 2) . '/services/FingerprintEnrollmentVerification.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Device-Token');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Use POST to report the stored-slot template.']);
    exit;
}

try {
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
    $input = json_decode(file_get_contents('php://input'), true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($input) || array_is_list($input)) {
        throw new JsonException('Expected a JSON object.');
    }

    require_once dirname(__DIR__, 2) . '/controllers/FingerprintEnrollmentController.php';
    require_once dirname(__DIR__, 2) . '/services/FingerprintEnrollmentService.php';
    require_once dirname(__DIR__, 2) . '/models/FingerprintEnrollmentJob.php';

    $controller = new FingerprintEnrollmentController();
    $result = $controller->reportIdentifyMatch($input);
    http_response_code((int) ($result['status'] ?? 200));
    echo json_encode($result['body'] ?? ['message' => 'OK']);
} catch (JsonException $error) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'A valid JSON object is required.']);
} catch (Throwable $error) {
    error_log('Identify match report: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['success' => false, 'message' => 'Unable to record the stored-slot template. The stored slot was preserved.']);
}
