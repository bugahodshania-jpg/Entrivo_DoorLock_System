<?php

require_once dirname(__DIR__) . '/services/FingerprintEnrollmentService.php';

function expectVerifiedEnrollment(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

/** SQLite executes real transactions; only MySQL's row-lock suffix is adapted. */
final class EnrollmentFixturePdo extends PDO
{
    public array $lockedJobs = [];

    public function __construct()
    {
        parent::__construct('sqlite::memory:', null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $this->sqliteCreateFunction('NOW', static fn (): string => '2026-10-22 10:00:00');
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        if (str_contains($query, 'FOR UPDATE')) {
            expectVerifiedEnrollment($this->inTransaction(), 'The job lock must be requested inside the transaction.');
            $this->lockedJobs[] = $query;
            $query = str_replace(' FOR UPDATE', '', $query);
        }
        return parent::prepare($query, $options);
    }
}

function enrollmentFixture(bool $withProofTable = true): array
{
    $pdo = new EnrollmentFixturePdo();
    // Every fixture table is connection-local and disappears with this in-memory
    // database. This test never calls entrivo_pdo() or reads backend credentials.
    $pdo->exec('CREATE TEMP TABLE fingerprints (
        fingerprint_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, finger_name TEXT,
        enrollment_device_id INTEGER, enrollment_slot INTEGER, shared_door_slot INTEGER UNIQUE,
        template_data BLOB, template_hash TEXT, status TEXT, door_sync_status TEXT,
        door_synced_at TEXT, enrolled_at TEXT, UNIQUE(user_id, finger_name)
    )');
    $pdo->exec("CREATE TEMP TABLE fingerprint_enrollment_jobs (
        job_id INTEGER PRIMARY KEY, user_id INTEGER, fingerprint_id INTEGER, finger_name TEXT,
        enrollment_device_id INTEGER, assigned_slot INTEGER, status TEXT, progress INTEGER,
        current_step TEXT, error_message TEXT, finished_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )");
    if ($withProofTable) {
        $pdo->exec('CREATE TEMP TABLE fingerprint_enrollment_verifications (
            job_id INTEGER PRIMARY KEY, fingerprint_id INTEGER, user_id INTEGER, finger_name TEXT,
            enrollment_device_id INTEGER, fresh_scan_verified INTEGER, stored_slot INTEGER,
            matched_slot INTEGER, confidence INTEGER, template_bytes INTEGER,
            template_sha256 TEXT, verified_at TEXT DEFAULT CURRENT_TIMESTAMP
        )');
    }
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs
        (job_id,user_id,finger_name,enrollment_device_id,assigned_slot,status,progress,current_step)
        VALUES (7,2,'Right Index',1,12,'processing',95,'Reading stored template')");
    $binary = str_repeat("\xFF\x01", 256);
    $payload = ['job_id' => 7, 'enrollment_device_id' => 1, 'assigned_slot' => 12,
        'template_data_base64' => base64_encode($binary), 'verification' => [
            'fresh_scan_verified' => true, 'stored_slot' => 12, 'matched_slot' => 12,
            'confidence' => 1, 'template_bytes' => 512, 'template_sha256' => hash('sha256', $binary),
        ]];
    return [$pdo, new FingerprintEnrollmentService($pdo), $payload, $binary];
}

function enrollmentSnapshot(PDO $pdo): array
{
    $tables = ['fingerprints', 'fingerprint_enrollment_jobs', 'fingerprint_enrollment_verifications'];
    $result = [];
    foreach ($tables as $table) $result[$table] = $pdo->query('SELECT * FROM ' . $table)->fetchAll();
    return $result;
}

foreach ([null, false, '', '   '] as $missing) {
    expectVerifiedEnrollment(!FingerprintEnrollmentVerification::deviceTokenMatches($missing, 'fixture-token'), 'An unconfigured token must reject completion.');
}
foreach ([null, false, '', 'wrong', 'fixture-token ', ['fixture-token']] as $wrong) {
    expectVerifiedEnrollment(!FingerprintEnrollmentVerification::deviceTokenMatches('fixture-token', $wrong), 'An absent or changed board token must reject completion.');
}
expectVerifiedEnrollment(FingerprintEnrollmentVerification::deviceTokenMatches('fixture-token', 'fixture-token'), 'Only the exact configured board token must match.');

[$pdo, $service, $payload, $binary] = enrollmentFixture();
$result = $service->completeEnrollment($payload);
expectVerifiedEnrollment($result['status'] === 200 && $result['body']['success'], 'A persisted template and explicit fresh proof must complete even when progress 99 was lost.');
$snapshot = enrollmentSnapshot($pdo);
$saved = $snapshot['fingerprints'][0];
$job = $snapshot['fingerprint_enrollment_jobs'][0];
$proof = $snapshot['fingerprint_enrollment_verifications'][0];
expectVerifiedEnrollment($saved['template_data'] === $binary && $saved['template_hash'] === hash('sha256', $binary), 'Stored bytes and digest must exactly match the board proof.');
expectVerifiedEnrollment($job['status'] === 'completed' && (int) $job['progress'] === 100 &&
    $job['current_step'] === 'Enrollment completed after final verification' && !empty($job['finished_at']), 'Only the committed proof may finish the job.');
expectVerifiedEnrollment((int) $proof['fingerprint_id'] === (int) $saved['fingerprint_id'] &&
    (int) $proof['stored_slot'] === 12 && $proof['template_sha256'] === hash('sha256', $binary), 'The audit proof must reference the saved fingerprint and physical slot.');
expectVerifiedEnrollment(!array_key_exists('template_data', $result['body']['fingerprint']) &&
    $result['body']['verification'] === $result['body']['job']['verification'], 'Completion must return JSON-safe metadata and the durable proof in both supported fields.');
$confirmedJob = $result['body']['job'];
expectVerifiedEnrollment(is_int($confirmedJob['job_id']) && is_int($confirmedJob['enrollment_device_id']) && is_int($confirmedJob['assigned_slot'])
    && $confirmedJob['job_id'] === 7 && $confirmedJob['enrollment_device_id'] === 1 && $confirmedJob['assigned_slot'] === 12,
    'Completion must return numeric job, device, and slot ids so the board can confirm success.');
json_encode($result['body'], JSON_THROW_ON_ERROR);
expectVerifiedEnrollment(count($pdo->lockedJobs) >= 2 && !$pdo->inTransaction(), 'Completion must lock the job, read its committed outcome, and release the transaction.');
$retry = $service->completeEnrollment($payload);
expectVerifiedEnrollment($retry['status'] === 200 && $retry['body']['idempotent'] && enrollmentSnapshot($pdo) === $snapshot,
    'A lost HTTP reply must be recoverable by exact retransmission without any additional writes.');
expectVerifiedEnrollment($retry['body']['verification'] === $result['body']['verification'], 'A retry must return the original proof timestamp and fingerprint identity.');

foreach (['confidence' => 2, 'template_sha256' => str_repeat('0', 64)] as $field => $value) {
    $changed = $payload;
    $changed['verification'][$field] = $value;
    $rejected = $service->completeEnrollment($changed);
    expectVerifiedEnrollment(!$rejected['body']['success'] && enrollmentSnapshot($pdo) === $snapshot, 'A changed completed retry must reject without writes.');
}
$changed = $payload;
$other = str_repeat('CD', 256);
$changed['template_data_base64'] = base64_encode($other);
$changed['verification']['template_sha256'] = hash('sha256', $other);
expectVerifiedEnrollment($service->completeEnrollment($changed)['status'] === 409 && enrollmentSnapshot($pdo) === $snapshot,
    'A different template with internally consistent proof must not replace a completed enrollment.');

foreach (['waiting', 'failed', 'cancelled'] as $status) {
    [$pdo, $service, $payload] = enrollmentFixture();
    $pdo->prepare('UPDATE fingerprint_enrollment_jobs SET status=?')->execute([$status]);
    $before = enrollmentSnapshot($pdo);
    $result = $service->completeEnrollment($payload);
    expectVerifiedEnrollment($result['status'] === 409 && enrollmentSnapshot($pdo) === $before && !$pdo->inTransaction(), 'Unclaimed and closed jobs must reject before saving any fingerprint.');
}
foreach (['enrollment_device_id' => 2, 'assigned_slot' => null] as $field => $value) {
    [$pdo, $service, $payload] = enrollmentFixture();
    $pdo->prepare('UPDATE fingerprint_enrollment_jobs SET ' . $field . '=?')->execute([$value]);
    $before = enrollmentSnapshot($pdo);
    expectVerifiedEnrollment($service->completeEnrollment($payload)['status'] === 409 && enrollmentSnapshot($pdo) === $before,
        'A device mismatch or missing durable slot reservation must reject without writes.');
}

[$pdo, $service, $payload] = enrollmentFixture();
$before = enrollmentSnapshot($pdo);
$missing = $payload;
unset($missing['verification']);
$result = $service->completeEnrollment($missing);
expectVerifiedEnrollment($result['status'] === 422 && str_contains($result['body']['message'], 'firmware') && enrollmentSnapshot($pdo) === $before,
    'Old firmware must receive a clear upgrade failure and preserve every enrollment row.');
$invalidProofs = [
    ['fresh_scan_verified', false], ['fresh_scan_verified', 'true'], ['fresh_scan_verified', 1],
    ['stored_slot', 11], ['matched_slot', 13], ['matched_slot', '12'], ['confidence', 0],
    ['confidence', -1], ['confidence', 1.0], ['confidence', true], ['confidence', 65536],
    ['stored_slot', 65536], ['matched_slot', 65536], ['template_bytes', 511],
    ['template_sha256', str_repeat('0', 64)], ['template_sha256', strtoupper($payload['verification']['template_sha256'])],
];
foreach ($invalidProofs as [$field, $value]) {
    $invalid = $payload;
    $invalid['verification'][$field] = $value;
    $result = $service->completeEnrollment($invalid);
    expectVerifiedEnrollment(in_array($result['status'], [409, 422], true) && enrollmentSnapshot($pdo) === $before,
        'Malformed or inconsistent proof must reject without writes: ' . $field);
}
foreach (['', '*not-base64*', base64_encode(str_repeat('AB', 255)), base64_encode(str_repeat("\xFF", 512))] as $encoded) {
    $invalid = $payload;
    $invalid['template_data_base64'] = $encoded;
    $result = $service->completeEnrollment($invalid);
    expectVerifiedEnrollment(!$result['body']['success'] && enrollmentSnapshot($pdo) === $before, 'Missing, invalid, truncated and uniform template data must preserve all rows.');
}

foreach ([512, 768, 1024, 1536] as $bytes) {
    [$pdo, $service, $payload] = enrollmentFixture();
    $binary = str_repeat("\x80\x02", $bytes / 2);
    $payload['template_data_base64'] = base64_encode($binary);
    $payload['verification']['template_bytes'] = $bytes;
    $payload['verification']['template_sha256'] = hash('sha256', $binary);
    expectVerifiedEnrollment($service->completeEnrollment($payload)['status'] === 200, 'Every supported complete template size must remain enrollable.');
}

// Force failures after save, after proof insertion, and at completion. Each must
// restore the exact earlier fingerprint instead of leaving a partial update.
foreach (['readback', 'proof', 'completion', 'completion_no_rows'] as $failure) {
    [$pdo, $service, $payload] = enrollmentFixture();
    $old = str_repeat('OLD!', 128);
    $pdo->prepare("INSERT INTO fingerprints
        (fingerprint_id,user_id,finger_name,enrollment_device_id,enrollment_slot,shared_door_slot,template_data,template_hash,status,door_sync_status,enrolled_at)
        VALUES (4,2,'Right Index',1,5,5,?,?,'active','synced','2026-10-20 08:00:00')")
        ->execute([$old, hash('sha256', $old)]);
    $pdo->exec('UPDATE fingerprint_enrollment_jobs SET fingerprint_id=4');
    if ($failure === 'readback') {
        $pdo->exec("CREATE TEMP TRIGGER corrupt_enrollment AFTER UPDATE ON fingerprints BEGIN UPDATE fingerprints SET template_hash='corrupt' WHERE fingerprint_id=NEW.fingerprint_id; END");
    } elseif ($failure === 'proof') {
        $pdo->exec("CREATE TEMP TRIGGER reject_proof BEFORE INSERT ON fingerprint_enrollment_verifications BEGIN SELECT RAISE(ABORT,'fixture proof failure'); END");
    } else {
        $abort = $failure === 'completion' ? "RAISE(ABORT,'fixture completion failure')" : 'RAISE(IGNORE)';
        $pdo->exec("CREATE TEMP TRIGGER reject_completion BEFORE UPDATE ON fingerprint_enrollment_jobs WHEN NEW.status='completed' BEGIN SELECT {$abort}; END");
    }
    $before = enrollmentSnapshot($pdo);
    $result = $service->completeEnrollment($payload);
    expectVerifiedEnrollment(!$result['body']['success'] && enrollmentSnapshot($pdo) === $before && !$pdo->inTransaction(),
        'Failure must roll back template bytes, hash, mapping, proof and job together: ' . $failure);
}

[$pdo, $service, $payload] = enrollmentFixture(false);
expectVerifiedEnrollment(!FingerprintEnrollmentVerification::tableExists($pdo), 'A fresh read must tolerate an unapplied migration.');
$result = $service->completeEnrollment($payload);
expectVerifiedEnrollment($result['status'] === 503 && str_contains($result['body']['message'], 'migration') &&
    !FingerprintEnrollmentVerification::tableExists($pdo) && (int) $pdo->query('SELECT COUNT(*) FROM fingerprints')->fetchColumn() === 0,
    'An unapplied migration must fail clearly without creating tables or saving a fingerprint.');

echo "PASS: authenticated proof validation, exact stored bytes/hash, lost-progress completion, atomic job/proof/template commit, rejected unclaimed/closed jobs, rollback at every persistence stage, supported sizes, missing migration, and idempotent HTTP retries.\n";
