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
$tables = ['direct_fingerprint_import_jobs', 'fingerprint_devices', 'users', 'rfid_cards', 'fingerprints', 'fingerprint_enrollment_jobs', 'schedules', 'access_log'];
$now = new DateTimeImmutable('2026-10-21 10:00:00', new DateTimeZone('Asia/Manila'));
$template = str_repeat("\x44\x45", 256);
try {
    // All application tables referenced below are connection-local temporary
    // shadows. Real accounts, credentials, policies and logs are never changed.
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY,device_type VARCHAR(20),status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE users (id INT PRIMARY KEY,username VARCHAR(50),is_active INT,approval_status VARCHAR(20),must_change_password INT,onboarding_step VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE rfid_cards (card_id INT PRIMARY KEY,user_id INT,rfid_uid VARCHAR(30),status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE fingerprints (fingerprint_id INT PRIMARY KEY,user_id INT,finger_name VARCHAR(50),enrollment_device_id INT,enrollment_slot INT,template_data LONGBLOB,template_hash VARCHAR(64),status VARCHAR(20),enrolled_at DATETIME) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_enrollment_jobs (job_id INT PRIMARY KEY,user_id INT,fingerprint_id INT,finger_name VARCHAR(50),enrollment_device_id INT,assigned_slot INT,status VARCHAR(20),progress INT,finished_at DATETIME NULL) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE direct_fingerprint_import_jobs (id INT PRIMARY KEY,user_id INT,enrollment_device_id INT,target_slot INT,status VARCHAR(20),queued_at DATETIME,processing_at DATETIME NULL) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE schedules (schedule_id INT PRIMARY KEY,user_id INT) ENGINE=InnoDB');
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
    expectCombined($verify($fingerprint)['access_granted'] === true, 'Confirmed registered fingerprints must work without a schedule in the combined endpoint.');
    $grant = $verify($rfid);
    expectCombined($grant['access_granted'] === true && $grant['user_id'] === 1 && $grant['card_id'] === 1, 'An active assigned RFID must resolve the registered user without a schedule.');
    $verify([...$rfid, 'rfid_uid' => '4300c46ddf', 'direction' => 'exit']);
    $log = $pdo->query('SELECT * FROM access_log ORDER BY log_id DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);
    expectCombined($log['access_type'] === 'OUT' && $log['card_id'] === 1 && $log['fingerprint_id'] === null && $log['schedule_id'] === null, 'RFID exit must log its card and OUT direction without inventing a fingerprint or schedule.');
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
    $scheduled = (new DirectFingerprintAccessService($pdo))->verify($legacyFingerprint, $now);
    expectCombined(!$scheduled['access_granted'] && $scheduled['reason'] === 'no_schedule', 'The original direct fingerprint route must still require a schedule.');
    $scheduledWithHash = (new DirectFingerprintAccessService($pdo))->verify([...$legacyFingerprint, 'template_hash' => 'invalid'], $now);
    expectCombined($scheduledWithHash['reason'] === 'no_schedule', 'The original direct fingerprint route must not acquire a new live-template hash contract.');
    expectCombined($verify($fingerprint)['access_granted'], 'The scoped identity check must not depend on a previous schedule decision.');

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
    echo "PASS: authenticated device token matching, registered fingerprint/RFID verification without schedules, live sensor-template binding, device/account/card/template/proof gates, separate scheduled policy, IN/OUT logs, immutable RFID UID snapshots including unknown cards and leading zeros, safe schema bootstrap, legacy log schema, and fail-closed log writes.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    $pdo->exec('SET timestamp=0');
    foreach ($tables as $table) $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
}
