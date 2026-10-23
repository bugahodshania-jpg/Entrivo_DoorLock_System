<?php

require_once dirname(__DIR__) . '/services/DoorStatusService.php';
header('Content-Type: application/json');
header('Cache-Control: no-store');
try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') throw new DoorStatusException('Use POST to report door status.', 405);
    entrivo_db_config();
    $token = getenv('DOOR_DEVICE_TOKEN');
    $provided = $_SERVER['HTTP_X_DEVICE_TOKEN'] ?? null;
    if (!is_string($token) || trim($token) === '') throw new DoorStatusException('The door device token is not configured.', 503);
    if (!is_string($provided) || !hash_equals($token, $provided)) throw new DoorStatusException('The door controller could not be authenticated.', 401);
    $input = json_decode(file_get_contents('php://input'), true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($input) || array_is_list($input)) throw new JsonException('A JSON object is required.');
    echo json_encode((new DoorStatusService())->report($input), JSON_THROW_ON_ERROR);
} catch (DoorStatusException $error) {
    http_response_code($error->httpStatus);
    echo json_encode(['success' => false, 'message' => $error->getMessage()]);
} catch (JsonException $error) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'A valid JSON object is required.']);
} catch (Throwable $error) {
    error_log('Door status device: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['success' => false, 'message' => 'Door status could not be received.']);
}
