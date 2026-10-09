<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/RfidScanService.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function entrivo_rfid_device_token(): string
{
    $token = getenv('RFID_DEVICE_TOKEN');

    return is_string($token) && $token !== '' ? $token : 'entrivo-rfid-2026';
}

function entrivo_rfid_token_is_valid(): bool
{
    $provided = (string) ($_SERVER['HTTP_X_DEVICE_TOKEN'] ?? '');

    return $provided !== '' && hash_equals(entrivo_rfid_device_token(), $provided);
}

if (!entrivo_rfid_token_is_valid()) {
    http_response_code(401);
    echo json_encode([
        'ok' => false,
        'message' => 'Unauthorized scanner.',
        'server_time' => entrivo_now(),
    ]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode([
        'ok' => true,
        'message' => 'Scanner online',
        'server_time' => entrivo_now(),
    ]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'ok' => false,
        'message' => 'Method not allowed.',
        'server_time' => entrivo_now(),
    ]);
    exit;
}

$raw = file_get_contents('php://input');
$input = json_decode($raw, true);
if (!is_array($input)) {
    $input = $_POST;
}

$service = new RfidScanService(entrivo_pdo());
$rfidUid = $service->normalizeUid($input['rfid_uid'] ?? '');

if (!$service->isValidUid($rfidUid)) {
    http_response_code(422);
    echo json_encode([
        'ok' => false,
        'message' => 'Invalid UID.',
        'server_time' => entrivo_now(),
    ]);
    exit;
}

try {
    $saved = $service->record($rfidUid, (string) ($input['device_label'] ?? 'rfid-scanner'));
    $registered = $service->isRegistered($rfidUid);

    echo json_encode([
        'ok' => true,
        'uid' => $saved['rfid_uid'],
        'scanned_at' => $saved['scanned_at'],
        'registered' => $registered,
        'message' => $registered
            ? 'This card is already registered.'
            : 'UID saved. Enter it on the registration page.',
        'server_time' => $saved['scanned_at'],
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'message' => 'Unable to save this scan.',
        'server_time' => entrivo_now(),
    ]);
}
