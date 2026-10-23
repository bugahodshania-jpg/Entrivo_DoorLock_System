<?php

require_once dirname(__DIR__, 2) . '/services/CombinedDoorAccessService.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Device-Token');
header('Cache-Control: no-store');

$method = $_SERVER['REQUEST_METHOD'] ?? '';
if ($method === 'OPTIONS') { http_response_code(204); exit; }
if ($method !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'access_granted' => false, 'reason' => 'method_not_allowed', 'message' => 'Use POST to verify a door credential.']);
    exit;
}

try {
    // Load the existing backend/.env without opening a database connection.
    entrivo_db_config();
    $configured = getenv('DOOR_DEVICE_TOKEN');
    if (!is_string($configured) || trim($configured) === '') {
        http_response_code(503);
        echo json_encode(['success' => false, 'access_granted' => false, 'reason' => 'device_not_configured', 'message' => 'The combined door verification service is not configured.']);
        exit;
    }
    if (!CombinedDoorAccessService::deviceTokenMatches($configured, $_SERVER['HTTP_X_DEVICE_TOKEN'] ?? null)) {
        http_response_code(401);
        echo json_encode(['success' => false, 'access_granted' => false, 'reason' => 'unauthorized_device', 'message' => 'The door controller could not be authenticated.']);
        exit;
    }
    $input = json_decode(file_get_contents('php://input'), true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($input) || array_is_list($input)) throw new JsonException('A JSON object is required.');
    echo json_encode((new CombinedDoorAccessService())->verify($input));
} catch (JsonException $error) {
    http_response_code(422);
    echo json_encode(['success' => false, 'access_granted' => false, 'reason' => 'invalid_request', 'message' => 'A valid JSON object is required.']);
} catch (Throwable $error) {
    error_log('Combined door verification: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['success' => false, 'access_granted' => false, 'reason' => 'backend_unavailable', 'message' => 'Door access could not be verified. Try again when the backend is available.']);
}
