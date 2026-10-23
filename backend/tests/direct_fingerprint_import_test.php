<?php

require_once dirname(__DIR__) . '/services/DirectFingerprintImportService.php';
require_once dirname(__DIR__) . '/models/FingerprintEnrollmentJob.php';
require_once dirname(__DIR__) . '/services/DirectFingerprintAccessService.php';

function assertImport(bool $condition,string $message): void { if(!$condition)throw new RuntimeException($message); }
function rejectImport(callable $work,int $status=409): void {
    try { $work(); } catch(DirectFingerprintImportException $error) { assertImport($error->httpStatus===$status,'Unexpected rejection status: '.$error->getMessage());return; }
    throw new RuntimeException('An unsafe or invalid database import was accepted.');
}

$pdo=entrivo_pdo();
$tables=['direct_fingerprint_import_jobs','users','user_privileges','faculty_info','staff_info','admin_info','fingerprint_devices','fingerprints','fingerprint_enrollment_jobs','schedules','access_overrides','access_log'];
$template=str_repeat("\x43\x44",256);
$hash=hash('sha256',$template);
$now=new DateTimeImmutable('2026-10-21 10:00:00',new DateTimeZone('Asia/Manila'));
try {
    // Temporary shadows are created before fixtures or services run. No real user,
    // policy, fingerprint, import queue, access log, or schema is modified.
    $pdo->exec("CREATE TEMPORARY TABLE direct_fingerprint_import_jobs (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,actor_id INT,user_id INT,fingerprint_id INT,
        enrollment_device_id INT,target_slot INT,employee_id VARCHAR(100),user_name VARCHAR(255),finger_name VARCHAR(50),
        template_data LONGBLOB,template_hash CHAR(64),source_enrolled_at DATETIME NULL,source_device_id INT NULL,source_slot INT NULL,
        status ENUM('pending','processing','completed','failed','cancelled') DEFAULT 'pending',progress INT DEFAULT 0,
        current_step VARCHAR(150) DEFAULT 'Waiting for Sensor A',error_message TEXT NULL,
        queued_at DATETIME DEFAULT CURRENT_TIMESTAMP,processing_at DATETIME NULL,finished_at DATETIME NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        active_device_key INT NULL UNIQUE,active_fingerprint_key INT NULL UNIQUE) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE users (id INT PRIMARY KEY,username VARCHAR(50),email VARCHAR(100),role VARCHAR(20),is_active INT,approval_status VARCHAR(20),must_change_password INT,onboarding_step VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE user_privileges (user_id INT,privilege_key VARCHAR(50)) ENGINE=InnoDB');
    foreach(['faculty_info','staff_info','admin_info'] as $profile) $pdo->exec("CREATE TEMPORARY TABLE {$profile} (user_id INT,employee_id VARCHAR(100),first_name VARCHAR(50),middle_name VARCHAR(50),last_name VARCHAR(50),extension_name VARCHAR(20),office_department VARCHAR(50),work_position VARCHAR(50),users_photo TEXT) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY,device_type VARCHAR(20),status VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec("CREATE TEMPORARY TABLE fingerprints (fingerprint_id INT PRIMARY KEY,user_id INT,finger_name VARCHAR(50),enrollment_device_id INT NULL,enrollment_slot INT NULL,shared_door_slot INT NULL,template_data LONGBLOB,template_hash VARCHAR(64),status VARCHAR(20),door_sync_status VARCHAR(20),door_synced_at DATETIME NULL,enrolled_at DATETIME NULL) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_enrollment_jobs (job_id INT PRIMARY KEY AUTO_INCREMENT,user_id INT,fingerprint_id INT NULL,finger_name VARCHAR(50),enrollment_device_id INT NULL,status VARCHAR(20),progress INT DEFAULT 0,current_step VARCHAR(150),assigned_slot INT NULL,error_message TEXT NULL,started_at DATETIME NULL,finished_at DATETIME NULL,created_at DATETIME DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE schedules (schedule_id INT PRIMARY KEY,user_id INT,schedule_type VARCHAR(20),schedule_kind VARCHAR(20),schedule_date DATE,time_start TIME,time_end TIME) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE access_overrides (override_id INT PRIMARY KEY,user_id INT,approved_by INT,override_start DATETIME,override_end DATETIME) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE access_log (log_id INT PRIMARY KEY AUTO_INCREMENT,user_id INT NULL,fingerprint_id INT NULL,schedule_id INT NULL,override_id INT NULL,access_timestamp DATETIME,access_status VARCHAR(20),denial_reason VARCHAR(50) NULL,method_access VARCHAR(20)) ENGINE=InnoDB');
    $pdo->exec('ALTER TABLE schedules ADD COLUMN status VARCHAR(20)');
    $pdo->exec('SET timestamp='.$now->getTimestamp());
    $reset=static function() use($pdo,$tables,$template,$hash): void {
        foreach($tables as $table)$pdo->exec('DELETE FROM '.$table);
        $pdo->exec("INSERT INTO users VALUES (1,'employee.one','one@example.invalid','faculty',1,'approved',0,'done'),(2,'employee.two','two@example.invalid','staff',1,'approved',0,'done'),(9,'fixture.admin','admin@example.invalid','super_admin',1,'approved',0,'done')");
        $pdo->exec("INSERT INTO user_privileges VALUES (9,'fingerprint'),(9,'fingerprint_update')");
        $pdo->exec("INSERT INTO faculty_info VALUES (1,'00123','First','','Employee','','Office','Faculty',NULL)");
        $pdo->exec("INSERT INTO staff_info VALUES (2,'00456','Other','','Employee','','Office','Staff',NULL)");
        $pdo->exec("INSERT INTO fingerprint_devices VALUES (1,'enrollment','active'),(2,'enrollment','active')");
        $insert=$pdo->prepare("INSERT INTO fingerprints VALUES (?,?,?,?,?,?,?,?,'active','synced','2026-10-20 09:00:00',?)");
        $insert->execute([1,1,'Right thumb',1,7,7,$template,$hash,'2026-10-20 09:00:00']);
        $insert->execute([2,1,'Left thumb',null,null,11,$template,$hash,null]);
        $insert->execute([3,2,'Right index',1,9,9,$template,$hash,'2026-10-20 09:00:00']);
        $pdo->exec("INSERT INTO fingerprint_enrollment_jobs (user_id,fingerprint_id,finger_name,enrollment_device_id,status,progress,current_step,assigned_slot,finished_at) VALUES (1,1,'Right thumb',1,'completed',100,'Enrollment completed',7,'2026-10-20 09:00:00')");
        $pdo->exec("INSERT INTO schedules VALUES (1,1,'single','regular','2026-10-21','09:00:00','11:00:00','approved')");
    };
    $service=new DirectFingerprintImportService($pdo,false);
    $request=['actor_id'=>9,'employee_id'=>'00123','fingerprint_id'=>1,'enrollment_device_id'=>1];
    $complete=static fn(int $jobId,int $slot)=>$service->deviceUpdate(['action'=>'complete','job_id'=>$jobId,'enrollment_device_id'=>1,'stored_slot'=>$slot,'template_hash'=>$hash]);
    $reset();
    $lookup=$service->lookup(['actor_id'=>9,'employee_id'=>' 00123 ']);
    assertImport($lookup['user']['employee_id']==='00123' && $lookup['user']['user_id']===1 && count($lookup['backups'])===2,'Exact employee lookup must preserve leading zeroes and list valid backups.');
    assertImport(!str_contains(json_encode($lookup),'template_data')&&!str_contains(json_encode($lookup),$hash),'The UI must never receive raw template bytes or hashes.');
    foreach ([512, 768, 1024, 1536] as $bytes) {
        foreach ([false, true] as $legacyBase64) {
            $reset();
            $completeTemplate = str_repeat('AB', $bytes / 2);
            $completeHash = hash('sha256', $completeTemplate);
            $pdo->prepare('UPDATE fingerprints SET template_data=?,template_hash=? WHERE fingerprint_id=1')
                ->execute([$legacyBase64 ? base64_encode($completeTemplate) : $completeTemplate, $completeHash]);
            $review = $service->lookup(['actor_id'=>9,'employee_id'=>'00123']);
            assertImport($review['backups'][0]['template_bytes'] === $bytes, 'Backup review must report the complete decoded size.');
            $sizedJob = $service->queue($request)['job'];
            $payload = $service->claim(['enrollment_device_id'=>1])['job'];
            assertImport($payload['template_bytes'] === $bytes && base64_decode($payload['template_data_base64'], true) === $completeTemplate,
                'Device claims must preserve every template byte and report its true size.');
            $result = $service->deviceUpdate(['action'=>'complete','job_id'=>$sizedJob['job_id'],'enrollment_device_id'=>1,
                'stored_slot'=>$sizedJob['target_slot'],'template_hash'=>$completeHash]);
            assertImport($result['job']['status'] === 'completed', 'Sensor-confirmed restores must support each complete template size.');
        }
        foreach (["\xFF", "\0", 'A'] as $value) {
            $uniform = str_repeat($value, $bytes);
            foreach ([$uniform, base64_encode($uniform)] as $storedTemplate) {
                $reset();
                $pdo->prepare('UPDATE fingerprints SET template_data=?,template_hash=? WHERE fingerprint_id=1')
                    ->execute([$storedTemplate, hash('sha256', $uniform)]);
                $before = $pdo->query('SELECT * FROM fingerprints WHERE fingerprint_id=1')->fetch();
                $review = $service->lookup(['actor_id'=>9,'employee_id'=>'00123']);
                assertImport(!in_array(1, array_column($review['backups'], 'fingerprint_id'), true),
                    'Uniform backups must not be offered for restore, even when their hash matches.');
                rejectImport(fn()=>$service->queue($request),422);
                assertImport((int)$pdo->query('SELECT COUNT(*) FROM direct_fingerprint_import_jobs')->fetchColumn() === 0
                    && $pdo->query('SELECT * FROM fingerprints WHERE fingerprint_id=1')->fetch() === $before,
                    'Rejected uniform backups must not create jobs or change stored fingerprint mappings.');
            }
        }
    }
    $reset();
    rejectImport(fn()=>$service->lookup(['actor_id'=>9,'employee_id'=>123]),422);
    rejectImport(fn()=>$service->lookup(['actor_id'=>9,'employee_id'=>'123']),404);
    $pdo->exec("INSERT INTO admin_info VALUES (2,'00123','Duplicate','','Employee','','Office','Admin',NULL)");
    rejectImport(fn()=>$service->lookup(['actor_id'=>9,'employee_id'=>'00123']));
    $pdo->exec('DELETE FROM admin_info');
    $pdo->exec('UPDATE users SET is_active=0 WHERE id=1');
    assertImport($service->lookup(['actor_id'=>9,'employee_id'=>'00123'])['backups'][0]['can_import']===false,'Inactive owners must remain reviewable without import permission.');
    rejectImport(fn()=>$service->queue($request),403);
    $pdo->exec('UPDATE users SET is_active=1 WHERE id=1');
    rejectImport(fn()=>$service->queue([...$request,'fingerprint_id'=>3]),403);
    $pdo->exec("UPDATE fingerprints SET template_data='invalid' WHERE user_id=1");
    assertImport($service->lookup(['actor_id'=>9,'employee_id'=>'00123'])['backups']===[],'Invalid or missing backups must never be offered as restorable.');
    rejectImport(fn()=>$service->queue($request),422);

    $reset();
    $pdo->exec('DELETE FROM user_privileges');
    assertImport($service->lookup(['actor_id'=>9,'employee_id'=>'00123'])['success'],'Default-role privileges must match the existing module when no explicit rows exist.');
    $pdo->exec("INSERT INTO user_privileges VALUES (9,'fingerprint')");
    rejectImport(fn()=>$service->queue($request),403);
    $pdo->exec("INSERT INTO user_privileges VALUES (9,'fingerprint_update')");
    $queued=$service->queue($request)['job'];
    assertImport($queued['target_slot']===7 && $queued['status']==='pending','An existing uniquely owned local slot must be reused to avoid duplicate templates.');
    assertImport($service->queue($request)['job']['job_id']===$queued['job_id'],'Repeated queue requests must return the same active restore.');
    rejectImport(fn()=>$service->queue([...$request,'fingerprint_id'=>2]));
    rejectImport(fn()=>$complete($queued['job_id'],7));
    $claim=$service->claim(['enrollment_device_id'=>1])['job'];
    assertImport($claim['job_id']===$queued['job_id'] && $claim['status']==='processing' && base64_decode($claim['template_data_base64'],true)===$template && $claim['template_hash']===$hash,'Only the sensor claim receives the verified binary snapshot.');
    assertImport($service->claim(['enrollment_device_id'=>1])['job']['job_id']===$queued['job_id'],'A reboot must resume the same processing job and target.');
    $model=new FingerprintEnrollmentJob();
    try {$model->createJob(2,'New finger',1,null);throw new RuntimeException('Enrollment creation raced an active import.');}
    catch(DirectFingerprintSensorBusyException $expected){assertImport(!$pdo->inTransaction(),'A rejected enrollment must release the device transaction.');}
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs (user_id,finger_name,enrollment_device_id,status,progress,current_step) VALUES (2,'Concurrent finger',1,'waiting',0,'Fixture')");
    $waiting=(int)$pdo->lastInsertId();
    assertImport(!$model->claimJob($waiting,1),'An existing waiting enrollment must not claim while an import owns the sensor.');
    $pdo->exec('DELETE FROM fingerprint_enrollment_jobs WHERE job_id='.$waiting);
    rejectImport(fn()=>$complete($queued['job_id'],8));
    rejectImport(fn()=>$service->deviceUpdate(['action'=>'complete','job_id'=>$queued['job_id'],'enrollment_device_id'=>1,'stored_slot'=>7,'template_hash'=>str_repeat('0',64)]));
    $before=$pdo->query('SELECT * FROM fingerprints WHERE fingerprint_id=1')->fetch();
    $done=$complete($queued['job_id'],7)['job'];
    assertImport($done['status']==='completed' && $done['progress']===100,'Only sensor readback confirmation may complete a restore.');
    $proofs=(int)$pdo->query('SELECT COUNT(*) FROM fingerprint_enrollment_jobs')->fetchColumn();
    assertImport($complete($queued['job_id'],7)['job']['status']==='completed'&&(int)$pdo->query('SELECT COUNT(*) FROM fingerprint_enrollment_jobs')->fetchColumn()===$proofs,'A lost completion reply must be idempotent without duplicate proof records.');
    $after=$pdo->query('SELECT * FROM fingerprints WHERE fingerprint_id=1')->fetch();
    foreach(['shared_door_slot','door_sync_status','door_synced_at','enrolled_at','template_data','template_hash'] as $field)assertImport($before[$field]===$after[$field],'A direct restore must preserve original '.$field.'.');
    assertImport((new DirectFingerprintAccessService($pdo))->verify(['enrollment_device_id'=>1,'matched_slot'=>7],$now)['access_granted'],'A physically confirmed restore must be compatible with direct access proof.');

    $reset();
    $new=$service->queue([...$request,'fingerprint_id'=>2])['job'];
    assertImport($new['target_slot']===12,'A backup without a local mapping must reserve a fresh slot beyond all mapped/reserved slots.');
    assertImport($pdo->query('SELECT enrollment_slot FROM fingerprints WHERE fingerprint_id=2')->fetchColumn()===null,'Queueing alone must not pretend the template exists on the sensor.');
    $service->claim(['enrollment_device_id'=>1]);
    $service->deviceUpdate(['action'=>'fail','job_id'=>$new['job_id'],'enrollment_device_id'=>1,'error_message'=>'Target occupied by a different template.']);
    assertImport($pdo->query('SELECT enrollment_slot FROM fingerprints WHERE fingerprint_id=2')->fetchColumn()===null,'An occupied-slot failure must preserve the original mapping.');
    $retried=$service->queue([...$request,'fingerprint_id'=>2])['job'];
    assertImport($retried['job_id']===$new['job_id']&&$retried['target_slot']===$new['target_slot'],'Unchanged-backup retries must reuse both job and target to avoid physical duplicates.');
    assertImport($model->getNextAvailableSlot()===13,'Normal enrollment allocation must honor import reservations including uncertain failed writes.');
    $service->claim(['enrollment_device_id'=>1]);
    $complete($new['job_id'],12);
    $legacy=$pdo->query('SELECT enrolled_at,enrollment_slot,shared_door_slot,door_sync_status FROM fingerprints WHERE fingerprint_id=2')->fetch();
    assertImport($legacy['enrolled_at']==='2026-10-21 10:00:00'&&(int)$legacy['enrollment_slot']===12&&(int)$legacy['shared_door_slot']===11&&$legacy['door_sync_status']==='synced','Verified legacy imports must fill only a missing local enrollment date and preserve Sensor B metadata.');
    assertImport((new DirectFingerprintAccessService($pdo))->verify(['enrollment_device_id'=>1,'matched_slot'=>12],$now)['access_granted'],'A verified legacy backup with missing capture date must become usable under its approved policy.');

    $reset();
    $job=$service->queue([...$request,'fingerprint_id'=>2])['job'];
    rejectImport(fn()=>$service->cancel(['actor_id'=>1,'job_id'=>$job['job_id']]),403);
    $pdo->exec("DELETE FROM user_privileges WHERE user_id=9 AND privilege_key='fingerprint_update'");
    rejectImport(fn()=>$service->cancel(['actor_id'=>9,'job_id'=>$job['job_id']]),403);
    assertImport($service->getAdminJob(['actor_id'=>9,'job_id'=>$job['job_id']])['job']['status']==='pending','Read-only administrators must not cancel imports.');
    $pdo->exec("INSERT INTO user_privileges VALUES (9,'fingerprint_update')");
    rejectImport(fn()=>$service->cancel(['actor_id'=>9,'job_id'=>0]),422);
    rejectImport(fn()=>$service->cancel(['actor_id'=>9,'job_id'=>PHP_INT_MAX]),404);
    $pdo->exec("UPDATE fingerprint_devices SET status='inactive' WHERE device_id=1");
    $cancelled=$service->cancel(['actor_id'=>9,'job_id'=>$job['job_id']])['job'];
    assertImport($cancelled['status']==='cancelled'&&$cancelled['current_step']==='Import cancelled by administrator'&&str_contains($cancelled['error_message'],'administrator')&&$cancelled['finished_at']===$now->format('Y-m-d H:i:s'),'An authorized administrator must be able to cancel a waiting import even if Sensor A is disconnected or inactive.');
    $cancelRecord=$pdo->query('SELECT active_device_key,active_fingerprint_key FROM direct_fingerprint_import_jobs WHERE id='.$job['job_id'])->fetch();
    assertImport($cancelRecord['active_device_key']===null&&$cancelRecord['active_fingerprint_key']===null,'Manual cancellation must release both active reservations.');
    assertImport($service->cancel(['actor_id'=>9,'job_id'=>$job['job_id']])['job']===$cancelled,'Repeated cancellation must preserve the original cancelled result.');
    $pdo->exec("UPDATE fingerprint_devices SET status='active' WHERE device_id=1");
    assertImport($service->claim(['enrollment_device_id'=>1])['success']===false,'A manually cancelled waiting job must never be claimed.');

    $reset();
    $job=$service->queue([...$request,'fingerprint_id'=>2])['job'];
    $service->claim(['enrollment_device_id'=>1]);
    $writing=$service->deviceUpdate(['action'=>'progress','job_id'=>$job['job_id'],'enrollment_device_id'=>1,'progress'=>45,'current_step'=>'Writing template'])['job'];
    $before=$pdo->query('SELECT * FROM fingerprints WHERE fingerprint_id=2')->fetch();
    $cancelled=$service->cancel(['actor_id'=>9,'job_id'=>$job['job_id']])['job'];
    assertImport($cancelled['status']==='cancelled'&&$cancelled['progress']===$writing['progress'],'A processing import must be cancellable without pretending the sensor was erased.');
    assertImport($pdo->query('SELECT * FROM fingerprints WHERE fingerprint_id=2')->fetch()===$before&&(int)$pdo->query('SELECT COUNT(*) FROM fingerprint_enrollment_jobs')->fetchColumn()===1,'Cancellation must preserve fingerprint backup/mappings and create no completion proof.');
    $retry=$service->queue([...$request,'fingerprint_id'=>2])['job'];
    assertImport($retry['job_id']!==$job['job_id']&&$retry['target_slot']===$job['target_slot']&&$retry['status']==='pending','Retrying a manually cancelled import must use a new attempt ID while reusing the reserved physical slot.');
    rejectImport(fn()=>$complete($job['job_id'],$job['target_slot']));
    assertImport($service->cancel(['actor_id'=>9,'job_id'=>$job['job_id']])['job']===$cancelled,'A delayed cancellation must keep referring to the old attempt.');
    $service->claim(['enrollment_device_id'=>1]);
    foreach(['complete','fail','progress'] as $lateAction) {
        rejectImport(fn()=>$service->deviceUpdate(['action'=>$lateAction,'job_id'=>$job['job_id'],'enrollment_device_id'=>1,'stored_slot'=>$job['target_slot'],'template_hash'=>$hash,'progress'=>95,'current_step'=>'Late result','error_message'=>'Late failure']));
    }
    $retryStatus=$service->getAdminJob(['actor_id'=>9,'job_id'=>$retry['job_id']])['job'];
    assertImport($retryStatus['status']==='processing'&&$retryStatus['progress']===5,'Late callbacks from a cancelled attempt must not complete, fail, or advance the retry.');
    $done=$complete($retry['job_id'],$retry['target_slot'])['job'];
    $terminal=$service->cancel(['actor_id'=>9,'job_id'=>$retry['job_id']]);
    assertImport($terminal['job']===$done&&str_contains($terminal['message'],'completed before'),'A completion that wins the cancellation race must remain completed with a truthful response.');
    assertImport($service->getAdminJob(['actor_id'=>9,'job_id'=>$job['job_id']])['job']===$cancelled,'The original manually cancelled attempt must stay closed after a successful retry.');

    $reset();
    $job=$service->queue($request)['job'];
    $service->claim(['enrollment_device_id'=>1]);
    $failed=$service->deviceUpdate(['action'=>'fail','job_id'=>$job['job_id'],'enrollment_device_id'=>1,'error_message'=>'Sensor write failed.'])['job'];
    $terminal=$service->cancel(['actor_id'=>9,'job_id'=>$job['job_id']]);
    assertImport($terminal['job']===$failed&&str_contains($terminal['message'],'already failed'),'Cancellation must preserve a previously failed import and its original reason.');

    $reset();
    $job=$service->queue($request)['job'];
    $pdo->exec('UPDATE direct_fingerprint_import_jobs SET queued_at=DATE_SUB(NOW(),INTERVAL 179 SECOND)');
    assertImport($service->getAdminJob(['actor_id'=>9,'job_id'=>$job['job_id']])['job']['status']==='pending','A 2:59 pickup wait must remain queued.');
    assertImport(DirectFingerprintImportSchema::hasActiveForDevice($pdo,1)&&DirectFingerprintImportSchema::hasActiveForUserOrSlot($pdo,1,1,7),'A pending import must retain its reservations through 2:59.');
    $pdo->exec('UPDATE direct_fingerprint_import_jobs SET queued_at=DATE_SUB(NOW(),INTERVAL 180 SECOND)');
    assertImport(!DirectFingerprintImportSchema::hasActiveForDevice($pdo,1)&&!DirectFingerprintImportSchema::hasActiveForUserOrSlot($pdo,1,1,7),'Reservation checks must exclude pending imports at exactly three minutes even before expiry is persisted.');
    $expired=$service->getAdminJob(['actor_id'=>9,'job_id'=>$job['job_id']])['job'];
    assertImport($expired['status']==='cancelled'&&str_contains($expired['error_message'],'did not pick up')&&str_contains($expired['error_message'],'3 minutes'),'A three-minute pickup expiry must explain no pickup.');
    $expiredRecord=$pdo->query('SELECT finished_at,active_device_key,active_fingerprint_key FROM direct_fingerprint_import_jobs WHERE id='.$job['job_id'])->fetch();
    assertImport($expiredRecord['finished_at']===$now->format('Y-m-d H:i:s')&&$expiredRecord['active_device_key']===null&&$expiredRecord['active_fingerprint_key']===null,'Pickup expiry must record its finish time and release both active reservations.');
    assertImport($service->claim(['enrollment_device_id'=>1])['success']===false,'An expired queued restore must never be given to hardware.');
    $retried=$service->queue($request)['job'];
    assertImport($retried['job_id']===$job['job_id']&&$retried['target_slot']===$job['target_slot']&&$retried['status']==='pending'&&$retried['queued_at']===$now->format('Y-m-d H:i:s')&&$retried['finished_at']===null&&$retried['error_message']===null,'Retrying a timed-out restore must reuse its job and slot with a fresh three-minute pickup wait.');
    $pdo->exec('UPDATE direct_fingerprint_import_jobs SET queued_at=DATE_SUB(NOW(),INTERVAL 179 SECOND)');
    assertImport($service->getAdminJob(['actor_id'=>9,'job_id'=>$job['job_id']])['job']['status']==='pending','A retried import must retain its full three-minute pickup window.');
    $service->claim(['enrollment_device_id'=>1]);
    $pdo->exec('UPDATE direct_fingerprint_import_jobs SET processing_at=DATE_SUB(NOW(),INTERVAL 179 SECOND)');
    assertImport($service->getAdminJob(['actor_id'=>9,'job_id'=>$job['job_id']])['job']['status']==='processing'&&DirectFingerprintImportSchema::hasActiveForDevice($pdo,1),'A claimed import must retain its separate processing lease through 2:59.');
    $pdo->exec('UPDATE direct_fingerprint_import_jobs SET processing_at=DATE_SUB(NOW(),INTERVAL 180 SECOND)');
    assertImport(!DirectFingerprintImportSchema::hasActiveForDevice($pdo,1)&&!DirectFingerprintImportSchema::hasActiveForUserOrSlot($pdo,1,1,7),'Reservation checks must exclude processing imports at exactly three minutes.');
    rejectImport(fn()=>$complete($job['job_id'],7));
    assertImport($service->getAdminJob(['actor_id'=>9,'job_id'=>$job['job_id']])['job']['status']==='cancelled','Late processing completion must remain cancelled without changing mappings.');

    $reset();
    $job=$service->queue($request)['job'];
    $pdo->exec('UPDATE direct_fingerprint_import_jobs SET queued_at=DATE_SUB(NOW(),INTERVAL 180 SECOND)');
    $lateClaim=$service->claim(['enrollment_device_id'=>1]);
    assertImport($lateClaim['success']===false&&!isset($lateClaim['job']['template_data_base64']),'A device claim at three minutes must cancel an unpolled restore without exposing template bytes.');
    $expiredRecord=$pdo->query('SELECT status,finished_at,active_device_key,active_fingerprint_key FROM direct_fingerprint_import_jobs WHERE id='.$job['job_id'])->fetch();
    assertImport($expiredRecord['status']==='cancelled'&&$expiredRecord['finished_at']===$now->format('Y-m-d H:i:s')&&$expiredRecord['active_device_key']===null&&$expiredRecord['active_fingerprint_key']===null,'Device pickup must persist cancellation and release the sensor even without administrator polling.');

    $reset();
    $job=$service->queue($request)['job'];
    $pdo->exec("UPDATE fingerprints SET template_hash=REPEAT('0',64) WHERE fingerprint_id=1");
    $blocked=$service->claim(['enrollment_device_id'=>1]);
    assertImport($blocked['success']===false && $blocked['job']['status']==='failed' && str_contains($blocked['job']['error_message'],'changed') && !isset($blocked['job']['template_data_base64']),'An invalid snapshot must fail immediately with its actual reason and no hardware payload.');
    $reset();
    $job=$service->queue($request)['job'];
    $service->claim(['enrollment_device_id'=>1]);
    $pdo->exec("UPDATE fingerprints SET template_hash=REPEAT('0',64) WHERE fingerprint_id=1");
    rejectImport(fn()=>$complete($job['job_id'],7));
    assertImport((int)$pdo->query('SELECT COUNT(*) FROM fingerprint_enrollment_jobs')->fetchColumn()===1,'A changed backup must not create successful sensor proof.');
    $reset();
    $job=$service->queue($request)['job'];
    $service->claim(['enrollment_device_id'=>1]);
    $pdo->exec('UPDATE fingerprints SET enrollment_slot=7 WHERE fingerprint_id=3');
    rejectImport(fn()=>$complete($job['job_id'],7));
    $reset();
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs (user_id,finger_name,enrollment_device_id,status,progress,current_step) VALUES (2,'Other finger',1,'waiting',0,'Fixture')");
    rejectImport(fn()=>$service->queue($request));
    $reset();
    $pdo->exec("UPDATE fingerprint_devices SET status='inactive' WHERE device_id=1");
    rejectImport(fn()=>$service->queue($request));

    $reset();
    $job=$service->queue([...$request,'fingerprint_id'=>2])['job'];
    $service->claim(['enrollment_device_id'=>1]);
    $pdo->exec("ALTER TABLE fingerprint_enrollment_jobs ADD CONSTRAINT fixture_reject_import_proof CHECK (current_step <> 'Imported database backup; sensor readback verified')");
    try {
        $complete($job['job_id'],$job['target_slot']);
        throw new RuntimeException('A restore completed without persisting its verified sensor proof.');
    } catch(PDOException $expected) {
        assertImport(!$pdo->inTransaction(),'A failed proof write must release its transaction.');
        assertImport($pdo->query('SELECT enrollment_slot FROM fingerprints WHERE fingerprint_id=2')->fetchColumn()===null,'A failed proof write must roll back local slot mapping.');
        assertImport($service->getAdminJob(['actor_id'=>9,'job_id'=>$job['job_id']])['job']['status']==='processing','A failed proof write must not report a completed import.');
    }

    echo "PASS: exact employee ownership and privileges, metadata-only backup review, sensor-confirmed restores, slot reservation and enrollment exclusion, same-target retries, authorized manual cancellation and isolated retry attempts, idempotent completion, snapshot/ownership guards, three-minute leases, legacy backup proof, and Sensor B state preservation.\n";
} finally {
    if($pdo->inTransaction())$pdo->rollBack();
    $pdo->exec('SET timestamp=0');
    foreach($tables as $table)$pdo->exec('DROP TEMPORARY TABLE IF EXISTS '.$table);
}
