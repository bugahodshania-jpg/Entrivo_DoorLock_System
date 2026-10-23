<?php

require_once dirname(__DIR__) . '/services/RegistrationUniquenessService.php';
require_once dirname(__DIR__) . '/services/UserRegistrationService.php';
require_once dirname(__DIR__) . '/services/FirstLoginService.php';

function checkContact(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function expectContactDuplicate(callable $operation): void
{
    try {
        $operation();
    } catch (RegistrationDuplicateException $error) {
        checkContact(
            ($error->fieldErrors['contact_number'] ?? '') === RegistrationUniquenessService::CONTACT_DUPLICATE_MESSAGE,
            'Duplicate contact numbers must receive the requested inline error.'
        );
        return;
    }
    throw new RuntimeException('An existing contact number was accepted.');
}

// Exercise the MySQL lock branch without connecting to or changing application data.
class ContactLockFixturePdo extends PDO
{
    public array $calls = [];
    public mixed $lockResult = 1;

    public function __construct() {}

    public function getAttribute(int $attribute): mixed
    {
        return $attribute === PDO::ATTR_DRIVER_NAME ? 'mysql' : null;
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        return new ContactLockFixtureStatement($this, $query);
    }
}

class ContactLockFixtureStatement extends PDOStatement
{
    public function __construct(private ContactLockFixturePdo $fixture, private string $query) {}

    public function execute(?array $params = null): bool
    {
        $this->fixture->calls[] = ['query' => $this->query, 'params' => $params];
        return true;
    }

    public function fetchColumn(int $column = 0): mixed
    {
        return $this->fixture->lockResult;
    }
}

$lockPdo = new ContactLockFixturePdo();
$lockService = new RegistrationUniquenessService($lockPdo);
$lock = $lockService->acquireContactLock('09000000001');
checkContact($lock !== null && strlen($lock) <= 64, 'Contact saves must use a MySQL-compatible named lock.');
checkContact($lockService->acquireContactLock('09000000001') === $lock, 'Competing saves for the same number must acquire the same lock.');
checkContact($lockService->acquireContactLock('09000000002') !== $lock, 'Unrelated contact numbers must use separate locks.');
$lockService->releaseContactLock($lock);
checkContact($lockPdo->calls[0] === ['query' => 'SELECT GET_LOCK(:lock_name, 10)', 'params' => ['lock_name' => $lock]], 'Contact saves must acquire the lock using bound parameters and a bounded wait.');
checkContact(end($lockPdo->calls) === ['query' => 'SELECT RELEASE_LOCK(:lock_name)', 'params' => ['lock_name' => $lock]], 'The acquired contact lock must be released with the same key.');
foreach ([0, null] as $failedLock) {
    $lockPdo->lockResult = $failedLock;
    try {
        $lockService->acquireContactLock('09000000001');
    } catch (RuntimeException) {
        continue;
    }
    throw new RuntimeException('Saving must stop when MySQL does not grant the contact lock.');
}

// Isolated fixtures: no application data is read or written.
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE users (
    id INTEGER PRIMARY KEY, username TEXT, email TEXT, password_hash TEXT, role TEXT,
    is_active INTEGER, must_change_password INTEGER, onboarding_step TEXT
)');
$pdo->exec('CREATE TABLE student_info (user_id INTEGER, school_id TEXT, contact_number TEXT)');
$pdo->exec('CREATE TABLE faculty_info (user_id INTEGER, contact_number TEXT)');
$pdo->exec('CREATE TABLE staff_info (user_id INTEGER, contact_number TEXT)');
$pdo->exec('CREATE TABLE admin_info (user_id INTEGER, contact_number TEXT)');
$pdo->exec('CREATE TABLE first_login_challenges (
    id TEXT, user_id INTEGER, otp_hash TEXT, otp_expires_at TEXT, otp_verified_at TEXT,
    password_replaced_at TEXT, attempt_count INTEGER
)');
$profiles = [
    ['student_info', 1, '09000000001'],
    ['faculty_info', 2, '09000000002'],
    ['staff_info', 3, '09000000003'],
    ['admin_info', 4, '09000000004'],
    ['admin_info', 5, '09000000005'], // Admin and superadmin both use admin_info.
];
foreach ($profiles as [$table, $userId, $number]) {
    $pdo->prepare("INSERT INTO {$table} (user_id, contact_number) VALUES (?, ?)")->execute([$userId, $number]);
}
$pdo->exec("INSERT INTO users VALUES (10, 'setup.staff', 'setup@csucc.edu.ph', '', 'staff', 1, 0, 'profile')");
$pdo->exec("INSERT INTO users VALUES (11, 'inactive.staff', 'inactive@csucc.edu.ph', '', 'staff', 0, 0, 'profile')");
$pdo->exec("INSERT INTO users VALUES (12, 'security.staff', 'security@csucc.edu.ph', '', 'staff', 1, 0, 'security')");
$pdo->exec("INSERT INTO staff_info VALUES (10, '09000000010')");
$uniqueness = new RegistrationUniquenessService($pdo);
checkContact($uniqueness->acquireContactLock('09000000001') === null, 'SQLite fixtures must not issue MySQL lock queries.');
$uniqueness->releaseContactLock(null);
$registration = new UserRegistrationService($pdo);
$profile = [
    'first_name' => 'New', 'last_name' => 'Student', 'middle_name' => '',
    'date_of_birth' => '2000-01-01', 'email' => 'new.student@csucc.edu.ph',
    'province' => 'Agusan Del Norte', 'city_municipality' => 'Cabadbaran City',
    'barangay' => 'Barangay 1', 'street_address' => 'Main St.', 'country' => 'Philippines',
];
foreach ($profiles as [$table, $userId, $number]) {
    checkContact(isset($uniqueness->check(['contact_number' => $number])['contact_number']), "{$table} contact numbers must be checked.");
    checkContact($uniqueness->checkContactNumber($number, $userId) === [], 'A trusted exclusion must allow the account\'s own number.');
    checkContact(isset($uniqueness->checkContactNumber($number, 10)['contact_number']), 'Excluding the current account must still find another account.');
    expectContactDuplicate(fn() => $registration->registerPublicStudent([...$profile, 'contact_number' => $number]));
}
checkContact($uniqueness->check(['contact_number' => '09000000099']) === [], 'An unused number must be available.');
foreach (['', '09 000000010', "' OR 1=1 --", '090000000100', ['09000000010'], 9000000010] as $malformed) {
    checkContact($uniqueness->check(['contact_number' => $malformed]) === [], 'Malformed contact lookups must be ignored.');
}
checkContact(
    isset($uniqueness->check(['contact_number' => '09000000010', 'user_id' => 10])['contact_number']),
    'Public lookup input must never exclude an account using a client-supplied user_id.'
);
checkContact((int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() === 3, 'Rejected public registrations must not create accounts.');

$firstLogin = new FirstLoginService($pdo);
$challengeInsert = $pdo->prepare('INSERT INTO first_login_challenges VALUES (?, ?, "", ?, "verified", ?, 0)');
$validChallenge = str_repeat('a', 32);
$challengeInsert->execute([$validChallenge, 10, date('Y-m-d H:i:s', time() + 3600), 'replaced']);
$own = $firstLogin->contactAvailability($validChallenge, '09000000010');
checkContact($own['available'] === true && (array) $own['errors'] === [], 'The verified setup account\'s current number must remain available.');
$taken = $firstLogin->contactAvailability($validChallenge, '09000000001');
checkContact($taken['available'] === false && ((array) $taken['errors'])['contact_number'] === RegistrationUniquenessService::CONTACT_DUPLICATE_MESSAGE, 'Setup availability must expose field-specific duplicate errors.');
$unused = $firstLogin->contactAvailability($validChallenge, '09000000099');
checkContact($unused['available'] === true, 'An unused setup contact number must be available.');
try {
    $firstLogin->contactAvailability($validChallenge, '09 000000010');
    throw new RuntimeException('Malformed setup contact number was accepted.');
} catch (RegistrationValidationException $error) {
    checkContact(isset($error->fieldErrors['contact_number']), 'Malformed setup numbers must receive an inline format error.');
}

$invalidChallenges = ['not-a-challenge', str_repeat('f', 32)];
foreach ([
    ['b', 10, time() - 60, 'replaced'], // Expired.
    ['c', 10, time() + 3600, null], // Password has not been set.
    ['d', 11, time() + 3600, 'replaced'], // Inactive account.
    ['e', 12, time() + 3600, 'replaced'], // Wrong setup step.
    ['0', 999, time() + 3600, 'replaced'], // Missing account.
] as [$token, $userId, $expires, $replaced]) {
    $id = str_repeat($token, 32);
    $challengeInsert->execute([$id, $userId, date('Y-m-d H:i:s', $expires), $replaced]);
    $invalidChallenges[] = $id;
}
foreach ($invalidChallenges as $challengeId) {
    try {
        $firstLogin->contactAvailability($challengeId, '09000000010');
    } catch (InvalidArgumentException) {
        continue;
    }
    throw new RuntimeException('An invalid setup challenge was allowed to exclude an account.');
}

$completion = [...$profile, 'sex' => 'Female', 'office_department' => 'Office', 'work_position' => 'Staff'];
expectContactDuplicate(fn() => $registration->completeOnboardingProfile(10, [
    ...$completion, 'contact_number' => '09000000001', 'user_id' => 1,
]));
expectContactDuplicate(fn() => $firstLogin->completeProfile($validChallenge, [...$completion, 'contact_number' => '09000000002']));
checkContact($pdo->query('SELECT onboarding_step FROM users WHERE id = 10')->fetchColumn() === 'profile', 'Rejected completion must preserve the onboarding step.');
checkContact($pdo->query('SELECT contact_number FROM staff_info WHERE user_id = 10')->fetchColumn() === '09000000010', 'Rejected completion must preserve the account\'s current profile.');
checkContact((int) $pdo->query('SELECT COUNT(*) FROM first_login_challenges WHERE id = "' . $validChallenge . '"')->fetchColumn() === 1, 'Rejected completion must preserve the setup challenge.');
checkContact(!$pdo->inTransaction(), 'Rejected saves must not leave an open transaction.');

// Legacy shared data must still be caught after excluding the current account.
$pdo->exec("INSERT INTO faculty_info VALUES (20, '09000000010')");
checkContact($firstLogin->contactAvailability($validChallenge, '09000000010')['available'] === false, 'A second owner must still make the current number unavailable.');

echo "PASS: contact uniqueness across every role, trusted own-account exclusions, challenge guards, inline errors, and direct save rejection without setup changes.\n";
