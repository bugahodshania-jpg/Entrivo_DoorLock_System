<?php

require_once dirname(__DIR__, 2) . '/config/connection.php';

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
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
    $result = $controller->queueTemplateSync($input);
    $body = $result['body'] ?? [];

    require_once dirname(__DIR__, 2) . '/services/ActivityLogService.php';
    $pdo = entrivo_pdo();
    $job = is_array($body['job'] ?? null) ? $body['job'] : [];

    if (!$job) {
        $fingerprintId = (int) ($input['fingerprint_id'] ?? 0);
        $fingerprint = $fingerprintId > 0 ? (new Fingerprint())->getById($fingerprintId) : null;
        $job = [
            'user_id' => $fingerprint['user_id'] ?? null,
            'finger_name' => $fingerprint['finger_name'] ?? '',
        ];
    }

    $job['error_message'] = empty($body['success']) ? (string) ($body['message'] ?? '') : '';
    $isAlreadyPending = !empty($body['success']) && stripos((string) ($body['message'] ?? ''), 'already pending') !== false;

    (new ActivityLogService($pdo))->recordFingerprintSync(
        $isAlreadyPending ? 'pending' : 'queued',
        $job,
        filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT) ?: null,
        !empty($body['success']) ? 'Success' : 'Failed'
    );

    http_response_code((int) ($result['status'] ?? 200));
    echo json_encode($result['body'] ?? ['message' => 'OK']);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Unable to queue template sync.',
        'error' => $error->getMessage(),
    ]);
}
