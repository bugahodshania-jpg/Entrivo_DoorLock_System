<?php

require_once dirname(__DIR__) . '/services/FingerprintEnrollmentReadiness.php';

function expectReadiness(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
expectReadiness(FingerprintEnrollmentReadiness::verifiedMap($pdo, [1]) === [], 'An unmigrated database must not label legacy records verified.');
$pdo->exec('CREATE TABLE fingerprints (fingerprint_id INTEGER PRIMARY KEY, user_id INTEGER, finger_name TEXT,
    status TEXT, enrollment_device_id INTEGER, enrollment_slot INTEGER, template_data BLOB,
    template_hash TEXT, enrolled_at TEXT)');
$pdo->exec('CREATE TABLE fingerprint_enrollment_jobs (job_id INTEGER PRIMARY KEY, user_id INTEGER,
    finger_name TEXT, enrollment_device_id INTEGER, assigned_slot INTEGER, status TEXT, progress INTEGER, finished_at TEXT)');
$pdo->exec('CREATE TABLE fingerprint_enrollment_verifications (job_id INTEGER PRIMARY KEY, fingerprint_id INTEGER,
    user_id INTEGER, finger_name TEXT, enrollment_device_id INTEGER, fresh_scan_verified INTEGER,
    stored_slot INTEGER, matched_slot INTEGER, confidence INTEGER, template_bytes INTEGER,
    template_sha256 TEXT, verified_at TEXT)');
$binary = str_repeat("\x80\x03", 384);
$hash = hash('sha256', $binary);
$pdo->prepare("INSERT INTO fingerprints VALUES (1,10,'Right Index','active',1,7,?,?,'2026-10-22 20:00:00')")->execute([$binary, $hash]);
$pdo->exec("INSERT INTO fingerprint_enrollment_jobs VALUES (20,10,'Right Index',1,7,'completed',100,'2026-10-22 20:00:01')");
$pdo->prepare("INSERT INTO fingerprint_enrollment_verifications VALUES (20,1,10,'Right Index',1,1,7,7,87,768,?,'2026-10-22 20:00:01')")->execute([$hash]);
$map = FingerprintEnrollmentReadiness::verifiedMap($pdo, [1, 1, -1]);
expectReadiness(count($map) === 1 && $map[1]['fresh_scan_verified'] && $map[1]['matched_slot'] === 7
    && $map[1]['template_bytes'] === 768, 'A durable proof must expose the exact current slot and supported backup size.');

$pdo->prepare('UPDATE fingerprints SET template_data=? WHERE fingerprint_id=1')->execute([str_repeat("\x00", 768)]);
expectReadiness(FingerprintEnrollmentReadiness::verifiedMap($pdo, [1]) === [], 'Corrupt or uniform current backups invalidate the old proof.');
$replacement = str_repeat("\x01\x02", 384);
$pdo->prepare('UPDATE fingerprints SET template_data=?,template_hash=? WHERE fingerprint_id=1')->execute([$replacement, hash('sha256', $replacement)]);
expectReadiness(FingerprintEnrollmentReadiness::verifiedMap($pdo, [1]) === [], 'A valid replacement template cannot reuse proof for a different digest.');
$pdo->prepare('UPDATE fingerprints SET template_data=?,template_hash=? WHERE fingerprint_id=1')->execute([base64_encode($binary), $hash]);
expectReadiness(isset(FingerprintEnrollmentReadiness::verifiedMap($pdo, [1])[1]), 'A verified legacy base64 representation preserves the exact proven bytes.');

$pdo->exec('UPDATE fingerprints SET enrollment_slot=8 WHERE fingerprint_id=1');
expectReadiness(FingerprintEnrollmentReadiness::verifiedMap($pdo, [1]) === [], 'A reassigned sensor slot must be verified again.');
$pdo->exec('UPDATE fingerprints SET enrollment_slot=7 WHERE fingerprint_id=1');
$pdo->exec("UPDATE fingerprints SET enrolled_at='2026-10-22 20:05:00' WHERE fingerprint_id=1");
expectReadiness(FingerprintEnrollmentReadiness::verifiedMap($pdo, [1]) === [], 'Proof from before a later enrollment cannot confirm the new enrollment.');
$pdo->exec("UPDATE fingerprints SET enrolled_at='2026-10-22 20:00:00' WHERE fingerprint_id=1");

$pdo->exec("INSERT INTO fingerprint_enrollment_jobs VALUES (21,10,'Left Thumb',1,8,'processing',50,NULL)");
expectReadiness(FingerprintEnrollmentReadiness::verifiedMap($pdo, [1]) === [], 'Live sensor work for this owner must not be presented as confirmed readiness.');
$pdo->exec("UPDATE fingerprint_enrollment_jobs SET status='failed',assigned_slot=7 WHERE job_id=21");
expectReadiness(FingerprintEnrollmentReadiness::verifiedMap($pdo, [1]) === [], 'A newer failed attempt at the proven slot requires renewed verification.');
$pdo->exec('UPDATE fingerprint_enrollment_jobs SET assigned_slot=8 WHERE job_id=21');
expectReadiness(isset(FingerprintEnrollmentReadiness::verifiedMap($pdo, [1])[1]), 'A finished unrelated slot must not invalidate this proof.');

$pdo->exec('UPDATE fingerprint_enrollment_verifications SET matched_slot=8 WHERE job_id=20');
expectReadiness(FingerprintEnrollmentReadiness::verifiedMap($pdo, [1]) === [], 'A final scan matching another slot must never be verified.');
$pdo->exec('UPDATE fingerprint_enrollment_verifications SET matched_slot=7 WHERE job_id=20');
$pdo->exec("UPDATE fingerprint_enrollment_jobs SET status='failed' WHERE job_id=20");
expectReadiness(FingerprintEnrollmentReadiness::verifiedMap($pdo, [1]) === [], 'A proof row alone cannot turn a failed job into a completed enrollment.');
echo "PASS: current template/slot/owner proof, legacy records, stale mappings, corrupt backups and unfinished or failed jobs.\n";
