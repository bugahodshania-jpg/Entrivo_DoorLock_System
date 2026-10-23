<?php

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/DirectFingerprintImportSchema.php';
require_once __DIR__ . '/SensorMemorySchema.php';
require_once __DIR__ . '/UserPrivilegeService.php';
require_once __DIR__ . '/FingerprintTemplateFormat.php';

final class DirectFingerprintImportException extends RuntimeException
{
    public function __construct(string $message, public readonly int $httpStatus = 409)
    {
        parent::__construct($message);
    }
}

/** Restores a verified database backup without changing Sensor B synchronization. */
final class DirectFingerprintImportService
{
    private PDO $pdo;

    public function __construct(?PDO $pdo = null, private bool $ensureSchema = true)
    {
        $this->pdo = $pdo ?? entrivo_pdo();
    }

    public function lookup(array $input): array
    {
        $this->actor($input['actor_id'] ?? null);
        $owner = $this->owner($input['employee_id'] ?? null);
        $query = $this->pdo->prepare('SELECT * FROM fingerprints WHERE user_id=? ORDER BY fingerprint_id');
        $query->execute([$owner['user_id']]);
        $backups = [];
        foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $fingerprint) {
            $binary = $this->binary($fingerprint);
            if ($binary === null) continue;
            $eligible = $this->eligible($owner) && $fingerprint['status'] === 'active';
            $backups[] = [
                'fingerprint_id' => (int) $fingerprint['fingerprint_id'],
                'finger_name' => (string) $fingerprint['finger_name'],
                'template_bytes' => strlen($binary), 'template_updated_at' => $fingerprint['enrolled_at'] ?? null,
                'enrollment_device_id' => isset($fingerprint['enrollment_device_id']) ? (int) $fingerprint['enrollment_device_id'] : null,
                'enrollment_slot' => isset($fingerprint['enrollment_slot']) ? (int) $fingerprint['enrollment_slot'] : null,
                'status' => $fingerprint['status'], 'can_import' => $eligible,
                'unavailable_reason' => $eligible ? '' : 'The account must be active, approved, and fully set up, and the fingerprint must be active.',
            ];
        }
        unset($owner['must_change_password'], $owner['onboarding_step']);
        return ['success' => true, 'message' => $backups === [] ? 'This employee has no valid fingerprint backup in the database.' : 'Review this employee and select a backed-up finger to restore to Sensor A.', 'user' => $owner, 'backups' => $backups];
    }

    public function queue(array $input): array
    {
        $actorId = $this->actor($input['actor_id'] ?? null, true);
        $deviceId = $this->integer($input['enrollment_device_id'] ?? $input['device_id'] ?? 1);
        $fingerprintId = $this->integer($input['fingerprint_id'] ?? null);
        $this->ready();
        return $this->transaction(function () use ($input, $actorId, $deviceId, $fingerprintId): array {
            $this->device($deviceId);
            if (SensorMemorySchema::hasProcessingForDevice($this->pdo, $deviceId)) {
                $this->reject('Sensor A is reading its memory. Wait for the read to finish before restoring a fingerprint.');
            }
            $owner = $this->owner($input['employee_id'] ?? null);
            $fingerprint = $this->fingerprint($fingerprintId);
            if ((int) $fingerprint['user_id'] !== $owner['user_id']) $this->reject('The selected backup does not belong to this employee.', 403);
            $binary = $this->binary($fingerprint);
            if (!$this->eligible($owner) || $fingerprint['status'] !== 'active') $this->reject('Only an active fingerprint for an active, approved account with completed setup can be restored.', 403);
            if ($binary === null) $this->reject('This fingerprint has no valid database backup of a supported size (' . FingerprintTemplateFormat::describeSupportedSizes() . ' bytes). Enroll it again first.', 422);
            $active = $this->pdo->prepare("SELECT * FROM direct_fingerprint_import_jobs WHERE status IN ('pending','processing') AND (enrollment_device_id=? OR fingerprint_id=?) FOR UPDATE");
            $active->execute([$deviceId, $fingerprintId]);
            $existing = $active->fetch(PDO::FETCH_ASSOC);
            if ($existing) {
                if ((int) $existing['fingerprint_id'] === $fingerprintId && (int) $existing['enrollment_device_id'] === $deviceId && $this->snapshotMatches($existing, $fingerprint)) {
                    return $this->jobResponse($existing, 'This database restore is already queued or in progress.');
                }
                $this->reject('Sensor A or this fingerprint already has an active database restore. Wait for it to finish.');
            }
            $this->noLiveEnrollment($deviceId, $owner['user_id']);
            $previous = $this->pdo->prepare('SELECT * FROM direct_fingerprint_import_jobs WHERE fingerprint_id=? AND enrollment_device_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE');
            $previous->execute([$fingerprintId, $deviceId]);
            $retry = $previous->fetch(PDO::FETCH_ASSOC);
            $retryMatches = $retry && in_array($retry['status'], ['failed','cancelled'], true) && $this->snapshotMatches($retry, $fingerprint);
            if ($retryMatches) {
                $this->slotOwner($deviceId, (int) $retry['target_slot'], $fingerprintId);
                // Keep a manually cancelled attempt closed so delayed cancel/device
                // requests cannot change a later attempt that uses the same slot.
                if ($retry['current_step'] !== 'Import cancelled by administrator') {
                    $this->pdo->prepare("UPDATE direct_fingerprint_import_jobs SET actor_id=?,status='pending',progress=0,current_step='Waiting for Sensor A',error_message=NULL,queued_at=NOW(),processing_at=NULL,finished_at=NULL,active_device_key=?,active_fingerprint_key=? WHERE id=?")->execute([$actorId, $deviceId, $fingerprintId, $retry['id']]);
                    return $this->jobResponse($this->job((int) $retry['id']), 'Database restore queued again using the same reserved sensor slot.');
                }
            }
            $slot = $retryMatches ? (int) $retry['target_slot'] : ((int) ($fingerprint['enrollment_device_id'] ?? 0) === $deviceId ? (int) ($fingerprint['enrollment_slot'] ?? 0) : 0);
            if ($slot > 0) $this->slotOwner($deviceId, $slot, $fingerprintId);
            else $slot = $this->nextSlot();
            if ($slot < 1 || $slot > 65535) $this->reject('There are no supported sensor slots available for this restore.');
            $insert = $this->pdo->prepare("INSERT INTO direct_fingerprint_import_jobs
                (actor_id,user_id,fingerprint_id,enrollment_device_id,target_slot,employee_id,user_name,finger_name,template_data,template_hash,source_enrolled_at,source_device_id,source_slot,active_device_key,active_fingerprint_key)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
            $insert->execute([$actorId,$owner['user_id'],$fingerprintId,$deviceId,$slot,$owner['employee_id'],$owner['full_name'],$fingerprint['finger_name'],$binary,strtolower($fingerprint['template_hash']),$fingerprint['enrolled_at'] ?? null,$fingerprint['enrollment_device_id'] ?? null,$fingerprint['enrollment_slot'] ?? null,$deviceId,$fingerprintId]);
            return $this->jobResponse($this->job((int) $this->pdo->lastInsertId()), 'Database restore queued. Sensor A must write and verify the template before it becomes ready.');
        });
    }

    public function getAdminJob(array $input): array
    {
        $this->actor($input['actor_id'] ?? null);
        $this->ready();
        return $this->jobResponse($this->job($this->integer($input['job_id'] ?? null)), 'Database restore status loaded.');
    }

    public function cancel(array $input): array
    {
        $this->actor($input['actor_id'] ?? null, true);
        $jobId = $this->integer($input['job_id'] ?? null);
        $this->ready();
        return $this->transaction(function () use ($jobId): array {
            $job = $this->job($jobId, true);
            if (!in_array($job['status'], ['pending','processing'], true)) {
                $message = match ($job['status']) {
                    'cancelled' => 'This import is already cancelled.',
                    'completed' => 'This import completed before it could be cancelled.',
                    default => 'This import has already failed and is no longer running.',
                };
                return $this->jobResponse($job, $message);
            }
            $this->pdo->prepare("UPDATE direct_fingerprint_import_jobs SET status='cancelled',current_step='Import cancelled by administrator',error_message='Import cancelled by an administrator. You can retry this database restore.',finished_at=NOW(),active_device_key=NULL,active_fingerprint_key=NULL WHERE id=? AND status IN ('pending','processing')")->execute([$jobId]);
            return $this->jobResponse($this->job($jobId), 'Import cancelled. You can retry this database restore.');
        });
    }

    public function claim(array $input): array
    {
        $deviceId = $this->integer($input['enrollment_device_id'] ?? null);
        $this->ready();
        return $this->transaction(function () use ($deviceId): array {
            $this->device($deviceId);
            if (SensorMemorySchema::hasProcessingForDevice($this->pdo, $deviceId)) {
                return ['success' => false, 'message' => 'Sensor A is reading its memory. The database restore will wait.'];
            }
            $query = $this->pdo->prepare("SELECT * FROM direct_fingerprint_import_jobs WHERE enrollment_device_id=? AND status IN ('pending','processing') ORDER BY id LIMIT 1 FOR UPDATE");
            $query->execute([$deviceId]);
            $job = $query->fetch(PDO::FETCH_ASSOC);
            if (!$job) return ['success' => false, 'message' => 'No pending database restore.'];
            try {
                $this->noLiveEnrollment($deviceId, (int) $job['user_id']);
                $this->validateSnapshot($job);
                $this->slotOwner($deviceId, (int) $job['target_slot'], (int) $job['fingerprint_id']);
            } catch (DirectFingerprintImportException $error) {
                $this->pdo->prepare("UPDATE direct_fingerprint_import_jobs SET status='failed',current_step='Database restore could not start',error_message=?,finished_at=NOW(),active_device_key=NULL,active_fingerprint_key=NULL WHERE id=? AND status IN ('pending','processing')")->execute([$error->getMessage(),$job['id']]);
                $result=$this->jobResponse($this->job((int)$job['id']),$error->getMessage());
                $result['success']=false;
                return $result;
            }
            if ($job['status'] === 'pending') {
                $this->pdo->prepare("UPDATE direct_fingerprint_import_jobs SET status='processing',progress=5,current_step='Sensor A claimed database restore',processing_at=NOW() WHERE id=? AND status='pending' AND queued_at>DATE_SUB(NOW(),INTERVAL 3 MINUTE)")->execute([$job['id']]);
                $job = $this->job((int) $job['id']);
            }
            if ($job['status'] !== 'processing') $this->reject('This database restore is no longer active.');
            $response = $this->jobResponse($job, 'Database restore claimed by Sensor A.');
            $response['job']['template_data_base64'] = base64_encode($job['template_data']);
            $response['job']['template_hash'] = $job['template_hash'];
            $response['job']['template_bytes'] = strlen($job['template_data']);
            return $response;
        });
    }

    public function deviceUpdate(array $input): array
    {
        $deviceId = $this->integer($input['enrollment_device_id'] ?? $input['device_id'] ?? null);
        $jobId = $this->integer($input['job_id'] ?? null);
        $action = $input['action'] ?? '';
        if (!is_string($action) || !in_array($action, ['complete','fail','progress'], true)) $this->reject('A valid device restore action is required.', 422);
        $this->ready();
        return $this->transaction(function () use ($input, $deviceId, $jobId, $action): array {
            $this->device($deviceId);
            $job = $this->job($jobId, true);
            if ((int) $job['enrollment_device_id'] !== $deviceId) $this->reject('This restore belongs to a different sensor.', 403);
            $slot = $input['stored_slot'] ?? $input['assigned_slot'] ?? null;
            $hash = $input['template_hash'] ?? '';
            if ($action === 'complete') {
                if ($this->integer($slot) !== (int) $job['target_slot'] || !is_string($hash) || !hash_equals($job['template_hash'], strtolower(trim($hash)))) $this->reject('The sensor slot or verified template hash does not match this restore.');
                if ($job['status'] === 'completed') return $this->jobResponse($job, 'This database restore was already confirmed.');
            }
            if ($job['status'] !== 'processing' || empty($job['processing_at'])) $this->reject('This restore is no longer processing. Queue it again before using Sensor A.');
            $live = $this->pdo->prepare('SELECT processing_at>DATE_SUB(NOW(),INTERVAL 3 MINUTE) FROM direct_fingerprint_import_jobs WHERE id=?');
            $live->execute([$jobId]);
            if (!(bool) $live->fetchColumn()) $this->reject('The three-minute restore lease expired. Queue the same backup again.');
            if ($action === 'fail') {
                $reason = is_string($input['error_message'] ?? null) ? trim($input['error_message']) : '';
                $this->pdo->prepare("UPDATE direct_fingerprint_import_jobs SET status='failed',current_step='Sensor restore failed',error_message=?,finished_at=NOW(),active_device_key=NULL,active_fingerprint_key=NULL WHERE id=? AND status='processing'")->execute([substr($reason !== '' ? $reason : 'Sensor A could not write and verify the database backup.',0,1000),$jobId]);
            } elseif ($action === 'progress') {
                $progress = max(5,min(95,(int) ($input['progress'] ?? 10)));
                $step = is_string($input['current_step'] ?? null) ? trim($input['current_step']) : 'Restoring database backup to Sensor A';
                $this->pdo->prepare('UPDATE direct_fingerprint_import_jobs SET progress=GREATEST(progress,?),current_step=? WHERE id=? AND status=\'processing\'')->execute([$progress,substr($step,0,150),$jobId]);
            } else {
                $fingerprint = $this->validateSnapshot($job);
                $this->noLiveEnrollment($deviceId, (int) $job['user_id']);
                $this->slotOwner($deviceId, (int) $job['target_slot'], (int) $job['fingerprint_id']);
                // Preserve Sensor B shared slot, sync state, template backup and capture date.
                $this->pdo->prepare('UPDATE fingerprints SET enrollment_device_id=?,enrollment_slot=?,enrolled_at=COALESCE(enrolled_at,NOW()) WHERE fingerprint_id=?')->execute([$deviceId,$job['target_slot'],$job['fingerprint_id']]);
                $proof = $this->pdo->prepare("INSERT INTO fingerprint_enrollment_jobs (user_id,fingerprint_id,finger_name,enrollment_device_id,status,progress,current_step,assigned_slot,started_at,finished_at) VALUES (?,?,?,?,'completed',100,'Imported database backup; sensor readback verified',?,NOW(),NOW())");
                $proof->execute([$job['user_id'],$job['fingerprint_id'],$fingerprint['finger_name'],$deviceId,$job['target_slot']]);
                $this->pdo->prepare("UPDATE direct_fingerprint_import_jobs SET status='completed',progress=100,current_step='Database backup restored and verified on Sensor A',error_message=NULL,finished_at=NOW(),active_device_key=NULL,active_fingerprint_key=NULL WHERE id=? AND status='processing'")->execute([$jobId]);
            }
            return $this->jobResponse($this->job($jobId), $action === 'complete' ? 'Database backup restored and verified on Sensor A.' : 'Database restore status updated.');
        });
    }

    private function actor(mixed $rawId, bool $write = false): int
    {
        $id = $this->integer($rawId);
        $query = $this->pdo->prepare('SELECT role,is_active,approval_status FROM users WHERE id=?');
        $query->execute([$id]);
        $actor = $query->fetch(PDO::FETCH_ASSOC);
        if (!$actor || (int) $actor['is_active'] !== 1 || $actor['approval_status'] !== 'approved' || !in_array($actor['role'], ['admin','super_admin'], true)) $this->reject('An active administrator is required for database fingerprint imports.', 403);
        $query = $this->pdo->prepare('SELECT privilege_key FROM user_privileges WHERE user_id=?');
        $query->execute([$id]);
        $privileges = $query->fetchAll(PDO::FETCH_COLUMN);
        if ($privileges === []) $privileges=UserPrivilegeService::defaultsForRole($actor['role']);
        if (!in_array('fingerprint',$privileges,true) || ($write && !in_array('fingerprint_update',$privileges,true))) $this->reject('You do not have permission to ' . ($write ? 'restore' : 'view') . ' database fingerprint backups.',403);
        return $id;
    }

    private function owner(mixed $rawEmployeeId): array
    {
        if (!is_string($rawEmployeeId) || ($employeeId = trim($rawEmployeeId)) === '' || strlen($employeeId)>100) $this->reject('Enter a valid employee ID exactly as registered.',422);
        $matches = [];
        foreach (['faculty_info','staff_info','admin_info'] as $table) {
            $query = $this->pdo->prepare("SELECT * FROM {$table} WHERE BINARY TRIM(employee_id)=BINARY ?");
            $query->execute([$employeeId]);
            foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $profile) $matches[(int) $profile['user_id']] = $profile;
        }
        if ($matches === []) $this->reject('No employee was found with that exact employee ID.',404);
        if (count($matches)!==1) $this->reject('This employee ID belongs to more than one account. Ask an administrator to correct the records.');
        $profile = array_values($matches)[0];
        $query = $this->pdo->prepare('SELECT id,username,email,role,is_active,approval_status,must_change_password,onboarding_step FROM users WHERE id=?');
        $query->execute([(int) $profile['user_id']]);
        $user = $query->fetch(PDO::FETCH_ASSOC);
        if (!$user || !in_array($user['role'],['faculty','staff','admin','super_admin'],true)) $this->reject('This employee account is unavailable.',404);
        $name = trim(implode(' ',array_filter([$profile['first_name']??'',$profile['middle_name']??'',$profile['last_name']??'',$profile['extension_name']??''])));
        return ['user_id'=>(int) $user['id'],'full_name'=>$name!==''?$name:$user['username'],'employee_id'=>$employeeId,'username'=>$user['username'],'email'=>$user['email'],'role'=>$user['role'],'office_department'=>$profile['office_department']??'','work_position'=>$profile['work_position']??'','user_photo'=>$profile['users_photo']??null,'status'=>(int)$user['is_active']===1?'active':'inactive','approval_status'=>$user['approval_status'],'must_change_password'=>(int)$user['must_change_password'],'onboarding_step'=>$user['onboarding_step']];
    }

    private function eligible(array $owner): bool
    {
        return $owner['status']==='active' && $owner['approval_status']==='approved' && $owner['must_change_password']===0 && $owner['onboarding_step']==='done';
    }

    private function device(int $id): void
    {
        $query=$this->pdo->prepare('SELECT device_type,status FROM fingerprint_devices WHERE device_id=? FOR UPDATE');
        $query->execute([$id]);
        $device=$query->fetch(PDO::FETCH_ASSOC);
        if (!$device || $device['device_type']!=='enrollment' || $device['status']!=='active') $this->reject('Sensor A is not registered and active. Activate the enrollment controller before restoring.');
    }

    private function fingerprint(int $id): array
    {
        $query=$this->pdo->prepare('SELECT * FROM fingerprints WHERE fingerprint_id=? FOR UPDATE');
        $query->execute([$id]);
        $record=$query->fetch(PDO::FETCH_ASSOC);
        if (!$record) $this->reject('The fingerprint backup no longer exists.',404);
        return $record;
    }

    private function binary(array $record): ?string
    {
        return FingerprintTemplateFormat::verifiedBinary($record['template_data'] ?? null, $record['template_hash'] ?? null);
    }

    private function snapshotMatches(array $job, array $fingerprint): bool
    {
        return (int)$job['user_id']===(int)$fingerprint['user_id'] && $job['finger_name']===$fingerprint['finger_name']
            && $job['template_hash']===strtolower((string)$fingerprint['template_hash']) && $this->binary($fingerprint)!==null
            && ($job['source_enrolled_at']??null)===($fingerprint['enrolled_at']??null)
            && (int)($job['source_device_id']??0)===(int)($fingerprint['enrollment_device_id']??0)
            && (int)($job['source_slot']??0)===(int)($fingerprint['enrollment_slot']??0);
    }

    private function validateSnapshot(array $job): array
    {
        $owner=$this->owner($job['employee_id']);
        $fingerprint=$this->fingerprint((int)$job['fingerprint_id']);
        if ($owner['user_id']!==(int)$job['user_id'] || !$this->eligible($owner) || $fingerprint['status']!=='active' || !$this->snapshotMatches($job,$fingerprint)) $this->reject('The employee, account, or fingerprint backup changed after this restore was queued. Review the record and queue it again.');
        return $fingerprint;
    }

    private function slotOwner(int $deviceId,int $slot,int $fingerprintId): void
    {
        $query=$this->pdo->prepare('SELECT fingerprint_id FROM fingerprints WHERE enrollment_device_id=? AND enrollment_slot=? AND fingerprint_id<>? FOR UPDATE');
        $query->execute([$deviceId,$slot,$fingerprintId]);
        if ($query->fetch()) $this->reject('The reserved sensor slot belongs to another fingerprint. No template will be overwritten.');
    }

    private function noLiveEnrollment(int $deviceId,int $userId): void
    {
        $query=$this->pdo->prepare("SELECT job_id FROM fingerprint_enrollment_jobs WHERE status IN ('waiting','processing') AND (enrollment_device_id=? OR enrollment_device_id IS NULL OR user_id=?) LIMIT 1 FOR UPDATE");
        $query->execute([$deviceId,$userId]);
        if ($query->fetch()) $this->reject('An enrollment is already waiting or running for this sensor or employee. Finish it before restoring a database backup.');
    }

    private function nextSlot(): int
    {
        $fingerprints=$this->pdo->query('SELECT GREATEST(COALESCE(MAX(enrollment_slot),0),COALESCE(MAX(shared_door_slot),0)) FROM fingerprints')->fetchColumn();
        $enrollments=$this->pdo->query("SELECT COALESCE(MAX(assigned_slot),0) FROM fingerprint_enrollment_jobs WHERE status IN ('waiting','processing') OR (status='failed' AND progress>=90)")->fetchColumn();
        $imports=$this->pdo->query('SELECT COALESCE(MAX(target_slot),0) FROM direct_fingerprint_import_jobs')->fetchColumn();
        return max((int)$fingerprints,(int)$enrollments,(int)$imports)+1;
    }

    private function job(int $id,bool $lock=false): array
    {
        $query=$this->pdo->prepare('SELECT * FROM direct_fingerprint_import_jobs WHERE id=?'.($lock?' FOR UPDATE':''));
        $query->execute([$id]);
        $job=$query->fetch(PDO::FETCH_ASSOC);
        if (!$job) $this->reject('Database restore job not found.',404);
        return $job;
    }

    private function jobResponse(array $job,string $message): array
    {
        $safe=array_intersect_key($job,array_flip(['user_id','fingerprint_id','enrollment_device_id','target_slot','employee_id','user_name','finger_name','status','progress','current_step','error_message','queued_at','processing_at','finished_at','updated_at']));
        foreach (['user_id','fingerprint_id','enrollment_device_id','target_slot','progress'] as $key) $safe[$key]=(int)$safe[$key];
        $safe['job_id']=(int)$job['id'];
        $safe['assigned_slot']=$safe['target_slot'];
        $safe['progress_step']=$safe['current_step'];
        return ['success'=>true,'message'=>$message,'job'=>$safe];
    }

    private function ready(): void
    {
        if ($this->ensureSchema) DirectFingerprintImportSchema::ensure($this->pdo);
        DirectFingerprintImportSchema::expire($this->pdo);
    }

    private function integer(mixed $value): int
    {
        if ((!is_int($value)&&!is_string($value)) || !($id=filter_var($value,FILTER_VALIDATE_INT,['options'=>['min_range'=>1]]))) $this->reject('A valid record or sensor ID is required.',422);
        return $id;
    }

    private function transaction(callable $work): array
    {
        $this->pdo->beginTransaction();
        try { $result=$work(); $this->pdo->commit(); return $result; }
        catch(Throwable $error) { if($this->pdo->inTransaction())$this->pdo->rollBack(); throw $error; }
    }

    private function reject(string $message,int $status=409): never
    {
        throw new DirectFingerprintImportException($message,$status);
    }
}
