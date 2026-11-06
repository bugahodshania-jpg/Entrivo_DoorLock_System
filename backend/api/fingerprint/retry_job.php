<?php

require_once dirname(__DIR__, 2) . '/config/connection.php';

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'message' => 'Method not allowed.'
    ]);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    $input = [];
}

require_once dirname(__DIR__, 2) . '/controllers/FingerprintEnrollmentController.php';
require_once dirname(__DIR__, 2) . '/services/FingerprintEnrollmentService.php';
require_once dirname(__DIR__, 2) . '/models/FingerprintEnrollmentJob.php';
require_once dirname(__DIR__, 2) . '/services/UserPrivilegeService.php';

$actorId = filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT) ?: null;

if (!$actorId) {
    http_response_code(422);
    echo json_encode([
        'success' => false,
        'message' => 'A valid actor id is required to retry an enrollment.',
    ]);
    exit;
}

try {
    (new UserPrivilegeService(entrivo_pdo()))->assertActorHasPrivilege(
        $actorId,
        'fingerprint_update',
        'You do not have permission to enroll or update fingerprints. Ask a Super Admin to grant Enroll & Update Fingerprints access.'
    );
} catch (InvalidArgumentException $error) {
    http_response_code(403);
    echo json_encode([
        'success' => false,
        'message' => $error->getMessage(),
    ]);
    exit;
}

try {
    $controller = new FingerprintEnrollmentController();
    $result = $controller->retryEnrollmentJob($input);

    if (!empty($result['body']['success'])) {
        require_once dirname(__DIR__, 2) . '/services/ActivityLogService.php';
        $job = is_array($result['body']['job'] ?? null) ? $result['body']['job'] : [];
        $job['job_id'] = $job['job_id'] ?? ($input['job_id'] ?? null);
        $job['error_message'] = '';
        (new ActivityLogService(entrivo_pdo()))->recordFingerprintJob(
            'retried',
            $job,
            filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT) ?: null
        );
    }

    http_response_code((int) ($result['status'] ?? 200));
    echo json_encode($result['body'] ?? ['message' => 'OK']);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Unable to retry enrollment job.',
        'error' => $error->getMessage(),
    ]);
}
