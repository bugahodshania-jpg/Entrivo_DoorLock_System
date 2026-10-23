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

if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'POST'], true)) {
    http_response_code(405);
    echo json_encode(['message' => 'Method not allowed.']);
    exit;
}

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/ActivityLogService.php';
require_once dirname(__DIR__) . '/services/NotificationService.php';
require_once dirname(__DIR__) . '/services/OverrideScheduleService.php';

function ensureScheduleKindColumn(PDO $pdo): void
{
    static $ready = false;

    if ($ready) {
        return;
    }

    try {
        $column = $pdo->query("SHOW COLUMNS FROM schedules LIKE 'schedule_kind'")->fetch(PDO::FETCH_ASSOC);
        if (!$column) {
            $pdo->exec(
                "ALTER TABLE schedules
                 ADD COLUMN schedule_kind ENUM('regular', 'override') NOT NULL DEFAULT 'regular'
                 AFTER schedule_type"
            );
        }
    } catch (Throwable $ignored) {
        // Ignore alter races / restricted environments.
    }

    $ready = true;
}

function overrideDisplayName(array $row): string
{
    $name = trim(implode(' ', array_filter([
        $row['first_name'] ?? '',
        $row['middle_name'] ?? '',
        $row['last_name'] ?? '',
        $row['extension_name'] ?? '',
    ])));

    return $name !== '' ? $name : (string) ($row['username'] ?? 'Unknown user');
}

function mapPendingOverride(array $row): array
{
    $role = strtolower(trim((string) ($row['role'] ?? '')));
    $roleLabel = match ($role) {
        'faculty' => 'Faculty',
        'staff' => 'Staff',
        'admin' => 'Admin',
        'super_admin' => 'Super Admin',
        'student' => 'Student',
        default => $role !== '' ? ucfirst($role) : 'User',
    };

    $isApproved = ($row['approved_by'] ?? null) !== null;
    $state = $isApproved ? 'approved' : 'pending';

    return [
        'id' => (int) $row['override_id'],
        'userId' => (int) $row['user_id'],
        'name' => overrideDisplayName($row),
        'username' => $row['username'] ?? '',
        'email' => $row['email'] ?? '',
        'role' => $role,
        'roleLabel' => $roleLabel,
        'schoolId' => ($row['school_id'] ?? '') !== '' ? $row['school_id'] : '—',
        'reason' => ($row['reason'] ?? '') !== '' ? $row['reason'] : 'No reason provided',
        'overrideStart' => $row['override_start'],
        'overrideEnd' => $row['override_end'],
        'startLabel' => $row['start_label'],
        'endLabel' => $row['end_label'],
        'dateLabel' => $row['date_label'],
        'timeStartLabel' => $row['time_start_label'],
        'timeEndLabel' => $row['time_end_label'],
        'timeLabel' => $row['time_start_label'] . ' - ' . $row['time_end_label'],
        'createdAt' => $row['created_label'],
        'createdDateLabel' => $row['created_date_label'],
        'createdTimeLabel' => $row['created_time_label'],
        'state' => $state,
        'stateLabel' => $isApproved ? 'Approved' : 'Pending',
        'isApproved' => $isApproved,
        'canReviewActions' => !$isApproved,
        'approvedById' => $isApproved ? (int) $row['approved_by'] : null,
        'approvedByName' => $isApproved
            ? (trim((string) ($row['approved_by_name'] ?? '')) !== ''
                ? $row['approved_by_name']
                : ((string) ($row['approved_by_username'] ?? '') !== ''
                    ? $row['approved_by_username']
                    : 'Administrator'))
            : null,
    ];
}

