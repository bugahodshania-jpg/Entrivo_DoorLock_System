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

function portalNormalizeText($value): string
{
    return trim((string) ($value ?? ''));
}

function portalActivityDevice(?string $userAgent): array
{
    $agent = $userAgent ?? '';
    $browser = 'Browser';

    if (stripos($agent, 'Edg/') !== false) {
        $browser = 'Edge';
    } elseif (stripos($agent, 'Chrome/') !== false) {
        $browser = 'Chrome';
    } elseif (stripos($agent, 'Firefox/') !== false) {
        $browser = 'Firefox';
    } elseif (stripos($agent, 'Safari/') !== false) {
        $browser = 'Safari';
    }

    if (stripos($agent, 'Windows') !== false) {
        return ['Desktop (Windows)', "{$browser} / Windows"];
    }

    if (stripos($agent, 'Android') !== false) {
        return ['Mobile (Android)', "{$browser} / Android"];
    }

    if (stripos($agent, 'iPhone') !== false || stripos($agent, 'iPad') !== false) {
        return ['Mobile (iOS)', "{$browser} / iOS"];
    }

    if (stripos($agent, 'Mac OS') !== false) {
        return ['Desktop (Mac)', "{$browser} / macOS"];
    }

    if (stripos($agent, 'Linux') !== false) {
        return ['Desktop (Linux)', "{$browser} / Linux"];
    }

    return ['Unknown device', $browser];
}

function portalActivityLoginDetails(string $status, ?string $reason): array
{
    if ($status === 'logout') {
        return ['Logout', 'Signed out successfully.', 'Success'];
    }

    if ($status === 'success') {
        return ['Login', 'Signed in successfully.', 'Success'];
    }

    if ($status === 'blocked') {
        return ['Login', 'Login blocked. The account is temporarily locked.', 'Failed'];
    }

    $detail = match ($reason) {
        'user_not_found' => 'The username was not found.',
        'wrong_password' => 'The password was incorrect.',
        'pending_approval' => 'The account is still waiting for approval.',
        'rejected' => 'The registration was not approved.',
        'inactive' => 'This account has been blocked.',
        default => 'The sign-in was not accepted.',
    };

    return ['Login', $detail, 'Failed'];
}

function portalRequireFacultyOrStaff(PDO $pdo, int $userId): array
{
    $statement = $pdo->prepare(
        'SELECT id, username, email, role, is_active, created_at, password_hash, password_updated_at
         FROM users
         WHERE id = :id
         LIMIT 1'
    );
    $statement->execute(['id' => $userId]);
    $user = $statement->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        throw new InvalidArgumentException('User account was not found.');
    }

    if (!in_array($user['role'], ['faculty', 'staff'], true)) {
        throw new InvalidArgumentException('This portal is only available for faculty and staff accounts.');
    }

    if (!(bool) $user['is_active']) {
        throw new InvalidArgumentException('This account is blocked. Contact an administrator for help.');
    }

    return $user;
}

function portalProfileTable(string $role): string
{
    return $role === 'staff' ? 'staff_info' : 'faculty_info';
}

function portalFetchProfile(PDO $pdo, array $user): array
{
    $table = portalProfileTable($user['role']);
    $statement = $pdo->prepare(
        "SELECT
            {$table}.employee_id,
            {$table}.first_name,
            {$table}.middle_name,
            {$table}.last_name,
            {$table}.extension_name,
            {$table}.sex,
            {$table}.date_of_birth,
            {$table}.age,
            {$table}.contact_number,
            {$table}.office_department,
            {$table}.work_position,
            {$table}.province,
            {$table}.city_municipality,
            {$table}.barangay,
            {$table}.street_address,
            {$table}.users_photo
         FROM {$table}
         WHERE {$table}.user_id = :user_id
         LIMIT 1"
    );
    $statement->execute(['user_id' => (int) $user['id']]);
    $profile = $statement->fetch(PDO::FETCH_ASSOC) ?: [];

    $questions = $pdo->prepare(
        'SELECT question_slot, question, answer_text
         FROM account_security_questions
         WHERE user_id = :user_id
         ORDER BY question_slot ASC'
    );
    $questions->execute(['user_id' => (int) $user['id']]);
    $credentialCounts = $pdo->prepare(
        "SELECT
            (SELECT COUNT(*)
             FROM fingerprints
             WHERE fingerprints.user_id = :fingerprint_user_id
               AND fingerprints.status = 'active') AS fingerprint_count,
            (SELECT COUNT(*)
             FROM rfid_cards
             WHERE rfid_cards.user_id = :rfid_user_id
               AND rfid_cards.status = 'active') AS rfid_count"
    );
    $credentialCounts->execute([
        'fingerprint_user_id' => (int) $user['id'],
        'rfid_user_id' => (int) $user['id'],
    ]);
    $counts = $credentialCounts->fetch(PDO::FETCH_ASSOC) ?: [];
    $securityQuestions = array_map(
        static fn ($row) => [
            'slot' => (int) $row['question_slot'],
            'question' => $row['question'],
            'answer' => (string) ($row['answer_text'] ?? ''),
            'hasAnswer' => true,
        ],
        $questions->fetchAll(PDO::FETCH_ASSOC)
    );

    $fullName = trim(implode(' ', array_filter([
        $profile['first_name'] ?? null,
        $profile['middle_name'] ?? null,
        $profile['last_name'] ?? null,
        $profile['extension_name'] ?? null,
    ])));

    return [
        'id' => (int) $user['id'],
        'username' => $user['username'],
        'email' => $user['email'],
        'role' => $user['role'],
        'name' => $fullName !== '' ? $fullName : $user['username'],
        'employeeId' => $profile['employee_id'] ?? '',
        'firstName' => $profile['first_name'] ?? '',
        'middleName' => $profile['middle_name'] ?? '',
        'lastName' => $profile['last_name'] ?? '',
        'extensionName' => $profile['extension_name'] ?? '',
        'sex' => $profile['sex'] ?? '',
        'dateOfBirth' => $profile['date_of_birth'] ?? '',
        'age' => $profile['age'] ?? '',
        'contactNumber' => $profile['contact_number'] ?? '',
        'officeDepartment' => $profile['office_department'] ?? '',
        'workPosition' => $profile['work_position'] ?? '',
        'province' => $profile['province'] ?? '',
        'cityMunicipality' => $profile['city_municipality'] ?? '',
        'barangay' => $profile['barangay'] ?? '',
        'streetAddress' => $profile['street_address'] ?? '',
        'photo' => $profile['users_photo'] ?? '',
        'passwordUpdatedAt' => $user['password_updated_at']
            ? date('M j, Y g:i A', strtotime((string) $user['password_updated_at']))
            : date('M j, Y g:i A', strtotime((string) $user['created_at'])),
        'fingerprintCount' => (int) ($counts['fingerprint_count'] ?? 0),
        'rfidCount' => (int) ($counts['rfid_count'] ?? 0),
        'securityQuestions' => $securityQuestions,
        'editableFields' => [
            'contactNumber',
            'streetAddress',
            'barangay',
            'cityMunicipality',
            'province',
        ],
    ];
}

