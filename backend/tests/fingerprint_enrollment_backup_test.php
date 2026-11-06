<?php

require_once dirname(__DIR__) . '/services/FingerprintEnrollmentBackup.php';

final class BackupFixturePdo extends PDO
{
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        return parent::prepare(str_replace(' FOR UPDATE', '', $query), $options);
    }
}

function expectBackup(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = new BackupFixturePdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE fingerprint_enrollment_jobs
    (job_id INTEGER PRIMARY KEY, enrollment_device_id INTEGER, assigned_slot INTEGER, status TEXT)');
$pdo->exec("INSERT INTO fingerprint_enrollment_jobs VALUES (7, 1, 23, 'stored_pending_commit')");
FingerprintEnrollmentBackup::ensure($pdo);
$binary = str_repeat("\x01\x7f", 256);
$hash = hash('sha256', $binary);

FingerprintEnrollmentBackup::stage($pdo, 7, 1, 23, $binary, $hash);
FingerprintEnrollmentBackup::stage($pdo, 7, 1, 23, $binary, $hash);
$staged = FingerprintEnrollmentBackup::find($pdo, 7);
expectBackup($staged !== null && $staged['template_data'] === $binary &&
    (int) $staged['template_bytes'] === 512 && $staged['template_sha256'] === $hash,
    'The exact saved template must be staged once after the stored-slot read.');

foreach ([
    [7, 1, 24, $binary, $hash],
    [7, 1, 23, str_repeat("\x02\x7f", 256), hash('sha256', str_repeat("\x02\x7f", 256))],
    [7, 1, 23, $binary, str_repeat('0', 64)],
    [8, 1, 23, $binary, $hash],
] as $invalid) {
    try {
        FingerprintEnrollmentBackup::stage($pdo, ...$invalid);
        throw new RuntimeException('A conflicting backup was accepted.');
    } catch (InvalidArgumentException|DomainException $expected) {
        expectBackup(!$pdo->inTransaction(), 'A rejected backup must roll back its transaction.');
    }
}
$pdo->exec("UPDATE fingerprint_enrollment_jobs SET status='completed' WHERE job_id=7");
try {
    FingerprintEnrollmentBackup::stage($pdo, 7, 1, 23, $binary, $hash);
    throw new RuntimeException('A closed job accepted a backup.');
} catch (DomainException $expected) {
    expectBackup(!$pdo->inTransaction(), 'A closed job must not leave an open transaction.');
}
FingerprintEnrollmentBackup::delete($pdo, 7);
expectBackup(FingerprintEnrollmentBackup::find($pdo, 7) === null,
    'The staged copy should be removed after final enrollment commit.');

echo "PASS: exact backup staging, idempotence, job and slot binding, conflicting backup rejection, and cleanup.\n";
