<?php

/**
 * Live door access feed for the Super Admin "Access Status" modal.
 *
 * GET /api/access_status_live.php?actor_id=1                -> baseline: latest_id only (no popup for old rows)
 * GET /api/access_status_live.php?actor_id=1&after_id=123   -> access attempts with log_id > 123 (oldest first)
 *
 * Every response also carries the live door lock state, so one cheap request
 * gives the modal both the newest access decision and the current lock state.
 * The query is a primary-key range scan, so polling it every ~0.5 s is cheap.
 */

date_default_timezone_set('Asia/Manila');

header('Content-Type: application/json');
header('Cache-Control: no-store, private');
header('Pragma: no-cache');
$allowedOrigins = require __DIR__ . '/../config/allowed_origins.php';
$origin = $_SERVER['HTTP_ORIGIN'] ?? $allowedOrigins[0];
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Vary: Origin');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Use GET to read the live access status.']);
    exit;
}

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/DoorStatusService.php';
require_once dirname(__DIR__) . '/services/ScheduleAccessPolicy.php';
require_once dirname(__DIR__) . '/services/FailedAccessStreak.php';
require_once dirname(__DIR__) . '/services/AccessEventType.php';
require_once dirname(__DIR__) . '/services/CombinedDoorAccessService.php';

$actorId = filter_input(INPUT_GET, 'actor_id', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
$afterId = filter_input(INPUT_GET, 'after_id', FILTER_VALIDATE_INT, ['options' => ['default' => 0, 'min_range' => 0]]);

try {
    $pdo = entrivo_pdo();

    if (!$actorId) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'actor_id is required.']);
        exit;
    }
    $actorQuery = $pdo->prepare('SELECT role, is_active, approval_status FROM users WHERE id = ?');
    $actorQuery->execute([$actorId]);
    $actor = $actorQuery->fetch(PDO::FETCH_ASSOC);
    if (!$actor || (int) $actor['is_active'] !== 1 || $actor['approval_status'] !== 'approved'
        || !in_array($actor['role'], ['super_admin', 'admin'], true)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'An active Super Admin or Admin account is required.']);
        exit;
    }

    // Live lock state of the door controller(s).
    $doorService = new DoorStatusService($pdo);
    $doorIds = $pdo->query("SELECT device_id FROM fingerprint_devices WHERE device_type='enrollment' ORDER BY (status='active') DESC, device_id")
        ->fetchAll(PDO::FETCH_COLUMN);
    $doors = array_map(static fn ($id) => $doorService->snapshot((int) $id), $doorIds);

    $latestId = (int) $pdo->query('SELECT COALESCE(MAX(log_id), 0) FROM access_log')->fetchColumn();

    if ($afterId <= 0) {
        echo json_encode([
            'success' => true,
            'latest_id' => $latestId,
            'events' => [],
            'doors' => $doors,
            'server_time' => date('c'),
        ]);
        exit;
    }

    // One SHOW COLUMNS call keeps older databases (without the newer columns) working.
    $columns = array_flip($pdo->query('SHOW COLUMNS FROM access_log')->fetchAll(PDO::FETCH_COLUMN));
    $optional = static fn (string $column, string $alias) => isset($columns[$column])
        ? "access_log.{$column} AS {$alias}" : "NULL AS {$alias}";

    $hasScheduleKind = (bool) $pdo->query("SHOW COLUMNS FROM schedules LIKE 'schedule_kind'")->fetch();

    $statement = $pdo->prepare(
        "SELECT
            access_log.log_id,
            DATE_FORMAT(access_log.access_timestamp, '%Y-%m-%dT%H:%i:%s') AS access_iso,
            DATE_FORMAT(access_log.access_timestamp, '%b %e, %Y') AS access_date,
            DATE_FORMAT(access_log.access_timestamp, '%h:%i:%s %p') AS access_time,
            DATE_FORMAT(access_log.access_timestamp, '%Y-%m-%d') AS access_day,
            access_log.access_timestamp,
            access_log.schedule_id,
            " . $optional('override_id', 'override_id') . ",
            " . ($hasScheduleKind ? 'linked_schedule.schedule_kind' : 'NULL') . " AS schedule_kind,
            linked_schedule.status AS schedule_status,
            access_log.access_status,
            access_log.denial_reason,
            access_log.method_access,
            access_log.user_id,
            " . $optional('access_type', 'access_type') . ",
            " . $optional('rfid_uid', 'rfid_uid') . ",
            " . $optional('matched_slot', 'matched_slot') . ",
            " . $optional('match_confidence', 'match_confidence') . ",
            COALESCE(
                NULLIF(TRIM(CONCAT_WS(' ', student_info.first_name, student_info.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', faculty_info.first_name, faculty_info.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', staff_info.first_name, staff_info.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', admin_info.first_name, admin_info.last_name)), ''),
                users.username
            ) AS user_name,
            users.role AS user_role,
            COALESCE(student_info.school_id, faculty_info.employee_id, staff_info.employee_id, admin_info.employee_id) AS user_identifier
         FROM access_log
         LEFT JOIN users ON users.id = access_log.user_id
         LEFT JOIN schedules AS linked_schedule ON linked_schedule.schedule_id = access_log.schedule_id
         LEFT JOIN student_info ON student_info.user_id = users.id
         LEFT JOIN faculty_info ON faculty_info.user_id = users.id
         LEFT JOIN staff_info ON staff_info.user_id = users.id
         LEFT JOIN admin_info ON admin_info.user_id = users.id
         WHERE access_log.log_id > :after_id
         ORDER BY access_log.log_id ASC
         LIMIT 10"
    );
    $statement->bindValue(':after_id', (int) $afterId, PDO::PARAM_INT);
    $statement->execute();

    // The person's approved schedules on the day of the attempt (same rules as
    // the door decision), so the modal can show what was assigned that day.
    $policy = new ScheduleAccessPolicy($pdo);
    $scheduleCache = [];
    $schedulesFor = static function (?int $userId, string $day) use ($policy, &$scheduleCache): array {
        if ($userId === null) return [];
        return $scheduleCache["{$userId}|{$day}"] ??= $policy->schedulesOn($userId, $day);
    };

    // Failed attempts in a row by the same person; the portal warns
    // administrators from the 3rd one on (FailedAccessStreak).
    $hasRfidUid = isset($columns['rfid_uid']);
    $failedStreak = static fn (array $row): int => FailedAccessStreak::count($pdo, $row, $hasRfidUid);

    // How each granted access happened (regular, override, admin permanent override, emergency card).
    $emergencyUids = CombinedDoorAccessService::emergencyCardUids();

    $events = array_map(static function (array $row) use ($schedulesFor, $failedStreak, $emergencyUids): array {
        $userId = $row['user_id'] !== null ? (int) $row['user_id'] : null;
        return [
            'failedAttempts' => $failedStreak($row),
            'id' => (int) $row['log_id'],
            'status' => $row['access_status'],
            'denialReason' => $row['denial_reason'],
            'method' => $row['method_access'],
            'direction' => ($row['access_type'] ?? 'IN') === 'OUT' ? 'exit' : 'entry',
            'timestamp' => $row['access_iso'],
            'date' => $row['access_date'],
            'time' => $row['access_time'],
            'userId' => $row['user_id'] !== null ? (int) $row['user_id'] : null,
            'userName' => $row['user_name'],
            'userRole' => $row['user_role'],
            'userIdentifier' => $row['user_identifier'],
            'rfidUid' => $row['method_access'] === 'RFID' ? ($row['rfid_uid'] ?: null) : null,
            'matchedSlot' => $row['matched_slot'] !== null ? (int) $row['matched_slot'] : null,
            'matchConfidence' => $row['match_confidence'] !== null ? (int) $row['match_confidence'] : null,
            'scheduleId' => $row['schedule_id'] !== null ? (int) $row['schedule_id'] : null,
            'accessType' => AccessEventType::classify($row, $emergencyUids),
            'schedules' => $schedulesFor($userId, (string) $row['access_day']),
        ];
    }, $statement->fetchAll(PDO::FETCH_ASSOC));

    echo json_encode([
        'success' => true,
        'latest_id' => $latestId,
        'events' => $events,
        'doors' => $doors,
        'server_time' => date('c'),
    ]);
} catch (Throwable $error) {
    error_log('Access status live: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['success' => false, 'message' => 'Live access status is unavailable.']);
}
