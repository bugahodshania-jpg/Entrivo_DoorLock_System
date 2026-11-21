<?php

require_once dirname(__DIR__) . '/services/DoorControlService.php';
header('Content-Type: application/json');
header('Cache-Control: no-store');
$allowedOrigins = require __DIR__ . '/../config/allowed_origins.php';
$origin = $_SERVER['HTTP_ORIGIN'] ?? $allowedOrigins[0];
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Vary: Origin');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
        // Door control logs (GET ?actor_id=&device_id=), or staff room access (?view=room_access).
        $service = new DoorControlService();
        echo json_encode(($_GET['view'] ?? '') === 'room_access' ? $service->roomAccess($_GET) : $service->history($_GET), JSON_THROW_ON_ERROR);
        exit;
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') throw new DoorStatusException('Use POST to control the door.', 405);
    $input = json_decode(file_get_contents('php://input'), true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($input)) throw new DoorStatusException('A JSON object is required.', 422);
    $service = new DoorControlService();
    // action: "schedule_mode" (mode auto|on|off), "room_hours" (start, end),
    // "staff_room_access" (user_id, allowed), or "lock" / "unlock".
    $result = match ($input['action'] ?? null) {
        'schedule_mode' => $service->setScheduleMode($input),
        'room_hours' => $service->setRoomHours($input),
        'staff_room_access' => $service->setStaffRoomAccess($input),
        default => $service->sendCommand($input),
    };
    echo json_encode($result, JSON_THROW_ON_ERROR);
} catch (DoorStatusException $error) {
    http_response_code($error->httpStatus);
    echo json_encode(['success' => false, 'message' => $error->getMessage()]);
} catch (JsonException) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'A valid JSON object is required.']);
} catch (Throwable $error) {
    error_log('Door control: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['success' => false, 'message' => 'The door control is unavailable right now.']);
}