function portalDashboard(PDO $pdo, int $userId): array
{
    $accessCounts = $pdo->prepare(
        "SELECT
            SUM(access_status = 'granted') AS granted_access,
            SUM(access_status = 'denied' AND DATE(access_timestamp) = CURDATE()) AS denied_today,
            SUM(DATE(access_timestamp) = CURDATE()) AS total_today
         FROM access_log
         WHERE user_id = :user_id"
    );
    $accessCounts->execute(['user_id' => $userId]);
    $counts = $accessCounts->fetch(PDO::FETCH_ASSOC) ?: [];

    $activeToday = $pdo->prepare(
        "SELECT COUNT(*) AS total
         FROM schedules
         WHERE user_id = :user_id
           AND status = 'approved'
           AND schedule_date = CURDATE()"
    );
    $activeToday->execute(['user_id' => $userId]);
    $activeScheduleCount = (int) ($activeToday->fetchColumn() ?: 0);

    $trendStatement = $pdo->prepare(
        "SELECT
            DATE(access_timestamp) AS access_date,
            access_status,
            COUNT(*) AS total
         FROM access_log
         WHERE user_id = :user_id
           AND access_timestamp >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
         GROUP BY DATE(access_timestamp), access_status
         ORDER BY access_date ASC"
    );
    $trendStatement->execute(['user_id' => $userId]);
    $trendRows = $trendStatement->fetchAll(PDO::FETCH_ASSOC);
    $trendByDate = [];

    foreach ($trendRows as $row) {
        $date = $row['access_date'];
        if (!isset($trendByDate[$date])) {
            $trendByDate[$date] = ['granted' => 0, 'denied' => 0];
        }
        $trendByDate[$date][$row['access_status']] = (int) $row['total'];
    }

    $accessTrend = [];
    $today = new DateTimeImmutable('today');
    for ($dayOffset = 6; $dayOffset >= 0; $dayOffset--) {
        $date = $today->sub(new DateInterval('P' . $dayOffset . 'D'));
        $dateKey = $date->format('Y-m-d');
        $accessTrend[] = [
            'date' => $dateKey,
            'label' => $date->format('M j'),
            'granted' => $trendByDate[$dateKey]['granted'] ?? 0,
            'denied' => $trendByDate[$dateKey]['denied'] ?? 0,
        ];
    }

    $hourlyStatement = $pdo->prepare(
        "SELECT
            HOUR(access_timestamp) AS access_hour,
            access_status,
            COUNT(*) AS total
         FROM access_log
         WHERE user_id = :user_id
           AND DATE(access_timestamp) = CURDATE()
         GROUP BY HOUR(access_timestamp), access_status"
    );
    $hourlyStatement->execute(['user_id' => $userId]);
    $hourlyRows = $hourlyStatement->fetchAll(PDO::FETCH_ASSOC);
    $hourlyByTime = [];

    foreach ($hourlyRows as $row) {
        $hour = (int) $row['access_hour'];
        if (!isset($hourlyByTime[$hour])) {
            $hourlyByTime[$hour] = ['granted' => 0, 'denied' => 0];
        }
        $hourlyByTime[$hour][$row['access_status']] = (int) $row['total'];
    }

    $todayAccessTrend = [];
    for ($hour = 0; $hour < 24; $hour += 3) {
        $bucketGranted = 0;
        $bucketDenied = 0;
        for ($bucketHour = $hour; $bucketHour < min($hour + 3, 24); $bucketHour++) {
            $bucketGranted += $hourlyByTime[$bucketHour]['granted'] ?? 0;
            $bucketDenied += $hourlyByTime[$bucketHour]['denied'] ?? 0;
        }
        $todayAccessTrend[] = [
            'date' => 'today-' . $hour,
            'label' => DateTimeImmutable::createFromFormat('!H', (string) $hour)->format('g A'),
            'granted' => $bucketGranted,
            'denied' => $bucketDenied,
        ];
    }

    $currentTime = new DateTimeImmutable('now');
    $scheduleStatement = $pdo->prepare(
        "SELECT
            schedules.schedule_id,
            schedules.time_start AS time_start_value,
            schedules.time_end AS time_end_value,
            TIME_FORMAT(schedules.time_start, '%h:%i %p') AS time_start,
            TIME_FORMAT(schedules.time_end, '%h:%i %p') AS time_end,
            schedules.status
         FROM schedules
         WHERE schedules.user_id = :user_id
           AND schedules.status = 'approved'
           AND schedules.schedule_date = CURDATE()
         ORDER BY schedules.time_start ASC"
    );
    $scheduleStatement->execute(['user_id' => $userId]);
    $todaySchedules = array_map(
        static function ($schedule) use ($currentTime) {
            $startTime = DateTimeImmutable::createFromFormat(
                'Y-m-d H:i:s',
                $currentTime->format('Y-m-d') . ' ' . $schedule['time_start_value']
            );
            $endTime = DateTimeImmutable::createFromFormat(
                'Y-m-d H:i:s',
                $currentTime->format('Y-m-d') . ' ' . $schedule['time_end_value']
            );
            $state = 'upcoming';
            $stateLabel = 'Incoming';

            if ($startTime && $endTime) {
                if ($currentTime > $endTime) {
                    $state = 'done';
                    $stateLabel = 'Done';
                } elseif ($currentTime >= $startTime) {
                    $state = 'active';
                    $stateLabel = 'Active';
                }
            }

            return [
                'id' => (int) $schedule['schedule_id'],
                'time' => $schedule['time_start'] . ' - ' . $schedule['time_end'],
                'state' => $state,
                'stateLabel' => $stateLabel,
            ];
        },
        $scheduleStatement->fetchAll(PDO::FETCH_ASSOC)
    );

    $overrideStatement = $pdo->prepare(
        "SELECT
            override_id,
            reason,
            override_start,
            override_end,
            approved_by,
            DATE_FORMAT(override_start, '%b %e, %h:%i %p') AS start_label,
            DATE_FORMAT(override_end, '%h:%i %p') AS end_label,
            DATE_FORMAT(created_at, '%b %e, %Y %h:%i %p') AS created_label
         FROM access_overrides
         WHERE user_id = :user_id
           AND approved_by IS NULL
         ORDER BY created_at DESC
         LIMIT 8"
    );
    $overrideStatement->execute(['user_id' => $userId]);
    $pendingOverrides = array_map(
        static fn ($row) => [
            'id' => (int) $row['override_id'],
            'reason' => $row['reason'] ?: 'No reason provided',
            'time' => $row['start_label'] . ' - ' . $row['end_label'],
            'createdAt' => $row['created_label'],
            'state' => 'pending',
            'stateLabel' => 'Pending',
        ],
        $overrideStatement->fetchAll(PDO::FETCH_ASSOC)
    );

    $accessTypeColumn = $pdo->query("SHOW COLUMNS FROM access_log LIKE 'access_type'")->fetch()
        ? 'access_log.access_type'
        : "'IN'";
    $recentLogStatement = $pdo->prepare(
        "SELECT
            access_log.log_id,
            TIME_FORMAT(access_log.access_timestamp, '%h:%i %p') AS access_time,
            access_log.method_access,
            {$accessTypeColumn} AS access_type,
            access_log.access_status
         FROM access_log
         WHERE access_log.user_id = :user_id
           AND DATE(access_log.access_timestamp) = CURDATE()
         ORDER BY access_log.access_timestamp DESC
         LIMIT 5"
    );
    $recentLogStatement->execute(['user_id' => $userId]);
    $recentAccessLogs = array_map(
        static fn ($log) => [
            'id' => (int) $log['log_id'],
            'time' => $log['access_time'],
            'method' => $log['method_access'],
            'accessType' => $log['access_type'],
            'status' => $log['access_status'],
        ],
        $recentLogStatement->fetchAll(PDO::FETCH_ASSOC)
    );

    return [
        'summary' => [
            'grantedAccess' => (int) ($counts['granted_access'] ?? 0),
            'deniedToday' => (int) ($counts['denied_today'] ?? 0),
            'activeSchedulesToday' => $activeScheduleCount,
            'totalToday' => (int) ($counts['total_today'] ?? 0),
        ],
        'accessTrend' => $accessTrend,
        'todayAccessTrend' => $todayAccessTrend,
        'todaySchedules' => $todaySchedules,
        'pendingOverrides' => $pendingOverrides,
        'recentAccessLogs' => $recentAccessLogs,
    ];
}

