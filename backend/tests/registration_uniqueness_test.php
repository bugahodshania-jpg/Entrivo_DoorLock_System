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
$pdo->exec('CREATE TABLE student_info (school_id TEXT UNIQUE)');
$pdo->exec('CREATE TABLE rfid_cards (rfid_uid TEXT COLLATE NOCASE UNIQUE)');
$pdo->exec("INSERT INTO users VALUES ('student.demo', 'student.demo@csucc.edu.ph')");
$pdo->exec("INSERT INTO student_info VALUES ('2023-0471')");
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

try {
    (new UserRegistrationService($pdo))->registerPublicStudent($duplicates);
    throw new RuntimeException('Public registration accepted duplicate identifiers.');
} catch (RegistrationDuplicateException $error) {
    expect(count($error->fieldErrors) === 4, 'Saving must reject duplicates even without frontend checks.');
}

foreach (['new.student1', 'new.1student', "new.student\u{0661}"] as $username) {
    try {
        (new UserRegistrationService($pdo))->registerPublicStudent(['username' => $username]);
        throw new RuntimeException('Registration accepted a username containing a number.');
    } catch (InvalidArgumentException $error) {
        expect($error->getMessage() === 'Username cannot contain numbers.', 'Number-containing usernames must be rejected before saving.');
    }
}
expect((int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() === 1, 'Rejected registration must not insert a user.');
echo "PASS: duplicate fields, normalization, unused values, parameterized queries, and server-side registration rejection.\n";
