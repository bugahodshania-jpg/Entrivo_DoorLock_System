<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/UserRegistrationService.php';
require_once dirname(__DIR__) . '/services/ActivityLogService.php';

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

    $pdo = entrivo_pdo();
    $service = new UserRegistrationService($pdo);
    $savedUser = $service->registerPublicStudent($input);
    $savedUserId = isset($savedUser['user_id']) ? (int) $savedUser['user_id'] : (isset($savedUser['id']) ? (int) $savedUser['id'] : 0);

    (new ActivityLogService($pdo))->record(
        $savedUserId > 0 ? $savedUserId : null,
        'Add',
        'Submitted a public registration that is pending approval.',
        'Success',
        $savedUserId > 0 ? $savedUserId : null,
        'registration',
        $savedUserId > 0 ? (string) $savedUserId : null
    );

    http_response_code(201);
    echo json_encode([
        'message' => 'Your account was created and is pending approval. It will remain pending if it is not approved within 24 hours. If 24 hours pass and the account is still not approved, ask an administrator about the concern.',
        'user' => $savedUser,
    ]);
} catch (RegistrationDuplicateException $error) {
    http_response_code(409);
    echo json_encode(['message' => $error->getMessage(), 'errors' => $error->fieldErrors]);
} catch (InvalidArgumentException $error) {
    http_response_code(422);
    echo json_encode([
        'message' => $error->getMessage(),
    ]);
} catch (PDOException $error) {
    $isDuplicate = ($error->errorInfo[1] ?? null) === 1062;
    $fieldErrors = [];
    if ($isDuplicate && isset($pdo, $input)) {
        $fieldErrors = (new RegistrationUniquenessService($pdo))->check($input);
    }
    http_response_code($isDuplicate ? 409 : 500);
    echo json_encode([
        'message' => $isDuplicate
            ? 'Username, email, school ID, or school ID UID already exists.'
            : 'Unable to create the account right now.',
        'errors' => (object) $fieldErrors,
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'message' => 'Unable to create the account right now.',
    ]);
}