function portalAccessLogs(PDO $pdo, int $userId): array
{
    $accessTypeColumn = $pdo->query("SHOW COLUMNS FROM access_log LIKE 'access_type'")->fetch()
        ? 'access_log.access_type'
        : "'IN'";

    $hasScheduleKind = (bool) $pdo->query("SHOW COLUMNS FROM schedules LIKE 'schedule_kind'")->fetch();
    $scheduleKindSelect = $hasScheduleKind
        ? "COALESCE(schedules.schedule_kind, 'regular')"
        : "CASE WHEN schedules.status = 'overridden' THEN 'override' ELSE 'regular' END";

    $statement = $pdo->prepare(
        "SELECT
            access_log.log_id,
            DATE_FORMAT(access_log.access_timestamp, '%Y-%m-%d') AS access_date_value,
            DATE_FORMAT(access_log.access_timestamp, '%b %e, %Y') AS access_date,
            TIME_FORMAT(access_log.access_timestamp, '%h:%i %p') AS access_time,
            access_log.method_access,
            {$accessTypeColumn} AS access_type,
            access_log.access_status,
            access_log.schedule_id,
            access_log.override_id,
            {$scheduleKindSelect} AS schedule_kind,
            schedules.status AS schedule_status,
            TIME_FORMAT(schedules.time_start, '%h:%i %p') AS schedule_start,
            TIME_FORMAT(schedules.time_end, '%h:%i %p') AS schedule_end
         FROM access_log
         LEFT JOIN schedules ON schedules.schedule_id = access_log.schedule_id
         WHERE access_log.user_id = :user_id
         ORDER BY access_log.access_timestamp DESC
         LIMIT 300"
    );
    $statement->execute(['user_id' => $userId]);

    return array_map(
        static function ($row) {
            $scheduleKind = strtolower(trim((string) ($row['schedule_kind'] ?? '')));
            $scheduleStatus = strtolower(trim((string) ($row['schedule_status'] ?? '')));

            if ($row['schedule_id'] === null && $row['override_id'] !== null) {
                $scheduleKind = 'override';
            } elseif ($scheduleKind === '' && $scheduleStatus === 'overridden') {
                $scheduleKind = 'override';
            } elseif ($scheduleKind === '' && $row['schedule_id'] !== null) {
                $scheduleKind = 'regular';
            }

            $isOverride = $scheduleKind === 'override';

            return [
                'id' => (int) $row['log_id'],
                'dateValue' => $row['access_date_value'],
                'date' => $row['access_date'],
                'time' => $row['access_time'],
                'method' => $row['method_access'],
                'accessType' => $row['access_type'],
                'status' => $row['access_status'],
                'scheduleId' => $row['schedule_id'] !== null ? (int) $row['schedule_id'] : null,
                'overrideId' => $row['override_id'] !== null ? (int) $row['override_id'] : null,
                'scheduleKind' => $row['schedule_id'] !== null || $row['override_id'] !== null
                    ? ($isOverride ? 'override' : 'regular')
                    : null,
                'scheduleKindLabel' => $row['schedule_id'] !== null || $row['override_id'] !== null
                    ? ($isOverride ? 'Override' : 'Regular')
                    : null,
                'scheduleWindow' => ($row['schedule_start'] && $row['schedule_end'])
                    ? $row['schedule_start'] . ' - ' . $row['schedule_end']
                    : null,
            ];
        },
        $statement->fetchAll(PDO::FETCH_ASSOC)
    );
}