function pendingOverrideSelectSql(): string
{
    return "SELECT
            access_overrides.override_id,
            access_overrides.user_id,
            access_overrides.approved_by,
            access_overrides.reason,
            access_overrides.override_start,
            access_overrides.override_end,
            access_overrides.created_at,
            users.username,
            users.email,
            users.role,
            DATE_FORMAT(access_overrides.override_start, '%b %e, %Y') AS date_label,
            DATE_FORMAT(access_overrides.override_start, '%b %e, %Y %h:%i %p') AS start_label,
            DATE_FORMAT(access_overrides.override_end, '%b %e, %Y %h:%i %p') AS end_label,
            TIME_FORMAT(access_overrides.override_start, '%h:%i %p') AS time_start_label,
            TIME_FORMAT(access_overrides.override_end, '%h:%i %p') AS time_end_label,
            DATE_FORMAT(access_overrides.created_at, '%b %e, %Y') AS created_date_label,
            DATE_FORMAT(access_overrides.created_at, '%h:%i %p') AS created_time_label,
            DATE_FORMAT(access_overrides.created_at, '%b %e, %Y %h:%i %p') AS created_label,
            COALESCE(
                student_info.school_id,
                faculty_info.employee_id,
                staff_info.employee_id,
                admin_info.employee_id
            ) AS school_id,
            COALESCE(
                student_info.first_name,
                faculty_info.first_name,
                staff_info.first_name,
                admin_info.first_name
            ) AS first_name,
            COALESCE(
                student_info.middle_name,
                faculty_info.middle_name,
                staff_info.middle_name,
                admin_info.middle_name
            ) AS middle_name,
            COALESCE(
                student_info.last_name,
                faculty_info.last_name,
                staff_info.last_name,
                admin_info.last_name
            ) AS last_name,
            COALESCE(
                student_info.extension_name,
                faculty_info.extension_name,
                staff_info.extension_name,
                admin_info.extension_name
            ) AS extension_name,
            approver.username AS approved_by_username,
            NULLIF(TRIM(CONCAT_WS(
                ' ',
                COALESCE(approver_admin.first_name, approver_faculty.first_name, approver_staff.first_name),
                COALESCE(approver_admin.last_name, approver_faculty.last_name, approver_staff.last_name)
            )), '') AS approved_by_name
         FROM access_overrides
         INNER JOIN users ON users.id = access_overrides.user_id
         LEFT JOIN users AS approver ON approver.id = access_overrides.approved_by
         LEFT JOIN admin_info AS approver_admin ON approver_admin.user_id = approver.id
         LEFT JOIN faculty_info AS approver_faculty ON approver_faculty.user_id = approver.id
         LEFT JOIN staff_info AS approver_staff ON approver_staff.user_id = approver.id
         LEFT JOIN student_info ON student_info.user_id = users.id
         LEFT JOIN faculty_info ON faculty_info.user_id = users.id
         LEFT JOIN staff_info ON staff_info.user_id = users.id
         LEFT JOIN admin_info ON admin_info.user_id = users.id";
}

function normalizeOverrideStatus(?string $status): string
{
    $normalized = strtolower(trim((string) $status));

    return $normalized === 'approved' ? 'approved' : 'pending';
}

function fetchOverrides(PDO $pdo, string $status = 'pending'): array
{
    $status = normalizeOverrideStatus($status);
    $where = $status === 'approved'
        ? 'WHERE access_overrides.approved_by IS NOT NULL'
        : 'WHERE access_overrides.approved_by IS NULL';
    $order = $status === 'approved'
        ? 'ORDER BY access_overrides.created_at DESC, access_overrides.override_start DESC'
        : 'ORDER BY access_overrides.created_at ASC, access_overrides.override_start ASC';

    $statement = $pdo->query(pendingOverrideSelectSql() . "\n         {$where}\n         {$order}");

    return array_map(
        static fn ($row) => mapPendingOverride($row),
        $statement->fetchAll(PDO::FETCH_ASSOC)
    );
}

function countOverridesByStatus(PDO $pdo): array
{
    $statement = $pdo->query(
        "SELECT
            SUM(CASE WHEN approved_by IS NULL THEN 1 ELSE 0 END) AS pending_count,
            SUM(CASE WHEN approved_by IS NOT NULL THEN 1 ELSE 0 END) AS approved_count
         FROM access_overrides"
    );
    $row = $statement->fetch(PDO::FETCH_ASSOC) ?: [];

    return [
        'pending' => (int) ($row['pending_count'] ?? 0),
        'approved' => (int) ($row['approved_count'] ?? 0),
    ];
}

function fetchOldestPending(PDO $pdo): ?array
{
    $statement = $pdo->query(
        pendingOverrideSelectSql() . "
         WHERE access_overrides.approved_by IS NULL
         ORDER BY access_overrides.created_at ASC, access_overrides.override_start ASC
         LIMIT 1"
    );
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row ? mapPendingOverride($row) : null;
}

function fetchRecentApprovedThisWeek(PDO $pdo, int $limit = 5): array
{
    $limit = max(1, min(5, $limit));
    $statement = $pdo->query(
        pendingOverrideSelectSql() . "
         WHERE access_overrides.approved_by IS NOT NULL
           AND DATE(access_overrides.override_start)
               BETWEEN DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
                   AND DATE_ADD(
                       DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY),
                       INTERVAL 6 DAY
                   )
         ORDER BY access_overrides.override_start DESC, access_overrides.created_at DESC
         LIMIT {$limit}"
    );

    return array_map(
        static fn ($row) => mapPendingOverride($row),
        $statement->fetchAll(PDO::FETCH_ASSOC)
    );
}

