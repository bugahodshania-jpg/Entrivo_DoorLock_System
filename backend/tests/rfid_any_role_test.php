<?php

require_once dirname(__DIR__) . '/services/CombinedDoorAccessService.php';

function expectAnyRole(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = entrivo_pdo();
// Connection-local shadow tables: real accounts, cards, schedules and logs are never touched.
$pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY,device_type VARCHAR(20),status VARCHAR(20)) ENGINE=InnoDB');
$pdo->exec('CREATE TEMPORARY TABLE users (id INT PRIMARY KEY,username VARCHAR(50),role VARCHAR(20),is_active INT,approval_status VARCHAR(20),must_change_password INT,onboarding_step VARCHAR(20)) ENGINE=InnoDB');
$pdo->exec('CREATE TEMPORARY TABLE rfid_cards (card_id INT PRIMARY KEY,user_id INT,rfid_uid VARCHAR(30),status VARCHAR(20)) ENGINE=InnoDB');
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
$roles = ['student' => 1, 'faculty' => 2, 'staff' => 3, 'admin' => 4, 'super_admin' => 5];
foreach ($roles as $role => $id) {
    $pdo->prepare("INSERT INTO users VALUES (?,?,?,1,'approved',0,'done')")->execute([$id, "user$id", $role]);
    $pdo->prepare("INSERT INTO rfid_cards VALUES (?,?,?,'active')")->execute([$id, $id, sprintf('AA000000%02d', $id)]);
    $pdo->prepare("INSERT INTO schedules (schedule_id,user_id,schedule_type,schedule_kind,schedule_date,time_start,time_end,repeat_type,status)
        VALUES (?,?,'single','regular','2026-11-09','08:00:00','10:00:00','none','approved')")->execute([$id, $id]);
}

$service = new CombinedDoorAccessService($pdo);
$inSchedule = new DateTimeImmutable('2026-11-09 09:00:00', new DateTimeZone('Asia/Manila'));
$afterSchedule = new DateTimeImmutable('2026-11-09 11:00:00', new DateTimeZone('Asia/Manila'));
$card = static fn (int $id, string $direction) => ['method' => 'rfid', 'enrollment_device_id' => 1,
    'rfid_uid' => sprintf('AA000000%02d', $id), 'direction' => $direction];

$at = static fn (string $time) => new DateTimeImmutable("2026-11-09 $time", new DateTimeZone('Asia/Manila'));
$student = $roles['student'];
$faculty = $roles['faculty'];
$lastLog = static fn () => $pdo->query('SELECT * FROM access_log ORDER BY log_id DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);

// A student never opens the room first, even during the student's own schedule.
$first = $service->verify($card($student, 'entry'), $at('08:30:00'));
expectAnyRole($first['access_granted'] === false && $first['reason'] === 'faculty_not_present',
    'A student card must not open the door before a faculty member is inside. Got ' . json_encode($first));
expectAnyRole($lastLog()['access_status'] === 'denied' && $lastLog()['denial_reason'] === 'unauthorized', 'The refused student entry must be logged.');
// Students can always exit.
expectAnyRole($service->verify($card($student, 'exit'), $at('08:31:00'))['access_granted'] === true, 'A student can always exit.');

// Faculty enters -> the student may enter, linked to the instructor's schedule.
$facultyEntry = $service->verify($card($faculty, 'entry'), $at('08:40:00'));
expectAnyRole($facultyEntry['access_granted'] === true, 'Faculty entry during schedule.');
expectAnyRole($facultyEntry['seconds_remaining'] === 80 * 60,
    'An entry grant reports the seconds left until the 10:00 schedule end (for the 15-minute reminder).');
$joined = $service->verify($card($student, 'entry'), $at('08:45:00'));
expectAnyRole($joined['access_granted'] === true && $joined['schedule_id'] === $faculty,
    'A student may enter while a faculty member is inside. Got ' . json_encode($joined));
expectAnyRole((int) $lastLog()['schedule_id'] === $faculty, 'The student entry is logged against the instructor\'s schedule.');
expectAnyRole($joined['seconds_remaining'] === 75 * 60, 'A student joining the class gets the instructor\'s remaining schedule time.');

// Faculty exits -> students are refused again.
expectAnyRole($service->verify($card($faculty, 'exit'), $at('08:50:00'))['access_granted'] === true, 'Faculty exit.');
expectAnyRole($service->verify($card($student, 'entry'), $at('08:55:00'))['reason'] === 'faculty_not_present',
    'After the faculty member leaves, a student card must be refused.');

// Faculty re-enters but never scans out: allowed until that schedule ends (10:00).
expectAnyRole($service->verify($card($faculty, 'entry'), $at('09:00:00'))['access_granted'] === true, 'Faculty re-entry.');
expectAnyRole($service->verify($card($student, 'entry'), $at('09:59:00'))['access_granted'] === true, 'Student entry before the instructor\'s schedule ends.');
expectAnyRole($service->verify($card($student, 'entry'), $at('10:00:00'))['reason'] === 'faculty_not_present',
    'Once the instructor\'s schedule ends, a forgotten exit must not keep letting students in.');

// Admin-approved temporary access (override) lets a student into a vacant room alone.
$pdo->exec("INSERT INTO schedules (schedule_id,user_id,schedule_type,schedule_kind,schedule_date,time_start,time_end,repeat_type,status)
    VALUES (50,$student,'single','override','2026-11-09','13:00:00','14:00:00','none','approved')");
$pdo->exec("INSERT INTO access_overrides VALUES (50,$student,99,'2026-11-09 13:00:00','2026-11-09 14:00:00')");
$alone = $service->verify($card($student, 'entry'), $at('13:30:00'));
expectAnyRole($alone['access_granted'] === true && $alone['schedule_kind'] === 'override',
    'An approved temporary access must let a student enter without a faculty member inside. Got ' . json_encode($alone));
expectAnyRole($service->verify($card($student, 'entry'), $at('14:30:00'))['reason'] === 'faculty_not_present',
    'Outside the temporary access window a student still needs a faculty member inside.');

$pdo->exec('DELETE FROM access_log');
foreach (array_diff_key($roles, ['student' => true]) as $role => $id) {
    $entry = $service->verify($card($id, 'entry'), $inSchedule);
    expectAnyRole($entry['access_granted'] === true, "A $role card must open the door during the user's approved schedule. Got " . json_encode($entry));
    $late = $service->verify($card($id, 'entry'), $afterSchedule);
    expectAnyRole($late['access_granted'] === false && $late['reason'] === 'expired_schedule',
        "A $role card must be refused entry after the schedule ends. Got " . json_encode($late));
    $exit = $service->verify($card($id, 'exit'), $afterSchedule);
    expectAnyRole($exit['access_granted'] === true, "A $role card must always be able to exit. Got " . json_encode($exit));
}

echo "PASS: RFID for every role (entry during the approved schedule, refused after it, exit always allowed); students enter only while a faculty/staff/admin is inside on a running schedule, except with approved temporary access; students can always exit.
";
