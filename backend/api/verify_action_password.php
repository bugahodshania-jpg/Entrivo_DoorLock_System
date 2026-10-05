<?php

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
    echo json_encode(['message' => 'Method not allowed']);
    exit;
}

require_once dirname(__DIR__) . '/config/connection.php';

try {
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) {
        throw new InvalidArgumentException('Request body must be JSON.');
    }

    $userId = (int) ($input['user_id'] ?? 0);
    $password = (string) ($input['password'] ?? '');

    if ($userId <= 0) {
        throw new InvalidArgumentException('Sign in again before continuing.');
    }

    if ($password === '') {
        throw new InvalidArgumentException('Security password is required.');
    }

    $pdo = entrivo_pdo();
    $statement = $pdo->prepare(
        'SELECT password_hash, is_active, role FROM users WHERE id = :id LIMIT 1'
    );
    $statement->execute(['id' => $userId]);
    $user = $statement->fetch(PDO::FETCH_ASSOC);

    $role = strtolower(trim((string) ($user['role'] ?? '')));
    $allowedRoles = ['super_admin', 'faculty', 'staff'];

    if (!$user || !(bool) $user['is_active'] || !in_array($role, $allowedRoles, true)) {
        throw new InvalidArgumentException('The security password is incorrect.');
    }

    if (!password_verify($password, (string) $user['password_hash'])) {
        throw new InvalidArgumentException('The security password is incorrect.');
    }

    echo json_encode(['verified' => true]);
} catch (InvalidArgumentException $exception) {
    http_response_code(422);
    echo json_encode(['message' => $exception->getMessage()]);
} catch (Throwable $exception) {
    http_response_code(500);
    echo json_encode(['message' => 'The security password could not be checked.']);
}