function portalActivityDescriptionForOwner(
    string $activityType,
    string $description,
    ?int $actorUserId,
    int $ownerUserId,
    ?string $entityType = null
): string
{
    $text = trim($description);
    $isOwnAction = $actorUserId !== null && $actorUserId === $ownerUserId;
    $type = strtolower(trim($activityType));
    $entity = strtolower(trim((string) $entityType));

    if (preg_match('/^Approved override request #(\d+)\s+for\b.+/i', $text, $matches)) {
        return 'Your override request #' . $matches[1] . ' was approved and marked as overridden.';
    }

    if (preg_match('/^Rejected override request #(\d+)\s+for\b.+/i', $text, $matches)) {
        return 'Your override request #' . $matches[1] . ' was rejected.';
    }

    if (preg_match('/^Edited user profile for\b.+/i', $text)) {
        return $isOwnAction ? 'You updated your profile.' : 'Your profile was updated by an administrator.';
    }

    if (preg_match('/^Updated password for\b.+/i', $text)) {
        return $isOwnAction ? 'You changed your password.' : 'Your password was updated by an administrator.';
    }

    if (preg_match('/^Blocked user account for\b.+/i', $text)) {
        return 'Your account was blocked.';
    }

    if (preg_match('/^Unblocked user account for\b.+/i', $text)) {
        return 'Your account was unblocked.';
    }

    if (preg_match('/^Deleted user account for\b.+/i', $text)) {
        return 'Your account was deleted.';
    }

    if ($entity === 'schedule' || preg_match('/\bschedule\b/i', $text)) {
        if ($type === 'add') {
            return 'A schedule was assigned to you.';
        }
        if ($type === 'edit') {
            return 'One of your schedules was updated.';
        }
        if ($type === 'delete') {
            return 'One of your schedules was removed.';
        }
    }

    if ($entity === 'rfid' || str_contains(strtolower($text), 'rfid')) {
        return 'Your RFID card credentials were updated.';
    }

    if ($entity === 'fingerprint_job') {
        if ($type === 'cancel') {
            return 'A fingerprint enrollment job for your account was cancelled.';
        }
        if ($type === 'retry') {
            return 'A fingerprint enrollment job for your account was queued again.';
        }
        return 'A fingerprint enrollment job was created for your account.';
    }

    if ($entity === 'fingerprint_sync') {
        if (str_contains(strtolower($text), 'failed')) {
            return 'Your fingerprint could not be synced to the door sensor.';
        }
        if ($type === 'cancel') {
            return 'A fingerprint sync to the door sensor was cancelled.';
        }
        if ($type === 'sync') {
            return 'Your fingerprint was synced to the door sensor.';
        }
        return 'Your fingerprint was queued for syncing to the door sensor.';
    }

    if ($entity === 'fingerprint' || str_contains(strtolower($text), 'fingerprint')) {
        if ($type === 'delete') {
            return 'A fingerprint credential was removed from your account.';
        }
        if ($type === 'enroll' || str_contains(strtolower($text), 'completed')) {
            return 'A fingerprint was enrolled for your account.';
        }
        return 'A fingerprint credential update was started for your account.';
    }

    if ($entity === 'registration') {
        return $type === 'reject'
            ? 'Your registration was rejected.'
            : 'Your registration was approved.';
    }

    if ($type === 'enroll' && preg_match('/\bfor\b.+/i', $text) && !$isOwnAction) {
        return 'A fingerprint was enrolled for your account.';
    }

    return $text;
}

function portalActivityCategory(
    string $activityType,
    ?string $entityType,
    string $description,
    ?int $actorUserId = null,
    ?int $ownerUserId = null
): string
{
    unset($actorUserId, $ownerUserId);

    return ActivityLogService::category($activityType, $entityType, $description);
}

function portalActivityLogs(PDO $pdo, int $userId): array
{
    $activityLog = new ActivityLogService($pdo);
    $activityLog->ensureTable();
    $activityLog->syncFingerprintEnrollmentActivities();

    $loginStatement = $pdo->prepare(
        "SELECT
            login_attempts.attempt_id,
            login_attempts.attempt_status,
            login_attempts.failure_reason,
            login_attempts.user_agent,
            login_attempts.created_at AS sort_at,
            DATE_FORMAT(login_attempts.created_at, '%Y-%m-%d') AS date_value,
            DATE_FORMAT(login_attempts.created_at, '%b %e, %Y') AS date_label,
            DATE_FORMAT(login_attempts.created_at, '%h:%i %p') AS time_label
         FROM login_attempts
         WHERE login_attempts.user_id = :user_id
         ORDER BY login_attempts.created_at DESC, login_attempts.attempt_id DESC
         LIMIT 300"
    );
    $loginStatement->execute(['user_id' => $userId]);

    $loginLogs = array_map(
        static function ($row) {
            [$activity, $description, $status] = portalActivityLoginDetails(
                strtolower(trim((string) ($row['attempt_status'] ?? ''))),
                $row['failure_reason'] ?? null
            );
            [$device, $deviceDetail] = portalActivityDevice($row['user_agent'] ?? null);

            return [
                'id' => 'login-' . (int) $row['attempt_id'],
                'activity' => $activity,
                'activityType' => $activity,
                'description' => $description,
                'status' => $status,
                'device' => $device,
                'deviceDetail' => $deviceDetail,
                'dateValue' => $row['date_value'],
                'date' => $row['date_label'],
                'time' => trim((string) $row['time_label']),
                'sortAt' => $row['sort_at'],
            ];
        },
        $loginStatement->fetchAll(PDO::FETCH_ASSOC)
    );

    $transactionStatement = $pdo->prepare(
        "SELECT
            activity_transactions.transaction_id,
            activity_transactions.actor_user_id,
            activity_transactions.activity_type,
            activity_transactions.entity_type,
            activity_transactions.description,
            activity_transactions.status,
            activity_transactions.user_agent,
            activity_transactions.created_at AS sort_at,
            DATE_FORMAT(activity_transactions.created_at, '%Y-%m-%d') AS date_value,
            DATE_FORMAT(activity_transactions.created_at, '%b %e, %Y') AS date_label,
            DATE_FORMAT(activity_transactions.created_at, '%h:%i %p') AS time_label
         FROM activity_transactions
         WHERE activity_transactions.actor_user_id = :user_id
            OR activity_transactions.target_user_id = :user_id_target
         ORDER BY activity_transactions.created_at DESC, activity_transactions.transaction_id DESC
         LIMIT 300"
    );
    $transactionStatement->execute([
        'user_id' => $userId,
        'user_id_target' => $userId,
    ]);

    $transactionLogs = array_map(
        static function ($row) use ($userId) {
            [$device, $deviceDetail] = portalActivityDevice($row['user_agent'] ?? null);
            $status = strcasecmp((string) $row['status'], 'Failed') === 0 ? 'Failed' : 'Success';
            $actorUserId = $row['actor_user_id'] !== null ? (int) $row['actor_user_id'] : null;
            $activityType = (string) ($row['activity_type'] ?? '');
            $entityType = $row['entity_type'] ?? null;
            $originalDescription = (string) ($row['description'] ?? '');
            $description = portalActivityDescriptionForOwner(
                $activityType,
                $originalDescription,
                $actorUserId,
                $userId,
                $entityType
            );

            return [
                'id' => 'txn-' . (int) $row['transaction_id'],
                'activity' => portalActivityCategory(
                    $activityType,
                    $entityType,
                    $originalDescription,
                    $actorUserId,
                    $userId
                ),
                'activityType' => $activityType,
                'description' => $description,
                'status' => $status,
                'device' => $device,
                'deviceDetail' => $deviceDetail,
                'dateValue' => $row['date_value'],
                'date' => $row['date_label'],
                'time' => trim((string) $row['time_label']),
                'sortAt' => $row['sort_at'],
            ];
        },
        $transactionStatement->fetchAll(PDO::FETCH_ASSOC)
    );

    $accessLogs = [];
    try {
        $accessStatement = $pdo->prepare(
            "SELECT
                access_log.log_id,
                access_log.method_access,
                access_log.access_status,
                access_log.access_timestamp AS sort_at,
                DATE_FORMAT(access_log.access_timestamp, '%Y-%m-%d') AS date_value,
                DATE_FORMAT(access_log.access_timestamp, '%b %e, %Y') AS date_label,
                DATE_FORMAT(access_log.access_timestamp, '%h:%i %p') AS time_label
             FROM access_log
             WHERE access_log.user_id = :user_id
             ORDER BY access_log.access_timestamp DESC
             LIMIT 200"
        );
        $accessStatement->execute(['user_id' => $userId]);

        $accessLogs = array_map(
            static function ($row) {
                $statusRaw = strtolower(trim((string) ($row['access_status'] ?? '')));
                $granted = $statusRaw === 'granted' || $statusRaw === 'success';
                $method = trim((string) ($row['method_access'] ?? 'Access')) ?: 'Access';

                return [
                    'id' => 'access-' . (int) $row['log_id'],
                    'activity' => 'Access',
                    'activityType' => 'Access',
                    'description' => $granted
                        ? 'Door access granted via ' . $method . '.'
                        : 'Door access denied via ' . $method . '.',
                    'status' => $granted ? 'Success' : 'Failed',
                    'device' => $method,
                    'deviceDetail' => 'Door access point',
                    'dateValue' => $row['date_value'],
                    'date' => $row['date_label'],
                    'time' => trim((string) $row['time_label']),
                    'sortAt' => $row['sort_at'],
                ];
            },
            $accessStatement->fetchAll(PDO::FETCH_ASSOC)
        );
    } catch (Throwable $accessError) {
        $accessLogs = [];
    }

    $logs = array_merge($loginLogs, $transactionLogs, $accessLogs);
    usort($logs, static function ($left, $right) {
        return strcmp((string) ($right['sortAt'] ?? ''), (string) ($left['sortAt'] ?? ''));
    });
    $logs = array_slice($logs, 0, 500);

    return array_map(
        static function ($log) {
            unset($log['sortAt']);
            return $log;
        },
        $logs
    );
}

