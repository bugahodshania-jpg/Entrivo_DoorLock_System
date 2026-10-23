<?php

header('Content-Type: application/json');
header('Cache-Control: no-store, private');
header('Pragma: no-cache');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? $allowedOrigins[0];
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Vary: Origin');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'POST'], true)) {
    http_response_code(405);
    echo json_encode(['message' => 'Method not allowed.']);
    exit;
}

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/NotificationService.php';

try {
    $input = $_SERVER['REQUEST_METHOD'] === 'GET' ? $_GET : json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) {
        http_response_code(400);
        echo json_encode(['message' => 'Invalid request body.']);
        exit;
    }
    $userId = filter_var($input['user_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$userId) {
        http_response_code(422);
        echo json_encode(['message' => 'A valid user account is required.']);
        exit;
    }
    $pdo = entrivo_pdo();
    // Align with the existing portal's user_id identity convention and active-account gate.
    $user = $pdo->prepare('SELECT id FROM users WHERE id = ? AND is_active = 1 LIMIT 1');
    $user->execute([$userId]);
    if (!$user->fetchColumn()) {
        http_response_code(403);
        echo json_encode(['message' => 'That user account is unavailable.']);
        exit;
    }
    $service = new NotificationService($pdo);
    $service->ensureSchema();
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $notifications = $service->getUnacknowledged((int) $userId);
        echo json_encode([
            'notifications' => $notifications,
            'unreadCount' => count($notifications),
            'timezone' => 'Asia/Manila',
        ], JSON_THROW_ON_ERROR);
        exit;
    }
    $id = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (($input['action'] ?? '') !== 'acknowledge' || !$id) {
        http_response_code(422);
        echo json_encode(['message' => 'Choose a valid notification to acknowledge.']);
        exit;
    }
    if (!$service->acknowledge((int) $userId, (int) $id)) {
        http_response_code(404);
        echo json_encode(['message' => 'That notification was not found.']);
        exit;
    }
    echo json_encode(['message' => 'Notification acknowledged.', 'id' => (int) $id, 'acknowledged' => true]);
} catch (Throwable $error) {
    error_log('Override notifications: ' . $error->getMessage());
    http_response_code(500);
    echo json_encode(['message' => 'Unable to load or update notifications right now.']);
}
