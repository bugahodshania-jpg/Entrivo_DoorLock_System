<?php

require_once dirname(__DIR__, 2) . '/services/SensorMemoryService.php';
header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? $allowedOrigins[0];
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Vary: Origin');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Cache-Control: no-store');
$method = $_SERVER['REQUEST_METHOD'] ?? '';
if ($method === 'OPTIONS') { http_response_code(204); exit; }

try {
    $service = new SensorMemoryService();
    if ($method === 'GET') {
        $result = $service->read($_GET);
    } elseif ($method === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true, 16, JSON_THROW_ON_ERROR);
        if (!is_array($input) || array_is_list($input)) throw new JsonException('A JSON object is required.');
        $result = $service->adminAction($input);
    } else {
        throw new SensorMemoryException('Use GET or POST for Sensor Memory.', 405);
    }
    echo json_encode($result, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
} catch (SensorMemoryException $error) {
    http_response_code($error->httpStatus);
    echo json_encode(['success' => false, 'message' => $error->getMessage()]);
} catch (JsonException $error) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'A valid JSON object is required.']);
} catch (Throwable $error) {
    error_log('Sensor memory: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['success' => false, 'message' => 'Sensor Memory is unavailable. No physical sensor read was confirmed. Try again when the backend is available.']);
}
