<?php

require_once dirname(__DIR__) . '/services/RfidScanService.php';
require_once dirname(__DIR__) . '/services/UserRegistrationService.php';

function verifyGate(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function expectGateError(RfidScanService $service, mixed $uid, int $status, string $code): void
{
    try {
        $service->verifyForRegistration($uid);
    } catch (RfidUidVerificationException $error) {
        verifyGate($error->httpStatus === $status, 'UID rejection must have the expected HTTP status.');
        verifyGate($error->errorCode === $code, 'UID rejection must identify the reason.');
        if ($code === RfidScanService::REGISTERED_UID_CODE) {
            verifyGate($error->getMessage() === RfidScanService::REGISTERED_UID_MESSAGE, 'Registered UIDs must direct the user to the admin office.');
        }
        return;
    }
    throw new RuntimeException('An ineligible UID was accepted.');
}

// Isolated fixtures only; no connection to the application's database is made.
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, email TEXT, is_active INTEGER, approval_status TEXT)');
$pdo->exec('CREATE TABLE rfid_cards (card_id INTEGER PRIMARY KEY, user_id INTEGER, rfid_uid TEXT UNIQUE, status TEXT)');
$pdo->exec("INSERT INTO users VALUES (1, 'existing.user', 'existing.user@csucc.edu.ph', 1, 'approved')");
$pdo->exec("INSERT INTO users VALUES (2, 'pending.user', 'pending.user@csucc.edu.ph', 0, 'pending')");
$cards = [
    [1, 1, 'aaBB1234', 'active'],
    [2, 2, 'PENDING01', 'active'],
    [3, 1, 'INACTIVE01', 'inactive'],
    [4, 1, 'REVOKED01', 'revoked'],
    [5, 1, 'BLOCKED01', 'blocked'],
    [6, 1, 'PENDINGCARD01', 'pending'],
];
$insert = $pdo->prepare('INSERT INTO rfid_cards VALUES (?, ?, ?, ?)');
foreach ($cards as $card) $insert->execute($card);
$service = new RfidScanService($pdo);

// No scan table exists yet: assigned UIDs must be rejected before any scan lookup.
foreach ($cards as $card) {
    expectGateError($service, strtolower($card[2]), 409, RfidScanService::REGISTERED_UID_CODE);
}
expectGateError($service, " aa bb\t12 34\n", 409, RfidScanService::REGISTERED_UID_CODE);
foreach (['', null, [], ['rfid_uid' => 'AABB1234']] as $missing) {
    expectGateError($service, $missing, 422, 'rfid_uid_required');
}
foreach (['AABB-1234', 'AABB@1234', str_repeat('A', 31)] as $invalid) {
    expectGateError($service, $invalid, 422, 'rfid_uid_invalid');
}

$pdo->exec('CREATE TABLE rfid_scan_log (scan_id INTEGER PRIMARY KEY, rfid_uid TEXT, scanned_at TEXT)');
$pdo->exec("INSERT INTO rfid_scan_log VALUES (1, 'AABB1234', '2026-10-18 11:00:00')");
$pdo->exec("INSERT INTO rfid_scan_log VALUES (2, 'newCard12', '2026-10-18 11:00:00')");
$pdo->exec("INSERT INTO rfid_scan_log VALUES (3, 'NEWCARD12', '2026-10-19 10:00:00')");
expectGateError($service, 'aabb1234', 409, RfidScanService::REGISTERED_UID_CODE);
expectGateError($service, 'UNSCANNED01', 422, 'rfid_uid_not_scanned');
$verified = $service->verifyForRegistration(" new card\t12 ");
verifyGate($verified === [
    'verified' => true,
    'rfid_uid' => 'NEWCARD12',
    'scanned_at' => '2026-10-19 10:00:00',
], 'An unregistered scanned UID must return normalized verification and its latest scan.');

$pdo->exec('CREATE TABLE student_info (school_id TEXT, user_id INTEGER, contact_number TEXT)');
foreach (['faculty_info', 'staff_info', 'admin_info'] as $table) {
    $pdo->exec("CREATE TABLE {$table} (user_id INTEGER, contact_number TEXT)");
}
$uniqueness = new RegistrationUniquenessService($pdo);
verifyGate($uniqueness->check(['rfid_uid' => ' aa bb 12 34 ']) === [
    'rfid_uid' => RfidScanService::REGISTERED_UID_MESSAGE,
], 'Availability checks must reject normalized duplicates with the same inline help.');

$profile = [
    'first_name' => 'New', 'last_name' => 'Student', 'date_of_birth' => '2000-01-01',
    'contact_number' => '09123456789', 'province' => 'Agusan Del Norte',
    'city_municipality' => 'Cabadbaran City', 'barangay' => 'Barangay 1',
    'street_address' => 'Main St.', 'country' => 'Philippines',
    'email' => 'new.student@csucc.edu.ph', 'username' => 'new.student',
    'school_id' => '2024-1234',
];
foreach ([' aa bb 12 34 ', 'pending01', 'inactive01', 'revoked01', 'blocked01'] as $uid) {
    try {
        (new UserRegistrationService($pdo))->registerPublicStudent([...$profile, 'rfid_uid' => $uid]);
    } catch (RegistrationDuplicateException $error) {
        verifyGate($error->fieldErrors === ['rfid_uid' => RfidScanService::REGISTERED_UID_MESSAGE], 'Direct public submission must reject registered UIDs before creating an account.');
        continue;
    }
    throw new RuntimeException('Direct public registration bypassed the UID gate.');
}
verifyGate((int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() === 2, 'Rejected submissions must not create users.');
verifyGate((int) $pdo->query('SELECT COUNT(*) FROM rfid_cards')->fetchColumn() === count($cards), 'Rejected submissions must not change card assignments.');

echo "PASS: registered UID gate, pending accounts and disabled cards, normalization, scan requirement, latest scan, and direct public submission rejection.\n";
