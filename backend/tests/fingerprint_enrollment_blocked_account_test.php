<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/FingerprintEnrollmentService.php';

// SQLite in memory: no live accounts, devices or sensor jobs are touched.
function expectBlocked(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, role TEXT, is_active INTEGER)');
$pdo->exec('CREATE TABLE super_admin_session_standby (user_id INTEGER PRIMARY KEY)');
$pdo->exec("INSERT INTO users VALUES
    (1, 'faculty.active', 'faculty', 1),
    (2, 'faculty.blocked', 'faculty', 0),
    (3, 'root.standby', 'super_admin', 0),
    (4, 'root.blocked', 'super_admin', 0),
    (5, 'admin.blocked', 'admin', 0)");
$pdo->exec('INSERT INTO super_admin_session_standby VALUES (3)');

$service = new FingerprintEnrollmentService($pdo);

expectBlocked($service->blockedAccountMessage(1) === null, 'An active account may be enrolled.');
foreach ([2 => 'faculty', 4 => 'super admin', 5 => 'admin'] as $id => $label) {
    expectBlocked(str_contains((string) $service->blockedAccountMessage($id), 'blocked'), "A blocked $label account must be refused.");
}
expectBlocked($service->blockedAccountMessage(3) === null, 'A standby Super Admin is Inactive, not Blocked.');
expectBlocked($service->blockedAccountMessage(99) === null, 'An unknown user is reported as "User not found" by the caller, not as blocked.');

// Starting an enrollment for a blocked account stops before any device or job work.
$result = $service->createEnrollmentJob(2, 'Right Thumb', 1);
expectBlocked($result['success'] === false && str_contains($result['message'], 'blocked'),
    'Enrollment for a blocked account must be refused. Got ' . json_encode($result));
$result = $service->startEnrollment(['user_id' => 5, 'finger_name' => 'Left Index', 'device_id' => 1]);
expectBlocked($result['status'] === 400 && $result['body']['success'] === false && str_contains($result['body']['message'], 'blocked'),
    'startEnrollment must refuse a blocked admin. Got ' . json_encode($result));

echo "PASS: fingerprint enrollment is refused for blocked accounts (faculty, admin, super admin), allowed for active accounts and standby Super Admins.\n";
