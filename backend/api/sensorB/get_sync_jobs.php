<?php

require_once dirname(__DIR__, 2) . '/config/connection.php';

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
    echo json_encode(['success' => false, 'message' => 'Method not allowed.']);
    exit;
}

$query = [
    'limit' => filter_input(INPUT_GET, 'limit', FILTER_VALIDATE_INT) ?: 25,
    'queue_id' => filter_input(INPUT_GET, 'queue_id', FILTER_VALIDATE_INT) ?: null,
];

require_once dirname(__DIR__, 2) . '/controllers/FingerprintSyncController.php';
require_once dirname(__DIR__, 2) . '/services/FingerprintSyncService.php';
require_once dirname(__DIR__, 2) . '/models/FingerprintSyncQueue.php';
require_once dirname(__DIR__, 2) . '/models/Fingerprint.php';

try {
    $controller = new FingerprintSyncController();
    $result = $controller->listSyncJobs($query);

    http_response_code((int) ($result['status'] ?? 200));
    echo json_encode($result['body'] ?? ['message' => 'OK']);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Unable to load sync jobs.',
        'error' => $error->getMessage(),
    ]);
}
