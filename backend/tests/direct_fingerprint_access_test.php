<?php

require_once dirname(__DIR__) . '/services/DirectFingerprintAccessService.php';

function expectDirect(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = entrivo_pdo();
$tables = ['fingerprint_devices', 'users', 'fingerprints', 'fingerprint_enrollment_jobs', 'schedules', 'access_overrides', 'access_log', 'direct_fingerprint_import_jobs'];
$now = new DateTimeImmutable('2026-10-21 10:00:00', new DateTimeZone('Asia/Manila'));
$template = str_repeat("\x42\x43", 256);

// Every referenced application table is shadowed by a temporary table on this
// connection. No actual user record, schema, sync flag, or policy is modified.
try {
    $pdo->exec("CREATE TEMPORARY TABLE direct_fingerprint_import_jobs (
        id INT PRIMARY KEY, user_id INT, enrollment_device_id INT, target_slot INT,
        status VARCHAR(20), queued_at DATETIME, processing_at DATETIME NULL
    ) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY, device_type VARCHAR(20), status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec("CREATE TEMPORARY TABLE users (id INT PRIMARY KEY, username VARCHAR(50), is_active TINYINT, approval_status VARCHAR(20), must_change_password TINYINT, onboarding_step VARCHAR(20)) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE fingerprints (
        fingerprint_id INT PRIMARY KEY, user_id INT, finger_name VARCHAR(50),
        enrollment_device_id INT, enrollment_slot INT, shared_door_slot INT,
        template_data LONGBLOB, template_hash VARCHAR(64), status VARCHAR(20),
        door_sync_status VARCHAR(20), door_synced_at DATETIME NULL, enrolled_at DATETIME
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_enrollment_jobs (
        job_id INT PRIMARY KEY, user_id INT, fingerprint_id INT NULL, finger_name VARCHAR(50),
        enrollment_device_id INT, assigned_slot INT NULL, status VARCHAR(20), progress INT,
        finished_at DATETIME NULL
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE schedules (
        schedule_id INT PRIMARY KEY, user_id INT, schedule_type VARCHAR(20), schedule_kind VARCHAR(20),
        schedule_date DATE NULL, time_start TIME, time_end TIME, start_date DATE NULL, end_date DATE NULL,
        repeat_type VARCHAR(30), repeat_day VARCHAR(15) NULL, repeat_days TEXT NULL,
        grace_period_minutes INT DEFAULT 15, status VARCHAR(20)
    ) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE access_overrides (override_id INT PRIMARY KEY, user_id INT, approved_by INT NULL, override_start DATETIME, override_end DATETIME) ENGINE=InnoDB');
    $pdo->exec("CREATE TEMPORARY TABLE access_log (
        log_id INT PRIMARY KEY AUTO_INCREMENT, user_id INT NULL, fingerprint_id INT NULL,
        schedule_id INT NULL, override_id INT NULL, access_timestamp DATETIME,
        access_status ENUM('granted','denied'),
        denial_reason ENUM('not_registered','invalid_rfid','invalid_fingerprint','no_schedule','expired_schedule','schedule_not_started','unauthorized','offline') NULL,
        method_access ENUM('RFID','Fingerprint','Override')
    ) ENGINE=InnoDB");
    $pdo->exec("INSERT INTO fingerprint_devices VALUES (1,'enrollment','active'),(2,'enrollment','active'),(3,'door','active')");
    $pdo->exec("INSERT INTO users VALUES (1,'fixture.user',1,'approved',0,'done'),(2,'other.user',1,'approved',0,'done')");
    $pdo->prepare("INSERT INTO fingerprints VALUES (1,1,'Right thumb',1,11,999,?,?,'active','failed',NULL,'2026-10-20 09:00:00')")->execute([$template, hash('sha256', $template)]);
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs VALUES (1,1,1,'Right thumb',1,11,'completed',100,'2026-10-20 09:00:00')");
    $scheduleSql = "INSERT INTO schedules VALUES (1,1,'single','regular','2026-10-21','09:00:00','11:00:00',NULL,NULL,'none',NULL,NULL,15,'approved')";
    $pdo->exec($scheduleSql);
    $service = new DirectFingerprintAccessService($pdo);
    $verify = static function (?DateTimeImmutable $at = null, array $input = ['enrollment_device_id' => 1, 'matched_slot' => 11]) use ($service, $now, $pdo): array {
        $before = (int) $pdo->query('SELECT COUNT(*) FROM access_log')->fetchColumn();
        $decision = $service->verify($input, $at ?? $now);
        expectDirect((int) $pdo->query('SELECT COUNT(*) FROM access_log')->fetchColumn() === $before + 1, 'Every evaluated grant or denial must have exactly one access log.');
        $log = $pdo->query('SELECT * FROM access_log ORDER BY log_id DESC LIMIT 1')->fetch();
        expectDirect($log['method_access'] === 'Fingerprint' && $log['access_status'] === ($decision['access_granted'] ? 'granted' : 'denied'), 'The persisted fingerprint access decision must match the response.');
        expectDirect(!$pdo->inTransaction(), 'A decision must release its transaction.');
        return $decision;
    };
    $expectDeny = static function (string $reason, ?DateTimeImmutable $at = null, array $input = ['enrollment_device_id' => 1, 'matched_slot' => 11]) use ($verify): void {
        $result = $verify($at, $input);
        expectDirect($result['access_granted'] === false && $result['reason'] === $reason, 'Expected denial ' . $reason . ', got ' . json_encode($result));
    };

    foreach ([512, 768, 1024, 1536] as $bytes) {
        $completeTemplate = str_repeat("\xFF\x01", $bytes / 2);
        foreach ([$completeTemplate, base64_encode($completeTemplate)] as $storedTemplate) {
            $pdo->prepare('UPDATE fingerprints SET template_data=?,template_hash=? WHERE fingerprint_id=1')
                ->execute([$storedTemplate, hash('sha256', $completeTemplate)]);
            expectDirect($verify()['access_granted'], 'A confirmed complete template of every supported size must authorize.');
        }
        foreach (["\xFF", "\0", 'A'] as $value) {
            $uniform = str_repeat($value, $bytes);
            foreach ([$uniform, base64_encode($uniform)] as $storedTemplate) {
                $pdo->prepare('UPDATE fingerprints SET template_data=?,template_hash=? WHERE fingerprint_id=1')
                    ->execute([$storedTemplate, hash('sha256', $uniform)]);
                $expectDeny('invalid_fingerprint');
            }
        }
    }
    $pdo->prepare('UPDATE fingerprints SET template_data=?,template_hash=? WHERE fingerprint_id=1')->execute([$template, hash('sha256', $template)]);
    $grant = $verify();
    $pdo->exec("INSERT INTO direct_fingerprint_import_jobs VALUES (1,1,1,11,'pending',NOW(),NULL)");
    $expectDeny('import_in_progress');
    $pdo->exec("UPDATE direct_fingerprint_import_jobs SET status='processing',processing_at=NOW()");
    $expectDeny('import_in_progress');
    $pdo->exec("UPDATE direct_fingerprint_import_jobs SET processing_at=DATE_SUB(NOW(),INTERVAL 6 MINUTE)");
    expectDirect($verify()['access_granted'] === true, 'An expired import lease must not indefinitely block an otherwise valid fingerprint.');
    $pdo->exec("UPDATE direct_fingerprint_import_jobs SET status='completed'");
    expectDirect($verify()['access_granted'] === true, 'A completed import must not block a confirmed fingerprint.');
    $pdo->exec('DELETE FROM direct_fingerprint_import_jobs');
    expectDirect($grant['success'] === true && $grant['access_granted'] === true && $grant['user_id'] === 1 && $grant['fingerprint_id'] === 1, 'A completed local enrollment with current approved access should unlock.');
    $unchanged = $pdo->query('SELECT shared_door_slot, door_sync_status, door_synced_at FROM fingerprints WHERE fingerprint_id=1')->fetch();
    expectDirect((int) $unchanged['shared_door_slot'] === 999 && $unchanged['door_sync_status'] === 'failed' && $unchanged['door_synced_at'] === null, 'Direct access must ignore and preserve original shared-door and sync state.');
    $expectDeny('not_registered', null, ['enrollment_device_id' => 1, 'matched_slot' => 999]);
    $expectDeny('not_registered', null, ['enrollment_device_id' => 2, 'matched_slot' => 11]);
    $expectDeny('device_unavailable', null, ['enrollment_device_id' => 3, 'matched_slot' => 11]);
    $expectDeny('device_unavailable', null, ['enrollment_device_id' => 99, 'matched_slot' => 11]);
    $pdo->exec("UPDATE fingerprint_devices SET status='inactive' WHERE device_id=1");
    $expectDeny('device_unavailable');
    $pdo->exec("UPDATE fingerprint_devices SET status='active' WHERE device_id=1");
    foreach ([[], ['enrollment_device_id' => true, 'matched_slot' => 11], ['enrollment_device_id' => 1, 'matched_slot' => 0], ['enrollment_device_id' => 1, 'matched_slot' => 65536], ['enrollment_device_id' => 1, 'matched_slot' => []]] as $invalid) {
        $expectDeny('invalid_request', null, $invalid);
    }

    foreach (["is_active=0", "approval_status='pending'", "approval_status='rejected'"] as $change) {
        $pdo->exec('UPDATE users SET ' . $change . ' WHERE id=1');
        $expectDeny('account_inactive');
        $pdo->exec("UPDATE users SET is_active=1, approval_status='approved' WHERE id=1");
    }
    foreach (["must_change_password=1", "onboarding_step='profile'"] as $change) {
        $pdo->exec('UPDATE users SET ' . $change . ' WHERE id=1');
        $expectDeny('account_incomplete');
        $pdo->exec("UPDATE users SET must_change_password=0, onboarding_step='done' WHERE id=1");
    }
    foreach (["status='inactive'", "template_data='bad'", "template_hash=REPEAT('0',64)"] as $change) {
        $pdo->exec('UPDATE fingerprints SET ' . $change . ' WHERE fingerprint_id=1');
        $expectDeny('invalid_fingerprint');
        $pdo->prepare("UPDATE fingerprints SET status='active',template_data=?,template_hash=? WHERE fingerprint_id=1")->execute([$template, hash('sha256', $template)]);
    }
    $pdo->prepare("INSERT INTO fingerprints VALUES (2,1,'Right thumb',1,11,NULL,?,?,'active','pending',NULL,'2026-10-20 09:00:00')")->execute([$template, hash('sha256', $template)]);
    $expectDeny('ambiguous_slot');
    $pdo->exec('DELETE FROM fingerprints WHERE fingerprint_id=2');

    foreach (['waiting','processing','failed','cancelled'] as $status) {
        $pdo->prepare('UPDATE fingerprint_enrollment_jobs SET status=? WHERE job_id=1')->execute([$status]);
        $expectDeny('enrollment_incomplete');
    }
    $pdo->exec("UPDATE fingerprint_enrollment_jobs SET status='completed' WHERE job_id=1");
    foreach (["progress=90", "finished_at=NULL", "user_id=2", "fingerprint_id=77", "finger_name='Other finger'", "finished_at='2026-10-19 09:00:00'"] as $change) {
        $pdo->exec('UPDATE fingerprint_enrollment_jobs SET ' . $change . ' WHERE job_id=1');
        $expectDeny('enrollment_incomplete');
        $pdo->exec("UPDATE fingerprint_enrollment_jobs SET progress=100,finished_at='2026-10-20 09:00:00',user_id=1,fingerprint_id=1,finger_name='Right thumb' WHERE job_id=1");
    }
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs VALUES (2,1,NULL,'Other finger',2,12,'waiting',0,NULL)");
    $expectDeny('enrollment_incomplete');
    $pdo->exec('DELETE FROM fingerprint_enrollment_jobs WHERE job_id=2');
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs VALUES (2,2,NULL,'Other finger',1,11,'failed',95,NULL)");
    $expectDeny('enrollment_incomplete');
    $pdo->exec('DELETE FROM fingerprint_enrollment_jobs WHERE job_id=2');

    expectDirect($verify($now->setTime(9,0))['access_granted'], 'The exact approved start time must permit entry.');
    $expectDeny('schedule_not_started', $now->setTime(8,59,59));
    $expectDeny('expired_schedule', $now->setTime(11,0));
    foreach (['pending','cancelled','completed','expired'] as $status) {
        $pdo->prepare('UPDATE schedules SET status=? WHERE schedule_id=1')->execute([$status]);
        $expectDeny('no_schedule');
    }
    $pdo->exec("UPDATE schedules SET status='approved',schedule_date='2026-10-22' WHERE schedule_id=1");
    $expectDeny('no_schedule');
    $pdo->exec("UPDATE schedules SET schedule_date=NULL,schedule_type='recurring',start_date='2026-10-19',end_date='2026-10-25',repeat_type='daily' WHERE schedule_id=1");
    expectDirect($verify()['access_granted'], 'A daily recurrence in its date range must permit entry.');
    $expectDeny('no_schedule', $now->modify('+7 days'));
    $pdo->exec("UPDATE schedules SET repeat_type='weekly' WHERE schedule_id=1");
    $expectDeny('no_schedule');
    $pdo->exec("UPDATE schedules SET repeat_day='Wednesday' WHERE schedule_id=1");
    expectDirect($verify()['access_granted'], 'Named weekly recurrence must match the current weekday.');
    $pdo->exec("UPDATE schedules SET repeat_type='weekly_selected',repeat_days='[\"Monday\",\"Wednesday\"]' WHERE schedule_id=1");
    expectDirect($verify()['access_granted'], 'Selected weekday recurrence must permit a selected day.');
    $pdo->exec("UPDATE schedules SET repeat_days='[\"Monday\"]' WHERE schedule_id=1");
    $expectDeny('no_schedule');
    $pdo->exec("UPDATE schedules SET repeat_days='invalid' WHERE schedule_id=1");
    $expectDeny('no_schedule');

    $pdo->exec('DELETE FROM schedules');
    $pdo->exec($scheduleSql);
    $pdo->exec("UPDATE schedules SET schedule_kind='override' WHERE schedule_id=1");
    $expectDeny('no_schedule');
    $pdo->exec("INSERT INTO access_overrides VALUES (1,1,NULL,'2026-10-21 09:00:00','2026-10-21 11:00:00')");
    $expectDeny('no_schedule');
    $pdo->exec('UPDATE access_overrides SET approved_by=2 WHERE override_id=1');
    expectDirect($verify()['override_id'] === 1, 'Approved live override plus matching approved schedule must permit entry and log the override.');
    $pdo->exec("UPDATE schedules SET status='cancelled' WHERE schedule_id=1");
    $expectDeny('no_schedule');
    $pdo->exec("UPDATE schedules SET status='overridden',schedule_kind='regular' WHERE schedule_id=1");
    expectDirect($verify()['access_granted'], 'Legacy overridden status must remain compatible with approved override policy.');
    $pdo->exec('DELETE FROM access_overrides WHERE override_id=1');
    $expectDeny('no_schedule');

    // A failed log write must abort the grant. This constraint exists only on
    // the known temporary table and cannot affect actual access logs.
    $pdo->exec("UPDATE schedules SET status='approved',schedule_kind='regular' WHERE schedule_id=1");
    $pdo->exec('DELETE FROM access_log');
    $pdo->exec("ALTER TABLE access_log ADD CONSTRAINT fixture_reject_grant CHECK (access_status <> 'granted')");
    try {
        $service->verify(['enrollment_device_id' => 1, 'matched_slot' => 11], $now);
        throw new RuntimeException('A grant escaped a failed access-log write.');
    } catch (PDOException $expected) {
        expectDirect(!$pdo->inTransaction() && (int) $pdo->query('SELECT COUNT(*) FROM access_log')->fetchColumn() === 0, 'A failed log must roll back and never return an unlock decision.');
    }

    echo "PASS: direct local-slot identity, confirmed enrollment, account/device/template gates, approved schedule windows and recurrence, override revocation, fingerprint access logs, fail-closed log errors, and original sync-state preservation.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    foreach ($tables as $table) $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
}
