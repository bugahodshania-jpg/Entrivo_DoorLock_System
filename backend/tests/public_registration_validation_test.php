<?php

require_once dirname(__DIR__) . '/services/UserRegistrationService.php';
require_once dirname(__DIR__) . '/services/FirstLoginService.php';

function verify(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function expectFieldError(callable $operation, string $field): array
{
    try {
        $operation();
    } catch (RegistrationValidationException $error) {
        verify(isset($error->fieldErrors[$field]), "Missing inline error for {$field}.");
        return $error->fieldErrors;
    }
    throw new RuntimeException("Invalid {$field} was accepted.");
}

$validProfile = [
    'first_name' => 'Shania Mae Ann',
    'middle_name' => 'G',
    'last_name' => 'Bugahod',
    'date_of_birth' => '2000-01-01',
    'contact_number' => '09123456789',
    'province' => 'agusan del Norte',
    'city_municipality' => 'cabadbaran city',
    'barangay' => 'barangay 12',
    'street_address' => '12 Rizal St., Purok-2',
    'country' => 'philippines',
    'email' => ' Shania.Mae ',
];
$normalized = RegistrationInputValidation::profile($validProfile);
verify($normalized['middle_name'] === 'G', 'Single-letter middle names must be accepted.');
verify($normalized['province'] === 'Agusan Del Norte', 'Province words must start with capital letters.');
verify($normalized['barangay'] === 'Barangay 12', 'Barangay numbers must be accepted.');
verify($normalized['email'] === 'shania.mae@csucc.edu.ph', 'Local school email input must be normalized.');
verify(RegistrationInputValidation::generatedUsername('Shania Mae Ann', 'Bugahod') === 'shaniamae.bugahod', 'Only two first-name words belong in an automatic username.');
verify(RegistrationInputValidation::generatedUsername('Niño', 'Dela Peña') === 'nino.delapena', 'Automatic usernames must transliterate Ñ and join surname words.');
verify(
    RegistrationInputValidation::generatedUsername(str_repeat('A', 50), str_repeat('B', 50)) === 'a.' . str_repeat('b', 48),
    'Long valid names must produce a fifty-character username while preserving its separator and surname allocation.'
);
verify(RegistrationInputValidation::name(' Niño ', 'First name') === 'Niño', 'One edge space may be trimmed.');
verify(RegistrationInputValidation::address('santo-niño', 'Barangay', true) === 'Santo-Niño', 'Capitalization must include Ñ and hyphenated words.');
foreach ([
    ['first_name', 'Juan2'], ['first_name', 'Juan!'], ['first_name', 'Juan-Paul'],
    ['first_name', 'Juan  Carlos'], ['middle_name', 'G.'], ['middle_name', '  '],
    ['last_name', 'Dela   Cruz'], ['last_name', "Cruz\n"], ['last_name', "Cruz\tSantos"],
    ['contact_number', '08123456789'], ['contact_number', '0912345678'], ['contact_number', '091234567890'],
    ['contact_number', '0912 3456789'], ['contact_number', ' 09123456789'], ['contact_number', '09123456789 '],
    ['street_address', 'Rizal #1'], ['street_address', 'Rizal  Street'], ['street_address', "Rizal\n"],
    ['barangay', 'Barangay@1'], ['barangay', 'Barangay  1'],
    ['city_municipality', 'City 1'], ['city_municipality', 'City/Name'],
    ['province', 'Province 1'], ['province', 'Agusan  Del Norte'], ['country', 'Country 1'],
    ['email', 'personal@gmail.com'], ['email', 'name @csucc.edu.ph'], ['email', '"name space"@csucc.edu.ph'], ['email', 'name..surname'],
    ['email', 'user@csucc.edu.ph.example.com'], ['date_of_birth', '2010-02-30'],
] as [$field, $value]) {
    expectFieldError(fn() => RegistrationInputValidation::profile([...$validProfile, $field => $value]), $field);
}
$allErrors = expectFieldError(fn() => RegistrationInputValidation::profile([
    ...$validProfile, 'first_name' => 'Juan1', 'contact_number' => '123', 'province' => 'Province2',
]), 'first_name');
verify(count($allErrors) === 3, 'Independent field errors must be returned together.');
$birthday = new DateTimeImmutable('2026-10-19', new DateTimeZone('Asia/Manila'));
verify(RegistrationInputValidation::age('2009-10-19', $birthday) === 17, 'The seventeenth birthday must be eligible.');
foreach (['2009-10-20', '2026-10-19', '2027-01-01', '2000-02-30'] as $birthDate) {
    try {
        RegistrationInputValidation::age($birthDate, $birthday);
        throw new RuntimeException("Ineligible birth date {$birthDate} was accepted.");
    } catch (InvalidArgumentException) {
        // Invalid dates, future dates, and ages below seventeen must all fail.
    }
}

// Isolated fixtures exercise actual registration and completion writes, without an application DB.
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT COLLATE NOCASE UNIQUE,
    email TEXT COLLATE NOCASE UNIQUE, password_hash TEXT, role TEXT, is_active INTEGER,
    approval_status TEXT, approval_due_at TEXT, must_change_password INTEGER DEFAULT 0,
    onboarding_step TEXT DEFAULT "done"
)');
$profileColumns = ['first_name', 'middle_name', 'last_name', 'extension_name', 'sex', 'date_of_birth', 'age',
    'contact_number', 'province', 'city_municipality', 'barangay', 'street_address'];
