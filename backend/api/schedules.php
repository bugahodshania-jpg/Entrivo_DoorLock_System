<?php

date_default_timezone_set('Asia/Manila');

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/ActivityLogService.php';
require_once dirname(__DIR__) . '/services/NotificationService.php';
require_once dirname(__DIR__) . '/services/OverrideScheduleService.php';
require_once dirname(__DIR__) . '/services/ScheduleStatusService.php';

try {
    $pdo = entrivo_pdo();
    $activityLog = new ActivityLogService($pdo);
    $overrideSchedules = new OverrideScheduleService($pdo);
    $overrideSchedules->ensureStampColumn();

    // Ensure schedule_kind exists (regular vs override).
    try {
        $kindColumn = $pdo->query("SHOW COLUMNS FROM schedules LIKE 'schedule_kind'")->fetch(PDO::FETCH_ASSOC);
        if (!$kindColumn) {
            $pdo->exec(
                "ALTER TABLE schedules
                 ADD COLUMN schedule_kind ENUM('regular', 'override') NOT NULL DEFAULT 'regular'
                 COMMENT 'regular = admin-created schedule; override = approved override request'
                 AFTER schedule_type"
            );
        }
    } catch (Throwable $ignored) {
        // Ignore alter races / restricted environments.
    }

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS schedule_edit_history (
            history_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            schedule_id INT UNSIGNED NOT NULL,
            edited_by INT UNSIGNED NULL,
            edited_by_name VARCHAR(255) NULL,
            change_summary LONGTEXT NOT NULL,
            edited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_schedule_edit_history_schedule_id (schedule_id),
            INDEX idx_schedule_edit_history_edited_at (edited_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $insertScheduleHistory = function ($scheduleId, $editorId, $editorName, $changes) use ($pdo) {
        if (empty($changes)) {
            return;
        }

        $stmt = $pdo->prepare(
            "INSERT INTO schedule_edit_history (schedule_id, edited_by, edited_by_name, change_summary)
             VALUES (:schedule_id, :edited_by, :edited_by_name, :change_summary)"
        );
        $stmt->execute([
            ':schedule_id' => $scheduleId,
            ':edited_by' => $editorId !== null ? (int) $editorId : null,
            ':edited_by_name' => $editorName !== '' ? $editorName : null,
            ':change_summary' => json_encode(array_values($changes), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);
    };

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $historyRequested = filter_input(INPUT_GET, 'history', FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);

        if ($historyRequested) {
            $scheduleId = (int) ($_GET['id'] ?? 0);

            if ($scheduleId <= 0) {
                http_response_code(422);
                echo json_encode(['message' => 'Schedule ID is required.']);
                exit;
            }

            $stmt = $pdo->prepare(
                "SELECT
                    history_id AS id,
                    schedule_id AS scheduleId,
                    edited_by AS editedBy,
                    edited_by_name AS editedByName,
                    change_summary AS changeSummary,
                    DATE_FORMAT(edited_at, '%b %e, %Y %h:%i %p') AS editedAt
                 FROM schedule_edit_history
                 WHERE schedule_id = :schedule_id
                 ORDER BY edited_at DESC, history_id DESC"
            );
            $stmt->execute([':schedule_id' => $scheduleId]);
            $historyRows = $stmt->fetchAll();

            foreach ($historyRows as &$historyRow) {
                $decodedChanges = json_decode($historyRow['changeSummary'], true);
                $historyRow['changes'] = is_array($decodedChanges) ? $decodedChanges : [];
                unset($historyRow['changeSummary']);
            }
            unset($historyRow);

            echo json_encode([
                'message' => 'Schedule history loaded.',
                'history' => $historyRows,
            ]);
            exit;
        }

        $limit = filter_input(INPUT_GET, 'limit', FILTER_VALIDATE_INT, ['options' => ['default' => 200, 'min_range' => 1, 'max_range' => 1000]]);
        $offset = filter_input(INPUT_GET, 'offset', FILTER_VALIDATE_INT, ['options' => ['default' => 0, 'min_range' => 0]]);

        $stmt = $pdo->prepare(
            "SELECT
                s.schedule_id AS id,
                s.user_id AS userId,
                s.schedule_type AS scheduleType,
                COALESCE(s.schedule_kind, 'regular') AS scheduleKind,
                DATE_FORMAT(s.schedule_date, '%Y-%m-%d') AS scheduleDate,
                DATE_FORMAT(s.schedule_date, '%W, %b %e, %Y') AS scheduleDateLabel,
                TIME_FORMAT(s.time_start, '%H:%i') AS timeStart,
                TIME_FORMAT(s.time_end, '%H:%i') AS timeEnd,
                TIME_FORMAT(s.time_start, '%h:%i %p') AS timeStartLabel,
                TIME_FORMAT(s.time_end, '%h:%i %p') AS timeEndLabel,
                DATE_FORMAT(s.start_date, '%Y-%m-%d') AS startDate,
                DATE_FORMAT(s.start_date, '%b %e, %Y') AS startDateLabel,
                DATE_FORMAT(s.end_date, '%Y-%m-%d') AS endDate,
                DATE_FORMAT(s.end_date, '%b %e, %Y') AS endDateLabel,
                s.repeat_type AS repeatType,
                s.repeat_days AS repeatDays,
                s.grace_period_minutes AS gracePeriodMinutes,
                s.status,
                s.overridden_by_schedule_id AS overriddenByScheduleId,
                DATE_FORMAT(s.created_at, '%b %e, %Y %h:%i %p') AS createdAt,
                DATE_FORMAT(s.created_at, '%Y-%m-%d %H:%i:%s') AS createdAtValue,
                CONCAT(TIME_FORMAT(s.time_start, '%h:%i %p'), ' - ', TIME_FORMAT(s.time_end, '%h:%i %p')) AS `window`,
                COALESCE(
                    NULLIF(TRIM(CONCAT_WS(' ', si.first_name, si.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', fi.first_name, fi.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', st.first_name, st.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), ''),
                    u.username,
                    'Unknown User'
                ) AS ownerName,
                COALESCE(
                    si.school_id,
                    fi.employee_id,
                    st.employee_id,
                    ai.employee_id,
                    'No ID'
                ) AS ownerIdentifier
             FROM schedules s
             INNER JOIN users u ON u.id = s.user_id
             LEFT JOIN student_info si ON si.user_id = u.id
             LEFT JOIN faculty_info fi ON fi.user_id = u.id AND si.user_id IS NULL
             LEFT JOIN staff_info st ON st.user_id = u.id AND si.user_id IS NULL AND fi.user_id IS NULL
             LEFT JOIN admin_info ai ON ai.user_id = u.id AND si.user_id IS NULL AND fi.user_id IS NULL AND st.user_id IS NULL
             ORDER BY s.created_at DESC
             LIMIT :limit OFFSET :offset"
        );
        $stmt->bindValue(':limit', (int) $limit, PDO::PARAM_INT);
        $stmt->bindValue(':offset', (int) $offset, PDO::PARAM_INT);
        $stmt->execute();

        echo json_encode([
            'message' => 'Schedules loaded.',
            'schedules' => array_map([ScheduleStatusService::class, 'normalizeSchedule'], $stmt->fetchAll()),
        ]);
        exit;
    }

    // ── helper: fetch a schedule by id with camelCase keys ──────────
    $fetchScheduleById = function ($id) use ($pdo) {
        $stmt = $pdo->prepare(
            "SELECT
                s.schedule_id AS id,
                s.user_id AS userId,
                s.schedule_type AS scheduleType,
                COALESCE(s.schedule_kind, 'regular') AS scheduleKind,
                DATE_FORMAT(s.schedule_date, '%Y-%m-%d') AS scheduleDate,
                DATE_FORMAT(s.schedule_date, '%W, %b %e, %Y') AS scheduleDateLabel,
                TIME_FORMAT(s.time_start, '%H:%i') AS timeStart,
                TIME_FORMAT(s.time_end, '%H:%i') AS timeEnd,
                TIME_FORMAT(s.time_start, '%h:%i %p') AS timeStartLabel,
                TIME_FORMAT(s.time_end, '%h:%i %p') AS timeEndLabel,
                DATE_FORMAT(s.start_date, '%Y-%m-%d') AS startDate,
                DATE_FORMAT(s.end_date, '%Y-%m-%d') AS endDate,
                s.repeat_type AS repeatType,
                s.repeat_days AS repeatDays,
                s.grace_period_minutes AS gracePeriodMinutes,
                s.status,
                s.overridden_by_schedule_id AS overriddenByScheduleId,
                DATE_FORMAT(s.created_at, '%b %e, %Y %h:%i %p') AS createdAt,
                DATE_FORMAT(s.created_at, '%Y-%m-%d %H:%i:%s') AS createdAtValue,
                CONCAT(TIME_FORMAT(s.time_start, '%h:%i %p'), ' - ', TIME_FORMAT(s.time_end, '%h:%i %p')) AS `window`,
                COALESCE(
                    NULLIF(TRIM(CONCAT_WS(' ', si.first_name, si.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', fi.first_name, fi.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', st.first_name, st.last_name)), ''),
                    NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), ''),
                    u.username,
                    'Unknown User'
                ) AS ownerName,
                COALESCE(
                    si.school_id,
                    fi.employee_id,
                    st.employee_id,
                    ai.employee_id,
                    'No ID'
                ) AS ownerIdentifier
             FROM schedules s
             INNER JOIN users u ON u.id = s.user_id
             LEFT JOIN student_info si ON si.user_id = u.id
             LEFT JOIN faculty_info fi ON fi.user_id = u.id AND si.user_id IS NULL
             LEFT JOIN staff_info st ON st.user_id = u.id AND si.user_id IS NULL AND fi.user_id IS NULL
             LEFT JOIN admin_info ai ON ai.user_id = u.id AND si.user_id IS NULL AND fi.user_id IS NULL AND st.user_id IS NULL
             WHERE s.schedule_id = :id"
        );
        $stmt->execute([':id' => $id]);
        $schedule = $stmt->fetch();
        return $schedule ? ScheduleStatusService::normalizeSchedule($schedule) : $schedule;
    };

    // Time conflicts apply to every person. A regular schedule cannot share a window.
    // An approved override may share a window with a regular schedule, but not with another override.
    $detectConflicts = function ($date, $timeStart, $timeEnd, $kind = 'regular', $excludeId = null) use ($pdo) {
        $sql = "SELECT DATE_FORMAT(s.schedule_date, '%Y-%m-%d') AS scheduleDate,
                       TIME_FORMAT(s.time_start, '%h:%i %p') AS timeStartLabel,
                       TIME_FORMAT(s.time_end, '%h:%i %p') AS timeEndLabel,
                       COALESCE(s.schedule_kind, 'regular') AS scheduleKind,
                       COALESCE(
                           NULLIF(TRIM(CONCAT_WS(' ', si.first_name, si.last_name)), ''),
                           NULLIF(TRIM(CONCAT_WS(' ', fi.first_name, fi.last_name)), ''),
                           NULLIF(TRIM(CONCAT_WS(' ', st.first_name, st.last_name)), ''),
                           NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), ''),
                           u.username,
                           'Scheduled user'
                       ) AS ownerName
                FROM schedules s
                INNER JOIN users u ON u.id = s.user_id
                LEFT JOIN student_info si ON si.user_id = u.id
                LEFT JOIN faculty_info fi ON fi.user_id = u.id AND si.user_id IS NULL
                LEFT JOIN staff_info st ON st.user_id = u.id AND si.user_id IS NULL AND fi.user_id IS NULL
                LEFT JOIN admin_info ai ON ai.user_id = u.id AND si.user_id IS NULL AND fi.user_id IS NULL AND st.user_id IS NULL
                WHERE s.schedule_date = :d
                  AND s.time_start < :te AND s.time_end > :ts
                  AND s.status <> 'cancelled'";
        $params = [':d' => $date, ':ts' => $timeStart, ':te' => $timeEnd];
        if ($kind === 'override') {
            $sql .= " AND COALESCE(s.schedule_kind, 'regular') = 'override'";
        }
        if ($excludeId !== null) {
            $sql .= " AND s.schedule_id != :eid";
            $params[':eid'] = $excludeId;
        }
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    };

    // ── helper: generate date strings between two dates matching repeat rules ──
    $generateDates = function ($start, $end, $repeatType, $repeatDays) {
        $dates = [];
        $current = new DateTimeImmutable($start);
        $endDate = new DateTimeImmutable($end);

        while ($current <= $endDate) {
            $dateStr = $current->format('Y-m-d');
            if ($repeatType === 'daily') {
                $dates[] = $dateStr;
            } elseif ($repeatType === 'weekly_selected' && is_array($repeatDays)) {
                $dayName = $current->format('l');
                if (in_array($dayName, $repeatDays, true)) {
                    $dates[] = $dateStr;
                }
            }
            $current = $current->modify('+1 day');
        }
        return $dates;
    };

    // ── POST: create schedule(s) ──────────────────────────────────
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $payload = json_decode(file_get_contents('php://input'), true);

        if (!is_array($payload)) {
            http_response_code(400);
            echo json_encode(['message' => 'Invalid request body.']);
            exit;
        }

        $userId = (int) ($payload['userId'] ?? 0);
        $scheduleType = $payload['scheduleType'] ?? 'single';
        $scheduleKind = $payload['scheduleKind'] ?? 'regular';
        $scheduleDate = $payload['scheduleDate'] ?? null;
        $startDate = $payload['startDate'] ?? null;
        $endDate = $payload['endDate'] ?? null;
        $repeatType = $payload['repeatType'] ?? 'none';
        $repeatDays = $payload['repeatDays'] ?? null;
        $timeStart = $payload['timeStart'] ?? null;
        $timeEnd = $payload['timeEnd'] ?? null;
        $gracePeriodMinutes = (int) ($payload['gracePeriodMinutes'] ?? 15);
        $status = strtolower(trim((string) ($payload['status'] ?? 'pending')));
        $createdBy = $payload['createdBy'] ?? null;
        $allowedKinds = ['regular', 'override'];
        $allowedRegularStatuses = ['pending', 'approved', 'completed', 'cancelled'];

        if (!in_array($scheduleKind, $allowedKinds, true)) {
            http_response_code(422);
            echo json_encode(['message' => 'Schedule kind must be Regular or Override.']);
            exit;
        }

        if (!in_array($status, $allowedRegularStatuses, true)) {
            http_response_code(422);
            echo json_encode(['message' => 'Regular schedules must use Pending, Approved, Completed, or Cancelled.']);
            exit;
        }

        if ($userId <= 0 || !$timeStart || !$timeEnd) {
            http_response_code(422);
            echo json_encode(['message' => 'User and time range are required.']);
            exit;
        }

        if (strtotime($timeEnd) <= strtotime($timeStart)) {
            http_response_code(422);
            echo json_encode(['message' => 'End time must be after start time.']);
            exit;
        }

        $approvedAt = null;
        $approvedBy = $payload['approvedBy'] ?? $createdBy;
        if ($status === 'approved' && $approvedBy !== null) {
            $approvedAt = entrivo_now();
        }

        if ($scheduleKind === 'override') {
            if ($scheduleType !== 'single' || !$scheduleDate) {
                http_response_code(422);
                echo json_encode(['message' => 'Override schedules must be a single-day access window.']);
                exit;
            }

            $sourceScheduleId = (int) ($payload['sourceScheduleId'] ?? 0);
            $preview = $overrideSchedules->preview($userId, $scheduleDate, $timeStart, $timeEnd, $sourceScheduleId);

            if ($preview['blockingOverrides'] !== []) {
                echo json_encode([
                    'hasConflicts' => true,
                    'conflicts' => [$scheduleDate],
                    'conflictDetails' => $preview['blockingOverrides'],
                    'validDates' => [],
                    'message' => 'This override overlaps another override. An approved override can share a time with one regular schedule only.',
                ]);
                exit;
            }

            if (empty($payload['confirmOverrideImpact'])) {
                echo json_encode([
                    'needsOverrideConfirmation' => true,
                    'affectedSchedules' => $preview['affected'],
                    'notifiedUsers' => $preview['others'],
                ]);
                exit;
            }

            try {
                $created = $overrideSchedules->createFromAdmin([
                    'userId' => $userId,
                    'scheduleDate' => $scheduleDate,
                    'timeStart' => $timeStart,
                    'timeEnd' => $timeEnd,
                    'gracePeriodMinutes' => $gracePeriodMinutes,
                    'createdBy' => $createdBy ? (int) $createdBy : ($approvedBy ? (int) $approvedBy : 0),
                    'reason' => $payload['reason'] ?? '',
                    'requesterName' => $payload['requesterName'] ?? '',
                    'sourceScheduleId' => $sourceScheduleId,
                ]);
            } catch (InvalidArgumentException $error) {
                http_response_code(422);
                echo json_encode(['message' => $error->getMessage()]);
                exit;
            } catch (RuntimeException $error) {
                http_response_code(409);
                echo json_encode(['message' => $error->getMessage()]);
                exit;
            }

            $row = $fetchScheduleById($created['scheduleId']);
            $affectedRows = [];
            foreach ($created['affectedSchedules'] as $affected) {
                $loaded = $fetchScheduleById((int) $affected['id']);
                $affectedRows[] = $loaded ?: $affected;
            }

            $activityLog->record(
                $createdBy ? (int) $createdBy : null,
                'Add',
                'Added override schedule for requester #' . $userId . ' on ' . $scheduleDate . ' (' . $timeStart . ' - ' . $timeEnd . ').',
                'Success',
                $userId,
                'schedule',
                (string) $created['scheduleId']
            );

            $notificationCount = count($created['notificationIds']);
            $emailDelivery = [
                'sent' => 0,
                'failed' => 0,
                'uncertain' => 0,
                'pending' => $notificationCount,
                'dispatchStarted' => $notificationCount > 0 && NotificationService::dispatchDelivery((int) $created['overrideId']),
            ];
            $message = 'Override schedule created without changing the regular schedule.';
            if ($notificationCount > 0) {
                $message .= $emailDelivery['dispatchStarted']
                    ? ' Affected users have dashboard notices, and their email notifications are queued for delivery.'
                    : ' Affected users have dashboard notices. Email is queued; run the notification delivery worker to send it.';
            }

            echo json_encode([
                'message' => $message,
                'schedule' => $row,
                'affectedSchedules' => $affectedRows,
                'affectedUsersNotified' => $notificationCount,
                'emailNotifications' => $emailDelivery,
            ]);
            exit;
        }

        // ── single schedule ────────────────────────────────────────
        if ($scheduleType === 'single') {
            if (!$scheduleDate) {
                http_response_code(422);
                echo json_encode(['message' => 'Schedule date is required.']);
                exit;
            }

            $conflictRows = $detectConflicts($scheduleDate, $timeStart, $timeEnd, 'regular');

            if ($conflictRows) {
                echo json_encode([
                    'hasConflicts' => true,
                    'conflicts' => [$scheduleDate],
                    'conflictDetails' => $conflictRows,
                    'validDates' => [],
                    'message' => 'A regular schedule cannot share this date and time. Another schedule already occupies this window.',
                ]);
                exit;
            }

            $insert = $pdo->prepare(
                "INSERT INTO schedules (user_id, schedule_type, schedule_kind, schedule_date, time_start, time_end, start_date, end_date, repeat_type, repeat_days, repeat_day, grace_period_minutes, status, created_by, approved_by, approved_at)
                 VALUES (:user_id, 'single', :schedule_kind, :schedule_date, :time_start, :time_end, NULL, NULL, 'none', NULL, NULL, :grace_period_minutes, :status, :created_by, :approved_by, :approved_at)"
            );
            $insert->execute([
                ':user_id' => $userId,
                ':schedule_kind' => $scheduleKind,
                ':schedule_date' => $scheduleDate,
                ':time_start' => $timeStart,
                ':time_end' => $timeEnd,
                ':grace_period_minutes' => $gracePeriodMinutes,
                ':status' => $status,
                ':created_by' => $createdBy,
                ':approved_by' => $approvedBy,
                ':approved_at' => $approvedAt,
            ]);

            $scheduleId = (int) $pdo->lastInsertId();
            $row = $fetchScheduleById($scheduleId);

            $activityLog->record(
                $createdBy ? (int) $createdBy : null,
                'Add',
                'Added schedule for user #' . $userId . ' on ' . $scheduleDate . ' (' . $timeStart . ' - ' . $timeEnd . ').',
                'Success',
                $userId,
                'schedule',
                (string) $scheduleId
            );

            echo json_encode([
                'message' => 'Schedule created.',
                'schedule' => $row,
            ]);
            exit;
        }

        // ── recurring / batch schedules ────────────────────────────
        if ($scheduleType === 'recurring') {
            if (!$startDate || !$endDate) {
                http_response_code(422);
                echo json_encode(['message' => 'Start date and end date are required for recurring schedules.']);
                exit;
            }
            if ($repeatType === 'weekly_selected' && (!is_array($repeatDays) || count($repeatDays) === 0)) {
                http_response_code(422);
                echo json_encode(['message' => 'Select at least one repeat day.']);
                exit;
            }

            $allDates = $generateDates($startDate, $endDate, $repeatType, $repeatDays);

            if (empty($allDates)) {
                http_response_code(422);
                echo json_encode(['message' => 'No dates match the recurring rule in the given range.']);
                exit;
            }

            $conflicts = [];
            $conflictDetails = [];
            $validDates = [];

            foreach ($allDates as $date) {
                $conflictRows = $detectConflicts($date, $timeStart, $timeEnd, 'regular');
                if ($conflictRows) {
                    $conflicts[] = $date;
                    foreach ($conflictRows as $conflictRow) {
                        $conflictDetails[] = $conflictRow;
                    }
                } else {
                    $validDates[] = $date;
                }
            }

            if (!empty($conflicts)) {
                echo json_encode([
                    'hasConflicts' => true,
                    'conflicts' => $conflicts,
                    'conflictDetails' => $conflictDetails,
                    'validDates' => [],
                    'message' => 'A regular schedule cannot share this date and time. Another schedule already occupies this window.',
                ]);
                exit;
            }

            // Create one exact-date schedule per valid recurring date so door-lock checks
            // can use schedule_id + schedule_date directly.
            $createdSchedules = [];

            if (!empty($validDates)) {
                $insert = $pdo->prepare(
                    "INSERT INTO schedules (user_id, schedule_type, schedule_kind, schedule_date, time_start, time_end, start_date, end_date, repeat_type, repeat_days, repeat_day, grace_period_minutes, status, created_by, approved_by, approved_at)
                     VALUES (:user_id, 'single', :schedule_kind, :schedule_date, :time_start, :time_end, NULL, NULL, 'none', NULL, NULL, :grace_period_minutes, :status, :created_by, :approved_by, :approved_at)"
                );

                foreach ($validDates as $date) {
                    $insert->execute([
                        ':user_id' => $userId,
                        ':schedule_kind' => $scheduleKind,
                        ':schedule_date' => $date,
                        ':time_start' => $timeStart,
                        ':time_end' => $timeEnd,
                        ':grace_period_minutes' => $gracePeriodMinutes,
                        ':status' => $status,
                        ':created_by' => $createdBy,
                        ':approved_by' => $approvedBy,
                        ':approved_at' => $approvedAt,
                    ]);

                    $newId = (int) $pdo->lastInsertId();
                    $createdSchedules[] = $fetchScheduleById($newId);
                }
            }

            echo json_encode([
                'isBatch' => true,
                'schedules' => $createdSchedules,
                'conflicts' => $conflicts,
            ]);

            if (!empty($createdSchedules)) {
                $activityLog->record(
                    $createdBy ? (int) $createdBy : null,
                    'Add',
                    'Added ' . count($createdSchedules) . ' recurring schedule(s) for user #' . $userId . '.',
                    'Success',
                    $userId,
                    'schedule',
                    null
                );
            }
            exit;
        }

        http_response_code(400);
        echo json_encode(['message' => 'Invalid schedule type.']);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
        $payload = json_decode(file_get_contents('php://input'), true);

        if (!is_array($payload) || empty($payload['id'])) {
            http_response_code(400);
            echo json_encode(['message' => 'Schedule ID is required.']);
            exit;
        }

        $scheduleId = (int) $payload['id'];
        $timeStart = $payload['timeStart'] ?? null;
        $timeEnd = $payload['timeEnd'] ?? null;
        $scheduleDate = $payload['scheduleDate'] ?? null;
        $gracePeriodMinutes = (int) ($payload['gracePeriodMinutes'] ?? 15);
        $status = strtolower(trim((string) ($payload['status'] ?? 'pending')));
        $updatedBy = isset($payload['updatedBy']) ? (int) $payload['updatedBy'] : null;
        $updatedByName = trim((string) ($payload['updatedByName'] ?? ''));

        $existingSchedule = $fetchScheduleById($scheduleId);

        if (!$existingSchedule) {
            http_response_code(404);
            echo json_encode(['message' => 'Schedule not found.']);
            exit;
        }

        $existingKind = strtolower(trim((string) ($existingSchedule['scheduleKind'] ?? 'regular')));
        $allowedStatuses = $existingKind === 'override'
            ? ['approved', 'completed', 'cancelled']
            : ['pending', 'approved', 'completed', 'cancelled'];

        if (!in_array($status, $allowedStatuses, true)) {
            http_response_code(422);
            echo json_encode([
                'message' => $existingKind === 'override'
                    ? 'Override schedules must use Approved, Completed, or Cancelled.'
                    : 'Regular schedules must use Pending, Approved, Completed, or Cancelled.',
            ]);
            exit;
        }

        if (!$timeStart || !$timeEnd) {
            http_response_code(422);
            echo json_encode(['message' => 'Time start and end are required.']);
            exit;
        }

        if (strtotime($timeEnd) <= strtotime($timeStart)) {
            http_response_code(422);
            echo json_encode(['message' => 'End time must be after start time.']);
            exit;
        }

        $ownerId = (int) ($existingSchedule['userId'] ?? 0);
        if ($existingKind === 'override') {
            $preview = $overrideSchedules->preview($ownerId, (string) $scheduleDate, $timeStart, $timeEnd, 0, $scheduleId);
            if ($preview['blockingOverrides'] !== []) {
                echo json_encode([
                    'hasConflicts' => true,
                    'conflicts' => [$scheduleDate],
                    'conflictDetails' => $preview['blockingOverrides'],
                    'validDates' => [],
                    'message' => 'This override overlaps another override. An approved override can share a time with one regular schedule only.',
                ]);
                exit;
            }
        } else {
            $conflictRows = $detectConflicts($scheduleDate, $timeStart, $timeEnd, 'regular', $scheduleId);
            if ($conflictRows) {
                echo json_encode([
                    'hasConflicts' => true,
                    'conflicts' => [$scheduleDate],
                    'conflictDetails' => $conflictRows,
                    'validDates' => [],
                    'message' => 'A regular schedule cannot share this date and time. Another schedule already occupies this window.',
                ]);
                exit;
            }
        }

        $pdo->prepare(
            "UPDATE schedules SET time_start = :time_start, time_end = :time_end, schedule_date = :schedule_date, grace_period_minutes = :grace_period_minutes, status = :status, schedule_kind = :schedule_kind WHERE schedule_id = :schedule_id"
        )->execute([
            ':time_start' => $timeStart,
            ':time_end' => $timeEnd,
            ':schedule_date' => $scheduleDate,
            ':grace_period_minutes' => $gracePeriodMinutes,
            ':status' => $status,
            ':schedule_kind' => $existingKind,
            ':schedule_id' => $scheduleId,
        ]);

        if ($status === 'approved') {
            $existing = $pdo->prepare("SELECT approved_at FROM schedules WHERE schedule_id = :id");
            $existing->execute([':id' => $scheduleId]);
            $row = $existing->fetch();
            if ($row && $row['approved_at'] === null) {
                $pdo->prepare("UPDATE schedules SET approved_by = :ab, approved_at = :aa WHERE schedule_id = :id")
                    ->execute([':ab' => $payload['approvedBy'] ?? null, ':aa' => entrivo_now(), ':id' => $scheduleId]);
            }
        }

        $row = $fetchScheduleById($scheduleId);
        $changes = [];

        $pushChange = function ($label, $before, $after) use (&$changes) {
            if ((string) $before === (string) $after) {
                return;
            }

            $changes[] = [
                'field' => $label,
                'before' => $before !== null && $before !== '' ? $before : 'Not set',
                'after' => $after !== null && $after !== '' ? $after : 'Not set',
            ];
        };

        $pushChange('Schedule Date', $existingSchedule['scheduleDate'] ?? '', $row['scheduleDate'] ?? '');
        $pushChange('Time Start', $existingSchedule['timeStartLabel'] ?? $existingSchedule['timeStart'] ?? '', $row['timeStartLabel'] ?? $row['timeStart'] ?? '');
        $pushChange('Time End', $existingSchedule['timeEndLabel'] ?? $existingSchedule['timeEnd'] ?? '', $row['timeEndLabel'] ?? $row['timeEnd'] ?? '');
        $pushChange('Grace Period', (string) ($existingSchedule['gracePeriodMinutes'] ?? '') !== '' ? ($existingSchedule['gracePeriodMinutes'] . ' min') : '', (string) ($row['gracePeriodMinutes'] ?? '') !== '' ? ($row['gracePeriodMinutes'] . ' min') : '');
        $pushChange('Status', $existingSchedule['status'] ?? '', $row['status'] ?? '');

        $insertScheduleHistory($scheduleId, $updatedBy, $updatedByName, $changes);

        $activityLog->record(
            $updatedBy,
            'Edit',
            'Edited schedule #' . $scheduleId
                . (!empty($changes) ? ' (' . count($changes) . ' field change(s)).' : '.'),
            'Success',
            isset($existingSchedule['userId']) ? (int) $existingSchedule['userId'] : null,
            'schedule',
            (string) $scheduleId
        );

        echo json_encode([
            'message' => 'Schedule updated.',
            'schedule' => $row,
        ]);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $scheduleId = (int) ($_GET['id'] ?? 0);
        $actorId = filter_var($_GET['actor_id'] ?? null, FILTER_VALIDATE_INT) ?: null;

        if ($scheduleId <= 0) {
            http_response_code(422);
            echo json_encode(['message' => 'Schedule ID is required.']);
            exit;
        }

        require_once dirname(__DIR__) . '/services/UserPrivilegeService.php';
        (new UserPrivilegeService($pdo))->assertActorCanDeleteRecords(
            (int) $actorId,
            'Admin accounts cannot delete schedules.'
        );

        $existingSchedule = $fetchScheduleById($scheduleId);
        $pdo->prepare("DELETE FROM schedules WHERE schedule_id = :id")->execute([':id' => $scheduleId]);

        $activityLog->record(
            $actorId,
            'Delete',
            'Deleted schedule #' . $scheduleId . '.',
            'Success',
            isset($existingSchedule['userId']) ? (int) $existingSchedule['userId'] : null,
            'schedule',
            (string) $scheduleId
        );

        echo json_encode(['message' => 'Schedule deleted.', 'id' => $scheduleId]);
        exit;
    }

    http_response_code(405);
    echo json_encode(['message' => 'Method not allowed']);
} catch (InvalidArgumentException $error) {
    http_response_code(403);
    echo json_encode(['message' => $error->getMessage()]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['message' => 'Unable to process schedules.', 'error' => $error->getMessage()]);
}
