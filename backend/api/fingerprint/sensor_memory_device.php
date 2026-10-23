<?php

require_once dirname(__DIR__, 2) . '/services/SensorMemoryService.php';
header('Content-Type: application/json');
header('Cache-Control: no-store');
$method = $_SERVER['REQUEST_METHOD'] ?? '';

try {
    if ($method !== 'POST') throw new SensorMemoryException('Use POST for sensor memory device requests.', 405);
    // The existing combined controller secret is loaded without connecting to DB.
    entrivo_db_config();
    $configured = getenv('DOOR_DEVICE_TOKEN');
    if (!is_string($configured) || trim($configured) === '') throw new SensorMemoryException('The sensor device token is not configured.', 503);
    if (!SensorMemoryService::deviceTokenMatches($configured, $_SERVER['HTTP_X_DEVICE_TOKEN'] ?? null)) {
        throw new SensorMemoryException('The sensor controller could not be authenticated.', 401);
    }
    $input = json_decode(file_get_contents('php://input'), true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($input) || array_is_list($input)) throw new JsonException('A JSON object is required.');
    $service = new SensorMemoryService();
    $action = $input['action'] ?? null;
    if ($action === 'claim') $result = $service->claim($input);
    elseif (in_array($action, ['complete', 'fail'], true)) $result = $service->deviceUpdate($input);
    else throw new SensorMemoryException('Use claim, complete, or fail.', 422);
    echo json_encode($result, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
} catch (SensorMemoryException $error) {
    http_response_code($error->httpStatus);
    echo json_encode(['success' => false, 'message' => $error->getMessage()]);
} catch (JsonException $error) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'A valid JSON object is required.']);
} catch (Throwable $error) {
    error_log('Sensor memory device: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['success' => false, 'message' => 'The sensor result could not be received. Retry when the backend is available.']);
}