$pdo->exec('CREATE TABLE student_info (student_id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE, school_id TEXT UNIQUE, '
    . implode(', ', array_map(fn($column) => "{$column} TEXT", [...$profileColumns, 'college', 'program_department', 'year_level', 'section', 'zip_code', 'country', 'school_id_photo'])) . ')');
$pdo->exec('CREATE TABLE staff_info (user_id INTEGER UNIQUE, employee_id TEXT UNIQUE, '
    . implode(', ', array_map(fn($column) => "{$column} TEXT", [...$profileColumns, 'office_department', 'work_position'])) . ')');
foreach (['faculty_info', 'admin_info'] as $profileTable) {
    $pdo->exec("CREATE TABLE {$profileTable} (user_id INTEGER UNIQUE, contact_number TEXT)");
}
$pdo->exec('CREATE TABLE rfid_cards (card_id INTEGER PRIMARY KEY, user_id INTEGER, rfid_uid TEXT UNIQUE, status TEXT)');
$pdo->exec('CREATE TABLE rfid_scan_log (scan_id INTEGER PRIMARY KEY, rfid_uid TEXT, scanned_at TEXT)');
$pdo->exec('CREATE TABLE account_security_questions (user_id INTEGER, question_slot INTEGER, question TEXT, answer_hash TEXT, answer_text TEXT)');
$pdo->exec("INSERT INTO rfid_scan_log VALUES (1, 'AABBCCDD', '2026-10-19 00:00:00')");
$questions = [
    ['question' => 'What is the name of your first school?', 'answer' => 'Cabadbaran'],
    ['question' => "What is your mother's maiden name?", 'answer' => 'Santos'],
    ['question' => 'What city were you born in?', 'answer' => 'Butuan'],
];
$registration = [
    ...$validProfile, 'username' => '', 'password' => 'Secure123!', 'confirm_password' => 'Secure123!',
    'school_id' => '2024-1234', 'sex' => 'Female',
    'college' => '(CEIT) College of Engineering and Information Technology',
    'program_department' => '(BSIT) Bachelor of Science in Information Technology',
    'year_level' => 'First Year', 'section' => 'Block A', 'zip_code' => '8605',
    'school_id_photo' => 'data:image/png;base64,dGVzdA==', 'rfid_uid' => 'AABBCCDD',
    'security_questions' => $questions,
];
$service = new UserRegistrationService($pdo);
expectFieldError(fn() => $service->registerPublicStudent([...$registration, 'contact_number' => '09 123456789']), 'contact_number');
verify((int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() === 0, 'Invalid public registration must not create an account.');
$saved = $service->registerPublicStudent($registration);
verify($saved['username'] === 'shaniamae.bugahod', 'Public registration must generate a missing username from the first two name words.');
$savedProfile = $pdo->query('SELECT * FROM student_info')->fetch(PDO::FETCH_ASSOC);
verify($savedProfile['middle_name'] === 'G' && $savedProfile['barangay'] === 'Barangay 12', 'Validated profile data must be stored.');
verify($saved['email'] === 'shania.mae@csucc.edu.ph', 'Stored public email must be institutional.');
try {
    $service->registerPublicStudent([...$registration, 'username' => 'different.student', 'school_id' => '2024-5678', 'rfid_uid' => 'NEWUID']);
    throw new RuntimeException('Duplicate institutional email was accepted.');
} catch (RegistrationDuplicateException $error) {
    verify(($error->fieldErrors['email'] ?? '') === 'Email already exists. Use a different school email.', 'Email collisions must retain the requested inline message.');
}
$pdo->exec("INSERT INTO rfid_scan_log VALUES (2, 'DDEEFF00', '2026-10-19 00:00:00')");
$custom = $service->registerPublicStudent([
    ...$registration, 'username' => 'shania.mae.bugahod', 'email' => 'second.student',
    'school_id' => '2024-5678', 'rfid_uid' => 'DDEEFF00', 'contact_number' => '09987654321',
]);
verify($custom['username'] === 'shania.mae.bugahod', 'A valid manual username must resolve same-name collisions.');

$pdo->exec("INSERT INTO users (id, username, email, role, is_active, onboarding_step) VALUES (10, 'legacy.staff', 'legacy@csucc.edu.ph', 'staff', 1, 'profile')");
$pdo->exec("INSERT INTO staff_info (user_id, employee_id, first_name, last_name, contact_number) VALUES (10, '202401-123456', 'Legacy-Name', 'Readonly2', '09123456780')");
$completion = [
    ...$validProfile, 'sex' => 'Female', 'office_department' => 'Office', 'work_position' => 'Staff',
    'street_address' => '', 'contact_number' => '09123456780',
];
expectFieldError(fn() => $service->completeOnboardingProfile(10, [...$completion, 'middle_name' => 'G.']), 'middle_name');
expectFieldError(fn() => $service->completeOnboardingProfile(10, [...$completion, 'date_of_birth' => (new DateTimeImmutable('today', new DateTimeZone('Asia/Manila')))->modify('-16 years')->format('Y-m-d')]), 'date_of_birth');
verify($pdo->query('SELECT onboarding_step FROM users WHERE id = 10')->fetchColumn() === 'profile', 'Invalid completion must preserve the current setup step.');
$service->completeOnboardingProfile(10, $completion);
$completed = $pdo->query('SELECT * FROM staff_info WHERE user_id = 10')->fetch(PDO::FETCH_ASSOC);
verify($completed['first_name'] === 'Legacy-Name' && $completed['last_name'] === 'Readonly2', 'Readonly assigned identity must not prevent completion or be changed.');
verify($completed['province'] === 'Agusan Del Norte' && $completed['contact_number'] === '09123456780', 'Completion must allow and preserve the account\'s own contact number.');
verify($completed['street_address'] === null, 'Completion must preserve optional street address behavior.');
verify($pdo->query('SELECT onboarding_step FROM users WHERE id = 10')->fetchColumn() === 'security', 'Valid completion must advance to security.');
$securityErrors = expectFieldError(fn() => $service->saveInitialSecurityQuestions(10, ['security_questions' => [
    $questions[0], ['question' => $questions[0]['question'], 'answer' => 'A'], $questions[2],
]]), 'security_question_2');
verify(isset($securityErrors['security_answer_2']), 'Security question and answer errors must both be inline.');
$service->saveInitialSecurityQuestions(10, ['security_questions' => $questions]);
verify($pdo->query('SELECT onboarding_step FROM users WHERE id = 10')->fetchColumn() === 'done', 'Valid security questions must finish setup.');

$pdo->exec('CREATE TABLE first_login_challenges (id TEXT, user_id INTEGER, otp_hash TEXT, otp_expires_at TEXT, otp_verified_at TEXT, password_replaced_at TEXT, attempt_count INTEGER)');
$pdo->prepare('UPDATE users SET must_change_password = 1, onboarding_step = "password", password_hash = :hash WHERE id = 10')->execute(['hash' => password_hash('Temporary123!', PASSWORD_DEFAULT)]);
$challengeId = str_repeat('a', 32);
$pdo->prepare('INSERT INTO first_login_challenges VALUES (:id, 10, "", :expires, "verified", NULL, 0)')->execute(['id' => $challengeId, 'expires' => date('Y-m-d H:i:s', time() + 3600)]);
$firstLogin = new FirstLoginService($pdo);
$passwordErrors = expectFieldError(fn() => $firstLogin->replaceTemporaryPassword($challengeId, 'weak', 'different'), 'password');
verify(isset($passwordErrors['confirm_password']), 'Password mismatch must target its confirmation field.');
expectFieldError(fn() => $firstLogin->replaceTemporaryPassword($challengeId, 'Temporary123!', 'Temporary123!'), 'password');
verify((int) $pdo->query('SELECT must_change_password FROM users WHERE id = 10')->fetchColumn() === 1, 'Rejected passwords must leave temporary-password setup intact.');

echo "PASS: public and completion validation, raw input rejection, age boundaries, generated/manual usernames, institutional email duplicates, saved profile data, and inline password/security errors.\n";
