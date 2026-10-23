<?php

require_once dirname(__DIR__) . '/services/RegistrationUniquenessService.php';
require_once dirname(__DIR__) . '/services/UserRegistrationService.php';

function expect(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

// Isolated fixture database: this test never changes the application's database.
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE users (username TEXT COLLATE NOCASE UNIQUE, email TEXT COLLATE NOCASE UNIQUE)');
$pdo->exec('CREATE TABLE student_info (school_id TEXT UNIQUE, user_id INTEGER, contact_number TEXT)');
$pdo->exec('CREATE TABLE rfid_cards (rfid_uid TEXT COLLATE NOCASE UNIQUE)');
$pdo->exec("INSERT INTO users VALUES ('student.demo', 'student.demo@csucc.edu.ph')");
$pdo->exec("INSERT INTO student_info (school_id) VALUES ('2023-0471')");
$pdo->exec("INSERT INTO rfid_cards VALUES ('ABCD12345')");
$service = new RegistrationUniquenessService($pdo);
$duplicates = ['username' => 'student.demo', 'school_id' => '2023-0471', 'rfid_uid' => 'ABCD12345', 'email' => 'student.demo@csucc.edu.ph'];

$errors = $service->check($duplicates);
expect(count($errors) === 4, 'Every duplicate must receive a field-specific error.');
foreach (array_keys($duplicates) as $field) {
    expect(isset($errors[$field]), "Missing duplicate error for {$field}.");
    expect(count($service->check([$field => $duplicates[$field]])) === 1, 'Partial checks must only report the requested field.');
}
expect(count($service->check(['username' => ' STUDENT.DEMO ', 'rfid_uid' => ' abcd 12345 '])) === 2, 'Normalized equivalents must be rejected.');
expect(isset($service->check(['email' => ' STUDENT.DEMO@CSUCC.EDU.PH '])['email']), 'Email comparisons must ignore case and whitespace.');
expect(isset($service->check(['email' => 'student.demo'])['email']), 'Email local parts must use the same normalization as registration.');
expect($service->check(['username' => 'new.student', 'school_id' => '2024-0999', 'rfid_uid' => 'DEADBEEF', 'email' => 'new.student@csucc.edu.ph']) === [], 'Unused values must be accepted.');
expect($service->check(['username' => "' OR 1=1 --"]) === [], 'Input must be parameterized.');
expect($service->check(['username' => ['invalid'], 'rfid_uid' => '', 'unknown' => 'anything']) === [], 'Unsupported or malformed lookup fields must not be queried.');

$pdo->exec('CREATE TABLE faculty_info (employee_id TEXT UNIQUE, user_id INTEGER, contact_number TEXT)');
$pdo->exec('CREATE TABLE staff_info (employee_id TEXT UNIQUE, user_id INTEGER, contact_number TEXT)');
$pdo->exec('CREATE TABLE admin_info (employee_id TEXT UNIQUE, user_id INTEGER, contact_number TEXT)');
$pdo->exec("INSERT INTO faculty_info (employee_id) VALUES ('202301-004712')");
$pdo->exec("INSERT INTO staff_info (employee_id) VALUES ('202302-000100')");
$pdo->exec("INSERT INTO admin_info (employee_id) VALUES ('202303-000200')");
foreach (['202301-004712', ' 202302-000100 ', '202303-000200'] as $employeeId) {
    expect(isset($service->check(['employee_id' => $employeeId])['employee_id']), 'Employee IDs must be unique across faculty, staff, and admin profiles.');
}
expect($service->check(['employee_id' => '202399-000001']) === [], 'Unused employee IDs must be accepted.');
expect($service->check(['employee_id' => '']) === [], 'Blank employee IDs must not be queried.');

$validPublicProfile = [
    'first_name' => 'Student',
    'last_name' => 'Demo',
    'date_of_birth' => '2000-01-01',
    'contact_number' => '09123456789',
    'province' => 'Agusan Del Norte',
    'city_municipality' => 'Cabadbaran City',
    'barangay' => 'Barangay 1',
    'street_address' => 'Main St.',
    'country' => 'Philippines',
];
try {
    (new UserRegistrationService($pdo))->registerPublicStudent([...$validPublicProfile, ...$duplicates]);
    throw new RuntimeException('Public registration accepted duplicate identifiers.');
} catch (RegistrationDuplicateException $error) {
    expect(count($error->fieldErrors) === 4, 'Saving must reject duplicates even without frontend checks.');
}

foreach (['new.student1', 'new.1student', "new.student\u{0661}"] as $username) {
    try {
        (new UserRegistrationService($pdo))->registerPublicStudent([...$validPublicProfile, 'email' => 'new.student@csucc.edu.ph', 'username' => $username]);
        throw new RuntimeException('Registration accepted a username containing a number.');
    } catch (RegistrationValidationException $error) {
        expect(($error->fieldErrors['username'] ?? '') === 'Username cannot contain numbers.', 'Number-containing usernames must be rejected before saving.');
    }
}
expect((int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() === 1, 'Rejected registration must not insert a user.');

$registration = new UserRegistrationService($pdo);
$validIdentity = [
    'role' => 'student',
    'school_id' => '2024-0999',
    'email' => 'juan.delacruz@csucc.edu.ph',
    'username' => 'juan.delacruz',
    'first_name' => 'Juan',
    'last_name' => 'Dela Cruz',
];
$rejectedIdentities = [
    ['first_name' => 'juan', 'message' => 'First name must start with a capital letter.'],
    ['first_name' => 'Juan2', 'message' => 'First name cannot contain numbers.'],
    ['first_name' => 'Juan!', 'message' => 'First name can only include letters, Ñ, spaces, and hyphens.'],
    ['last_name' => 'cruz', 'message' => 'Last name must start with a capital letter.'],
    ['last_name' => 'Cruz-', 'message' => 'Last name cannot start or end with a hyphen, or repeat spaces and hyphens.'],
    ['username' => 'Juan.delacruz', 'message' => 'Username must be all lowercase.'],
    ['username' => 'juan1.delacruz', 'message' => 'Username cannot contain numbers.'],
    ['username' => 'juandelacruz', 'message' => 'Username must include a dot (.).'],
    ['username' => 'juan_delacruz', 'message' => 'Username can only use lowercase letters and a dot.'],
];
foreach ($rejectedIdentities as $override) {
    $message = $override['message'];
    unset($override['message']);
    try {
        $registration->registerUser(array_merge($validIdentity, $override));
        throw new RuntimeException("Registration accepted invalid identity: {$message}");
    } catch (InvalidArgumentException $error) {
        expect($error->getMessage() === $message, "Expected '{$message}' but received '{$error->getMessage()}'.");
    }
}
try {
    $registration->registerUser(array_merge($validIdentity, [
        'first_name' => 'Niño',
        'last_name' => 'Santos-Cruz',
    ]));
    throw new RuntimeException('A valid student name was saved without a scanned RFID UID.');
} catch (InvalidArgumentException $error) {
    expect(
        $error->getMessage() === 'Enter the RFID UID shown on the scanner.',
        'Valid student names must pass, then require a scanned RFID UID.'
    );
}
expect((int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() === 1, 'Invalid admin registration must not insert a user.');
echo "PASS: duplicate fields, normalization, unused values, parameterized queries, and server-side registration rejection.\n";