function overrideListPayload(PDO $pdo, string $status): array
{
    return [
        'message' => 'Override requests loaded.',
        'status' => $status,
        'overrides' => fetchOverrides($pdo, $status),
        'counts' => countOverridesByStatus($pdo),
        'oldestPending' => fetchOldestPending($pdo),
        'recentApprovedThisWeek' => fetchRecentApprovedThisWeek($pdo),
    ];
}

function fetchOverrideById(PDO $pdo, int $overrideId): ?array
{
    $statement = $pdo->prepare(
        pendingOverrideSelectSql() . '
         WHERE access_overrides.override_id = :override_id
         LIMIT 1'
    );
    $statement->execute(['override_id' => $overrideId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row ? mapPendingOverride($row) : null;
}

function fetchPendingOverride(PDO $pdo, int $overrideId): ?array
{
    $override = fetchOverrideById($pdo, $overrideId);

    if (!$override || !empty($override['isApproved'])) {
        return null;
    }

    return $override;
}

try {
    $pdo = entrivo_pdo();
    ensureScheduleKindColumn($pdo);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $overrideId = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT);
        $status = normalizeOverrideStatus($_GET['status'] ?? 'pending');

        if ($overrideId) {
            $override = fetchOverrideById($pdo, $overrideId);

            if (!$override) {
                http_response_code(404);
                echo json_encode(['message' => 'That override request was not found.']);
                exit;
            }

            echo json_encode([
                'message' => 'Override request loaded.',
                'override' => $override,
            ]);
            exit;
        }

        echo json_encode(overrideListPayload($pdo, $status));
        exit;
    }

    $input = json_decode(file_get_contents('php://input'), true);

    if (!is_array($input)) {
        http_response_code(400);
        echo json_encode(['message' => 'Invalid request body.']);
        exit;
    }

    $overrideId = filter_var($input['override_id'] ?? $input['id'] ?? null, FILTER_VALIDATE_INT) ?: 0;
    $action = strtolower(trim((string) ($input['action'] ?? '')));
    $actorId = filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT) ?: null;
    $listStatus = normalizeOverrideStatus($input['status'] ?? 'pending');

    if ($overrideId <= 0) {
        http_response_code(422);
        echo json_encode(['message' => 'An override request is required.']);
        exit;
    }

    if (!in_array($action, ['approve', 'reject'], true)) {
        http_response_code(422);
        echo json_encode(['message' => 'Choose approve or reject.']);
        exit;
    }

    $existing = fetchPendingOverride($pdo, $overrideId);

    if (!$existing) {
        http_response_code(404);
        echo json_encode(['message' => 'That pending override request was not found.']);
        exit;
    }

    if ($action === 'approve') {
        if (!$actorId) {
            http_response_code(422);
            echo json_encode(['message' => 'An approving administrator is required.']);
            exit;
        }

        $notifications = new NotificationService($pdo);
        $notifications->ensureSchema();
        $overrideSchedules = new OverrideScheduleService($pdo);
        $overrideSchedules->ensureStampColumn();
        $pdo->beginTransaction();

        try {
            // Read the window again while locked: a pending request can be edited.
            $lock = $pdo->prepare('SELECT override_id FROM access_overrides WHERE override_id = ? AND approved_by IS NULL FOR UPDATE');
            $lock->execute([$overrideId]);
            $existing = $lock->fetchColumn() ? fetchPendingOverride($pdo, $overrideId) : null;
            if (!$existing) {
                $pdo->rollBack();
                http_response_code(404);
                echo json_encode(['message' => 'That pending override request was not found.']);
                exit;
            }
            $start = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', (string) $existing['overrideStart']);
            $end = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', (string) $existing['overrideEnd']);
            if (!$start || !$end || $end <= $start || $start->format('Y-m-d') !== $end->format('Y-m-d')) {
                $pdo->rollBack();
                http_response_code(422);
                echo json_encode(['message' => 'That override request has an invalid single-day access window.']);
                exit;
            }
            $statement = $pdo->prepare(
                'UPDATE access_overrides
                 SET approved_by = :approved_by
                 WHERE override_id = :override_id
                   AND approved_by IS NULL'
            );
            $statement->execute([
                'approved_by' => $actorId,
                'override_id' => $overrideId,
            ]);

            if ($statement->rowCount() === 0) {
                $pdo->rollBack();
                http_response_code(404);
                echo json_encode(['message' => 'That pending override request was not found.']);
                exit;
            }

            $scheduleDate = $start->format('Y-m-d');
            $timeStart = $start->format('H:i:s');
            $timeEnd = $end->format('H:i:s');
            $approvedAt = entrivo_now();

            $existingSchedule = $pdo->prepare(
                "SELECT schedule_id
                 FROM schedules
                 WHERE user_id = :user_id
                   AND schedule_date = :schedule_date
                   AND time_start = :time_start
                   AND time_end = :time_end
                   AND (
                        COALESCE(schedule_kind, 'regular') = 'override'
                        OR status = 'overridden'
                   )
                 ORDER BY schedule_id DESC
                 LIMIT 1"
            );
            $existingSchedule->execute([
                'user_id' => $existing['userId'],
                'schedule_date' => $scheduleDate,
                'time_start' => $timeStart,
                'time_end' => $timeEnd,
            ]);
            $scheduleId = (int) ($existingSchedule->fetchColumn() ?: 0);

            if ($scheduleId > 0) {
                $updateSchedule = $pdo->prepare(
                    "UPDATE schedules
                     SET status = 'approved',
                         schedule_kind = 'override',
                         approved_by = :approved_by,
                         approved_at = :approved_at,
                         created_by = COALESCE(created_by, :created_by)
                     WHERE schedule_id = :schedule_id"
                );
                $updateSchedule->execute([
                    'approved_by' => $actorId,
                    'approved_at' => $approvedAt,
                    'created_by' => $actorId,
                    'schedule_id' => $scheduleId,
                ]);
            } else {
                $insertSchedule = $pdo->prepare(
                    "INSERT INTO schedules (
                        user_id,
                        schedule_type,
                        schedule_kind,
                        schedule_date,
                        time_start,
                        time_end,
                        start_date,
                        end_date,
                        repeat_type,
                        repeat_days,
                        repeat_day,
                        grace_period_minutes,
                        status,
                        created_by,
                        approved_by,
                        approved_at
                     ) VALUES (
                        :user_id,
                        'single',
                        'override',
                        :schedule_date,
                        :time_start,
                        :time_end,
                        NULL,
                        NULL,
                        'none',
                        NULL,
                        NULL,
                        15,
                        'approved',
                        :created_by,
                        :approved_by,
                        :approved_at
                     )"
                );
                $insertSchedule->execute([
                    'user_id' => $existing['userId'],
                    'schedule_date' => $scheduleDate,
                    'time_start' => $timeStart,
                    'time_end' => $timeEnd,
                    'created_by' => $actorId,
                    'approved_by' => $actorId,
                    'approved_at' => $approvedAt,
                ]);
            }

            $overrideScheduleId = $scheduleId > 0 ? $scheduleId : (int) $pdo->lastInsertId();
            $overrideSchedules->stampOverlappingRegulars(
                (int) $existing['userId'],
                $scheduleDate,
                $timeStart,
                $timeEnd,
                $overrideScheduleId
            );
            $notificationIds = $notifications->createForApprovedOverride($existing, true);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }

            throw $error;
        }

        $message = 'Override request approved. It now appears in Schedules as an Approved override.';
        // SMTP runs in a separate process; even the single-worker PHP development
        // server remains available for notification polling during a mail outage.
        $emailDelivery = [
            'sent' => 0, 'failed' => 0, 'uncertain' => 0, 'pending' => count($notificationIds),
            'dispatchStarted' => count($notificationIds) > 0 && NotificationService::dispatchDelivery($overrideId),
        ];
        if (count($notificationIds) > 0) {
            $message .= $emailDelivery['dispatchStarted']
                ? ' Affected users have dashboard notices, and their email notifications are queued for delivery.'
                : ' Affected users have dashboard notices. Email is queued; run the notification delivery worker to send it.';
        }
        $activityType = 'Approve';
        $description = 'Approved override request #' . $overrideId . ' for ' . $existing['name']
            . ' and created an approved override schedule.';
    } else {
        $statement = $pdo->prepare(
            'DELETE FROM access_overrides
             WHERE override_id = :override_id
               AND approved_by IS NULL'
        );
        $statement->execute(['override_id' => $overrideId]);

        if ($statement->rowCount() === 0) {
            http_response_code(404);
            echo json_encode(['message' => 'That pending override request was not found.']);
            exit;
        }

        $message = 'Override request rejected.';
        $activityType = 'Reject';
        $description = 'Rejected override request #' . $overrideId . ' for ' . $existing['name'] . '.';
    }

    (new ActivityLogService($pdo))->record(
        $actorId,
        $activityType,
        $description,
        'Success',
        $existing['userId'],
        'access_override',
        (string) $overrideId
    );

    echo json_encode(array_merge(
        overrideListPayload($pdo, $listStatus),
        array_merge(['message' => $message], isset($emailDelivery) ? [
            'affectedUsersNotified' => count($notificationIds),
            'emailNotifications' => $emailDelivery,
        ] : [])
    ));
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['message' => 'Unable to process override requests right now.']);
}
