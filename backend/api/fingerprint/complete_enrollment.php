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
require_once dirname(__DIR__, 2) . '/models/Fingerprint.php';

require_once dirname(__DIR__, 2) . '/services/ActivityLogService.php';

try {
    $activityLog = new ActivityLogService(entrivo_pdo());
    $jobId = (int) ($input['job_id'] ?? 0);
    $jobBefore = $jobId > 0 ? (new FingerprintEnrollmentJob())->getJobById($jobId) : null;
    $isUpdate = is_array($jobBefore) ? $activityLog->fingerprintJobIsUpdate($jobBefore) : null;

    $controller = new FingerprintEnrollmentController();
    $result = $controller->completeEnrollment($input);
    $actorId = filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT) ?: null;
    $job = is_array($result['body']['job'] ?? null) ? $result['body']['job'] : [];

    if ($job !== [] || !empty($result['body']['success'])) {
        $job['is_update'] = $isUpdate;
        $activityLog->recordFingerprintResult(
            $job,
            !empty($result['body']['success']) ? 'success' : 'failed',
            $actorId
        );
    }

    http_response_code((int) ($result['status'] ?? 200));
    echo json_encode($result['body'] ?? ['message' => 'OK']);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Unable to complete fingerprint enrollment.',
        'error' => $error->getMessage(),
    ]);
}
