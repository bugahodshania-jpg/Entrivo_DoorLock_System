<?php

require_once dirname(__DIR__) . '/services/CombinedDoorAccessService.php';
require_once dirname(__DIR__) . '/services/DoorAccessCacheService.php';
require_once dirname(__DIR__) . '/services/RfidCardSlots.php';

function expectBackup(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function expectBackupRefused(callable $action, string $needle, string $message): void
{
    try {
        $action();
    } catch (InvalidArgumentException $error) {
        expectBackup(stripos($error->getMessage(), $needle) !== false, "$message Got: " . $error->getMessage());
        return;
    }
    throw new RuntimeException("$message Nothing was refused.");
}

$pdo = entrivo_pdo();
putenv('DOOR_EMERGENCY_RFID_UIDS');
// Connection-local shadow tables: real accounts, cards and logs are never touched.
$pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY,device_type VARCHAR(20),status VARCHAR(20)) ENGINE=InnoDB');
$pdo->exec('CREATE TEMPORARY TABLE users (id INT PRIMARY KEY,username VARCHAR(50),role VARCHAR(20),is_active INT,approval_status VARCHAR(20),must_change_password INT,onboarding_step VARCHAR(20)) ENGINE=InnoDB');
// The old layout: one card per user.
$pdo->exec("CREATE TEMPORARY TABLE rfid_cards (
    card_id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, rfid_uid VARCHAR(30) NOT NULL,
    status ENUM('active','inactive','lost') DEFAULT 'active', issued_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY user_id (user_id), UNIQUE KEY rfid_uid (rfid_uid)
) ENGINE=InnoDB");
$pdo->exec('CREATE TEMPORARY TABLE rfid_scan_log (scan_id INT AUTO_INCREMENT PRIMARY KEY,rfid_uid VARCHAR(30) NOT NULL,scanned_at DATETIME NOT NULL,device_label VARCHAR(64) NULL) ENGINE=InnoDB');
$pdo->exec('CREATE TEMPORARY TABLE fingerprints (fingerprint_id INT PRIMARY KEY,user_id INT,finger_name VARCHAR(50),enrollment_device_id INT,enrollment_slot INT,status VARCHAR(20)) ENGINE=InnoDB');
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
$pdo->exec('CREATE TEMPORARY TABLE door_emergency_cards (rfid_uid VARCHAR(10) NOT NULL PRIMARY KEY, card_name VARCHAR(60) NOT NULL, device_id INT NULL, reported_at DATETIME NOT NULL) ENGINE=InnoDB');