function portalOverrides(PDO $pdo, int $userId): array
{
    $statement = $pdo->prepare(
        "SELECT
            override_id,
            reason,
            approved_by,
            override_start,
            override_end,
            created_at,
            DATE_FORMAT(override_start, '%Y-%m-%d') AS start_date_value,
            DATE_FORMAT(override_start, '%b %e, %Y') AS date_label,
            DATE_FORMAT(override_start, '%Y-%m-%d\\T%H:%i') AS start_input,
            DATE_FORMAT(override_end, '%Y-%m-%d\\T%H:%i') AS end_input,
            DATE_FORMAT(override_start, '%H:%i') AS time_start,
            DATE_FORMAT(override_end, '%H:%i') AS time_end,
            TIME_FORMAT(override_start, '%h:%i %p') AS time_start_label,
            TIME_FORMAT(override_end, '%h:%i %p') AS time_end_label,
            DATE_FORMAT(override_start, '%b %e, %Y %h:%i %p') AS start_label,
            DATE_FORMAT(override_end, '%b %e, %Y %h:%i %p') AS end_label,
            DATE_FORMAT(created_at, '%b %e, %Y') AS created_date_label,
            DATE_FORMAT(created_at, '%h:%i %p') AS created_time_label,
            DATE_FORMAT(created_at, '%b %e, %Y %h:%i %p') AS created_label
         FROM access_overrides
         WHERE user_id = :user_id
         ORDER BY created_at DESC
         LIMIT 200"
    );
    $statement->execute(['user_id' => $userId]);
    $now = new DateTimeImmutable('now');

    return array_map(
        static function ($row) use ($now) {
            $isApproved = $row['approved_by'] !== null;
            $start = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', (string) $row['override_start']);
            $end = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', (string) $row['override_end']);
            $state = 'pending';
            $stateLabel = 'Pending';

            if ($isApproved && $start && $end) {
                if ($now > $end) {
                    $state = 'done';
                    $stateLabel = 'Done';
                } elseif ($now >= $start) {
                    $state = 'active';
                    $stateLabel = 'Active';
                } else {
                    $state = 'upcoming';
                    $stateLabel = 'Incoming';
                }
            }

            return [
                'id' => (int) $row['override_id'],
                'reason' => $row['reason'] ?: 'No reason provided',
                'start' => $row['start_label'],
                'end' => $row['end_label'],
                'startInput' => $row['start_input'],
                'endInput' => $row['end_input'],
                'scheduleDate' => $row['start_date_value'],
                'dateLabel' => $row['date_label'],
                'timeStart' => $row['time_start'],
                'timeEnd' => $row['time_end'],
                'timeStartLabel' => $row['time_start_label'],
                'timeEndLabel' => $row['time_end_label'],
                'time' => $row['time_start_label'] . ' - ' . $row['time_end_label'],
                'createdAt' => $row['created_label'],
                'createdDateLabel' => $row['created_date_label'],
                'createdTimeLabel' => $row['created_time_label'],
                'dateValue' => $row['start_date_value'],
                'state' => $state,
                'stateLabel' => $stateLabel,
                'isApproved' => $isApproved,
                'canEdit' => $state === 'pending',
                'canCancel' => in_array($state, ['pending', 'upcoming', 'active'], true),
            ];
        },
        $statement->fetchAll(PDO::FETCH_ASSOC)
    );
}

function portalSchedules(PDO $pdo, int $userId): array
{
    $statement = $pdo->prepare(
        "SELECT
            schedule_id,
            schedule_type,
            schedule_date,
            start_date,
            end_date,
            time_start,
            time_end,
            repeat_type,
            repeat_days,
            repeat_day,
            status,
            grace_period_minutes,
            DATE_FORMAT(COALESCE(schedule_date, start_date), '%Y-%m-%d') AS date_value,
            DATE_FORMAT(COALESCE(schedule_date, start_date), '%b %e, %Y') AS date_label,
            TIME_FORMAT(time_start, '%h:%i %p') AS time_start_label,
            TIME_FORMAT(time_end, '%h:%i %p') AS time_end_label
         FROM schedules
         WHERE user_id = :user_id
         ORDER BY COALESCE(schedule_date, start_date) DESC, time_start ASC
         LIMIT 500"
    );
    $statement->execute(['user_id' => $userId]);

    return array_map(
        static function ($row) {
            $repeatDays = $row['repeat_days'];
            if (is_string($repeatDays) && $repeatDays !== '') {
                $decoded = json_decode($repeatDays, true);
                $repeatDays = is_array($decoded) ? $decoded : [];
            } else {
                $repeatDays = [];
            }

            return [
                'id' => (int) $row['schedule_id'],
                'scheduleType' => $row['schedule_type'],
                'scheduleDate' => $row['schedule_date'],
                'startDate' => $row['start_date'],
                'endDate' => $row['end_date'],
                'dateValue' => $row['date_value'],
                'dateLabel' => $row['date_label'],
                'timeStart' => $row['time_start'],
                'timeEnd' => $row['time_end'],
                'time' => $row['time_start_label'] . ' - ' . $row['time_end_label'],
                'repeatType' => $row['repeat_type'],
                'repeatDays' => $repeatDays,
                'repeatDay' => $row['repeat_day'],
                'status' => $row['status'],
                'gracePeriodMinutes' => (int) ($row['grace_period_minutes'] ?? 15),
            ];
        },
        $statement->fetchAll(PDO::FETCH_ASSOC)
    );
}

