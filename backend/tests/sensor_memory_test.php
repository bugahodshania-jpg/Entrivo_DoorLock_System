<?php

require_once dirname(__DIR__) . '/services/SensorMemoryService.php';
require_once dirname(__DIR__) . '/services/DirectFingerprintImportService.php';
require_once dirname(__DIR__) . '/models/FingerprintEnrollmentJob.php';

function memoryAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}
function memoryReject(callable $work, int $status = 409): void
{
    try { $work(); }
    catch (SensorMemoryException $error) {
        memoryAssert($error->httpStatus === $status, 'Unexpected rejection: ' . $error->getMessage());
        return;
    }
    throw new RuntimeException('Invalid sensor memory request was accepted.');
}

$pdo = entrivo_pdo();
$tables = ['door_controller_status', 'sensor_memory_jobs', 'sensor_memory_inventories', 'sensor_memory_templates', 'users', 'user_privileges',
    'faculty_info', 'staff_info', 'admin_info', 'fingerprint_devices', 'fingerprints', 'fingerprint_enrollment_jobs', 'direct_fingerprint_import_jobs'];
$template = str_repeat("\x43\x44", 256);
$hash = hash('sha256', $template);
$now = new DateTimeImmutable('2026-10-22 10:00:00', new DateTimeZone('Asia/Manila'));
try {
    $pdo->exec(str_replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE', DoorStatusSchema::definition()));
    // Connection-local temporary shadows protect all real users, templates,
    // mappings, queues, and device records. No migration runs on real tables.
    foreach (SensorMemorySchema::definitions() as $definition) {
        $pdo->exec(str_replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE', $definition));
    }
    $pdo->exec('CREATE TEMPORARY TABLE users (id INT PRIMARY KEY,username VARCHAR(50),role VARCHAR(20),is_active INT,approval_status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE user_privileges (user_id INT,privilege_key VARCHAR(50)) ENGINE=InnoDB');
    foreach (['faculty_info', 'staff_info', 'admin_info'] as $profile) {
        $pdo->exec("CREATE TEMPORARY TABLE {$profile} (user_id INT,employee_id VARCHAR(100),first_name VARCHAR(50),middle_name VARCHAR(50),last_name VARCHAR(50),extension_name VARCHAR(20)) ENGINE=InnoDB");
    }
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY,device_name VARCHAR(100),device_type VARCHAR(20),status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE fingerprints (fingerprint_id INT PRIMARY KEY,user_id INT,finger_name VARCHAR(50),enrollment_device_id INT,enrollment_slot INT,template_data BLOB,template_hash CHAR(64),status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_enrollment_jobs (job_id INT AUTO_INCREMENT PRIMARY KEY,enrollment_device_id INT NULL,status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE direct_fingerprint_import_jobs (id INT AUTO_INCREMENT PRIMARY KEY,enrollment_device_id INT,status VARCHAR(20),queued_at DATETIME,processing_at DATETIME) ENGINE=InnoDB');
    $pdo->exec('SET timestamp=' . $now->getTimestamp());
    $reset = static function () use ($pdo, $tables, $template, $hash): void {
        foreach ($tables as $table) $pdo->exec('DELETE FROM ' . $table);
        $pdo->exec("INSERT INTO users VALUES (1,'employee.one','faculty',1,'approved'),(2,'employee.two','staff',1,'approved'),(9,'fixture.admin','super_admin',1,'approved')");
        $pdo->exec("INSERT INTO user_privileges VALUES (9,'fingerprint')");
        $pdo->exec("INSERT INTO faculty_info VALUES (1,'00123','First','','Employee','')");
        $pdo->exec("INSERT INTO staff_info VALUES (2,'00456','Other','','Employee','')");
        $pdo->exec("INSERT INTO fingerprint_devices VALUES (1,'Sensor A','enrollment','active'),(2,'Other Sensor','enrollment','active'),(3,'Door B','door','active')");
        $pdo->exec("INSERT INTO door_controller_status (device_id,door_state,boot_id,report_sequence) VALUES (1,'locked',REPEAT('a',32),1),(2,'locked',REPEAT('b',32),1)");
        $insert = $pdo->prepare('INSERT INTO fingerprints VALUES (?,?,?,?,?,?,?,?)');
        $insert->execute([1,1,'Right thumb',1,7,$template,$hash,'active']);
        $insert->execute([2,1,'Left thumb',1,9,base64_encode($template),$hash,'active']);
        $insert->execute([3,2,'Right index',1,7,$template,$hash,'inactive']);
        $insert->execute([4,2,'Left index',1,10,'invalid',str_repeat('0',64),'active']);
        $insert->execute([5,2,'Other device finger',2,5,$template,$hash,'active']);
    };
    $service = new SensorMemoryService($pdo);
    $admin = ['actor_id' => 9, 'device_id' => 1];
    $queue = static fn(array $extra = []) => $service->adminAction([...$admin, 'action' => 'scan', ...$extra])['job'];
    $claim = static fn(int $device = 1) => $service->claim(['device_id' => $device])['job'];
    $inventoryComplete = static function (array $job, array $extra = []) use ($service): array {
        return $service->deviceUpdate(['action' => 'complete', 'device_id' => $job['device_id'], 'job_id' => $job['job_id'],
            'claim_token' => $job['claim_token'], 'capacity' => 1000, 'template_count' => 4, 'occupied_slots' => [11,0,9,7], ...$extra]);
    };
    $readTemplate = static function (int $parent, int $slot) use ($service, $admin): ?array {
        $service->adminAction([...$admin, 'action' => 'read_template', 'inventory_id' => $parent, 'slot_id' => $slot]);
        return $service->claim(['device_id' => 1])['job'];
    };
    $templateComplete = static fn(array $job, string $data, array $extra = []) => $service->deviceUpdate(['action' => 'complete',
        'device_id' => 1, 'job_id' => $job['job_id'], 'claim_token' => $job['claim_token'], 'target_slot' => $job['target_slot'],
        'template_data_base64' => base64_encode($data), ...$extra]);
    $rows = static fn(array $response): array => array_column($response['rows'], null, 'slot_id');
    $reset();

    $doorStatus = new DoorStatusService($pdo);
    $reportDoor = static fn(string $state, int $sequence) => $doorStatus->report([
        'device_id' => 1, 'boot_id' => str_repeat('a',32), 'sequence' => $sequence, 'door_state' => $state,
    ]);
    memoryAssert($doorStatus->snapshot(1)['can_read_sensor'], 'A fresh locked report must allow sensor reads.');
    memoryAssert(count($doorStatus->read(['actor_id'=>9])['doors']) === 2, 'Portal status must expose the enrollment controllers.');
    try { $doorStatus->read(['actor_id'=>0]); throw new RuntimeException('Invalid door status actor accepted.'); }
    catch (DoorStatusException $error) { memoryAssert($error->httpStatus === 422, 'Invalid actors must be rejected.'); }
    $firstRead = $queue();
    $otherRead = $queue(['device_id'=>2]);
    $reportDoor('unlocked',2);
    memoryAssert($doorStatus->snapshot(1)['state'] === 'unlocked', 'Unlocked must be reported without being called unavailable.');
    memoryAssert($pdo->query('SELECT status FROM sensor_memory_jobs WHERE id='.$firstRead['job_id'])->fetchColumn() === 'cancelled', 'Unlocking must cancel a queued sensor read.');
    memoryAssert($pdo->query('SELECT status FROM sensor_memory_jobs WHERE id='.$otherRead['job_id'])->fetchColumn() === 'pending', 'Another controller must retain its queued read.');
    memoryReject(fn() => $queue());
    memoryReject(fn() => $service->adminAction([...$admin,'action'=>'read_template','inventory_id'=>1,'slot_id'=>7]));
    memoryAssert($claim() === null, 'An unlocked controller must not claim reads.');
    $reportDoor('locked',3);
    $processingRead = $queue();
    $claim();
    $reportDoor('unlocked',4);
    memoryAssert($pdo->query('SELECT status FROM sensor_memory_jobs WHERE id='.$processingRead['job_id'])->fetchColumn() === 'cancelled', 'Unlocking must also cancel an in-progress read.');
    $reportDoor('locked',5);
    $waitingRead = $queue();
    $pdo->exec("UPDATE door_controller_status SET received_at=DATE_SUB(NOW(6),INTERVAL 15 SECOND) WHERE device_id=1");
    memoryAssert($doorStatus->snapshot(1)['state'] === 'unknown' && !$doorStatus->snapshot(1)['can_read_sensor'], 'A report expires at exactly fifteen seconds.');
    memoryReject(fn() => $queue());
    memoryAssert($claim() === null, 'A stale report must not claim a pending read.');
    $service->adminAction([...$admin,'action'=>'cancel','job_id'=>$waitingRead['job_id']]);
    try { $reportDoor('locked',5); throw new RuntimeException('Duplicate door heartbeat refreshed the connection.'); }
    catch (DoorStatusException $error) { memoryAssert($error->httpStatus === 409, 'Duplicate sequence must be rejected.'); }
    memoryAssert(!$doorStatus->snapshot(1)['online'], 'A replay cannot refresh an expired report.');
    $reportDoor('locked',6);
    memoryAssert($doorStatus->snapshot(1)['can_read_sensor'], 'A new locked heartbeat must restore read availability.');
    $pdo->exec('DELETE FROM door_controller_status WHERE device_id=1');
    memoryReject(fn() => $queue());
    memoryAssert($doorStatus->snapshot(1)['state'] === 'unknown', 'A controller that has never reported must not appear locked.');
    $reset();

    memoryAssert(SensorMemoryService::deviceTokenMatches('fixture-secret', 'fixture-secret'), 'The correct device token must match.');
    foreach ([null, '', 'fixture-secret ', 1] as $provided) memoryAssert(!SensorMemoryService::deviceTokenMatches('fixture-secret', $provided), 'Missing and altered tokens must be rejected.');
    memoryAssert(!SensorMemoryService::deviceTokenMatches('', ''), 'An unconfigured token must never authenticate a device.');
    memoryReject(fn() => $service->read([...$admin, 'actor_id' => 1]), 403);
    memoryReject(fn() => $queue(['actor_id' => 1]), 403);
    $pdo->exec("UPDATE users SET is_active=0 WHERE id=9");
    memoryReject(fn() => $service->read($admin), 403);
    $pdo->exec("UPDATE users SET is_active=1,approval_status='pending' WHERE id=9");
    memoryReject(fn() => $queue(), 403);
    $pdo->exec("UPDATE users SET approval_status='approved' WHERE id=9");
    $pdo->exec("UPDATE user_privileges SET privilege_key='dashboard'");
    memoryReject(fn() => $service->read($admin), 403);
    memoryReject(fn() => $queue(), 403);
    $pdo->exec('DELETE FROM user_privileges');
    memoryAssert($service->read($admin)['success'], 'Existing role defaults must apply when no explicit privileges exist.');
    $pdo->exec("INSERT INTO user_privileges VALUES (9,'fingerprint')");
    $initial = $service->read($admin);
    memoryAssert($initial['inventory'] === null && count($initial['devices']) === 2, 'Only enrollment devices are selectable and no inventory is invented from the database.');
    foreach ($initial['rows'] as $row) memoryAssert($row['sensor_present'] === null && $row['template_status'] === 'not_scanned', 'An unscanned sensor must never be called empty or matching.');
    memoryReject(fn() => $queue(['device_id' => 3]), 404);
    memoryReject(fn() => $queue(['device_id' => 0]), 422);
    memoryReject(fn() => $queue(['device_id' => true]), 422);
    $queued = $queue();
    memoryAssert($queue()['job_id'] === $queued['job_id'], 'Repeated inventory queue requests must be idempotent.');
    memoryAssert(!SensorMemorySchema::hasProcessingForDevice($pdo,1), 'A pending read must yield to enrollment.');
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs (enrollment_device_id,status) VALUES (1,'waiting')");
    memoryAssert($claim() === null, 'An enrollment must defer the read claim.');
    $pdo->exec('DELETE FROM fingerprint_enrollment_jobs');
    $pdo->exec("INSERT INTO direct_fingerprint_import_jobs (enrollment_device_id,status,queued_at) VALUES (1,'pending',NOW())");
    memoryAssert($claim() === null, 'An active database restore must defer the read claim.');
    $pdo->exec('DELETE FROM direct_fingerprint_import_jobs');
    memoryAssert($claim(2) === null, 'A different device must not claim another device job.');
    $claimed = $claim();
    memoryAssert($claimed['job_id'] === $queued['job_id'] && $claimed['kind'] === 'inventory' && strlen($claimed['claim_token']) === 64, 'A claim must bind an unguessable token to the exact inventory job.');
    memoryAssert(SensorMemorySchema::hasProcessingForDevice($pdo,1), 'A processing read must reserve the physical sensor.');
    memoryAssert($claim()['claim_token'] === $claimed['claim_token'], 'A reconnect must resume the same claim without resetting the lease.');
    memoryAssert(!str_contains(json_encode($service->read([...$admin,'job_id'=>$claimed['job_id']])), 'claim_token'), 'Administrative polling must not expose device claim tokens.');
    memoryReject(fn() => $inventoryComplete($claimed, ['claim_token' => str_repeat('0',64)]), 403);
    memoryReject(fn() => $inventoryComplete($claimed, ['device_id' => 2]), 403);
    foreach ([['capacity'=>4097], ['capacity'=>0], ['template_count'=>3], ['occupied_slots'=>[0,7,7,11]],
        ['occupied_slots'=>[0,7,9,1000]], ['occupied_slots'=>[0,7,9,'11']], ['occupied_slots'=>[0,7,9,-1]],
        ['captured_at'=>'2026-02-30T10:00:00+08:00'], ['captured_at'=>'2026-10-22 10:00:00']] as $invalid) {
        memoryReject(fn() => $inventoryComplete($claimed,$invalid), 422);
    }
    memoryAssert((int)$pdo->query('SELECT COUNT(*) FROM sensor_memory_inventories')->fetchColumn() === 0, 'Invalid reports must never create a partial or empty inventory.');
    $before = $pdo->query('SELECT * FROM fingerprints ORDER BY fingerprint_id')->fetchAll();
    $complete = $inventoryComplete($claimed, ['captured_at'=>'2026-10-22T02:00:00Z']);
    memoryAssert($complete['job']['status'] === 'completed', 'A complete sensor report must complete atomically.');
    memoryAssert($inventoryComplete($claimed, ['captured_at'=>'2026-10-22T02:00:00Z'])['job'] === $complete['job'], 'An exact duplicate terminal report must be accepted idempotently.');
    memoryReject(fn() => $inventoryComplete($claimed, ['occupied_slots'=>[0,7,9,12],'captured_at'=>'2026-10-22T02:00:00Z']));
    $snapshot = $service->read($admin);
    $inventoryId = $snapshot['inventory']['job_id'];
    $mapped = $rows($snapshot);
    memoryAssert($snapshot['inventory']['occupied_slots'] === [0,7,9,11] && $snapshot['inventory']['template_count'] === 4, 'The actual sensor bitmap, including unmapped slot 0, must be stored and sorted.');
    memoryAssert($snapshot['inventory']['source'] === 'r307s' && $snapshot['inventory']['captured_at'] === '2026-10-22 10:00:00' && $snapshot['inventory']['received_at'] === '2026-10-22 10:00:00', 'Capture and server receive times must remain explicit and separate.');
    memoryAssert($mapped[0]['mapping_status'] === 'sensor_only' && $mapped[7]['mapping_status'] === 'conflict' && $mapped[9]['mapping_status'] === 'mapped' && $mapped[10]['mapping_status'] === 'database_only', 'The union must show sensor-only, duplicate database mappings, mapped, and database-only slots.');
    memoryAssert(!isset($mapped[5]) && $snapshot['summary']['sensor_only'] === 2 && $snapshot['summary']['conflict'] === 1 && $snapshot['summary']['database_only'] === 1, 'Comparison must isolate devices and count real differences.');
    memoryAssert($mapped[9]['template_status'] === 'not_read' && $snapshot['summary']['matches'] === 0, 'A shared slot ID is never evidence of equal templates.');
    memoryReject(fn() => $service->adminAction([...$admin,'action'=>'read_template','inventory_id'=>$inventoryId,'slot_id'=>10]), 422);
    memoryReject(fn() => $service->adminAction([...$admin,'device_id'=>2,'action'=>'read_template','inventory_id'=>$inventoryId,'slot_id'=>0]), 403);
    $templateJob = $readTemplate($inventoryId,9);
    memoryReject(fn() => $templateComplete($templateJob,$template,['target_slot'=>7]),422);
    memoryReject(fn() => $templateComplete($templateJob,$template,['inventory_id'=>$inventoryId+1]),422);
    foreach (['not base64', base64_encode($template)."\n", base64_encode('too short')] as $bad) {
        memoryReject(fn() => $templateComplete($templateJob,$template,['template_data_base64'=>$bad]),422);
    }
    $result = $templateComplete($templateJob,$template,['template_hash'=>str_repeat('0',64),'template_bytes'=>1]);
    memoryAssert($result['job']['status'] === 'completed' && $templateComplete($templateJob,$template)['job']['status'] === 'completed', 'Template completion and exact repeated payloads must be idempotent, ignoring untrusted client diagnostics.');
    $afterRead = $service->read([...$admin,'template_job_id'=>$templateJob['job_id']]);
    memoryAssert($rows($afterRead)[9]['template_status'] === 'match' && $afterRead['template']['template_hash'] === $hash
        && $afterRead['template']['template_bytes'] === 512 && base64_decode($afterRead['template']['template_data_base64'],true) === $template
        && hex2bin($afterRead['template']['template_data_hex']) === $template, 'Only real returned bytes may prove a match, and explicit exports must preserve all bytes.');
    memoryAssert(!str_contains(json_encode($service->read($admin)), 'template_data_base64'), 'Ordinary polling must return template metadata without raw binary payloads.');
    memoryReject(fn() => $service->read([...$admin,'actor_id'=>1,'template_job_id'=>$templateJob['job_id']]),403);
    memoryReject(fn() => $service->read([...$admin,'device_id'=>2,'template_job_id'=>$templateJob['job_id']]),403);
    memoryReject(fn() => $templateComplete($templateJob,str_repeat('XY',256)));
    $reread = $readTemplate($inventoryId,9);
    memoryAssert($reread['job_id'] !== $templateJob['job_id'], 'An explicit reread must create a fresh physical read after a completed template job.');
    memoryAssert($service->adminAction([...$admin,'action'=>'read_template','inventory_id'=>$inventoryId,'slot_id'=>9])['job']['job_id'] === $reread['job_id'], 'Repeated requests while a reread is active must reuse that exact attempt.');
    $templateComplete($reread,$template);
    $otherTemplate = str_repeat('XY',256);
    $pdo->prepare('UPDATE fingerprints SET template_data=?,template_hash=? WHERE fingerprint_id=2')->execute([$otherTemplate,hash('sha256',$otherTemplate)]);
    memoryAssert($rows($service->read($admin))[9]['template_status'] === 'different', 'Comparison must recompute against current verified DB bytes rather than cache a stale match.');
    $pdo->prepare('UPDATE fingerprints SET template_data=?,template_hash=? WHERE fingerprint_id=2')->execute([base64_encode($template),$hash]);

    $conflictJob = $readTemplate($inventoryId,7);
    $templateComplete($conflictJob,$template);
    memoryAssert($rows($service->read($admin))[7]['template_status'] === 'conflict', 'Duplicate database mappings must remain conflicts even with matching bytes.');
    $zeroJob = $readTemplate($inventoryId,0);
    $templateComplete($zeroJob,$template);
    memoryAssert($rows($service->read($admin))[0]['template_status'] === 'no_backup', 'An unmapped slot 0 must remain readable without inventing a user.');
    $uniformJob = $readTemplate($inventoryId,11);
    $templateComplete($uniformJob,str_repeat("\0",512));
    $uniform = $service->read([...$admin,'template_job_id'=>$uniformJob['job_id']]);
    memoryAssert($rows($uniform)[11]['template_status'] === 'invalid_sensor_template' && !$uniform['template']['template_valid']
        && base64_decode($uniform['template']['template_data_base64'],true) === str_repeat("\0",512), 'The viewer must preserve suspicious actual bytes while marking them invalid for comparison.');
    memoryAssert($pdo->query('SELECT * FROM fingerprints ORDER BY fingerprint_id')->fetchAll() === $before, 'Sensor reads must never change fingerprint data, status, or mappings.');

    foreach ([512,768,1024,1536] as $bytes) {
        $queued = $queue(); $job = $claim(); $inventoryComplete($job);
        $sizedJob = $readTemplate($queued['job_id'],0);
        $data = str_repeat('AB',$bytes/2);
        $templateComplete($sizedJob,$data);
        $raw = $service->read([...$admin,'template_job_id'=>$sizedJob['job_id']])['template'];
        memoryAssert($raw['template_bytes'] === $bytes && base64_decode($raw['template_data_base64'],true) === $data, 'Every supported complete template length must round-trip exactly.');
    }

    $lastInventory = $service->read($admin)['inventory'];
    $failedJob = $readTemplate($lastInventory['job_id'],7);
    $failure = ['action'=>'fail','device_id'=>1,'job_id'=>$failedJob['job_id'],'claim_token'=>$failedJob['claim_token'],'error_message'=>'Slot changed after inventory.'];
    memoryAssert($service->deviceUpdate($failure)['job']['status'] === 'failed', 'A failed template read must close only that job.');
    memoryAssert($service->deviceUpdate($failure)['job']['status'] === 'failed', 'A repeated exact failure must be idempotent.');
    memoryReject(fn() => $templateComplete($failedJob,$template));
    memoryAssert($service->read($admin)['inventory'] === $lastInventory, 'Template read failures must preserve the last complete inventory.');
    $cancel = $queue();
    $cancelled = $service->adminAction([...$admin,'action'=>'cancel','job_id'=>$cancel['job_id']])['job'];
    memoryAssert($cancelled['status'] === 'cancelled' && $claim() === null, 'A cancelled pending read must never reach the sensor.');
    $queue(); $cancelledClaim = $claim();
    $service->adminAction([...$admin,'action'=>'cancel','job_id'=>$cancelledClaim['job_id']]);
    $new = $queue();
    memoryReject(fn() => $inventoryComplete($cancelledClaim));
    memoryAssert($service->read($admin)['active_job']['job_id'] === $new['job_id'], 'A delayed cancelled-job callback must not touch a later attempt.');
    $service->adminAction([...$admin,'action'=>'cancel','job_id'=>$new['job_id']]);

    $pending = $queue();
    $pdo->exec("UPDATE sensor_memory_jobs SET queued_at=DATE_SUB(NOW(),INTERVAL 179 SECOND) WHERE id=".$pending['job_id']);
    memoryAssert($service->read([...$admin,'job_id'=>$pending['job_id']])['job']['status'] === 'pending', 'Pickup must remain available at 2:59.');
    $pdo->exec("UPDATE sensor_memory_jobs SET queued_at=DATE_SUB(NOW(),INTERVAL 180 SECOND) WHERE id=".$pending['job_id']);
    memoryAssert($claim() === null && $service->read([...$admin,'job_id'=>$pending['job_id']])['job']['status'] === 'cancelled', 'Pickup must expire at exactly three minutes even without admin polling.');
    $queue(); $leased = $claim();
    $pdo->exec("UPDATE sensor_memory_jobs SET processing_at=DATE_SUB(NOW(),INTERVAL 179 SECOND) WHERE id=".$leased['job_id']);
    memoryAssert(SensorMemorySchema::hasProcessingForDevice($pdo,1) && $service->read([...$admin,'job_id'=>$leased['job_id']])['job']['status'] === 'processing', 'A processing lease must remain reserved through 2:59.');
    $pdo->exec("UPDATE sensor_memory_jobs SET processing_at=DATE_SUB(NOW(),INTERVAL 180 SECOND) WHERE id=".$leased['job_id']);
    memoryAssert(!SensorMemorySchema::hasProcessingForDevice($pdo,1), 'Physical reservations must release at exactly three minutes before persistence.');
    memoryReject(fn() => $inventoryComplete($leased));
    memoryAssert($service->read([...$admin,'job_id'=>$leased['job_id']])['job']['status'] === 'failed' && $service->read($admin)['inventory'] === $lastInventory, 'Late processing results must not replace the previous inventory.');

    $queue(); $atomic = $claim();
    $pdo->exec('ALTER TABLE sensor_memory_inventories ADD CONSTRAINT fixture_sensor_count CHECK (job_id <> '.$atomic['job_id'].')');
    try { $inventoryComplete($atomic); throw new RuntimeException('An inventory completed without its snapshot.'); }
    catch (PDOException $expected) {
        memoryAssert(!$pdo->inTransaction() && $service->read([...$admin,'job_id'=>$atomic['job_id']])['job']['status'] === 'processing'
            && $service->read($admin)['inventory'] === $lastInventory, 'A failed snapshot write must roll back job completion and preserve the last inventory.');
    }
    $pdo->exec('ALTER TABLE sensor_memory_inventories DROP CONSTRAINT fixture_sensor_count');
    $inventoryComplete($atomic,['template_count'=>0,'occupied_slots'=>[]]);
    $empty = $service->read($admin);
    memoryAssert($empty['inventory']['template_count'] === 0 && $empty['inventory']['occupied_slots'] === [] && $rows($empty)[9]['mapping_status'] === 'database_only', 'Only a valid actual zero-count report may describe an empty sensor.');

    // Extend only the temporary shadows to exercise the real enrollment/import
    // entry points and their shared physical-device guard, in both directions.
    $reset();
    $pdo->exec("ALTER TABLE users ADD email VARCHAR(100) DEFAULT 'fixture@example.invalid',ADD must_change_password INT DEFAULT 0,ADD onboarding_step VARCHAR(20) DEFAULT 'done'");
    $pdo->exec("ALTER TABLE fingerprints ADD shared_door_slot INT NULL,ADD enrolled_at DATETIME NULL,ADD door_sync_status VARCHAR(20) DEFAULT 'pending',ADD door_synced_at DATETIME NULL");
    $pdo->exec("ALTER TABLE fingerprint_enrollment_jobs ADD user_id INT,ADD fingerprint_id INT NULL,ADD finger_name VARCHAR(50),ADD progress INT DEFAULT 0,ADD current_step VARCHAR(150),ADD assigned_slot INT NULL,ADD error_message TEXT NULL,ADD started_at DATETIME NULL,ADD finished_at DATETIME NULL,ADD created_at DATETIME DEFAULT CURRENT_TIMESTAMP,ADD updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
    $pdo->exec("ALTER TABLE direct_fingerprint_import_jobs ADD actor_id INT,ADD user_id INT,ADD fingerprint_id INT,ADD target_slot INT,ADD employee_id VARCHAR(100),ADD user_name VARCHAR(255),ADD finger_name VARCHAR(50),ADD template_data BLOB,ADD template_hash CHAR(64),ADD source_enrolled_at DATETIME NULL,ADD source_device_id INT NULL,ADD source_slot INT NULL,ADD progress INT DEFAULT 0,ADD current_step VARCHAR(150) DEFAULT 'Waiting for Sensor A',ADD error_message TEXT NULL,ADD finished_at DATETIME NULL,ADD updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,ADD active_device_key INT NULL UNIQUE,ADD active_fingerprint_key INT NULL UNIQUE");
    $pdo->exec("ALTER TABLE direct_fingerprint_import_jobs MODIFY status VARCHAR(20) DEFAULT 'pending',MODIFY queued_at DATETIME DEFAULT CURRENT_TIMESTAMP");
    $pdo->exec("INSERT INTO user_privileges VALUES (9,'fingerprint_update')");
    $enrollment = new FingerprintEnrollmentJob();
    $imports = new DirectFingerprintImportService($pdo,false);
    $importRequest = ['actor_id'=>9,'employee_id'=>'00123','fingerprint_id'=>2,'enrollment_device_id'=>1];
    $otherImportRequest = ['actor_id'=>9,'employee_id'=>'00456','fingerprint_id'=>5,'enrollment_device_id'=>2];
    $clearWork = static function () use ($pdo): void {
        $pdo->exec('DELETE FROM sensor_memory_jobs');
        $pdo->exec('DELETE FROM sensor_memory_inventories');
        $pdo->exec('DELETE FROM sensor_memory_templates');
        $pdo->exec('DELETE FROM fingerprint_enrollment_jobs');
        $pdo->exec('DELETE FROM direct_fingerprint_import_jobs');
    };
    $queue(); $processingRead = $claim();
    try { $enrollment->createJob(1,'Fixture finger',1); throw new RuntimeException('Enrollment creation overlapped a processing sensor memory read.'); }
    catch (DirectFingerprintSensorBusyException $expected) { memoryAssert(!$pdo->inTransaction(),'A rejected enrollment must release its transaction.'); }
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs (user_id,finger_name,enrollment_device_id,status,assigned_slot) VALUES (1,'Fixture waiting',1,'waiting',12)");
    $waitingId = (int)$pdo->lastInsertId();
    memoryAssert(!$enrollment->claimJob($waitingId,1), 'A waiting enrollment must not claim a sensor being read.');
    $pdo->exec("UPDATE fingerprint_enrollment_jobs SET status='processing',progress=5 WHERE job_id=".$waitingId);
    try { $enrollment->reserveEmptySlot($waitingId,1,12,1000,[0,12]); throw new RuntimeException('Enrollment slot reservation overlapped a processing sensor memory read.'); }
    catch (FingerprintSlotReservationException $expected) { memoryAssert(str_contains($expected->getMessage(),'reading its memory') && !$pdo->inTransaction(),'The slot-reservation guard must reject because of the memory owner.'); }
    $pdo->exec('DELETE FROM fingerprint_enrollment_jobs');
    try { $imports->queue($importRequest); throw new RuntimeException('A database restore was queued on a sensor being read.'); }
    catch (DirectFingerprintImportException $expected) { memoryAssert($expected->httpStatus === 409 && str_contains($expected->getMessage(),'reading its memory'),'The import queue must reject the memory owner.'); }
    $deferredImport = $imports->claim(['enrollment_device_id'=>1]);
    memoryAssert(!$deferredImport['success'] && str_contains($deferredImport['message'],'reading its memory'), 'The import claim path must defer to a processing read.');
    $otherEnrollment = (int)$enrollment->createJob(2,'Other sensor fixture',2);
    memoryAssert($enrollment->claimJob($otherEnrollment,2), 'A processing read must not block enrollment on another physical sensor.');
    $otherSlot = (int)$enrollment->getJobById($otherEnrollment)['assigned_slot'];
    memoryAssert($enrollment->reserveEmptySlot($otherEnrollment,2,$otherSlot,1000,[0,$otherSlot]) > 0, 'Another sensor may reserve its empty enrollment slot.');
    $pdo->exec('DELETE FROM fingerprint_enrollment_jobs');
    $otherImport = $imports->queue($otherImportRequest)['job'];
    memoryAssert($imports->claim(['enrollment_device_id'=>2])['job']['status'] === 'processing', 'A processing read must not block a restore on another physical sensor.');
    $imports->cancel(['actor_id'=>9,'job_id'=>$otherImport['job_id']]);
    $inventoryComplete($processingRead);
    $postReadEnrollment = (int)$enrollment->createJob(1,'After read fixture',1);
    memoryAssert($enrollment->claimJob($postReadEnrollment,1), 'A completed read must release enrollment creation and claim.');
    $pdo->exec('DELETE FROM fingerprint_enrollment_jobs');
    $postReadImport = $imports->queue($importRequest)['job'];
    memoryAssert($imports->claim(['enrollment_device_id'=>1])['job']['status'] === 'processing', 'A completed read must release restore queue and claim.');
    $imports->cancel(['actor_id'=>9,'job_id'=>$postReadImport['job_id']]);

    foreach (['pending','expired'] as $memoryState) {
        $clearWork();
        $queue();
        if ($memoryState === 'expired') {
            $claim();
            $pdo->exec("UPDATE sensor_memory_jobs SET processing_at=DATE_SUB(NOW(),INTERVAL 3 MINUTE)");
        }
        $allowedEnrollment = (int)$enrollment->createJob(1,'Unblocked fixture',1);
        memoryAssert($enrollment->claimJob($allowedEnrollment,1), 'Pending or expired memory reads must not block enrollment create/claim.');
        $allowedSlot = (int)$enrollment->getJobById($allowedEnrollment)['assigned_slot'];
        memoryAssert($enrollment->reserveEmptySlot($allowedEnrollment,1,$allowedSlot,1000,[0,$allowedSlot]) > 0, 'Pending or expired memory reads must not block enrollment slot reservation.');
        $pdo->exec('DELETE FROM fingerprint_enrollment_jobs');
        $allowedImport = $imports->queue($importRequest)['job'];
        memoryAssert($imports->claim(['enrollment_device_id'=>1])['job']['status'] === 'processing', 'Pending or expired memory reads must not block restore queue/claim.');
        $imports->cancel(['actor_id'=>9,'job_id'=>$allowedImport['job_id']]);
    }

    $clearWork();
    $pdo->exec('DELETE FROM sensor_memory_jobs');
    $erase = $service->adminAction([...$admin, 'action' => 'empty_sensor']);
    memoryAssert($erase['job']['kind'] === 'empty' && $erase['job']['status'] === 'pending', 'Erase must queue a dedicated empty-library job.');
    memoryAssert(SensorMemorySchema::hasProcessingForDevice($pdo, 1), 'A queued sensor erase must reserve the sensor so enrollment cannot start.');
    try {
        $enrollment->createJob(1, 'During erase', 1);
        throw new RuntimeException('Enrollment was created while a sensor erase was queued.');
    } catch (DirectFingerprintSensorBusyException $error) {
        memoryAssert(str_contains($error->getMessage(), 'memory'), 'Enrollment must explain that sensor erase is occupying the sensor.');
    }
    $eraseClaim = $claim();
    memoryAssert($eraseClaim['kind'] === 'empty' && strlen($eraseClaim['claim_token']) === 64, 'The controller must claim the erase job with its own token.');
    memoryReject(fn() => $inventoryComplete($eraseClaim, ['template_count' => 1, 'occupied_slots' => [2], 'capacity' => 1000]), 422);
    $erased = $inventoryComplete($eraseClaim, ['template_count' => 0, 'occupied_slots' => [], 'capacity' => 1000]);
    memoryAssert($erased['job']['status'] === 'completed', 'A proven empty sensor must complete the erase.');
    $afterErase = $service->read($admin);
    memoryAssert($afterErase['inventory']['template_count'] === 0 && $afterErase['inventory']['occupied_slots'] === [], 'The saved reading after erase must show no fingerprint templates or slot IDs.');

    echo "PASS: protected administrator reads/actions, device tokens and claim leases, actual slot 0 and unknown slots, atomic inventories, count/bitmap validation, conflict and missing mappings, real binary comparisons and exports, supported and suspicious actual template bytes, isolated cancellation/retries, idempotent reports, three-minute expiry, unchanged fingerprint data, real enrollment/create/claim/reservation plus import/queue/claim interlocks with pending, expired, completed, and other-device reads, and password-gated full R307S template erasure.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    $pdo->exec('SET timestamp=0');
    foreach ($tables as $table) $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
}
