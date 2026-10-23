<?php

require_once dirname(__DIR__, 2) . '/services/FingerprintEnrollmentService.php';

header('Content-Type: application/json');
header('Cache-Control: no-store');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
$method = $_SERVER['REQUEST_METHOD'] ?? '';
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($method !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed.']);
    exit;
}

try {
    $input = json_decode(file_get_contents('php://input'), true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($input) || array_is_list($input)) {
        throw new JsonException('Expected an object.');
    }
    $result = (new FingerprintEnrollmentService())->reserveEmptySlot($input);
    http_response_code($result['status']);
    echo json_encode($result['body']);
} catch (JsonException $error) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'A valid JSON object is required.']);
} catch (Throwable $error) {
    error_log('Enrollment empty-slot reservation: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['success' => false, 'message' => 'An empty sensor slot could not be confirmed. Existing fingerprints were preserved.']);
}
