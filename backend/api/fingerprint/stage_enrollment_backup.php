<?php

require_once dirname(__DIR__, 2) . '/config/connection.php';
require_once dirname(__DIR__, 2) . '/services/FingerprintEnrollmentVerification.php';
require_once dirname(__DIR__, 2) . '/services/FingerprintEnrollmentBackup.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Device-Token');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Use POST to stage a sensor backup.']);
    exit;
}

try {
    entrivo_db_config();
    $configured = getenv('DOOR_DEVICE_TOKEN');
    if (!is_string($configured) || trim($configured) === '') {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'The enrollment device token is not configured.']);
        exit;
    }
    if (!FingerprintEnrollmentVerification::deviceTokenMatches($configured, $_SERVER['HTTP_X_DEVICE_TOKEN'] ?? null)) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'The enrollment device could not be authenticated.']);
        exit;
    }
    $input = json_decode(file_get_contents('php://input'), true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($input) || array_is_list($input)) throw new InvalidArgumentException('A JSON object is required.');
    $encoded = $input['template_data_base64'] ?? null;
    $binary = is_string($encoded) ? base64_decode($encoded, true) : false;
    $bytes = $input['template_bytes'] ?? null;
    $hash = $input['template_sha256'] ?? null;
    if (!is_string($binary) || !is_int($bytes) || strlen($binary) !== $bytes || !is_string($hash) ||
        !is_int($input['job_id'] ?? null) || !is_int($input['enrollment_device_id'] ?? null) ||
        !is_int($input['assigned_slot'] ?? null)) {
        throw new InvalidArgumentException('Complete backup bytes, hash, job, device, and slot are required.');
    }
    $pdo = entrivo_pdo();
    FingerprintEnrollmentBackup::ensure($pdo);
    FingerprintEnrollmentBackup::stage($pdo, $input['job_id'], $input['enrollment_device_id'],
        $input['assigned_slot'], $binary, $hash);
    echo json_encode(['success' => true, 'job_id' => $input['job_id'],
        'assigned_slot' => $input['assigned_slot'], 'template_bytes' => $bytes, 'template_sha256' => $hash]);
} catch (JsonException|InvalidArgumentException $error) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => $error->getMessage()]);
} catch (DomainException $error) {
    http_response_code(409);
    echo json_encode(['success' => false, 'message' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('Enrollment backup staging: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['success' => false, 'message' => 'MySQL could not save the sensor backup. The stored slot remains available for recovery.']);
}
