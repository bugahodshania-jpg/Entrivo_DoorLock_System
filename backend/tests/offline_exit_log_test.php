<?php

require_once dirname(__DIR__) . '/services/CombinedDoorAccessService.php';

function expectOfflineExit(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = entrivo_pdo();
$tables = ['fingerprint_devices', 'users', 'rfid_cards', 'fingerprints', 'schedules', 'access_overrides', 'access_log', 'door_event_log'];
try {
    // Connection-local shadow tables: real accounts, cards, logs and events are never touched.
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY,device_type VARCHAR(20),status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE users (id INT PRIMARY KEY,username VARCHAR(50),role VARCHAR(20),is_active INT,approval_status VARCHAR(20),must_change_password INT,onboarding_step VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE rfid_cards (card_id INT PRIMARY KEY,user_id INT,rfid_uid VARCHAR(30),status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE fingerprints (fingerprint_id INT PRIMARY KEY,user_id INT,finger_name VARCHAR(50),enrollment_device_id INT,enrollment_slot INT) ENGINE=InnoDB');
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
    $pdo->exec('CREATE TEMPORARY TABLE door_event_log (event_id CHAR(32) NOT NULL PRIMARY KEY, log_id INT NULL, recorded_at DATETIME NOT NULL) ENGINE=InnoDB');

    $pdo->exec("INSERT INTO fingerprint_devices VALUES (1,'enrollment','active')");
    $pdo->exec("INSERT INTO users VALUES (1,'student.one','student',1,'approved',0,'done'),(2,'faculty.two','faculty',1,'approved',0,'done')");
    $pdo->exec("INSERT INTO rfid_cards VALUES (1,1,'AA00000001','active')");
    $pdo->exec("INSERT INTO fingerprints VALUES (7,2,'Right Thumb',1,7)");
    // Faculty schedule 08:00-10:00, to check the offline exit is linked to it.
    $pdo->exec("INSERT INTO schedules (schedule_id,user_id,schedule_type,schedule_kind,schedule_date,time_start,time_end,repeat_type,status)
        VALUES (20,2,'single','regular','2026-11-12','08:00:00','10:00:00','none','approved')");

    $service = new CombinedDoorAccessService($pdo);
    $now = new DateTimeImmutable('2026-11-12 10:30:00', new DateTimeZone('Asia/Manila'));
    $id = static fn (int $n) => str_pad(dechex($n), 32, '0', STR_PAD_LEFT);
    $count = static fn () => (int) $pdo->query('SELECT COUNT(*) FROM access_log')->fetchColumn();
    $log = static fn (int $logId) => $pdo->query('SELECT * FROM access_log WHERE log_id=' . $logId)->fetch(PDO::FETCH_ASSOC);
    $card = static fn (string $eventId, array $extra = []) => ['offline_exit' => true, 'method' => 'rfid', 'enrollment_device_id' => 1,
        'rfid_uid' => 'AA00000001', 'direction' => 'exit', 'event_id' => $eventId, ...$extra];

    // An offline card exit 5 minutes ago is stored as a granted OUT at that time.
    $first = $service->verify($card($id(1), ['age_seconds' => 300]), $now);
    expectOfflineExit($first['success'] === true && $first['recorded'] === true, 'An offline exit must be recorded. Got ' . json_encode($first));
    $row = $log($first['log_id']);
    expectOfflineExit($row['access_type'] === 'OUT' && $row['access_status'] === 'granted' && $row['method_access'] === 'RFID'
        && (int) $row['user_id'] === 1 && (int) $row['card_id'] === 1 && $row['rfid_uid'] === 'AA00000001',
        'The offline exit must be a granted RFID OUT for the card owner. Got ' . json_encode($row));
    expectOfflineExit($row['access_timestamp'] === '2026-11-12 10:25:00', 'The exit must carry the time it happened, not the upload time.');

    // Retrying the same upload never logs it twice.
    $before = $count();
    $again = $service->verify($card($id(1), ['age_seconds' => 900]), $now);
    expectOfflineExit($again['success'] === true && ($again['duplicate'] ?? false) === true && $count() === $before,
        'A repeated upload must succeed without a second log.');

    // Unknown cards and unknown time are still logged.
    $unknown = $service->verify($card($id(2), ['rfid_uid' => 'BB00000002']), $now);
    $row = $log($unknown['log_id']);
    expectOfflineExit($unknown['recorded'] && $row['user_id'] === null && $row['rfid_uid'] === 'BB00000002'
        && $row['access_timestamp'] === '2026-11-12 10:30:00', 'An unknown card exit with no age is logged by UID at receive time.');

    // An offline fingerprint lock is logged for the slot owner and linked to the
    // session the user entered on (here an IN at 09:00), as an EXTENDED exit.
    $pdo->exec("INSERT INTO access_log (user_id,fingerprint_id,schedule_id,access_timestamp,access_status,method_access,access_type)
        VALUES (2,7,20,'2026-11-12 09:00:00','granted','Fingerprint','IN')");
    $finger = $service->verify(['offline_exit' => true, 'method' => 'fingerprint', 'enrollment_device_id' => 1, 'matched_slot' => 7,
        'direction' => 'exit', 'event_id' => $id(3), 'age_seconds' => 600], $now);
    $row = $log($finger['log_id']);
    expectOfflineExit($finger['recorded'] && (int) $row['user_id'] === 2 && (int) $row['fingerprint_id'] === 7
        && $row['method_access'] === 'Fingerprint' && (int) $row['schedule_id'] === 20 && $row['access_timestamp'] === '2026-11-12 10:20:00',
        'An offline fingerprint exit must be logged for the slot owner, linked to the schedule. Got ' . json_encode($row));

    // Online exit with an event_id, reply lost, then the same exit uploaded offline: one log only.
    $before = $count();
    $online = $service->verify(['method' => 'rfid', 'enrollment_device_id' => 1, 'rfid_uid' => 'AA00000001', 'direction' => 'exit', 'event_id' => $id(4)], $now);
    expectOfflineExit($online['access_granted'] === true && $count() === $before + 1, 'The online exit is logged once.');
    $replay = $service->verify($card($id(4)), $now);
    expectOfflineExit(($replay['duplicate'] ?? false) === true && $count() === $before + 1,
        'An exit logged online must not be logged again from the offline queue. Got ' . json_encode($replay));

    // Malformed uploads are refused (so the controller can drop them) and log nothing.
    $before = $count();
    foreach ([$card('nothex'), $card($id(5), ['rfid_uid' => 'XYZ']), $card($id(6), ['direction' => 'entry']),
        ['offline_exit' => true, 'method' => 'fingerprint', 'enrollment_device_id' => 1, 'direction' => 'exit', 'event_id' => $id(7)]] as $bad) {
        $result = $service->verify($bad, $now);
        expectOfflineExit($result['success'] === false && $result['reason'] === 'invalid_request', 'A malformed upload must be refused. Got ' . json_encode($result));
    }
    expectOfflineExit($count() === $before, 'Refused uploads must not log anything.');

    echo "PASS: offline exits are logged as granted OUT at the time they happened (card, unknown card, fingerprint slot linked to its schedule), once per event even when retried or already logged online, and malformed uploads are refused.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    foreach ($tables as $table) $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
}
