<?php

// The door's offline schedule copy: who is listed, which windows, the binary
// format the ESP32 reads, and a version that changes only with the answers.
// Optional: php door_access_cache_test.php <path> writes the sample copy as a
// C++ array, used by esp32/.../AccessCacheSelfTest.cpp.
require_once dirname(__DIR__) . '/services/DoorAccessCacheService.php';

function expectCache(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

/** Reads a copy back the way the controller does. */
function readCopy(string $bytes): array
{
    $h = unpack('a4magic/vformat/vheader/Vversion/Vgenerated/Vfrom/Vuntil/vpeople/vcredentials/vwindows/vzero/Vcrc/Vsize', $bytes);
    $payload = substr($bytes, 40);
    $people = [];
    for ($i = 0; $i < $h['people']; $i++) {
        $people[] = unpack('Vuser/Crole/Cflags/vfirst/vcount/vzero', substr($payload, $i * 12, 12));
    }
    $credentials = [];
    $base = $h['people'] * 12;
    for ($i = 0; $i < $h['credentials']; $i++) {
        $record = substr($payload, $base + $i * 12, 12);
        $c = unpack('Ctype/Cflags/vslot', $record);
        $c['uid'] = strtoupper(bin2hex(substr($record, 4, 5)));
        $c['person'] = unpack('v', substr($record, 10, 2))[1];
        $credentials[] = $c;
    }
    $windows = [];
    $base += $h['credentials'] * 12;
    for ($i = 0; $i < $h['windows']; $i++) {
        $windows[] = unpack('Vstart/Vend/Ckind', substr($payload, $base + $i * 12, 12));
    }
    return ['header' => $h, 'payload' => $payload, 'people' => $people, 'credentials' => $credentials, 'windows' => $windows];
}

$pdo = entrivo_pdo();
// Only the shadow emergency-card table below counts in this test.
putenv('DOOR_EMERGENCY_RFID_UIDS');
$tables = ['users', 'rfid_cards', 'fingerprints', 'schedules', 'access_overrides', 'door_emergency_cards'];
try {
    // Connection-local shadow tables: real accounts and schedules are never touched.
    $pdo->exec('CREATE TEMPORARY TABLE users (id INT PRIMARY KEY,username VARCHAR(50),role VARCHAR(20),is_active INT,approval_status VARCHAR(20),must_change_password INT,onboarding_step VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE rfid_cards (card_id INT PRIMARY KEY,user_id INT NULL,rfid_uid VARCHAR(30),status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE fingerprints (fingerprint_id INT PRIMARY KEY,user_id INT,finger_name VARCHAR(50),enrollment_device_id INT,enrollment_slot INT) ENGINE=InnoDB');
    $pdo->exec("CREATE TEMPORARY TABLE schedules (
        schedule_id INT PRIMARY KEY, user_id INT, schedule_type VARCHAR(20), schedule_kind VARCHAR(20),
        schedule_date DATE NULL, time_start TIME, time_end TIME, start_date DATE NULL, end_date DATE NULL,
        repeat_type VARCHAR(30), repeat_day VARCHAR(15) NULL, repeat_days TEXT NULL,
        grace_period_minutes INT DEFAULT 15, status VARCHAR(20), overridden_by_schedule_id INT NULL
    ) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE access_overrides (override_id INT PRIMARY KEY, user_id INT, approved_by INT NULL, override_start DATETIME, override_end DATETIME) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE door_emergency_cards (rfid_uid VARCHAR(10) NOT NULL PRIMARY KEY, card_name VARCHAR(60) NOT NULL, device_id INT NULL, reported_at DATETIME NOT NULL) ENGINE=InnoDB');

    $pdo->exec("INSERT INTO users VALUES
        (1,'student.one','student',1,'approved',0,'done'),
        (2,'faculty.two','faculty',1,'approved',0,'done'),
        (3,'admin.three','admin',1,'approved',0,'done'),
        (4,'faculty.off','faculty',0,'approved',0,'done'),
        (5,'staff.new','staff',1,'approved',1,'password')");
    $pdo->exec("INSERT INTO rfid_cards VALUES
        (1,1,'AA00000001','active'),(2,2,'bb00000002','active'),(3,3,'CC00000003','active'),
        (4,4,'DD00000004','active'),(5,2,'EE00000005','lost'),(6,1,'FF00000006','active'),(7,2,'FF00000006','active'),
        (8,NULL,'9900000099','active'),(9,5,'AB00000009','active'),(10,NULL,'1200000012','active')");
    $pdo->exec("INSERT INTO door_emergency_cards VALUES ('9900000099','Spare key',1,NOW()),('7700000077','Guard card',1,NOW())");
    $pdo->exec("INSERT INTO fingerprints VALUES (7,2,'Right Thumb',1,7),(9,4,'Left Thumb',1,9),(11,1,'Right Index',2,3)");
    $pdo->exec("INSERT INTO schedules (schedule_id,user_id,schedule_type,schedule_kind,schedule_date,start_date,end_date,time_start,time_end,repeat_type,repeat_days,status) VALUES
        (20,2,'single','regular','2026-11-12',NULL,NULL,'08:00:00','10:00:00','none',NULL,'approved'),
        (21,2,'recurring','regular',NULL,'2026-11-01','2026-11-30','13:00:00','15:00:00','weekly_selected','[\"Monday\",\"Wednesday\",\"Friday\"]','approved'),
        (22,2,'single','regular','2026-11-12',NULL,NULL,'16:00:00','17:00:00','none',NULL,'pending'),
        (23,1,'single','regular','2026-11-12',NULL,NULL,'09:00:00','10:00:00','none',NULL,'approved'),
        (24,1,'single','override','2026-11-14',NULL,NULL,'10:00:00','12:00:00','none',NULL,'approved'),
        (25,1,'single','override','2026-11-15',NULL,NULL,'10:00:00','11:00:00','none',NULL,'approved'),
        (26,2,'single','regular','2026-11-25',NULL,NULL,'08:00:00','09:00:00','none',NULL,'approved'),
        (27,3,'single','regular','2026-11-12',NULL,NULL,'08:00:00','09:00:00','none',NULL,'approved')");
    $pdo->exec("INSERT INTO access_overrides VALUES (1,1,3,'2026-11-14 10:00:00','2026-11-14 12:00:00')");

    // Fingerprint slot checks are covered by the live entry tests; here slot 7
    // is a usable enrollment of the faculty member and slot 9 is not.
    $slotOwner = static fn (int $deviceId, int $slot): ?array => $deviceId === 1 && $slot === 7 ? ['user_id' => 2, 'role' => 'faculty'] : null;
    $service = new DoorAccessCacheService($pdo, $slotOwner);
    $zone = new DateTimeZone('Asia/Manila');
    $now = new DateTimeImmutable('2026-11-12 07:00:00', $zone); // a Thursday
    $copy = $service->build(1, $now);
    $read = readCopy($copy['bytes']);
    $h = $read['header'];

    expectCache($h['magic'] === 'ENAC' && $h['format'] === 1 && $h['header'] === 40, 'Header magic, format and size.');
    expectCache(strlen($copy['bytes']) === 40 + $h['size'] && $h['crc'] === crc32($read['payload']), 'Payload size and CRC-32 must match.');
    expectCache($h['from'] === (new DateTimeImmutable('2026-11-12 00:00:00', $zone))->getTimestamp()
        && $h['until'] === (new DateTimeImmutable('2026-11-20 00:00:00', $zone))->getTimestamp(), 'The copy covers today and the next 7 days.');
    expectCache($h['version'] === $copy['version'] && $h['generated'] === $now->getTimestamp(), 'Version and build time in the header.');

    // People: the unlinked emergency cards (user 0), the student, the faculty member and the admin.
    expectCache(array_column($read['people'], 'user') === [0, 1, 2, 3], 'People listed: ' . json_encode(array_column($read['people'], 'user')));
    [$nobody, $student, $faculty, $admin] = $read['people'];
    expectCache($nobody['flags'] === 1 && $nobody['count'] === 0 && $admin['role'] === 4 && $admin['flags'] === 1 && $admin['count'] === 0,
        'Emergency cards and admins enter at any time, without windows.');
    expectCache($student['role'] === 1 && $student['flags'] === 0 && $faculty['role'] === 2 && $faculty['flags'] === 0, 'Student and faculty roles.');

    // Windows: the student's approved override only; the faculty member's
    // approved regular schedules inside the 8 days (not the pending one, not 11-25).
    $at = static fn (string $text) => (new DateTimeImmutable($text, $zone))->getTimestamp();
    $windowsOf = static fn (array $person) => array_map(
        static fn ($w) => [$w['start'], $w['end'], $w['kind']],
        array_slice($read['windows'], $person['first'], $person['count'])
    );
    expectCache($windowsOf($student) === [[$at('2026-11-14 10:00'), $at('2026-11-14 12:00'), 2]],
        'A student gets only the approved override (not the regular schedule, not the unapproved override). Got ' . json_encode($windowsOf($student)));
    expectCache($windowsOf($faculty) === [
        [$at('2026-11-12 08:00'), $at('2026-11-12 10:00'), 1],
        [$at('2026-11-13 13:00'), $at('2026-11-13 15:00'), 1],
        [$at('2026-11-16 13:00'), $at('2026-11-16 15:00'), 1],
        [$at('2026-11-18 13:00'), $at('2026-11-18 15:00'), 1],
    ], 'Faculty windows (single date, then Mon/Wed/Fri). Got ' . json_encode($windowsOf($faculty)));
    expectCache($h['windows'] === 5, 'Five windows in all.');

    // Credentials: finger slot 7, then the usable cards in UID order. Not listed:
    // an inactive account, a lost card, a UID registered twice, an unfinished
    // account, an unlinked card that is not an emergency card, slot 9, device 2.
    $listed = array_map(static fn ($c) => [$c['type'], $c['flags'], $c['slot'], $c['uid'], $read['people'][$c['person']]['user']], $read['credentials']);
    expectCache($listed === [
        [1, 0, 7, '0000000000', 2],
        [2, 1, 0, '7700000077', 0],
        [2, 1, 0, '9900000099', 0],
        [2, 0, 0, 'AA00000001', 1],
        [2, 0, 0, 'BB00000002', 2],
        [2, 0, 0, 'CC00000003', 3],
    ], 'Credentials listed: ' . json_encode($listed));

    // The version ignores the build time, and changes when an answer would change.
    $later = $service->build(1, $now->modify('+3 hours'));
    expectCache($later['version'] === $copy['version'], 'Rebuilding later the same day keeps the version.');
    $pdo->exec("UPDATE schedules SET time_end = '10:30:00' WHERE schedule_id = 20");
    $edited = $service->build(1, $now);
    expectCache($edited['version'] !== $copy['version'], 'Editing a schedule changes the version.');
    $pdo->exec("UPDATE schedules SET time_end = '10:00:00' WHERE schedule_id = 20");
    $nextDay = $service->build(1, $now->modify('+1 day'));
    expectCache($nextDay['version'] !== $copy['version'] && readCopy($nextDay['bytes'])['header']['from'] === $at('2026-11-13 00:00'),
        'A new day moves the range and changes the version.');
    expectCache($service->build(1, $now)['version'] === $copy['version'], 'The original data gives the original version again.');

    // The heartbeat reuses a version for a minute, then rebuilds.
    $file = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'entrivo_door_access_cache_999.json';
    @unlink($file);
    $v1 = $service->cachedVersion(999, $now);
    $pdo->exec("UPDATE schedules SET time_end = '10:45:00' WHERE schedule_id = 20");
    $sameMinute = $service->cachedVersion(999, $now->modify('+30 seconds'));
    $afterMinute = $service->cachedVersion(999, $now->modify('+61 seconds'));
    @unlink($file);
    $pdo->exec("UPDATE schedules SET time_end = '10:00:00' WHERE schedule_id = 20");
    expectCache($sameMinute === $v1 && $afterMinute !== $v1, 'The heartbeat version is cached for 60 seconds.');

    if (isset($argv[1])) {
        $hex = implode(', ', array_map(static fn ($b) => sprintf('0x%02X', ord($b)), str_split($copy['bytes'])));
        file_put_contents($argv[1], "// Generated by backend/tests/door_access_cache_test.php (build at 2026-11-12 07:00 Asia/Manila).\n"
            . "constexpr uint8_t SAMPLE[] = {\n    " . wordwrap($hex, 96, "\n    ") . "\n};\n");
        echo 'Sample copy written: ' . strlen($copy['bytes']) . " bytes\n";
    }

    echo "PASS: the door's offline schedule copy lists only usable credentials (active cards, confirmed fingerprints, set-up accounts, emergency cards), "
        . "the right windows per role for today and the next 7 days, in the binary format the controller reads, with a version that changes only with the answers.\n";
} finally {
    foreach ($tables as $table) $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
}