function portalCalendarSchedules(PDO $pdo, int $viewerUserId): array
{
    $statement = $pdo->prepare(
        "SELECT
            s.schedule_id,
            s.user_id,
            s.schedule_type,
            s.schedule_date,
            s.time_start,
            s.time_end,
            s.status,
            s.grace_period_minutes,
            DATE_FORMAT(COALESCE(s.schedule_date, s.start_date), '%Y-%m-%d') AS date_value,
            DATE_FORMAT(COALESCE(s.schedule_date, s.start_date), '%b %e, %Y') AS date_label,
            TIME_FORMAT(s.time_start, '%h:%i %p') AS time_start_label,
            TIME_FORMAT(s.time_end, '%h:%i %p') AS time_end_label,
            COALESCE(
                NULLIF(TRIM(CONCAT_WS(' ', si.first_name, si.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', fi.first_name, fi.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', st.first_name, st.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), ''),
                u.username,
                'Unknown User'
            ) AS owner_name,
            COALESCE(
                si.school_id,
                fi.employee_id,
                st.employee_id,
                ai.employee_id,
                'No ID'
            ) AS owner_identifier
         FROM schedules s
         INNER JOIN users u ON u.id = s.user_id
         LEFT JOIN student_info si ON si.user_id = u.id
         LEFT JOIN faculty_info fi ON fi.user_id = u.id AND si.user_id IS NULL
         LEFT JOIN staff_info st ON st.user_id = u.id AND si.user_id IS NULL AND fi.user_id IS NULL
         LEFT JOIN admin_info ai ON ai.user_id = u.id AND si.user_id IS NULL AND fi.user_id IS NULL AND st.user_id IS NULL
         WHERE LOWER(TRIM(s.status)) IN ('approved', 'overridden')
           AND COALESCE(s.schedule_date, s.start_date) IS NOT NULL
         ORDER BY COALESCE(s.schedule_date, s.start_date) ASC, s.time_start ASC
         LIMIT 3000"
    );
    $statement->execute();

    return array_map(
        static function ($row) use ($viewerUserId) {
            $ownerUserId = (int) $row['user_id'];

            return [
                'id' => (int) $row['schedule_id'],
                'userId' => $ownerUserId,
                'isMine' => $ownerUserId === $viewerUserId,
                'ownerName' => $row['owner_name'],
                'ownerIdentifier' => $row['owner_identifier'],
                'scheduleType' => $row['schedule_type'],
                'scheduleDate' => $row['schedule_date'],
                'dateValue' => $row['date_value'],
                'dateLabel' => $row['date_label'],
                'timeStart' => $row['time_start'],
                'timeEnd' => $row['time_end'],
                'time' => $row['time_start_label'] . ' - ' . $row['time_end_label'],
                'status' => $row['status'],
                'gracePeriodMinutes' => (int) ($row['grace_period_minutes'] ?? 15),
            ];
        },
        $statement->fetchAll(PDO::FETCH_ASSOC)
    );
}

try {
    $pdo = entrivo_pdo();
    $input = [];

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        if (!is_array($input)) {
            $input = [];
        }
    }

    $action = portalNormalizeText($_GET['action'] ?? ($input['action'] ?? 'dashboard'));
    $userId = filter_var($_GET['user_id'] ?? ($input['user_id'] ?? null), FILTER_VALIDATE_INT);

    if (!$userId) {
        http_response_code(422);
        echo json_encode(['message' => 'A valid user id is required.']);
        exit;
    }

    $user = portalRequireFacultyOrStaff($pdo, $userId);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        if ($action === 'dashboard') {
            echo json_encode([
                'message' => 'Dashboard loaded.',
                ...portalDashboard($pdo, $userId),
            ]);
            exit;
        }

        if ($action === 'profile') {
            echo json_encode([
                'message' => 'Profile loaded.',
                'profile' => portalFetchProfile($pdo, $user),
            ]);
            exit;
        }

        if ($action === 'access_logs') {
            echo json_encode([
                'message' => 'Access logs loaded.',
                'accessLogs' => portalAccessLogs($pdo, $userId),
            ]);
            exit;
        }

        if ($action === 'activity_logs') {
            $previewLimit = filter_input(INPUT_GET, 'limit', FILTER_VALIDATE_INT);
            if (!is_int($previewLimit) || $previewLimit < 1) {
                $previewLimit = 0;
            } else {
                $previewLimit = min($previewLimit, 20);
            }

            $logs = portalActivityLogs($pdo, $userId);
            $hasMore = $previewLimit > 0 && count($logs) > $previewLimit;
            if ($previewLimit > 0) {
                $logs = array_slice($logs, 0, $previewLimit);
            }

            $payload = [
                'message' => 'Activity logs loaded.',
                'logs' => $logs,
            ];

            if ($previewLimit > 0) {
                $payload['hasMore'] = $hasMore;
            }

            echo json_encode($payload);
            exit;
        }

        if ($action === 'overrides') {
            echo json_encode([
                'message' => 'Override requests loaded.',
                'overrides' => portalOverrides($pdo, $userId),
            ]);
            exit;
        }

        if ($action === 'schedules') {
            $calendarSchedules = [];

            try {
                $calendarSchedules = portalCalendarSchedules($pdo, $userId);
            } catch (Throwable $calendarError) {
                $calendarSchedules = [];
            }

            echo json_encode([
                'message' => 'Schedules loaded.',
                'schedules' => portalSchedules($pdo, $userId),
                'calendarSchedules' => $calendarSchedules,
            ]);
            exit;
        }

        http_response_code(400);
        echo json_encode(['message' => 'Unknown action.']);
        exit;
    }

    if ($action === 'update_profile') {
        $contactNumber = portalNormalizeText($input['contactNumber'] ?? '');
        $streetAddress = portalNormalizeText($input['streetAddress'] ?? '');
        $barangay = portalNormalizeText($input['barangay'] ?? '');
        $cityMunicipality = portalNormalizeText($input['cityMunicipality'] ?? '');
        $province = portalNormalizeText($input['province'] ?? '');

        if ($contactNumber !== '' && !preg_match('/^\d{11}$/', $contactNumber)) {
            throw new InvalidArgumentException('Contact number must be 11 digits.');
        }

        $table = portalProfileTable($user['role']);
        $update = $pdo->prepare(
            "UPDATE {$table}
             SET contact_number = :contact_number,
                 street_address = :street_address,
                 barangay = :barangay,
                 city_municipality = :city_municipality,
                 province = :province
             WHERE user_id = :user_id"
        );
        $update->execute([
            'contact_number' => $contactNumber !== '' ? $contactNumber : null,
            'street_address' => $streetAddress !== '' ? $streetAddress : null,
            'barangay' => $barangay !== '' ? $barangay : null,
            'city_municipality' => $cityMunicipality !== '' ? $cityMunicipality : null,
            'province' => $province !== '' ? $province : null,
            'user_id' => $userId,
        ]);

        (new ActivityLogService($pdo))->record(
            $userId,
            'Update',
            'Updated account profile details.',
            'Success',
            $userId,
            'profile',
            (string) $userId
        );

        echo json_encode([
            'message' => 'Profile updated successfully.',
            'profile' => portalFetchProfile($pdo, $user),
        ]);
        exit;
    }

    if ($action === 'change_password') {
        $currentPassword = (string) ($input['currentPassword'] ?? '');
        $newPassword = (string) ($input['newPassword'] ?? '');
        $confirmPassword = (string) ($input['confirmPassword'] ?? '');

        if ($currentPassword === '' || $newPassword === '') {
            throw new InvalidArgumentException('Current and new passwords are required.');
        }

        if ($newPassword !== $confirmPassword) {
            throw new InvalidArgumentException('New password confirmation does not match.');
        }

        if (strlen($newPassword) < 8) {
            throw new InvalidArgumentException('New password must be at least 8 characters.');
        }

        if (!password_verify($currentPassword, (string) $user['password_hash'])) {
            (new ActivityLogService($pdo))->record(
                $userId,
                'Password',
                'Password change failed. The current password was incorrect.',
                'Failed',
                $userId,
                'password',
                (string) $userId
            );
            throw new InvalidArgumentException('Current password is incorrect.');
        }

        $update = $pdo->prepare(
            'UPDATE users
             SET password_hash = :password_hash,
                 password_updated_at = NOW()
             WHERE id = :id'
        );
        $update->execute([
            'password_hash' => password_hash($newPassword, PASSWORD_DEFAULT),
            'id' => $userId,
        ]);

        (new ActivityLogService($pdo))->record(
            $userId,
            'Update',
            'Changed account password.',
            'Success',
            $userId,
            'password',
            (string) $userId
        );

        echo json_encode(['message' => 'Password updated successfully.']);
        exit;
    }

    if ($action === 'update_security_questions') {
        $questions = $input['securityQuestions'] ?? null;

        if (!is_array($questions) || count($questions) !== 3) {
            throw new InvalidArgumentException('Provide exactly three security questions.');
        }

        $allowedQuestions = [
            'What is the name of your first school?',
            'What is your mother\'s maiden name?',
            'What city were you born in?',
            'What is the name of your favorite teacher?',
            'What was the name of your first pet?',
            'What is your favorite book?',
        ];
        $seen = [];
        $normalized = [];
        foreach ($questions as $index => $item) {
            $question = portalNormalizeText($item['question'] ?? '');
            $answer = preg_replace('/\s+/', ' ', portalNormalizeText($item['answer'] ?? ''));

            if (!in_array($question, $allowedQuestions, true)) {
                throw new InvalidArgumentException('Select a security question from the list.');
            }

            if ($answer !== '' && strlen($answer) > 100) {
                throw new InvalidArgumentException('Each security answer must be 100 characters or fewer.');
            }

            if (isset($seen[$question])) {
                throw new InvalidArgumentException('Choose three different security questions.');
            }

            $seen[$question] = true;
            $slot = $index + 1;

            $exists = $pdo->prepare(
                'SELECT question_id, question FROM account_security_questions
                 WHERE user_id = :user_id AND question_slot = :slot LIMIT 1'
            );
            $exists->execute(['user_id' => $userId, 'slot' => $slot]);
            $row = $exists->fetch(PDO::FETCH_ASSOC);
            $keepExisting = $answer === ''
                && $row
                && $question === trim((string) $row['question']);

            if (!$keepExisting && ($answer === '' || strlen($answer) < 2)) {
                throw new InvalidArgumentException('Each security answer must be at least 2 characters.');
            }

            $normalized[] = [
                'slot' => $slot,
                'question' => $question,
                'keep_existing' => $keepExisting,
                'question_id' => $row ? (int) $row['question_id'] : null,
                'answer_hash' => $keepExisting ? null : password_hash(strtolower($answer), PASSWORD_DEFAULT),
                'answer_text' => $keepExisting ? null : $answer,
            ];
        }

        $pdo->beginTransaction();
        try {
            foreach ($normalized as $item) {
                if ($item['keep_existing']) {
                    continue;
                }

                if ($item['question_id']) {
                    $save = $pdo->prepare(
                        'UPDATE account_security_questions
                         SET question = :question,
                             answer_hash = :answer_hash,
                             answer_text = :answer_text
                         WHERE question_id = :question_id'
                    );
                    $save->execute([
                        'question' => $item['question'],
                        'answer_hash' => $item['answer_hash'],
                        'answer_text' => $item['answer_text'],
                        'question_id' => $item['question_id'],
                    ]);
                } else {
                    $save = $pdo->prepare(
                        'INSERT INTO account_security_questions (user_id, question_slot, question, answer_hash, answer_text)
                         VALUES (:user_id, :slot, :question, :answer_hash, :answer_text)'
                    );
                    $save->execute([
                        'user_id' => $userId,
                        'slot' => $item['slot'],
                        'question' => $item['question'],
                        'answer_hash' => $item['answer_hash'],
                        'answer_text' => $item['answer_text'],
                    ]);
                }
            }

            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }

            throw $error;
        }

        (new ActivityLogService($pdo))->record(
            $userId,
            'Update',
            'Updated account security questions.',
            'Success',
            $userId,
            'security_questions',
            (string) $userId
        );

        echo json_encode([
            'message' => 'Security questions updated successfully.',
            'profile' => portalFetchProfile($pdo, $user),
        ]);
        exit;
    }

    if ($action === 'request_override') {
        $reason = portalNormalizeText($input['reason'] ?? '');
        $scheduleDate = portalNormalizeText($input['scheduleDate'] ?? $input['schedule_date'] ?? '');
        $timeStart = portalNormalizeText($input['timeStart'] ?? $input['time_start'] ?? '');
        $timeEnd = portalNormalizeText($input['timeEnd'] ?? $input['time_end'] ?? '');
        $startRaw = portalNormalizeText($input['overrideStart'] ?? $input['override_start'] ?? '');
        $endRaw = portalNormalizeText($input['overrideEnd'] ?? $input['override_end'] ?? '');

        if ($reason === '') {
            throw new InvalidArgumentException('A reason is required for the override request.');
        }

        $start = null;
        $end = null;

        if ($scheduleDate !== '' && $timeStart !== '' && $timeEnd !== '') {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $scheduleDate)) {
                throw new InvalidArgumentException('Provide a valid schedule date.');
            }

            if (!preg_match('/^\d{2}:\d{2}$/', $timeStart) || !preg_match('/^\d{2}:\d{2}$/', $timeEnd)) {
                throw new InvalidArgumentException('Provide valid start and end times.');
            }

            if ($timeEnd <= $timeStart) {
                throw new InvalidArgumentException('Time end must be after time start.');
            }

            $start = DateTimeImmutable::createFromFormat('Y-m-d H:i', $scheduleDate . ' ' . $timeStart);
            $end = DateTimeImmutable::createFromFormat('Y-m-d H:i', $scheduleDate . ' ' . $timeEnd);
        } else {
            $start = DateTimeImmutable::createFromFormat('Y-m-d\TH:i', $startRaw)
                ?: DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $startRaw);
            $end = DateTimeImmutable::createFromFormat('Y-m-d\TH:i', $endRaw)
                ?: DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $endRaw);
        }

        if (!$start || !$end) {
            throw new InvalidArgumentException('Provide a valid single schedule date and time range.');
        }

        if ($end <= $start) {
            throw new InvalidArgumentException('Override end must be after the start time.');
        }

        // Override requests are single-day windows only.
        if ($start->format('Y-m-d') !== $end->format('Y-m-d')) {
            throw new InvalidArgumentException('Override requests support a single schedule day only.');
        }

        $insert = $pdo->prepare(
            'INSERT INTO access_overrides (user_id, reason, override_start, override_end)
             VALUES (:user_id, :reason, :override_start, :override_end)'
        );
        $insert->execute([
            'user_id' => $userId,
            'reason' => $reason,
            'override_start' => $start->format('Y-m-d H:i:s'),
            'override_end' => $end->format('Y-m-d H:i:s'),
        ]);

        $overrideId = (int) $pdo->lastInsertId();
        (new ActivityLogService($pdo))->record(
            $userId,
            'Add',
            'Submitted override request #' . $overrideId . ' for ' . $start->format('M j, Y') . '.',
            'Success',
            $userId,
            'access_override',
            (string) $overrideId
        );

        echo json_encode([
            'message' => 'Override request submitted and is pending review.',
            'overrideId' => $overrideId,
            'overrides' => portalOverrides($pdo, $userId),
        ]);
        exit;
    }

    if ($action === 'update_override') {
        $overrideId = filter_var($input['overrideId'] ?? $input['override_id'] ?? null, FILTER_VALIDATE_INT);
        $reason = portalNormalizeText($input['reason'] ?? '');
        $scheduleDate = portalNormalizeText($input['scheduleDate'] ?? $input['schedule_date'] ?? '');
        $timeStart = portalNormalizeText($input['timeStart'] ?? $input['time_start'] ?? '');
        $timeEnd = portalNormalizeText($input['timeEnd'] ?? $input['time_end'] ?? '');

        if (!$overrideId) {
            throw new InvalidArgumentException('A valid override id is required.');
        }

        if ($reason === '') {
            throw new InvalidArgumentException('A reason is required for the override request.');
        }

        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $scheduleDate)) {
            throw new InvalidArgumentException('Provide a valid schedule date.');
        }

        if (!preg_match('/^\d{2}:\d{2}$/', $timeStart) || !preg_match('/^\d{2}:\d{2}$/', $timeEnd)) {
            throw new InvalidArgumentException('Provide valid start and end times.');
        }

        if ($timeEnd <= $timeStart) {
            throw new InvalidArgumentException('Time end must be after time start.');
        }

        $start = DateTimeImmutable::createFromFormat('Y-m-d H:i', $scheduleDate . ' ' . $timeStart);
        $end = DateTimeImmutable::createFromFormat('Y-m-d H:i', $scheduleDate . ' ' . $timeEnd);

        if (!$start || !$end) {
            throw new InvalidArgumentException('Provide a valid single schedule date and time range.');
        }

        $existing = $pdo->prepare(
            'SELECT override_id, approved_by
             FROM access_overrides
             WHERE override_id = :override_id AND user_id = :user_id
             LIMIT 1'
        );
        $existing->execute([
            'override_id' => $overrideId,
            'user_id' => $userId,
        ]);
        $row = $existing->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            throw new InvalidArgumentException('Override request not found.');
        }

        if ($row['approved_by'] !== null) {
            throw new InvalidArgumentException('Only pending override requests can be edited.');
        }

        $update = $pdo->prepare(
            'UPDATE access_overrides
             SET reason = :reason,
                 override_start = :override_start,
                 override_end = :override_end
             WHERE override_id = :override_id AND user_id = :user_id'
        );
        $update->execute([
            'reason' => $reason,
            'override_start' => $start->format('Y-m-d H:i:s'),
            'override_end' => $end->format('Y-m-d H:i:s'),
            'override_id' => $overrideId,
            'user_id' => $userId,
        ]);

        (new ActivityLogService($pdo))->record(
            $userId,
            'Edit',
            'Updated override request #' . $overrideId . '.',
            'Success',
            $userId,
            'access_override',
            (string) $overrideId
        );

        echo json_encode([
            'message' => 'Override request updated.',
            'overrides' => portalOverrides($pdo, $userId),
        ]);
        exit;
    }

    if ($action === 'cancel_override') {
        $overrideId = filter_var($input['overrideId'] ?? $input['override_id'] ?? null, FILTER_VALIDATE_INT);

        if (!$overrideId) {
            throw new InvalidArgumentException('A valid override id is required.');
        }

        $existing = $pdo->prepare(
            'SELECT override_id, approved_by, override_start, override_end
             FROM access_overrides
             WHERE override_id = :override_id AND user_id = :user_id
             LIMIT 1'
        );
        $existing->execute([
            'override_id' => $overrideId,
            'user_id' => $userId,
        ]);
        $row = $existing->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            throw new InvalidArgumentException('Override request not found.');
        }

        $now = new DateTimeImmutable('now');
        $end = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', (string) $row['override_end']);

        if ($row['approved_by'] !== null && $end && $now > $end) {
            throw new InvalidArgumentException('Completed override requests cannot be cancelled.');
        }

        $delete = $pdo->prepare(
            'DELETE FROM access_overrides
             WHERE override_id = :override_id AND user_id = :user_id'
        );
        $delete->execute([
            'override_id' => $overrideId,
            'user_id' => $userId,
        ]);

        (new ActivityLogService($pdo))->record(
            $userId,
            'Delete',
            'Cancelled override request #' . $overrideId . '.',
            'Success',
            $userId,
            'access_override',
            (string) $overrideId
        );

        echo json_encode([
            'message' => 'Override request cancelled.',
            'overrides' => portalOverrides($pdo, $userId),
        ]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['message' => 'Unknown action.']);
} catch (InvalidArgumentException $error) {
    http_response_code(422);
    echo json_encode(['message' => $error->getMessage()]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'message' => 'Unable to process the user portal request.',
        'error' => $error->getMessage(),
    ]);
}
