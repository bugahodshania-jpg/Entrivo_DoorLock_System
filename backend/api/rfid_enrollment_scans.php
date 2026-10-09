<?php

date_default_timezone_set('Asia/Manila');

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['message' => 'Method not allowed']);
    exit;
}

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/RfidScanService.php';

try {
    $service = new RfidScanService(entrivo_pdo());
    echo json_encode(['scans' => $service->listScans()]);
} catch (PDOException $exception) {
    http_response_code(500);
    echo json_encode(['message' => 'Unable to load enrollment scans right now.']);
}
