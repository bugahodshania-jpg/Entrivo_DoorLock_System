<?php

require_once dirname(__DIR__, 2) . '/config/connection.php';

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (!in_array($_SERVER['REQUEST_METHOD'], ['POST', 'DELETE'], true)) {
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'message' => 'Method not allowed.',
    ]);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    $input = [];
}

require_once dirname(__DIR__, 2) . '/models/Fingerprint.php';
require_once dirname(__DIR__, 2) . '/services/UserPrivilegeService.php';

try {
    $fingerprintId = filter_var(
        $input['fingerprint_id'] ?? ($_GET['fingerprint_id'] ?? null),
        FILTER_VALIDATE_INT
    ) ?: null;
    $actorId = filter_var(
        $input['actor_id'] ?? ($_GET['actor_id'] ?? null),
        FILTER_VALIDATE_INT
    ) ?: null;

    if (!$fingerprintId) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'A valid fingerprint id is required.',
        ]);
        exit;
    }

    if (!$actorId) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'A valid actor id is required to delete fingerprints.',
        ]);
        exit;
    }

    $pdo = entrivo_pdo();
    (new UserPrivilegeService($pdo))->assertActorHasPrivilege(
        $actorId,
        'fingerprint_update',
        'You do not have permission to delete fingerprints. Ask a Super Admin to grant Update Fingerprints access.'
    );

    $fingerprintModel = new Fingerprint();
    $existing = $fingerprintModel->getById($fingerprintId);

    if (!$existing) {
        http_response_code(404);
        echo json_encode([
            'success' => false,
            'message' => 'Fingerprint record not found.',
        ]);
        exit;
    }

    $deleted = $fingerprintModel->deleteById($fingerprintId);

    if (!$deleted) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Unable to delete that fingerprint record.',
        ]);
        exit;
    }

    echo json_encode([
        'success' => true,
        'message' => 'Fingerprint deleted successfully.',
        'fingerprint_id' => $fingerprintId,
    ]);
} catch (InvalidArgumentException $error) {
    http_response_code(403);
    echo json_encode([
        'success' => false,
        'message' => $error->getMessage(),
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Unable to delete fingerprint.',
        'error' => $error->getMessage(),
    ]);
}
