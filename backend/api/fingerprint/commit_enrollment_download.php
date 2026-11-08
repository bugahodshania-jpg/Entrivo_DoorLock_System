<?php

require_once dirname(__DIR__, 2) . '/config/connection.php';

header('Content-Type: application/json');
$allowedOrigins = require __DIR__ . '/../../config/allowed_origins.php';
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');

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

require_once dirname(__DIR__, 2) . '/controllers/FingerprintEnrollmentController.php';
require_once dirname(__DIR__, 2) . '/services/FingerprintEnrollmentService.php';
require_once dirname(__DIR__, 2) . '/models/FingerprintEnrollmentJob.php';
require_once dirname(__DIR__, 2) . '/services/UserPrivilegeService.php';
require_once dirname(__DIR__, 2) . '/services/ActivityLogService.php';

$actorId = filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT) ?: null;
if (!$actorId) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'A valid actor id is required to download this enrollment.']);
    exit;
}

try {
    $privileges = new UserPrivilegeService(entrivo_pdo());
    $privileges->assertActorHasPrivilege(
        $actorId,
        'fingerprint_update',
        'You do not have permission to save this fingerprint enrollment.'
    );
    $privileges->assertActorCanDeleteRecords(
        $actorId,
        'Only a Super Admin can download the matched template into the database and a PC backup.'
    );

    $controller = new FingerprintEnrollmentController();
    $result = $controller->commitEnrollmentDownload($input);
    $job = is_array($result['body']['job'] ?? null) ? $result['body']['job'] : [];
    // #region agent log
    require_once dirname(__DIR__, 2) . '/utils/agent_debug_log.php';
    $fp = is_array($result['body']['fingerprint'] ?? null) ? $result['body']['fingerprint'] : [];
    $ver = is_array($result['body']['verification'] ?? null) ? $result['body']['verification'] : [];
    agent_debug_log('F', 'commit_enrollment_download.php', 'Download commit result', [
        'success' => !empty($result['body']['success']),
        'message' => $result['body']['message'] ?? null,
        'job_id' => $job['job_id'] ?? ($input['job_id'] ?? null),
        'job_status' => $job['status'] ?? null,
        'assigned_slot' => $job['assigned_slot'] ?? null,
        'fingerprint_id' => $fp['fingerprint_id'] ?? null,
        'fp_status' => $fp['status'] ?? null,
        'fp_slot' => $fp['enrollment_slot'] ?? null,
        'verification_matched_slot' => $ver['matched_slot'] ?? null,
        'verification_hash_prefix' => isset($ver['template_sha256']) ? substr((string) $ver['template_sha256'], 0, 16) : null,
    ]);
    // #endregion

    if (!empty($result['body']['success']) && empty($result['body']['idempotent'])) {
        try {
            (new ActivityLogService(entrivo_pdo()))->recordFingerprintResult($job, 'success', $actorId);
        } catch (Throwable $logError) {
            error_log('Enrollment download activity log: ' . $logError->getMessage());
        }
    }

    http_response_code((int) ($result['status'] ?? 200));
    echo json_encode($result['body'] ?? ['message' => 'OK']);
} catch (InvalidArgumentException $error) {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('Enrollment download commit: ' . $error->getMessage());
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Unable to save the matched fingerprint template.',
    ]);
}
