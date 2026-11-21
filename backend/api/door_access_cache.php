<?php

// The door controller's offline schedule copy (binary, see DoorAccessCacheService).
// GET ?device_id=1 with the X-Device-Token header. The controller asks only
// when a door status reply carries a version different from the copy it has.
require_once dirname(__DIR__) . '/services/DoorAccessCacheService.php';
header('Cache-Control: no-store');
try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        http_response_code(405);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'message' => 'Use GET to download the door schedule copy.']);
        exit;
    }
    entrivo_db_config();
    $token = getenv('DOOR_DEVICE_TOKEN');
    $provided = $_SERVER['HTTP_X_DEVICE_TOKEN'] ?? null;
    if (!is_string($token) || trim($token) === '' || !is_string($provided) || !hash_equals($token, $provided)) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'message' => 'The door controller could not be authenticated.']);
        exit;
    }
    $deviceId = filter_var($_GET['device_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($deviceId === false) {
        http_response_code(422);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'message' => 'A valid device_id is required.']);
        exit;
    }
    $copy = (new DoorAccessCacheService(entrivo_pdo()))->build((int) $deviceId);
    header('Content-Type: application/octet-stream');
    header('Content-Length: ' . strlen($copy['bytes']));
    header('X-Access-Cache-Version: ' . $copy['version']);
    echo $copy['bytes'];
} catch (Throwable $error) {
    error_log('Door access cache: ' . $error->getMessage());
    http_response_code(503);
    header('Content-Type: application/json');
    echo json_encode(['success' => false, 'message' => 'The door schedule copy could not be built.']);
}
