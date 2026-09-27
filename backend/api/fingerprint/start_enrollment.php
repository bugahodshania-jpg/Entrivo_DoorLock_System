<?php

require_once dirname(__DIR__, 2) . '/config/connection.php';

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
    echo json_encode([
        'success' => false,
        'message' => 'Method not allowed.'
    ]);
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

try {
    $fingerprintId = filter_var($input['fingerprint_id'] ?? null, FILTER_VALIDATE_INT) ?: null;
    $actorId = filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT) ?: null;

    if ($fingerprintId) {
        if (!$actorId) {
            http_response_code(422);
            echo json_encode([
                'success' => false,
                'message' => 'A valid actor id is required to update fingerprints.',
            ]);
            exit;
        }

        $pdo = entrivo_pdo();
        (new UserPrivilegeService($pdo))->assertActorHasPrivilege(
            $actorId,
            'fingerprint_update',
            'You do not have permission to update fingerprints. Ask a Super Admin to grant Update Fingerprints access.'
        );
    }

    $controller = new FingerprintEnrollmentController();
    $result = $controller->startEnrollment($input);

    http_response_code((int) ($result['status'] ?? 200));
    echo json_encode($result['body'] ?? ['message' => 'OK']);
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
        'message' => 'Unable to start fingerprint enrollment.',
        'error' => $error->getMessage(),
    ]);
}
