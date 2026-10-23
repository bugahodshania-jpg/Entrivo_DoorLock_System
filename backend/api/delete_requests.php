<?php

date_default_timezone_set('Asia/Manila');

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/DeleteRequestService.php';

try {
    $pdo = entrivo_pdo();
    $service = new DeleteRequestService($pdo);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $actorId = (int) ($_GET['actor_id'] ?? 0);
        $proofId = (int) ($_GET['proof'] ?? 0);
        if ($proofId > 0) {
            $file = $service->proofFile($actorId, $proofId);
            header('Content-Type: ' . $file['mime']);
            header('Content-Length: ' . (string) filesize($file['path']));
            header('Content-Disposition: inline; filename="delete-proof-' . $proofId . '"');
            header('Cache-Control: private, max-age=3600');
            header('X-Content-Type-Options: nosniff');
            readfile($file['path']);
            exit;
        }

        $isMine = ($_GET['scope'] ?? '') === 'mine';
        $status = (string) ($_GET['status'] ?? ($isMine ? 'all' : 'pending'));
        $requests = $isMine
            ? $service->listForRequester($actorId, $status)
            : $service->listForReviewer($actorId, $status);
        echo json_encode([
            'message' => 'Delete requests loaded.',
            'requests' => $requests,
        ]);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        echo json_encode(['message' => 'Method not allowed.']);
        exit;
    }

    $isUpload = isset($_FILES['proof']);
    $payload = $isUpload ? $_POST : json_decode(file_get_contents('php://input'), true);
    if (!is_array($payload)) {
        http_response_code(400);
        echo json_encode(['message' => 'Invalid request body.']);
        exit;
    }

    $actorId = (int) ($payload['actorId'] ?? $payload['actor_id'] ?? 0);
    $action = (string) ($payload['action'] ?? 'create');

    if ($action === 'approve') {
        $request = $service->approve(
            $actorId,
            (int) ($payload['requestId'] ?? 0),
            (string) ($payload['password'] ?? '')
        );
        echo json_encode(['message' => 'Delete request approved. The record was removed.', 'request' => $request]);
        exit;
    }

    if ($action === 'reject') {
        $request = $service->reject($actorId, (int) ($payload['requestId'] ?? 0), (string) ($payload['note'] ?? ''));
        echo json_encode(['message' => 'Delete request rejected. The record was kept.', 'request' => $request]);
        exit;
    }

    if ($action === 'revert') {
        $request = $service->revert($actorId, (int) ($payload['requestId'] ?? 0));
        echo json_encode(['message' => 'Delete request returned to review.', 'request' => $request]);
        exit;
    }

    if ($action === 'cancel') {
        $request = $service->cancel(
            $actorId,
            (int) ($payload['requestId'] ?? 0),
            (string) ($payload['password'] ?? '')
        );
        echo json_encode(['message' => 'Delete request cancelled. The record was kept.', 'request' => $request]);
        exit;
    }

    if ($action === 'delete_now') {
        $service->deleteNow($actorId, (string) ($payload['targetType'] ?? ''), (int) ($payload['targetId'] ?? 0));
        echo json_encode(['message' => 'Record deleted.']);
        exit;
    }

    $request = $service->create(
        $actorId,
        (string) ($payload['targetType'] ?? ''),
        (int) ($payload['targetId'] ?? 0),
        (string) ($payload['targetLabel'] ?? ''),
        (string) ($payload['reason'] ?? ''),
        $_FILES['proof'] ?? []
    );
    echo json_encode([
        'message' => 'Delete request sent. A Super Admin will review it before anything is removed.',
        'request' => $request,
    ]);
} catch (InvalidArgumentException $error) {
    http_response_code(422);
    echo json_encode(['message' => $error->getMessage()]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['message' => 'Unable to process the delete request right now.']);
}
