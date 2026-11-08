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
    require_once dirname(__DIR__, 2) . '/utils/agent_debug_log.php';
    $configured = getenv('DOOR_DEVICE_TOKEN');
    if (!is_string($configured) || trim($configured) === '') {
        // #region agent log
        agent_debug_log('G', 'verify_access.php', 'Door verify rejected: token not configured', []);
        // #endregion
        http_response_code(503);
        echo json_encode(['success' => false, 'access_granted' => false, 'reason' => 'device_not_configured', 'message' => 'The combined door verification service is not configured.']);
        exit;
    }
    if (!CombinedDoorAccessService::deviceTokenMatches($configured, $_SERVER['HTTP_X_DEVICE_TOKEN'] ?? null)) {
        // #region agent log
        agent_debug_log('G', 'verify_access.php', 'Door verify rejected: unauthorized device token', [
            'has_header' => isset($_SERVER['HTTP_X_DEVICE_TOKEN']),
        ]);
        // #endregion
        http_response_code(401);
        echo json_encode(['success' => false, 'access_granted' => false, 'reason' => 'unauthorized_device', 'message' => 'The door controller could not be authenticated.']);
        exit;
    }
    $raw = file_get_contents('php://input');
    $input = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($input) || array_is_list($input)) throw new JsonException('A JSON object is required.');
    // #region agent log
    agent_debug_log('A', 'verify_access.php', 'Door verify accepted token; dispatching', [
        'method' => $input['method'] ?? null,
        'matched_slot' => $input['matched_slot'] ?? null,
        'enrollment_device_id' => $input['enrollment_device_id'] ?? null,
        'direction' => $input['direction'] ?? null,
        'hash_prefix' => isset($input['template_hash']) && is_string($input['template_hash'])
            ? substr($input['template_hash'], 0, 16) : null,
    ]);
    // #endregion
    echo json_encode((new CombinedDoorAccessService())->verify($input));
} catch (JsonException $error) {
    // #region agent log
    if (function_exists('agent_debug_log')) {
        agent_debug_log('G', 'verify_access.php', 'Door verify invalid JSON', ['error' => $error->getMessage()]);
    }
    // #endregion
    http_response_code(422);
    echo json_encode(['success' => false, 'access_granted' => false, 'reason' => 'invalid_request', 'message' => 'A valid JSON object is required.']);
} catch (Throwable $error) {
    // #region agent log
    if (function_exists('agent_debug_log')) {
        agent_debug_log('G', 'verify_access.php', 'Door verify backend exception', ['error' => $error->getMessage()]);
    }
    // #endregion
    error_log('Combined door verification: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['success' => false, 'access_granted' => false, 'reason' => 'backend_unavailable', 'message' => 'Door access could not be verified. Try again when the backend is available.']);
}
