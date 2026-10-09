<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/RegistrationUniquenessService.php';

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? $allowedOrigins[0];
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['message' => 'Method not allowed.']);
    exit;
}
try {
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) {
        http_response_code(400);
        echo json_encode(['message' => 'Invalid JSON payload.']);
        exit;
    }
    $errors = (new RegistrationUniquenessService(entrivo_pdo()))->check($input);
    echo json_encode(['available' => $errors === [], 'errors' => (object) $errors]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['message' => 'Unable to check registration details. Please try again.']);
}
