<?php

require_once dirname(__DIR__, 2) . '/services/DirectFingerprintAccessService.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'access_granted' => false, 'reason' => 'method_not_allowed', 'message' => 'Use POST to verify direct fingerprint access.']);
    exit;
}

try {
    $input = json_decode(file_get_contents('php://input'), true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($input) || array_is_list($input)) {
        throw new JsonException('A JSON object is required.');
    }
    $decision = (new DirectFingerprintAccessService())->verify($input);
    http_response_code($decision['success'] ? 200 : 422);
    echo json_encode($decision);
} catch (JsonException $error) {
    http_response_code(422);
    echo json_encode(['success' => false, 'access_granted' => false, 'reason' => 'invalid_request', 'message' => 'A valid JSON object with enrollment_device_id and matched_slot is required.']);
} catch (Throwable $error) {
    error_log('Direct fingerprint access: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['success' => false, 'access_granted' => false, 'reason' => 'backend_unavailable', 'message' => 'Door access could not be verified. Keep the door locked and try again when the backend is available.']);
}
