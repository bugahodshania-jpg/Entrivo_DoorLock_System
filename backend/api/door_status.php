<?php

require_once dirname(__DIR__) . '/services/DoorStatusService.php';
header('Content-Type: application/json');
header('Cache-Control: no-store');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? $allowedOrigins[0];
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Vary: Origin');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') throw new DoorStatusException('Use GET to view door status.', 405);
    echo json_encode((new DoorStatusService())->read($_GET), JSON_THROW_ON_ERROR);
} catch (DoorStatusException $error) {
    http_response_code($error->httpStatus);
    echo json_encode(['success' => false, 'message' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('Door status: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['success' => false, 'message' => 'Door status is unavailable.']);
}
