<?php

require_once dirname(__DIR__, 2) . '/config/connection.php';
require_once dirname(__DIR__, 2) . '/services/FingerprintEnrollmentVerification.php';

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Device-Token');
header('Cache-Control: no-store');

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

require_once dirname(__DIR__, 2) . '/controllers/FingerprintEnrollmentController.php';
require_once dirname(__DIR__, 2) . '/services/FingerprintEnrollmentService.php';
require_once dirname(__DIR__, 2) . '/models/FingerprintEnrollmentJob.php';
require_once dirname(__DIR__, 2) . '/models/Fingerprint.php';

require_once dirname(__DIR__, 2) . '/services/ActivityLogService.php';

try {
    // Authenticate before opening a DB connection or accepting board proof.
    entrivo_db_config();
    $configured = getenv('DOOR_DEVICE_TOKEN');
    if (!is_string($configured) || trim($configured) === '') {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Enrollment completion is not configured. Set DOOR_DEVICE_TOKEN on the backend and enrollment board.']);
        exit;
    }
    if (!FingerprintEnrollmentVerification::deviceTokenMatches($configured, $_SERVER['HTTP_X_DEVICE_TOKEN'] ?? null)) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'The enrollment board could not be authenticated. Update its firmware and device token before completing enrollment.']);
        exit;
    }
    $input = json_decode(file_get_contents('php://input'), true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($input) || array_is_list($input)) throw new JsonException('Expected a JSON object.');

    $controller = new FingerprintEnrollmentController();
    $result = $controller->completeEnrollment($input);
    $actorId = filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT) ?: null;
    $job = is_array($result['body']['job'] ?? null) ? $result['body']['job'] : [];

    if (!empty($result['body']['success']) && empty($result['body']['idempotent'])) {
        try {
            (new ActivityLogService(entrivo_pdo()))->recordFingerprintResult($job, 'success', $actorId);
        } catch (Throwable $logError) {
            // A logging outage must not turn an already committed enrollment
            // into an ambiguous failure or force another sensor write.
            error_log('Verified enrollment activity log: ' . $logError->getMessage());
        }
    }

    http_response_code((int) ($result['status'] ?? 200));
    echo json_encode($result['body'] ?? ['message' => 'OK']);
} catch (JsonException $error) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'A valid JSON object is required.']);
} catch (Throwable $error) {
    error_log('Verified enrollment endpoint: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode([
        'success' => false,
        'message' => 'Unable to complete fingerprint enrollment.',
    ]);
}
