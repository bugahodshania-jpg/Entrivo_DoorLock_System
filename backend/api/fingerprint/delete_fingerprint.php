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
require_once dirname(__DIR__, 2) . '/services/FingerprintSlotRegistry.php';
require_once dirname(__DIR__, 2) . '/services/SensorMemorySchema.php';
require_once dirname(__DIR__, 2) . '/services/SensorMemoryService.php';

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
    (new UserPrivilegeService($pdo))->assertActorCanDeleteRecords(
        $actorId,
        'Admin accounts cannot delete fingerprint records.'
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

    $deviceId = (int) ($existing['enrollment_device_id'] ?? 0);
    $slot = (int) ($existing['enrollment_slot'] ?? 0);
    FingerprintSlotRegistry::release($pdo, $deviceId, $slot);

    $message = 'Fingerprint deleted successfully.';
    $sensorJob = null;
    if ($deviceId > 0 && $slot > 0 && SensorMemorySchema::tableExists($pdo)) {
        try {
            $queued = (new SensorMemoryService($pdo))->adminAction([
                'action' => 'delete_slot',
                'actor_id' => $actorId,
                'device_id' => $deviceId,
                'slot_id' => $slot,
            ]);
            $sensorJob = $queued['job'] ?? null;
            $message = 'Fingerprint deleted. Keep the door locked while the controller removes R307S slot '
                . $slot . '.';
        } catch (SensorMemoryException $error) {
            $message = 'Fingerprint record deleted, but R307S slot ' . $slot
                . ' was not queued for deletion. ' . $error->getMessage();
        }
    }

    require_once dirname(__DIR__, 2) . '/services/ActivityLogService.php';
    (new ActivityLogService(entrivo_pdo()))->record(
        $actorId,
        'Delete',
        'Deleted fingerprint #' . $fingerprintId
            . ' for user #' . (int) ($existing['user_id'] ?? 0)
            . ($slot > 0 ? ' and queued R307S slot ' . $slot . ' for deletion.' : '.') ,
        'Success',
        isset($existing['user_id']) ? (int) $existing['user_id'] : null,
        'fingerprint',
        (string) $fingerprintId
    );

    echo json_encode([
        'success' => true,
        'message' => $message,
        'fingerprint_id' => $fingerprintId,
        'sensor_job' => $sensorJob,
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