$pdo->exec("INSERT INTO fingerprint_devices VALUES (1,'enrollment','active')");
$roles = ['student' => 1, 'faculty' => 2, 'staff' => 3, 'admin' => 4, 'super_admin' => 5];
foreach ($roles as $role => $id) {
    $pdo->prepare("INSERT INTO users VALUES (?,?,?,1,'approved',0,'done')")->execute([$id, "user$id", $role]);
    $pdo->prepare("INSERT INTO rfid_cards (user_id, rfid_uid) VALUES (?,?)")->execute([$id, sprintf('AA000000%02d', $id)]);
}
$pdo->exec("INSERT INTO schedules (schedule_id,user_id,schedule_type,schedule_kind,schedule_date,time_start,time_end,repeat_type,status)
    VALUES (2,2,'single','regular','2026-11-09','08:00:00','10:00:00','none','approved')");

// The migration: a card_slot column, and one card per slot instead of per user.
RfidCardSlots::ensureSchema($pdo);
RfidCardSlots::ensureSchema($pdo); // Running it again changes nothing.
expectBackup(RfidCardSlots::hasSlotColumn($pdo), 'The card_slot column must be added.');
$keys = array_unique(array_column($pdo->query('SHOW INDEX FROM rfid_cards')->fetchAll(PDO::FETCH_ASSOC), 'Key_name'));
expectBackup(in_array('uq_rfid_cards_user_slot', $keys, true) && !in_array('user_id', $keys, true) && in_array('rfid_uid', $keys, true),
    'Keys after the migration: ' . json_encode(array_values($keys)));
expectBackup((int) $pdo->query("SELECT COUNT(*) FROM rfid_cards WHERE card_slot='primary'")->fetchColumn() === 5, 'Existing cards become primary cards.');

$faculty = $roles['faculty'];
$admin = $roles['admin'];
$scan = static fn (string $uid) => $pdo->prepare("INSERT INTO rfid_scan_log (rfid_uid, scanned_at) VALUES (?, '2026-11-09 07:00:00')")->execute([$uid]);

// Who may hold a backup card, and which UIDs are accepted.
expectBackup(!RfidCardSlots::canHoldBackup('student') && RfidCardSlots::canHoldBackup('faculty') && RfidCardSlots::canHoldBackup('staff')
    && RfidCardSlots::canHoldBackup('admin') && RfidCardSlots::canHoldBackup('super_admin'), 'Backup cards are for faculty, staff, admins and super admins.');
$scan('BB00000001');
expectBackupRefused(fn () => RfidCardSlots::validateBackup($pdo, 1, 'student', 'BB00000001', 'active', 'AA00000001'), 'only faculty', 'A student must not get a backup card.');
expectBackupRefused(fn () => RfidCardSlots::validateBackup($pdo, $faculty, 'faculty', 'BB0001', 'active', 'AA00000002'), '10-character', 'A UID the door cannot read must be refused.');
expectBackupRefused(fn () => RfidCardSlots::validateBackup($pdo, $faculty, 'faculty', 'AA00000002', 'active', 'AA00000002'), 'different', 'The backup must differ from the primary card.');
expectBackupRefused(fn () => RfidCardSlots::validateBackup($pdo, $faculty, 'faculty', 'AA00000003', 'active', 'AA00000002'), 'another user', "Another user's card must be refused.");
expectBackupRefused(fn () => RfidCardSlots::validateBackup($pdo, $faculty, 'faculty', 'BB00000009', 'active', 'AA00000002'), 'not scanned', 'A UID never tapped on a scanner must be refused.');
expectBackupRefused(fn () => RfidCardSlots::validateBackup($pdo, $faculty, 'faculty', 'BB00000001', 'broken', 'AA00000002'), 'status', 'Unknown statuses must be refused.');
expectBackup(RfidCardSlots::validateBackup($pdo, 1, 'student', '', 'unassigned', 'AA00000001') === ['uid' => null, 'status' => 'active'], 'An empty backup means no backup card, for any role.');

// Saving a backup card keeps the primary card.
$valid = RfidCardSlots::validateBackup($pdo, $faculty, 'faculty', ' bb00000001 ', 'active', 'AA00000002');
expectBackup($valid === ['uid' => 'BB00000001', 'status' => 'active'], 'The UID is normalized. Got ' . json_encode($valid));
RfidCardSlots::saveBackup($pdo, $faculty, $valid['uid'], $valid['status']);
expectBackup((RfidCardSlots::card($pdo, $faculty, RfidCardSlots::PRIMARY)['rfid_uid'] ?? '') === 'AA00000002'
    && (RfidCardSlots::card($pdo, $faculty, RfidCardSlots::BACKUP)['rfid_uid'] ?? '') === 'BB00000001', 'A faculty member holds both cards.');
// Saving the same backup again needs no new scan (the card already belongs to them).
$pdo->exec("DELETE FROM rfid_scan_log WHERE rfid_uid='BB00000001'");
expectBackup(RfidCardSlots::validateBackup($pdo, $faculty, 'faculty', 'BB00000001', 'active', 'AA00000002')['uid'] === 'BB00000001', 'Re-saving an owned backup card is allowed.');
expectBackupRefused(fn () => RfidCardSlots::validateBackup($pdo, $admin, 'admin', 'BB00000001', 'active', 'AA00000004'), 'another user', 'A backup card belongs to one person.');

// The door: both cards open it for the same person, under the same schedule.
$service = new CombinedDoorAccessService($pdo);
$at = static fn (string $time) => new DateTimeImmutable("2026-11-09 $time", new DateTimeZone('Asia/Manila'));
$tap = static fn (string $uid, string $direction = 'entry') => ['method' => 'rfid', 'enrollment_device_id' => 1, 'rfid_uid' => $uid, 'direction' => $direction];
$primaryEntry = $service->verify($tap('AA00000002'), $at('08:30:00'));
$backupEntry = $service->verify($tap('BB00000001'), $at('08:35:00'));
expectBackup($primaryEntry['access_granted'] === true && $backupEntry['access_granted'] === true, 'Both faculty cards must open the door during the schedule. Got ' . json_encode($backupEntry));
$log = $pdo->query('SELECT * FROM access_log ORDER BY log_id DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);
expectBackup((int) $log['user_id'] === $faculty && $log['rfid_uid'] === 'BB00000001', 'The backup entry is logged under the same person, with the backup UID.');
$late = $service->verify($tap('BB00000001'), $at('11:00:00'));
expectBackup($late['access_granted'] === false && $late['reason'] === 'expired_schedule', 'The backup card follows the same schedule. Got ' . json_encode($late));

$scan('BB00000004');
$adminBackup = RfidCardSlots::validateBackup($pdo, $admin, 'admin', 'BB00000004', 'active', 'AA00000004');
RfidCardSlots::saveBackup($pdo, $admin, $adminBackup['uid'], $adminBackup['status']);
$anytime = $service->verify($tap('BB00000004'), $at('22:00:00'));
expectBackup($anytime['access_granted'] === true && $anytime['schedule_kind'] === 'permanent_override', 'An admin backup card is a permanent override too. Got ' . json_encode($anytime));

// The offline copy for the door holds both cards for one person.
$cache = new DoorAccessCacheService($pdo, static fn () => null);
$collect = (new ReflectionMethod($cache, 'collectCredentials'));
$collect->setAccessible(true);
[$people, $credentials] = $collect->invoke($cache, 1);
$facultyCards = array_values(array_map(static fn ($c) => $c['uid'], array_filter($credentials, static fn ($c) => $c['user_id'] === $faculty)));
sort($facultyCards);
expectBackup($facultyCards === ['AA00000002', 'BB00000001'] && isset($people[$faculty]), 'Offline copy cards for faculty: ' . json_encode($facultyCards));

// A lost backup card stops working; the primary card keeps working.
RfidCardSlots::saveBackup($pdo, $faculty, 'BB00000001', 'lost');
$lost = $service->verify($tap('BB00000001'), $at('09:00:00'));
expectBackup($lost['access_granted'] === false, 'A lost backup card must be refused. Got ' . json_encode($lost));
expectBackup($service->verify($tap('AA00000002'), $at('09:05:00'))['access_granted'] === true, 'The primary card still works after the backup is lost.');
[, $credentials] = $collect->invoke($cache, 1);
expectBackup(!in_array('BB00000001', array_column($credentials, 'uid'), true), 'A lost backup card leaves the offline copy.');
expectBackup($service->verify($tap('BB00000001', 'exit'), $at('09:10:00'))['access_granted'] === true, 'Any card may still exit.');

// Removing the backup card deletes only that card.
RfidCardSlots::saveBackup($pdo, $faculty, null, 'active');
expectBackup(RfidCardSlots::card($pdo, $faculty, RfidCardSlots::BACKUP) === null && RfidCardSlots::card($pdo, $faculty, RfidCardSlots::PRIMARY) !== null, 'Removing the backup keeps the primary card.');

// A swap: the old backup becomes the primary card and the old primary the backup.
RfidCardSlots::saveBackup($pdo, $admin, 'BB00000004', 'active');
$pdo->beginTransaction();
RfidCardSlots::releaseBackupUid($pdo, $admin, 'BB00000004');
$pdo->prepare("UPDATE rfid_cards SET rfid_uid='BB00000004' WHERE user_id=? AND card_slot='primary'")->execute([$admin]);
RfidCardSlots::saveBackup($pdo, $admin, 'AA00000004', 'active');
$pdo->commit();
expectBackup(RfidCardSlots::card($pdo, $admin, RfidCardSlots::PRIMARY)['rfid_uid'] === 'BB00000004'
    && RfidCardSlots::card($pdo, $admin, RfidCardSlots::BACKUP)['rfid_uid'] === 'AA00000004', 'Primary and backup cards can be swapped.');

echo "PASS: backup RFID cards (migration from one card per user, faculty/staff/admin/super admin only, 10-character scanned UID, never shared or equal to the primary), both cards open the door for the same person and schedule online and offline, a lost backup is refused while the primary keeps working, removing and swapping cards.\n";
