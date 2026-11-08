<?php

require_once dirname(__DIR__) . '/services/CombinedDoorAccessService.php';

function expectCombined(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

foreach ([null, false, '', '   '] as $missing) {
    expectCombined(!CombinedDoorAccessService::deviceTokenMatches($missing, 'fixture-token'), 'An unconfigured device token must fail closed.');
}
expectCombined(CombinedDoorAccessService::deviceTokenMatches('fixture-token', 'fixture-token'), 'An exact configured device token must match.');
foreach ([null, false, '', 'wrong-token', ' fixture-token', ['fixture-token']] as $wrong) {
    expectCombined(!CombinedDoorAccessService::deviceTokenMatches('fixture-token', $wrong), 'Missing or incorrect controller authentication must fail.');
}

$pdo = entrivo_pdo();
$tables = ['direct_fingerprint_import_jobs', 'fingerprint_devices', 'users', 'rfid_cards', 'fingerprints', 'fingerprint_enrollment_jobs', 'schedules', 'access_overrides', 'access_log', 'fingerprint_sensor_slots'];
$now = new DateTimeImmutable('2026-10-21 10:00:00', new DateTimeZone('Asia/Manila'));
$template = str_repeat("\x44\x45", 256);
try {
    // Shadow the real slot registry so fixtures never write live sensor rows.
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_sensor_slots (
        device_id INT NOT NULL, slot INT NOT NULL, state VARCHAR(20) NOT NULL DEFAULT 'free',
        fingerprint_id INT NULL, job_id INT NULL, updated_at DATETIME NULL,
        PRIMARY KEY (device_id, slot)
    ) ENGINE=InnoDB");
    // All application tables referenced below are connection-local temporary
    // shadows. Real accounts, credentials, policies and logs are never changed.
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY,device_type VARCHAR(20),status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE users (id INT PRIMARY KEY,username VARCHAR(50),is_active INT,approval_status VARCHAR(20),must_change_password INT,onboarding_step VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE rfid_cards (card_id INT PRIMARY KEY,user_id INT,rfid_uid VARCHAR(30),status VARCHAR(20)) ENGINE=InnoDB');
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
        log_id INT PRIMARY KEY AUTO_INCREMENT,user_id INT NULL,card_id INT NULL,fingerprint_id INT NULL,
        schedule_id INT NULL,override_id INT NULL,access_timestamp DATETIME,
        access_status ENUM('granted','denied'),
        denial_reason ENUM('not_registered','invalid_rfid','invalid_fingerprint','no_schedule','expired_schedule','schedule_not_started','unauthorized','offline') NULL,
        method_access ENUM('RFID','Fingerprint','Override'),access_type ENUM('IN','OUT') NOT NULL DEFAULT 'IN'
    ) ENGINE=InnoDB");
    $pdo->beginTransaction();
    try {
        AccessLogSchema::ensureRfidUid($pdo);
        throw new LogicException('Schema changes must not commit an active credential transaction.');
    } catch (RuntimeException $expected) {
        expectCombined($pdo->inTransaction(), 'An RFID schema bootstrap must never implicitly commit an existing transaction.');
    } finally {
        if ($pdo->inTransaction()) $pdo->rollBack();
    }
    expectCombined(!$pdo->query("SHOW COLUMNS FROM access_log LIKE 'rfid_uid'")->fetch(), 'A transaction must not add the RFID column before safe bootstrap.');
    $pdo->exec('SET timestamp=' . $now->getTimestamp());
    $reset = static function () use ($pdo, $tables, $template): void {
        foreach ($tables as $table) $pdo->exec('DELETE FROM ' . $table);
        $pdo->exec("INSERT INTO fingerprint_devices VALUES (1,'enrollment','active'),(2,'door','active')");
        $pdo->exec("INSERT INTO users VALUES (1,'fixture.employee',1,'approved',0,'done'),(2,'fixture.other',1,'approved',0,'done')");
        $pdo->exec("INSERT INTO rfid_cards VALUES (1,1,'4300C46DDF','active')");
        $pdo->prepare("INSERT INTO fingerprints VALUES (1,1,'Left Thumb',1,7,?,?,'active','2026-10-20 09:00:00')")->execute([$template, hash('sha256', $template)]);
        $pdo->exec("INSERT INTO fingerprint_enrollment_jobs VALUES (1,1,1,'Left Thumb',1,7,'completed',100,'2026-10-20 09:00:00')");
        // Juan (user 1): REGULAR 8:00 AM - 4:00 PM today. "Now" is 10:00 AM.
        $pdo->exec("INSERT INTO schedules VALUES (1,1,'single','regular','2026-10-21','08:00:00','16:00:00',NULL,NULL,'none',NULL,NULL,15,'approved',NULL)");
    };
    $addSchedule = static function (int $id, int $user, string $kind, string $start, string $end, string $status = 'approved') use ($pdo): void {
        $pdo->prepare("INSERT INTO schedules VALUES (?,?,'single',?,'2026-10-21',?,?,NULL,NULL,'none',NULL,NULL,15,?,NULL)")
            ->execute([$id, $user, $kind, $start, $end, $status]);
    };
    $approveOverride = static function (int $id, int $user, string $start, string $end) use ($pdo): void {
        $pdo->prepare('INSERT INTO access_overrides VALUES (?,?,99,?,?)')->execute([$id, $user, "2026-10-21 $start", "2026-10-21 $end"]);
    };
    $service = new CombinedDoorAccessService($pdo);
    $fingerprint = ['method' => 'fingerprint', 'enrollment_device_id' => 1, 'matched_slot' => 7, 'template_hash' => hash('sha256', $template)];
    $rfid = ['method' => 'rfid', 'enrollment_device_id' => 1, 'rfid_uid' => '4300C46DDF', 'direction' => 'entry'];
    $verify = static function (array $input) use ($pdo, $service, $now): array {
        $before = (int) $pdo->query('SELECT COUNT(*) FROM access_log')->fetchColumn();
        $decision = $service->verify($input, $now);
        expectCombined((int) $pdo->query('SELECT COUNT(*) FROM access_log')->fetchColumn() === $before + 1, 'Every evaluated credential decision must have exactly one log.');
        $log = $pdo->query('SELECT * FROM access_log ORDER BY log_id DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);
        expectCombined($log['access_status'] === ($decision['access_granted'] ? 'granted' : 'denied'), 'The persisted decision must agree with the response.');
        expectCombined($log['method_access'] === ($input['method'] === 'rfid' ? 'RFID' : 'Fingerprint'), 'The access method must be logged correctly.');
        $expectedUid = $input['method'] === 'rfid' && is_string($input['rfid_uid'] ?? null)
            && preg_match('/^[A-F0-9]{10}$/D', strtoupper(trim($input['rfid_uid']))) === 1
            ? strtoupper(trim($input['rfid_uid'])) : null;
        expectCombined(($log['rfid_uid'] ?? null) === $expectedUid, 'RFID logs must retain only the normalized scanned UID, including on denials; fingerprint logs must have no RFID UID.');
        expectCombined(!$pdo->inTransaction(), 'Credential verification must release its transaction.');
        return $decision;
    };
    $deny = static function (array $input, string $reason) use ($verify): void {
        $result = $verify($input);
        expectCombined($result['access_granted'] === false && $result['reason'] === $reason, 'Expected ' . $reason . ', got ' . json_encode($result));
    };

    $reset();
    expectCombined($verify($fingerprint)['access_granted'] === true, 'A confirmed registered fingerprint with a current schedule must unlock.');
    $grant = $verify($rfid);
    expectCombined($grant['access_granted'] === true && $grant['user_id'] === 1 && $grant['card_id'] === 1, 'An active assigned RFID with a current schedule must resolve the registered user.');
    $verify([...$rfid, 'rfid_uid' => '4300c46ddf', 'direction' => 'exit']);
    $log = $pdo->query('SELECT * FROM access_log ORDER BY log_id DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);
    expectCombined($log['access_type'] === 'OUT' && $log['card_id'] === 1 && $log['fingerprint_id'] === null && (int) $log['schedule_id'] === 1, 'RFID exit must log its card, OUT direction, and the schedule of the session it ends, without inventing a fingerprint.');
    $knownLogId = (int) $log['log_id'];
    $pdo->exec("UPDATE rfid_cards SET rfid_uid='00000ABCDE' WHERE card_id=1");
    $knownLog = $pdo->query('SELECT rfid_uid FROM access_log WHERE log_id=' . $knownLogId)->fetchColumn();
    expectCombined($knownLog === '4300C46DDF', 'A registered RFID scan must retain its original UID when the card registration changes.');
    $verify([...$rfid, 'rfid_uid' => ' 00000abcde ']);
    $leadingZeroLogId = (int) $pdo->query('SELECT MAX(log_id) FROM access_log')->fetchColumn();
    $pdo->exec('DELETE FROM rfid_cards WHERE card_id=1');
    $knownLog = $pdo->query('SELECT rfid_uid FROM access_log WHERE log_id=' . $leadingZeroLogId)->fetchColumn();
    expectCombined($knownLog === '00000ABCDE', 'Deleting a card registration must not remove its scanned UID or strip leading zeros.');
    $reset();
    $legacyFingerprint = $fingerprint;
    unset($legacyFingerprint['template_hash']);
    $pdo->exec('DELETE FROM schedules');
    $scheduled = (new DirectFingerprintAccessService($pdo))->verify($legacyFingerprint, $now);
    expectCombined(!$scheduled['access_granted'] && $scheduled['reason'] === 'no_schedule', 'The original direct fingerprint route must still require a schedule.');
    $scheduledWithHash = (new DirectFingerprintAccessService($pdo))->verify([...$legacyFingerprint, 'template_hash' => 'invalid'], $now);
    expectCombined($scheduledWithHash['reason'] === 'no_schedule', 'The original direct fingerprint route must not acquire a new live-template hash contract.');
    $deny($fingerprint, 'no_schedule');
    $reset();
    expectCombined($verify($fingerprint)['access_granted'], 'A scheduled fingerprint entry must not depend on a previous decision.');

    $deny($legacyFingerprint, 'invalid_request');
    foreach ([null, true, 123, '', str_repeat('a', 63), str_repeat('a', 65), str_repeat('A', 64), str_repeat('g', 64), ' ' . $fingerprint['template_hash'], [$fingerprint['template_hash']]] as $hash) {
        $deny([...$fingerprint, 'template_hash' => $hash], 'invalid_request');
    }
    $deny([...$fingerprint, 'template_hash' => str_repeat('0', 64)], 'fingerprint_mismatch');
    expectCombined($verify($fingerprint)['access_granted'], 'A valid live sensor template hash must still match the registered database backup.');

    foreach (["\xFF", "\0", 'A'] as $value) {
        $uniform = str_repeat($value, 768);
        foreach ([$uniform, base64_encode($uniform)] as $storedTemplate) {
            $pdo->prepare('UPDATE fingerprints SET template_data=?,template_hash=? WHERE fingerprint_id=1')
                ->execute([$storedTemplate, hash('sha256', $uniform)]);
            $deny([...$fingerprint, 'template_hash' => hash('sha256', $uniform)], 'invalid_fingerprint');
        }
    }
    $pdo->prepare('UPDATE fingerprints SET template_data=?,template_hash=? WHERE fingerprint_id=1')
        ->execute([$template, hash('sha256', $template)]);

    $deny([...$rfid, 'rfid_uid' => '0000000000'], 'not_registered');
    $unknownLog = $pdo->query('SELECT * FROM access_log ORDER BY log_id DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);
    expectCombined($unknownLog['rfid_uid'] === '0000000000' && $unknownLog['user_id'] === null && $unknownLog['card_id'] === null, 'An unregistered RFID must retain its complete UID without fabricating a user or card registration.');
    foreach ([true, '', '4300 C46DDF', '4300C46DD', '4300C46DDZ', ['4300C46DDF']] as $uid) $deny([...$rfid, 'rfid_uid' => $uid], 'invalid_request');
    foreach ([null, '', 'IN', 'sideways', true, ['exit']] as $direction) $deny([...$rfid, 'direction' => $direction], 'invalid_request');
    foreach ([$rfid, $fingerprint] as $input) {
        $deny([...$input, 'enrollment_device_id' => true], 'invalid_request');
        $deny([...$input, 'enrollment_device_id' => 2], 'device_unavailable');
        $deny([...$input, 'enrollment_device_id' => 99], 'device_unavailable');
    }
    $pdo->exec("UPDATE fingerprint_devices SET status='inactive' WHERE device_id=1");
    foreach ([$rfid, $fingerprint] as $input) $deny($input, 'device_unavailable');
    $reset();
    foreach (['inactive', 'lost'] as $status) {
        $pdo->prepare('UPDATE rfid_cards SET status=? WHERE card_id=1')->execute([$status]);
        $deny($rfid, 'invalid_rfid');
    }
    $reset();
    foreach (["is_active=0", "approval_status='pending'", "approval_status='rejected'"] as $change) {
        $pdo->exec('UPDATE users SET ' . $change . ' WHERE id=1');
        foreach ([$rfid, $fingerprint] as $input) $deny($input, 'account_inactive');
        $reset();
    }
    foreach (["must_change_password=1", "onboarding_step='profile'"] as $change) {
        $pdo->exec('UPDATE users SET ' . $change . ' WHERE id=1');
        foreach ([$rfid, $fingerprint] as $input) $deny($input, 'account_incomplete');
        $reset();
    }
    $pdo->exec("INSERT INTO rfid_cards VALUES (2,2,'4300c46ddf','active')");
    $deny($rfid, 'ambiguous_card');
    $reset();
    $pdo->exec('DELETE FROM users WHERE id=1');
    $deny($rfid, 'not_registered');
    $reset();
    $deny([...$fingerprint, 'matched_slot' => 999], 'not_registered');
    $pdo->prepare("INSERT INTO fingerprints VALUES (2,2,'Other Finger',1,7,?,?,'active','2026-10-20 09:00:00')")->execute([$template, hash('sha256', $template)]);
    $deny($fingerprint, 'ambiguous_slot');
    $reset();
    foreach (["status='inactive'", "template_data='bad'", "template_hash=REPEAT('0',64)"] as $change) {
        $pdo->exec('UPDATE fingerprints SET ' . $change . ' WHERE fingerprint_id=1');
        $deny($fingerprint, 'invalid_fingerprint');
        $reset();
    }
    foreach (['waiting', 'processing', 'failed', 'cancelled'] as $status) {
        $pdo->prepare('UPDATE fingerprint_enrollment_jobs SET status=? WHERE job_id=1')->execute([$status]);
        $deny($fingerprint, 'enrollment_incomplete');
        $reset();
    }
    $pdo->exec("INSERT INTO direct_fingerprint_import_jobs VALUES (1,1,1,7,'pending',NOW(),NULL)");
    $deny($fingerprint, 'import_in_progress');
    $reset();
    // Schedule policy for entry. Juan: REGULAR 08:00-16:00. Maria: OVERRIDE 10:00-12:00.
    $lastLog = static fn (): array => $pdo->query('SELECT * FROM access_log ORDER BY log_id DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);
    $maria = [...$rfid, 'rfid_uid' => 'AAAAAAAAAA'];
    $reset();
    $pdo->exec("INSERT INTO rfid_cards VALUES (2,2,'AAAAAAAAAA','active')");
    $addSchedule(2, 2, 'override', '10:00:00', '12:00:00');
    $approveOverride(1, 2, '10:00:00', '12:00:00');
    // Stamp Juan's regular the way OverrideScheduleService does; it must stay valid.
    $pdo->exec('UPDATE schedules SET overridden_by_schedule_id=2 WHERE schedule_id=1');
    foreach ([$rfid, $fingerprint] as $input) {
        $result = $verify($input);
        expectCombined($result['access_granted'] && $result['schedule_kind'] === 'regular' && $result['schedule_id'] === 1 && $result['override_id'] === null,
            'An OVERRIDE of another user must not block a valid REGULAR schedule: ' . json_encode($result));
        $log = $lastLog();
        expectCombined((int) $log['schedule_id'] === 1 && $log['override_id'] === null, 'A REGULAR grant must log its schedule.');
    }
    $result = $verify($maria);
    expectCombined($result['access_granted'] && $result['user_id'] === 2 && $result['schedule_kind'] === 'override'
        && $result['schedule_id'] === 2 && $result['override_id'] === 1, 'A valid approved OVERRIDE must grant as OVERRIDE: ' . json_encode($result));
    $log = $lastLog();
    expectCombined((int) $log['schedule_id'] === 2 && (int) $log['override_id'] === 1, 'An OVERRIDE grant must log its schedule and override.');

    // Same user with both valid: REGULAR wins.
    $addSchedule(3, 1, 'override', '09:00:00', '11:00:00');
    $approveOverride(2, 1, '09:00:00', '11:00:00');
    $result = $verify($rfid);
    expectCombined($result['schedule_kind'] === 'regular' && $result['schedule_id'] === 1, 'REGULAR must have priority over a simultaneous OVERRIDE.');
    // Only the override is valid: OVERRIDE.
    $pdo->exec('DELETE FROM schedules WHERE schedule_id=1');
    foreach ([$rfid, $fingerprint] as $input) {
        $result = $verify($input);
        expectCombined($result['access_granted'] && $result['schedule_kind'] === 'override' && $result['override_id'] === 2, 'A user with only a valid OVERRIDE must enter as OVERRIDE.');
    }
    // An override without an approved request does not count; Maria's override is not Juan's.
    $pdo->exec('UPDATE access_overrides SET approved_by=NULL WHERE override_id=2');
    $pdo->exec('DELETE FROM access_log'); // No open session: nobody inside.
    foreach ([$rfid, $fingerprint] as $input) $deny($input, 'no_schedule');
    expectCombined($lastLog()['denial_reason'] === 'no_schedule', 'A schedule denial must log its reason.');
    expectCombined($verify($maria)['access_granted'], 'Another user being denied must not affect a valid OVERRIDE.');

    // Outside the window, wrong status, other users' schedules.
    foreach ([
        ["time_start='11:00:00',time_end='16:00:00'", 'schedule_not_started'],
        ["time_start='07:00:00',time_end='09:00:00'", 'expired_schedule'],
        ["time_end='10:00:00'", 'expired_schedule'],
        ["schedule_date='2026-10-22'", 'no_schedule'],
        ["status='pending'", 'no_schedule'],
        ["status='cancelled'", 'no_schedule'],
        ['user_id=2', 'no_schedule'],
    ] as [$change, $reason]) {
        $reset();
        $pdo->exec('UPDATE schedules SET ' . $change . ' WHERE schedule_id=1');
        foreach ([$rfid, $fingerprint] as $input) $deny($input, $reason);
        expectCombined($lastLog()['denial_reason'] === $reason, 'The schedule denial reason must be logged: ' . $reason);
    }
    $reset();
    $pdo->exec("UPDATE schedules SET time_start='10:00:00' WHERE schedule_id=1");
    expectCombined($verify($rfid)['access_granted'], 'A schedule is valid from its exact start time.');
    $reset();
    $pdo->exec("UPDATE schedules SET schedule_date=NULL,schedule_type='recurring',start_date='2026-10-19',end_date='2026-10-25',repeat_type='weekly_selected',repeat_days='[\"Wednesday\"]' WHERE schedule_id=1");
    expectCombined($verify($fingerprint)['access_granted'], 'A recurring REGULAR schedule must be valid on its selected day.');
    $pdo->exec("UPDATE schedules SET repeat_days='[\"Thursday\"]' WHERE schedule_id=1");
    $pdo->exec('DELETE FROM access_log'); // No open session: nobody inside.
    $deny($fingerprint, 'no_schedule');
    // Exit is never schedule-gated: it only arms the lock on an open door.
    $pdo->exec('DELETE FROM schedules');
    $deny($rfid, 'no_schedule');
    expectCombined($verify([...$rfid, 'direction' => 'exit'])['access_granted'], 'An RFID exit must work without a schedule.');
    expectCombined($verify([...$fingerprint, 'direction' => 'exit'])['access_granted'], 'A fingerprint exit must work without a schedule.');
    $reset();
    // Sessions: in/out repeatedly during the schedule, EXTENDED exits, and
    // leaving a locked door after the schedule ended (exit only, never entry).
    $at = static fn (string $clock): DateTimeImmutable => new DateTimeImmutable("2026-10-21 $clock", new DateTimeZone('Asia/Manila'));
    $verifyAt = static function (array $input, string $clock) use ($pdo, $service, $at): array {
        $pdo->exec('SET timestamp=' . $at($clock)->getTimestamp());
        $decision = $service->verify($input, $at($clock));
        expectCombined(!$pdo->inTransaction(), 'Credential verification must release its transaction.');
        return $decision;
    };
    $reset();
    $pdo->exec('DELETE FROM access_log');
    foreach (['09:00:00', '10:00:00', '11:30:00'] as $clock) {
        foreach ([[$rfid, 'entry'], [[...$rfid, 'direction' => 'exit'], 'exit']] as [$input, $kind]) {
            $result = $verifyAt($input, $clock);
            expectCombined($result['access_granted'] && (int) $result['schedule_id'] === 1, "In and out must work repeatedly during the schedule ($kind at $clock).");
            if ($kind === 'exit') expectCombined($result['extended'] === false, 'An exit inside the schedule is not extended.');
        }
    }
    // Enter during the schedule, stay past 16:00, leave at 16:25.
    expectCombined($verifyAt($rfid, '15:50:00')['access_granted'], 'Entry inside the schedule must be granted.');
    $late = $verifyAt([...$rfid, 'direction' => 'exit'], '16:25:00');
    expectCombined($late['access_granted'] && $late['extended'] === true && $late['extended_minutes'] === 25
        && (int) $late['schedule_id'] === 1 && $late['schedule_kind'] === 'regular', 'A late exit must be granted and recorded as EXTENDED: ' . json_encode($late));
    $log = $lastLog();
    expectCombined($log['access_type'] === 'OUT' && $log['access_status'] === 'granted' && (int) $log['schedule_id'] === 1,
        'The EXTENDED exit must be in the access log, linked to its schedule.');
    $denied = $verifyAt($rfid, '16:30:00');
    expectCombined(!$denied['access_granted'] && $denied['reason'] === 'expired_schedule', 'After the schedule ends the user may not enter again.');
    // An override session that runs late is linked to the override.
    $reset();
    $pdo->exec('DELETE FROM access_log');
    $pdo->exec('DELETE FROM schedules');
    $addSchedule(5, 1, 'override', '10:00:00', '12:00:00');
    $approveOverride(5, 1, '10:00:00', '12:00:00');
    expectCombined($verifyAt($fingerprint, '11:00:00')['schedule_kind'] === 'override', 'OVERRIDE entry must be granted.');
    $late = $verifyAt([...$fingerprint, 'direction' => 'exit'], '12:10:00');
    expectCombined($late['extended'] && $late['schedule_kind'] === 'override' && (int) $late['override_id'] === 5,
        'A late fingerprint exit must be EXTENDED and linked to the override: ' . json_encode($late));

    // Locked in: entered, door locked, schedule over. The inside fingerprint
    // sensor lets the user OUT; the same scan without an open session stays denied.
    $reset();
    $pdo->exec('DELETE FROM access_log');
    expectCombined($verifyAt($fingerprint, '15:00:00')['access_granted'], 'Entry inside the schedule must be granted.');
    $out = $verifyAt($fingerprint, '16:40:00');
    expectCombined($out['access_granted'] && ($out['exit_only'] ?? false) === true && $out['direction'] === 'exit' && $out['extended'] === true,
        'A user still inside after the schedule must be let out (exit only): ' . json_encode($out));
    $log = $lastLog();
    expectCombined($log['access_type'] === 'OUT' && (int) $log['schedule_id'] === 1, 'A locked-in exit must be logged as OUT.');
    $again = $verifyAt($fingerprint, '16:45:00');
    expectCombined(!$again['access_granted'] && $again['reason'] === 'expired_schedule' && empty($again['exit_only']),
        'After leaving, the same user must not get back in after the schedule.');
    // RFID entrance is outside: an open session never turns it into an exit.
    $reset();
    $pdo->exec('DELETE FROM access_log');
    expectCombined($verifyAt($rfid, '15:00:00')['access_granted'], 'Entry inside the schedule must be granted.');
    $outside = $verifyAt($rfid, '16:40:00');
    expectCombined(!$outside['access_granted'] && empty($outside['exit_only']), 'The outside entrance reader must never let anyone in after the schedule.');
    $inside = $verifyAt([...$rfid, 'direction' => 'exit'], '16:41:00');
    expectCombined($inside['access_granted'] && $inside['extended'], 'The inside exit reader must let a locked-in user out after the schedule.');
    // Exit without any schedule or session is still allowed (nobody is trapped).
    $pdo->exec('DELETE FROM schedules');
    $pdo->exec('DELETE FROM access_log');
    $free = $verifyAt([...$rfid, 'direction' => 'exit'], '18:00:00');
    expectCombined($free['access_granted'] && $free['schedule_id'] === null && $free['extended'] === false, 'An exit must never be refused for a schedule reason.');
    $pdo->exec('SET timestamp=' . $now->getTimestamp());
    $reset();
    $before = (int) $pdo->query('SELECT COUNT(*) FROM access_log')->fetchColumn();
    expectCombined($service->verify(['method' => 'unsupported'])['access_granted'] === false, 'Unknown verification methods must never grant access.');
    expectCombined((int) $pdo->query('SELECT COUNT(*) FROM access_log')->fetchColumn() === $before, 'A malformed request must not fabricate a credential method in the logs.');

    // Compatibility with installations that have not added access_type yet.
    $pdo->exec('ALTER TABLE access_log DROP COLUMN access_type');
    $legacy = new CombinedDoorAccessService($pdo);
    expectCombined($legacy->verify([...$rfid, 'direction' => 'exit'], $now)['access_granted'], 'RFID verification must remain compatible with the original access_log schema.');
    $pdo->exec('DELETE FROM access_log');
    $pdo->exec("ALTER TABLE access_log ADD CONSTRAINT fixture_no_combined_grants CHECK (access_status <> 'granted')");
    foreach ([$fingerprint, $rfid] as $input) {
        try {
            $legacy->verify($input, $now);
            throw new RuntimeException('A door grant escaped a failed access-log write.');
        } catch (PDOException $expected) {
            expectCombined(!$pdo->inTransaction() && (int) $pdo->query('SELECT COUNT(*) FROM access_log')->fetchColumn() === 0, 'A failed log must roll back and prevent returning an unlock decision.');
        }
    }
    echo "PASS: authenticated device token matching, registered fingerprint/RFID entry gated by the user's current REGULAR or OVERRIDE schedule (REGULAR priority, overrides never block regulars, repeated in/out, EXTENDED exits linked to their session, locked-in exit-only, never-refused exits), live sensor-template binding, device/account/card/template/proof gates, separate scheduled policy, IN/OUT logs, immutable RFID UID snapshots including unknown cards and leading zeros, safe schema bootstrap, legacy log schema, and fail-closed log writes.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    $pdo->exec('SET timestamp=0');
    foreach ($tables as $table) $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
}
