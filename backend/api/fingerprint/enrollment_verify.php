<?php

require_once dirname(__DIR__, 2) . '/config/connection.php';
require_once dirname(__DIR__, 2) . '/services/EnrollmentVerifyService.php';
require_once dirname(__DIR__, 2) . '/services/FingerprintEnrollmentVerification.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Device-Token');
header('Cache-Control: no-store');

$method = $_SERVER['REQUEST_METHOD'] ?? '';
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    entrivo_db_config();
    $service = new EnrollmentVerifyService();
    if ($method === 'GET') {
        $token = $_SERVER['HTTP_X_DEVICE_TOKEN'] ?? null;
        $configured = getenv('DOOR_DEVICE_TOKEN');
        if (is_string($configured) && trim($configured) !== ''
            && FingerprintEnrollmentVerification::deviceTokenMatches($configured, $token)) {
            echo json_encode($service->claim($_GET));
            exit;
        }
        echo json_encode($service->readForAdmin($_GET));
        exit;
    }
    if ($method !== 'POST') {
        throw new EnrollmentVerifyException('Method not allowed.', 405);
    }
    $configured = getenv('DOOR_DEVICE_TOKEN');
    if (!is_string($configured) || trim($configured) === ''
        || !FingerprintEnrollmentVerification::deviceTokenMatches($configured, $_SERVER['HTTP_X_DEVICE_TOKEN'] ?? null)) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'The enrollment device could not be authenticated.']);
        exit;
    }
    $input = json_decode(file_get_contents('php://input'), true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($input) || array_is_list($input)) {
        throw new EnrollmentVerifyException('A valid JSON object is required.', 422);
    }
    echo json_encode($service->deviceUpdate($input));
} catch (EnrollmentVerifyException $error) {
    http_response_code($error->httpStatus);
    echo json_encode(['success' => false, 'message' => $error->getMessage()]);
} catch (JsonException $error) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'A valid JSON object is required.']);
} catch (Throwable $error) {
    error_log('Enrollment verify: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['success' => false, 'message' => 'Unable to record the enrollment verification scan.']);
}
