<?php

require_once dirname(__DIR__) . '/services/CombinedDoorAccessService.php';

function expectFingerRole(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = entrivo_pdo();
$tables = ['direct_fingerprint_import_jobs', 'fingerprint_devices', 'users', 'fingerprints', 'fingerprint_enrollment_jobs', 'schedules', 'access_overrides', 'access_log', 'fingerprint_sensor_slots'];
$template = str_repeat("\x44\x45", 256);
$hash = hash('sha256', $template);
try {
    // Connection-local shadow tables: real accounts, fingerprints, schedules and logs are never touched.
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_sensor_slots (device_id INT NOT NULL, slot INT NOT NULL, state VARCHAR(20) NOT NULL DEFAULT 'free',
        fingerprint_id INT NULL, job_id INT NULL, updated_at DATETIME NULL, PRIMARY KEY (device_id, slot)) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY,device_type VARCHAR(20),status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE users (id INT PRIMARY KEY,username VARCHAR(50),role VARCHAR(20),is_active INT,approval_status VARCHAR(20),must_change_password INT,onboarding_step VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE fingerprints (fingerprint_id INT PRIMARY KEY,user_id INT,finger_name VARCHAR(50),enrollment_device_id INT,enrollment_slot INT,template_data LONGBLOB,template_hash VARCHAR(64),status VARCHAR(20),enrolled_at DATETIME) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_enrollment_jobs (job_id INT PRIMARY KEY,user_id INT,fingerprint_id INT,finger_name VARCHAR(50),enrollment_device_id INT,assigned_slot INT,status VARCHAR(20),progress INT,finished_at DATETIME NULL) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE direct_fingerprint_import_jobs (id INT PRIMARY KEY,user_id INT,enrollment_device_id INT,target_slot INT,status VARCHAR(20),queued_at DATETIME,processing_at DATETIME NULL) ENGINE=InnoDB');
    $pdo->exec("CREATE TEMPORARY TABLE schedules (
        schedule_id INT PRIMARY KEY, user_id INT, schedule_type VARCHAR(20), schedule_kind VARCHAR(20),
        schedule_date DATE NULL, time_start TIME, time_end TIME, start_date DATE NULL, end_date DATE NULL,
        repeat_type VARCHAR(30), repeat_day VARCHAR(15) NULL, repeat_days TEXT NULL,
        grace_period_minutes INT DEFAULT 15, status VARCHAR(20), overridden_by_schedule_id INT NULL
    ) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE access_overrides (override_id INT PRIMARY KEY, user_id INT, approved_by INT NULL, override_start DATETIME, override_end DATETIME) ENGINE=InnoDB');
    $pdo->exec("CREATE TEMPORARY TABLE access_log (
        log_id INT PRIMARY KEY AUTO_INCREMENT,user_id INT NULL,card_id INT NULL,rfid_uid VARCHAR(10) NULL,fingerprint_id INT NULL,
        schedule_id INT NULL,override_id INT NULL,access_timestamp DATETIME,
        access_status ENUM('granted','denied'),
        denial_reason ENUM('not_registered','invalid_rfid','invalid_fingerprint','no_schedule','expired_schedule','schedule_not_started','unauthorized','offline') NULL,
        method_access ENUM('RFID','Fingerprint','Override'),access_type ENUM('IN','OUT') NOT NULL DEFAULT 'IN'
    ) ENGINE=InnoDB");

    $pdo->exec("INSERT INTO fingerprint_devices VALUES (1,'enrollment','active')");
    // User id = sensor slot = fingerprint id. Every user has a REGULAR 08:00-10:00 schedule.
    $roles = ['student' => 1, 'faculty' => 2, 'staff' => 3, 'admin' => 4, 'super_admin' => 5];
    foreach ($roles as $role => $id) {
        $pdo->prepare("INSERT INTO users VALUES (?,?,?,1,'approved',0,'done')")->execute([$id, "user$id", $role]);
        $pdo->prepare("INSERT INTO fingerprints VALUES (?,?,'Right Thumb',1,?,?,?,'active','2026-11-09 07:00:00')")->execute([$id, $id, $id, $template, $hash]);
        $pdo->prepare("INSERT INTO fingerprint_enrollment_jobs VALUES (?,?,?,'Right Thumb',1,?,'completed',100,'2026-11-09 07:00:00')")->execute([$id, $id, $id, $id]);
        $pdo->prepare("INSERT INTO schedules (schedule_id,user_id,schedule_type,schedule_kind,schedule_date,time_start,time_end,repeat_type,status)
            VALUES (?,?,'single','regular','2026-11-09','08:00:00','10:00:00','none','approved')")->execute([$id, $id]);
    }

    $service = new CombinedDoorAccessService($pdo);
    $at = static fn (string $time) => new DateTimeImmutable("2026-11-09 $time", new DateTimeZone('Asia/Manila'));
    $finger = static fn (int $id, string $direction, array $extra = []) => ['method' => 'fingerprint', 'enrollment_device_id' => 1,
        'matched_slot' => $id, 'template_hash' => $hash, 'direction' => $direction, ...$extra];
    $verify = static function (array $input, string $time) use ($pdo, $service, $at): array {
        $pdo->exec('SET timestamp=' . $at($time)->getTimestamp());
        $decision = $service->verify($input, $at($time));
        expectFingerRole(!$pdo->inTransaction(), 'Fingerprint verification must release its transaction.');
        return $decision;
    };
    $lastLog = static fn () => $pdo->query('SELECT * FROM access_log ORDER BY log_id DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);

    // Faculty / staff: regular schedule only; nothing outside it.
    foreach (['faculty', 'staff'] as $role) {
        $id = $roles[$role];
        $in = $verify($finger($id, 'entry'), '09:00:00');
        expectFingerRole($in['access_granted'] && $in['schedule_kind'] === 'regular', "A $role fingerprint must open the door on the regular schedule. Got " . json_encode($in));
        // The 15-minute reminder is planned from the schedule end (10:00), not the RTC.
        expectFingerRole($in['seconds_remaining'] === 3600 && $in['schedule_end_epoch'] === $at('10:00:00')->getTimestamp()
            && $in['server_time_epoch'] === $at('09:00:00')->getTimestamp(), "An entry carries the schedule end and server time. Got " . json_encode($in));
        expectFingerRole($verify($finger($id, 'exit'), '09:05:00')['access_granted'], "The $role who unlocked can lock with a fingerprint.");
        $late = $verify($finger($id, 'entry'), '12:00:00');
        expectFingerRole(!$late['access_granted'] && $late['reason'] === 'expired_schedule', "A $role without a valid schedule must be refused. Got " . json_encode($late));
    }

    // Admin / super admin: permanent override at any time, no schedule.
    foreach (['admin', 'super_admin'] as $role) {
        $id = $roles[$role];
        $any = $verify($finger($id, 'entry'), '21:00:00');
        expectFingerRole($any['access_granted'] && $any['schedule_kind'] === 'permanent_override' && empty($any['exit_only']),
            "A $role fingerprint must open the door without a schedule. Got " . json_encode($any));
        expectFingerRole(($any['schedule_end_epoch'] ?? null) === null, 'A permanent override has no schedule end, so no reminder.');
        expectFingerRole($lastLog()['access_status'] === 'granted' && $lastLog()['access_type'] === 'IN', "The $role entry must be logged IN.");
        $exit = $verify($finger($id, 'exit', ['unlocked_by_user_id' => $id]), '21:10:00');
        expectFingerRole($exit['access_granted'], "The $role who unlocked can lock with a fingerprint. Got " . json_encode($exit));
    }

    // Students: fingerprint identifies them, but only an approved override opens the room.
    $student = $roles['student'];
    $refused = $verify($finger($student, 'entry'), '09:00:00');
    expectFingerRole(!$refused['access_granted'] && $refused['reason'] === 'no_schedule',
        'A student fingerprint must not open the door on a regular schedule. Got ' . json_encode($refused));
    $pdo->exec("INSERT INTO schedules (schedule_id,user_id,schedule_type,schedule_kind,schedule_date,time_start,time_end,repeat_type,status)
        VALUES (50,$student,'single','override','2026-11-09','13:00:00','14:00:00','none','approved')");
    $pdo->exec("INSERT INTO access_overrides VALUES (50,$student,99,'2026-11-09 13:00:00','2026-11-09 14:00:00')");
    $override = $verify($finger($student, 'entry'), '13:15:00');
    expectFingerRole($override['access_granted'] && $override['schedule_kind'] === 'override', 'A student with an approved override may enter. Got ' . json_encode($override));

    // Locking (touch, then fingerprint) must be the person who unlocked.
    $faculty = $roles['faculty'];
    $wrong = $verify($finger($roles['staff'], 'exit', ['unlocked_by_user_id' => $faculty]), '09:30:00');
    expectFingerRole(!$wrong['access_granted'] && $wrong['reason'] === 'wrong_user',
        'Another registered finger must not lock a door someone else unlocked. Got ' . json_encode($wrong));
    $log = $lastLog();
    expectFingerRole($log['access_status'] === 'denied' && $log['access_type'] === 'OUT' && (int) $log['user_id'] === $roles['staff'],
        'The refused lock attempt must be logged as a denied OUT.');
    $admin = $verify($finger($roles['admin'], 'exit', ['unlocked_by_user_id' => $faculty]), '09:31:00');
    expectFingerRole(!$admin['access_granted'] && $admin['reason'] === 'wrong_user', 'An admin finger must not lock a door a faculty member unlocked.');
    expectFingerRole($verify($finger($faculty, 'exit', ['unlocked_by_user_id' => $faculty]), '09:32:00')['access_granted'], 'The same user locks the door.');
    // Entry ignores the field.
    expectFingerRole($verify($finger($faculty, 'entry', ['unlocked_by_user_id' => 999]), '09:33:00')['access_granted'], 'unlocked_by_user_id must not affect entry.');

    // Inactive accounts never get in, admins included.
    foreach ($roles as $role => $id) {
        $pdo->prepare('UPDATE users SET is_active=0 WHERE id=?')->execute([$id]);
        $inactive = $verify($finger($id, 'entry'), '13:30:00');
        expectFingerRole(!$inactive['access_granted'] && $inactive['reason'] === 'account_inactive', "An inactive $role must be refused. Got " . json_encode($inactive));
        $pdo->prepare('UPDATE users SET is_active=1 WHERE id=?')->execute([$id]);
    }

    echo "PASS: fingerprint entry by role (faculty/staff: valid schedule; admin/super admin: permanent override; students: approved override only), inactive accounts refused, and touch-then-fingerprint locking only by the user who unlocked.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    $pdo->exec('SET timestamp=0');
    foreach ($tables as $table) $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
}
