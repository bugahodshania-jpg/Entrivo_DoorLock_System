<?php

require_once dirname(__DIR__, 2) . '/config/connection.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed.']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    $input = [];
}

require_once dirname(__DIR__, 2) . '/controllers/FingerprintSyncController.php';
require_once dirname(__DIR__, 2) . '/services/FingerprintSyncService.php';
require_once dirname(__DIR__, 2) . '/models/FingerprintSyncQueue.php';
require_once dirname(__DIR__, 2) . '/models/Fingerprint.php';

try {
    $controller = new FingerprintSyncController();
    $result = $controller->failDeviceJob($input);

    http_response_code((int) ($result['status'] ?? 200));
    echo json_encode($result['body'] ?? ['message' => 'OK']);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Unable to fail template sync.',
        'error' => $error->getMessage(),
    ]);
}
