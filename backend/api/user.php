<?php

date_default_timezone_set('Asia/Manila');

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'POST', 'PUT', 'DELETE'], true)) {
    http_response_code(405);
    echo json_encode(['message' => 'Method not allowed']);
    exit;
}

require_once dirname(__DIR__) . '/services/UserRegistrationService.php';
require_once dirname(__DIR__) . '/services/SuperAdminDashboardSession.php';
require_once dirname(__DIR__) . '/services/UserPrivilegeService.php';
require_once dirname(__DIR__) . '/services/ActivityLogService.php';

require_once dirname(__DIR__) . '/config/connection.php';

function activityUserLabel(?array $user): string
{
    if (!$user) {
        return 'a user';
    }

    $name = trim(implode(' ', array_filter([
        $user['firstName'] ?? $user['first_name'] ?? '',
        $user['lastName'] ?? $user['last_name'] ?? '',
    ])));

    if ($name !== '') {
        return $name;
    }

    return (string) ($user['username'] ?? 'a user');
}

function getSuperAdminStandbyMap(PDO $pdo): array
{
    try {
        return (new SuperAdminDashboardSession($pdo))->standbyUserIdMap();
    } catch (Throwable) {
        return [];
    }
}

function countOccupiedSuperAdminSlots(PDO $pdo, ?int $excludeUserId = null): int
{
    $superAdmins = $pdo->query(
        "SELECT id, is_active FROM users WHERE role = 'super_admin'"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $standbyMap = getSuperAdminStandbyMap($pdo);
    $occupiedSlots = 0;

    foreach ($superAdmins as $row) {
        $id = (int) ($row['id'] ?? 0);

        if ($excludeUserId !== null && $id === $excludeUserId) {
            continue;
        }

        $isActive = (bool) ($row['is_active'] ?? false);
        $isStandby = !empty($standbyMap[$id]);

        if ($isActive || $isStandby) {
            $occupiedSlots += 1;
        }
    }

    return $occupiedSlots;
}

function resolveAccountStatus(
    string $approvalStatus,
    bool $isActive,
    string $role,
    int $userId,
    array $standbyMap = [],
    string $onboardingStep = 'done'
): string {
    return match ($approvalStatus) {
        'pending' => 'pending',
        'rejected' => 'rejected',
        default => !$isActive
            ? (
                $role === 'super_admin' && !empty($standbyMap[$userId])
                    ? 'inactive'
                    : 'blocked'
            )
            : ($onboardingStep !== '' && $onboardingStep !== 'done' ? 'pending_login' : 'active'),
    };
}

function fetchUsersByRole(PDO $pdo, string $roleKey): array
{
    $profileTable = match ($roleKey) {
        'students' => 'student_info',
        'faculty' => 'faculty_info',
        'staff' => 'staff_info',
        'admins' => 'admin_info',
    };
    $idColumn = $roleKey === 'students' ? 'school_id' : 'employee_id';
    $roleCondition = $roleKey === 'admins'
        ? "users.role IN ('admin', 'super_admin')"
        : 'users.role = :role';

    $statement = $pdo->prepare(
        "SELECT
            users.id,
            users.username,
            users.email,
            users.role,
            users.is_active,
            users.approval_status,
            users.onboarding_step,
            DATE_FORMAT(users.created_at, '%b %e, %Y') AS joined_at,
            {$profileTable}.{$idColumn} AS profile_identifier,
            {$profileTable}.first_name,
            {$profileTable}.middle_name,
            {$profileTable}.last_name,
            {$profileTable}.extension_name,
            {$profileTable}.sex,
            {$profileTable}.contact_number,
            " . ($roleKey === 'students'
                ? "{$profileTable}.college,
                   {$profileTable}.program_department,
                   {$profileTable}.year_level,
                   {$profileTable}.section,
                   NULL AS office_department,
                   NULL AS work_position"
                : "NULL AS college,
                   NULL AS program_department,
                   NULL AS year_level,
                   NULL AS section,
                   {$profileTable}.office_department,
                   {$profileTable}.work_position") . ",
            COALESCE(rfid_cards.status, 'unassigned') AS rfid_status,
            COUNT(fingerprints.fingerprint_id) AS fingerprint_count
         FROM users
         LEFT JOIN {$profileTable} ON {$profileTable}.user_id = users.id
         LEFT JOIN rfid_cards ON rfid_cards.user_id = users.id
         LEFT JOIN fingerprints ON fingerprints.user_id = users.id AND fingerprints.status = 'active'
         WHERE {$roleCondition}
         GROUP BY
            users.id,
            users.username,
            users.email,
            users.role,
            users.is_active,
            users.approval_status,
            users.onboarding_step,
            users.created_at,
            {$profileTable}.{$idColumn},
            {$profileTable}.first_name,
            {$profileTable}.middle_name,
            {$profileTable}.last_name,
            {$profileTable}.extension_name,
            {$profileTable}.sex,
            {$profileTable}.contact_number,
            {$profileTable}." . ($roleKey === 'students' ? 'college' : 'office_department') . ",
            {$profileTable}." . ($roleKey === 'students' ? 'program_department' : 'work_position') . ",
            " . ($roleKey === 'students' ? "{$profileTable}.year_level,
            {$profileTable}.section," : '') . "
            rfid_cards.status
         ORDER BY {$profileTable}.last_name ASC, {$profileTable}.first_name ASC, users.username ASC"
    );

    if ($roleKey !== 'admins') {
        $statement->bindValue(':role', rtrim($roleKey, 's'));
    }

    $statement->execute();

    $standbyMap = $roleKey === 'admins' ? getSuperAdminStandbyMap($pdo) : [];

    return array_map(
        static function ($user) use ($standbyMap) {
            $nameParts = [
                $user['first_name'],
                $user['middle_name'],
                $user['last_name'],
                $user['extension_name'],
            ];
            $fullName = trim(implode(' ', array_filter($nameParts)));

            return [
                'id' => (int) $user['id'],
                'name' => $fullName ?: $user['username'],
                'username' => $user['username'],
                'email' => $user['email'],
                'role' => $user['role'],
                'identifier' => $user['profile_identifier'] ?: 'Not assigned',
                'sex' => $user['sex'] ?: 'N/A',
                'contactNumber' => $user['contact_number'] ?: 'Not provided',
                'college' => $user['college'],
                'programDepartment' => $user['program_department'],
                'yearLevel' => $user['year_level'],
                'section' => $user['section'],
                'officeDepartment' => $user['office_department'],
                'workPosition' => $user['work_position'],
                'rfidStatus' => $user['rfid_status'],
                'fingerprintCount' => (int) $user['fingerprint_count'],
                'status' => resolveAccountStatus(
                    (string) ($user['approval_status'] ?? 'approved'),
                    (bool) $user['is_active'],
                    (string) $user['role'],
                    (int) $user['id'],
                    $standbyMap,
                    (string) ($user['onboarding_step'] ?? 'done')
                ),
                'joinedAt' => $user['joined_at'],
            ];
        },
        $statement->fetchAll()
    );
}

function getUserProfileConfiguration(string $role): ?array
{
    return match ($role) {
        'student' => [
            'table' => 'student_info',
            'identifierColumn' => 'school_id',
            'identifierLabel' => 'School ID',
            'isStudent' => true,
        ],
        'faculty' => [
            'table' => 'faculty_info',
            'identifierColumn' => 'employee_id',
            'identifierLabel' => 'Employee ID',
            'isStudent' => false,
        ],
        'staff' => [
            'table' => 'staff_info',
            'identifierColumn' => 'employee_id',
            'identifierLabel' => 'Employee ID',
            'isStudent' => false,
        ],
        'admin', 'super_admin' => [
            'table' => 'admin_info',
            'identifierColumn' => 'employee_id',
            'identifierLabel' => 'Employee ID',
            'isStudent' => false,
        ],
        default => null,
    };
}

function fetchUserById(PDO $pdo, int $userId): ?array
{
    $roleStatement = $pdo->prepare('SELECT role FROM users WHERE id = :id LIMIT 1');
    $roleStatement->execute(['id' => $userId]);
    $role = $roleStatement->fetchColumn();

    if (!$role) {
        return null;
    }

    $profile = getUserProfileConfiguration((string) $role);

    if (!$profile) {
        return null;
    }

    $profileTable = $profile['table'];
    $isStudent = $profile['isStudent'];
    $schoolFields = $isStudent
        ? 'profile.college,
           profile.program_department,
           profile.year_level,
           profile.section,
           NULL AS office_department,
           NULL AS work_position'
        : 'NULL AS college,
           NULL AS program_department,
           NULL AS year_level,
           NULL AS section,
           profile.office_department,
           profile.work_position';
    $photoField = $isStudent ? 'profile.school_id_photo AS users_photo' : 'profile.users_photo';

    $statement = $pdo->prepare(
        "SELECT
            users.id,
            users.username,
            users.email,
            users.role,
            users.is_active,
            users.approval_status,
            users.onboarding_step,
            DATE_FORMAT(users.created_at, '%b %e, %Y') AS joined_at,
            profile.{$profile['identifierColumn']} AS profile_identifier,
            profile.first_name,
            profile.middle_name,
            profile.last_name,
            profile.extension_name,
            profile.sex,
            DATE_FORMAT(profile.date_of_birth, '%b %e, %Y') AS birthdate,
            DATE_FORMAT(profile.date_of_birth, '%Y-%m-%d') AS date_of_birth,
            profile.age,
            profile.contact_number,
            profile.street_address,
            profile.barangay,
            profile.city_municipality,
            profile.province,
            {$schoolFields},
            {$photoField},
            (SELECT rfid_cards.rfid_uid
             FROM rfid_cards
             WHERE rfid_cards.user_id = users.id
             ORDER BY CASE WHEN rfid_cards.status = 'active' THEN 0 ELSE 1 END,
                      rfid_cards.issued_at DESC
             LIMIT 1) AS rfid_uid,
            (SELECT COUNT(*)
             FROM fingerprints
             WHERE fingerprints.user_id = users.id
               AND fingerprints.status = 'active') AS fingerprint_count
         FROM users
         LEFT JOIN {$profileTable} AS profile ON profile.user_id = users.id
         WHERE users.id = :id
         LIMIT 1"
    );
    $statement->execute(['id' => $userId]);
    $row = $statement->fetch();

    if (!$row) {
        return null;
    }

    $name = trim(implode(' ', array_filter([
        $row['first_name'],
        $row['middle_name'],
        $row['last_name'],
        $row['extension_name'],
    ])));
    $address = trim(implode(', ', array_filter([
        $row['street_address'],
        $row['barangay'],
        $row['city_municipality'],
        $row['province'],
    ])));
    $photo = trim((string) ($row['users_photo'] ?? ''));

    if ($photo !== '' && !preg_match('/^(data:image\/|https?:\/\/|\/)/i', $photo)) {
        $photo = '';
    }

    return [
        'id' => (int) $row['id'],
        'name' => $name !== '' ? $name : $row['username'],
        'firstName' => $row['first_name'] ?? '',
        'middleName' => $row['middle_name'] ?? '',
        'lastName' => $row['last_name'] ?? '',
        'extensionName' => $row['extension_name'] ?? '',
        'username' => $row['username'],
        'email' => $row['email'],
        'role' => $row['role'],
        'identifier' => $row['profile_identifier'] ?: 'Not assigned',
        'identifierLabel' => $profile['identifierLabel'],
        'isStudent' => $isStudent,
        'sex' => $row['sex'] ?: 'Not provided',
        'birthdate' => $row['birthdate'] ?: 'Not provided',
        'dateOfBirth' => $row['date_of_birth'] ?? '',
        'age' => $row['age'] !== null ? (string) $row['age'] : '',
        'contactNumber' => $row['contact_number'] ?: 'Not provided',
        'address' => $address,
        'streetAddress' => $row['street_address'] ?? '',
        'barangay' => $row['barangay'] ?? '',
        'cityMunicipality' => $row['city_municipality'] ?? '',
        'province' => $row['province'] ?? '',
        'status' => resolveAccountStatus(
            (string) ($row['approval_status'] ?? 'approved'),
            (bool) $row['is_active'],
            (string) $row['role'],
            (int) $row['id'],
            ($row['role'] ?? '') === 'super_admin' ? getSuperAdminStandbyMap($pdo) : [],
            (string) ($row['onboarding_step'] ?? 'done')
        ),
        'rfidUid' => $row['rfid_uid'] ?: 'Not assigned',
        'college' => $row['college'],
        'yearLevel' => $row['year_level'],
        'program' => $row['program_department'],
        'programDepartment' => $row['program_department'],
        'section' => $row['section'],
        'officeDepartment' => $row['office_department'],
        'workPosition' => $row['work_position'],
        'fingerprintCount' => (int) $row['fingerprint_count'],
        'joinedAt' => $row['joined_at'],
        'photo' => $photo,
    ];
}

function normalizeEditableText(mixed $value): string
{
    return trim((string) ($value ?? ''));
}

function normalizeEditableSex(mixed $value): ?string
{
    $normalized = strtolower(normalizeEditableText($value));

    return match ($normalized) {
        'male' => 'Male',
        'female' => 'Female',
        default => null,
    };
}

function calculateEditableAge(?string $dateOfBirth): ?int
{
    if (!$dateOfBirth) {
        return null;
    }

    try {
        $birthDate = new DateTimeImmutable($dateOfBirth);
        $today = new DateTimeImmutable('today');

        if ($birthDate > $today) {
            return null;
        }

        return (int) $birthDate->diff($today)->y;
    } catch (Exception) {
        return null;
    }
}

function assertEditablePersonName(string $name, string $label, bool $required = true): void
{
    if ($name === '') {
        if ($required) {
            throw new InvalidArgumentException("{$label} is required.");
        }

        return;
    }

    if (mb_strlen($name) < 2 || mb_strlen($name) > 50) {
        throw new InvalidArgumentException("{$label} must be 2 to 50 characters.");
    }

    if (preg_match('/\p{N}/u', $name)) {
        throw new InvalidArgumentException("{$label} cannot contain numbers.");
    }

    if (preg_match('/[^A-Za-zÑñ -]/u', $name)) {
        throw new InvalidArgumentException("{$label} can only include letters, Ñ, spaces, and hyphens.");
    }

    if (!preg_match('/^[A-ZÑ]/u', $name)) {
        throw new InvalidArgumentException("{$label} must start with a capital letter.");
    }

    if (!preg_match('/^[A-ZÑ][A-Za-zÑñ]*(?:[ -][A-Za-zÑñ]+)*$/u', $name)) {
        throw new InvalidArgumentException("{$label} cannot start or end with a hyphen, or repeat spaces and hyphens.");
    }
}

function assertEditableUsername(string $username): void
{
    if ($username === '') {
        throw new InvalidArgumentException('Username is required.');
    }

    if ($username !== strtolower($username)) {
        throw new InvalidArgumentException('Username must be all lowercase.');
    }

    if (preg_match('/\p{N}/u', $username)) {
        throw new InvalidArgumentException('Username cannot contain numbers.');
    }

    if (!preg_match('/^[a-z.]+$/', $username)) {
        throw new InvalidArgumentException('Username can only use lowercase letters and a dot.');
    }

    if (!str_contains($username, '.')) {
        throw new InvalidArgumentException('Username must include a dot (.).');
    }

    if (!preg_match('/^[a-z]+(?:\.[a-z]+)+$/', $username) || strlen($username) > 50) {
        throw new InvalidArgumentException('Use lowercase letters separated by a dot, such as firstname.lastname.');
    }
}

function assertEditableSchoolEmail(string $email): void
{
    $suffix = '@csucc.edu.ph';

    if ($email === '') {
        throw new InvalidArgumentException('School email is required.');
    }

    if (!str_ends_with($email, $suffix) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new InvalidArgumentException('Email must use the @csucc.edu.ph domain.');
    }

    $localPart = substr($email, 0, -strlen($suffix));

    if (!preg_match('/^[a-z][a-z0-9._-]{2,49}$/', $localPart)) {
        throw new InvalidArgumentException('Use 3 to 50 characters, starting with a letter. Letters, numbers, dots, underscores, and hyphens only.');
    }
}

function assertEditableIdentifier(string $identifier, bool $isStudent, string $label): void
{
    if ($identifier === '') {
        throw new InvalidArgumentException("{$label} is required.");
    }

    $pattern = $isStudent ? '/^\d{4}-\d{4}$/' : '/^\d{6}-\d{6}$/';
    $format = $isStudent ? 'xxxx-xxxx' : 'xxxxxx-xxxxxx';

    if (!preg_match($pattern, $identifier)) {
        throw new InvalidArgumentException("{$label} must use {$format} format.");
    }
}

function assertEditableBoundedText(string $value, string $label, int $max, bool $required): void
{
    if ($value === '') {
        if ($required) {
            throw new InvalidArgumentException("{$label} is required.");
        }

        return;
    }

    if (strlen($value) > $max) {
        throw new InvalidArgumentException("{$label} must be {$max} characters or fewer.");
    }
}

function editableStudentPrograms(): array
{
    return [
        '(CEIT) College of Engineering and Information Technology' => [
            '(BSIT) Bachelor of Science in Information Technology',
            '(BSEE) Bachelor of Science in Electrical Engineering',
            '(BSCpE) Bachelor of Science in Computer Engineering',
        ],
        '(CTHM) College of Tourism and Hospitality Management' => [
            '(BSHM) Bachelor of Science in Hospitality Management',
            '(BSTM) Bachelor of Science in Tourism Management',
        ],
        '(CITTE) College of Industrial and Technical Teacher Education' => [
            '(BSIndTech) - Architectural Drafting Technology',
            '(BSIndTech) - Automotive Technology',
            '(BSIndTech) - Civil Technology',
            '(BSIndTech) - (BSIndTech)',
            '(BSIndTech) - Electronics Technology',
            '(BTVTED) Bachelor of Technical Vocational Teacher Education',
        ],
        '(CBA) College of Business and Accountancy' => [
            '(BSA) Bachelor of Science in Accountancy',
            '(BSMA) Bachelor of Science in Management Accounting',
            '(BSOA) Bachelor of Science in Office Administration',
            '(BSBA) Bachelor of Science in Business Administration',
            '(BSEntrep) Bachelor of Science in Entrepreneurship',
        ],
    ];
}

function assertEditableAccountIsUnique(PDO $pdo, int $userId, string $username, string $email, string $identifier, bool $isStudent): void
{
    $usernameStatement = $pdo->prepare(
        'SELECT id FROM users WHERE username = :username AND id <> :id LIMIT 1'
    );
    $usernameStatement->execute([
        'username' => $username,
        'id' => $userId,
    ]);

    if ($usernameStatement->fetch()) {
        throw new InvalidArgumentException('Username already exists. Choose another username.');
    }

    $emailStatement = $pdo->prepare(
        'SELECT id FROM users WHERE email = :email AND id <> :id LIMIT 1'
    );
    $emailStatement->execute([
        'email' => $email,
        'id' => $userId,
    ]);

    if ($emailStatement->fetch()) {
        throw new InvalidArgumentException('Email already exists. Use a different school email.');
    }

    if ($isStudent) {
        $identifierStatement = $pdo->prepare(
            'SELECT user_id FROM student_info WHERE school_id = :identifier AND user_id <> :user_id LIMIT 1'
        );
        $identifierStatement->execute([
            'identifier' => $identifier,
            'user_id' => $userId,
        ]);

        if ($identifierStatement->fetch()) {
            throw new InvalidArgumentException('School ID already exists.');
        }

        return;
    }

    foreach (['faculty_info', 'staff_info', 'admin_info'] as $table) {
        $identifierStatement = $pdo->prepare(
            "SELECT user_id FROM {$table} WHERE employee_id = :identifier AND user_id <> :user_id LIMIT 1"
        );
        $identifierStatement->execute([
            'identifier' => $identifier,
            'user_id' => $userId,
        ]);

        if ($identifierStatement->fetch()) {
            throw new InvalidArgumentException('Employee ID already exists.');
        }
    }
}

function updateUserById(PDO $pdo, int $userId, array $input): array
{
    $roleStatement = $pdo->prepare('SELECT role, is_active FROM users WHERE id = :id LIMIT 1');
    $roleStatement->execute(['id' => $userId]);
    $account = $roleStatement->fetch(PDO::FETCH_ASSOC) ?: null;
    $role = $account['role'] ?? null;

    if (!$role) {
        throw new InvalidArgumentException('That user was not found.');
    }

    $profile = getUserProfileConfiguration((string) $role);

    if (!$profile) {
        throw new InvalidArgumentException('That user role is not supported.');
    }

    $isStudent = $profile['isStudent'];
    $firstName = normalizeEditableText($input['firstName'] ?? $input['first_name'] ?? '');
    $middleName = normalizeEditableText($input['middleName'] ?? $input['middle_name'] ?? '');
    $lastName = normalizeEditableText($input['lastName'] ?? $input['last_name'] ?? '');
    $extensionName = normalizeEditableText($input['extensionName'] ?? $input['extension_name'] ?? '');
    $sex = normalizeEditableSex($input['sex'] ?? '');
    $dateOfBirth = normalizeEditableText($input['dateOfBirth'] ?? $input['date_of_birth'] ?? '');
    $contactNumber = normalizeEditableText($input['contactNumber'] ?? $input['contact_number'] ?? '');
    $streetAddress = normalizeEditableText($input['streetAddress'] ?? $input['street_address'] ?? '');
    $barangay = normalizeEditableText($input['barangay'] ?? '');
    $cityMunicipality = normalizeEditableText($input['cityMunicipality'] ?? $input['city_municipality'] ?? '');
    $province = normalizeEditableText($input['province'] ?? '');
    $username = normalizeEditableText($input['username'] ?? '');
    $email = strtolower(normalizeEditableText($input['email'] ?? ''));
    $identifier = normalizeEditableText($input['identifier'] ?? '');
    $status = strtolower(normalizeEditableText($input['status'] ?? 'active'));

    $keepCurrentActive = $status === 'pending_login';

    if ($status === 'blocked') {
        $status = 'inactive';
    }

    if (!in_array($status, ['active', 'inactive', 'pending_login'], true)) {
        throw new InvalidArgumentException('Status must be active, inactive, or blocked.');
    }

    $isActive = $keepCurrentActive
        ? ((int) ($account['is_active'] ?? 0) === 1 ? 1 : 0)
        : ($status === 'active' ? 1 : 0);

    assertEditablePersonName($firstName, 'First name');
    assertEditablePersonName($middleName, 'Middle name', false);
    assertEditablePersonName($lastName, 'Last name');

    if ($extensionName !== '' && !in_array($extensionName, ['Jr.', 'Sr.', 'II', 'III', 'IV', 'V'], true)) {
        throw new InvalidArgumentException('Extension must be Jr., Sr., II, III, IV, or V.');
    }

    if ($sex === null) {
        throw new InvalidArgumentException('Sex must be Male or Female.');
    }

    if ($dateOfBirth === '') {
        throw new InvalidArgumentException('Date of birth is required.');
    }

    $age = calculateEditableAge($dateOfBirth);

    if ($age === null) {
        throw new InvalidArgumentException('Date of birth must be a valid past date.');
    }

    if ($contactNumber === '' || !preg_match('/^\d{11}$/', $contactNumber)) {
        throw new InvalidArgumentException('Contact number must be 11 digits.');
    }

    assertEditableUsername($username);
    assertEditableSchoolEmail($email);
    assertEditableIdentifier($identifier, $isStudent, $profile['identifierLabel']);
    assertEditableBoundedText($streetAddress, 'Street address', 255, false);
    assertEditableBoundedText($barangay, 'Barangay', 100, true);
    assertEditableBoundedText($cityMunicipality, 'City / Municipality', 100, true);
    assertEditableBoundedText($province, 'Province', 100, true);
    assertEditableAccountIsUnique($pdo, $userId, $username, $email, $identifier, $isStudent);

    $college = normalizeEditableText($input['college'] ?? '');
    $programDepartment = normalizeEditableText(
        $input['program'] ?? $input['programDepartment'] ?? $input['program_department'] ?? '',
    );
    $yearLevel = normalizeEditableText($input['yearLevel'] ?? $input['year_level'] ?? '');
    $section = normalizeEditableText($input['section'] ?? '');
    $officeDepartment = normalizeEditableText(
        $input['officeDepartment'] ?? $input['office_department'] ?? '',
    );
    $workPosition = normalizeEditableText($input['workPosition'] ?? $input['work_position'] ?? '');

    if ($isStudent) {
        $programs = editableStudentPrograms();

        if ($college === '') {
            throw new InvalidArgumentException('College is required.');
        }

        if ($programDepartment === '') {
            throw new InvalidArgumentException('Program is required.');
        }

        if (isset($programs[$college]) && !in_array($programDepartment, $programs[$college], true)) {
            throw new InvalidArgumentException('Select a program for the chosen college.');
        }

        if (!in_array($yearLevel, ['First Year', 'Second Year', 'Third Year', 'Fourth Year'], true)) {
            throw new InvalidArgumentException('Year level is required.');
        }

        if ($section !== '' && !in_array($section, ['Block A', 'Block B', 'Block C', 'Block D'], true)) {
            throw new InvalidArgumentException('Section must be Block A, Block B, Block C, or Block D.');
        }
    } else {
        assertEditableBoundedText($officeDepartment, 'Department', 150, true);
        assertEditableBoundedText($workPosition, 'Position', 150, true);
    }

    $rfidUid = null;

    if ($isStudent && array_key_exists('rfidUid', $input)) {
        $rfidUid = strtoupper(preg_replace('/\s+/', '', (string) ($input['rfidUid'] ?? $input['rfid_uid'] ?? '')));

        if ($rfidUid === '') {
            $rfidUid = null;
        } else {
            if (strlen($rfidUid) > 30 || !preg_match('/^[A-Z0-9]+$/', $rfidUid)) {
                throw new InvalidArgumentException('RFID UID must be up to 30 letters or numbers.');
            }

            $duplicateRfid = $pdo->prepare(
                'SELECT card_id
                 FROM rfid_cards
                 WHERE rfid_uid = :rfid_uid
                   AND user_id <> :user_id
                 LIMIT 1'
            );
            $duplicateRfid->execute([
                'rfid_uid' => $rfidUid,
                'user_id' => $userId,
            ]);

            if ($duplicateRfid->fetch()) {
                throw new InvalidArgumentException('That RFID UID is already assigned to another user.');
            }
        }
    }

    $pdo->beginTransaction();

    try {
        $userUpdate = $pdo->prepare(
            'UPDATE users
             SET username = :username,
                 email = :email,
                 is_active = :is_active
             WHERE id = :id'
        );
        $userUpdate->execute([
            'username' => $username,
            'email' => $email,
            'is_active' => $isActive,
            'id' => $userId,
        ]);

        $profileTable = $profile['table'];
        $identifierColumn = $profile['identifierColumn'];

        if ($isStudent) {
            $profileUpdate = $pdo->prepare(
                "UPDATE {$profileTable}
                 SET {$identifierColumn} = :identifier,
                     first_name = :first_name,
                     middle_name = :middle_name,
                     last_name = :last_name,
                     extension_name = :extension_name,
                     sex = :sex,
                     date_of_birth = :date_of_birth,
                     age = :age,
                     contact_number = :contact_number,
                     street_address = :street_address,
                     barangay = :barangay,
                     city_municipality = :city_municipality,
                     province = :province,
                     college = :college,
                     program_department = :program_department,
                     year_level = :year_level,
                     section = :section
                 WHERE user_id = :user_id"
            );
            $profileUpdate->execute([
                'identifier' => $identifier,
                'first_name' => $firstName,
                'middle_name' => $middleName !== '' ? $middleName : null,
                'last_name' => $lastName,
                'extension_name' => $extensionName !== '' ? $extensionName : null,
                'sex' => $sex,
                'date_of_birth' => $dateOfBirth,
                'age' => $age,
                'contact_number' => $contactNumber,
                'street_address' => $streetAddress !== '' ? $streetAddress : null,
                'barangay' => $barangay !== '' ? $barangay : null,
                'city_municipality' => $cityMunicipality !== '' ? $cityMunicipality : null,
                'province' => $province !== '' ? $province : null,
                'college' => $college,
                'program_department' => $programDepartment,
                'year_level' => $yearLevel,
                'section' => $section !== '' ? $section : null,
                'user_id' => $userId,
            ]);

            if (array_key_exists('rfidUid', $input) || array_key_exists('rfid_uid', $input)) {
                $existingCard = $pdo->prepare(
                    'SELECT card_id
                     FROM rfid_cards
                     WHERE user_id = :user_id
                     ORDER BY CASE WHEN status = \'active\' THEN 0 ELSE 1 END,
                              issued_at DESC
                     LIMIT 1'
                );
                $existingCard->execute(['user_id' => $userId]);
                $card = $existingCard->fetch();

                if ($rfidUid === null) {
                    if ($card) {
                        $deleteCard = $pdo->prepare(
                            'DELETE FROM rfid_cards WHERE card_id = :card_id'
                        );
                        $deleteCard->execute(['card_id' => (int) $card['card_id']]);
                    }
                } elseif ($card) {
                    $updateCard = $pdo->prepare(
                        "UPDATE rfid_cards
                         SET rfid_uid = :rfid_uid,
                             status = 'active'
                         WHERE card_id = :card_id"
                    );
                    $updateCard->execute([
                        'rfid_uid' => $rfidUid,
                        'card_id' => (int) $card['card_id'],
                    ]);
                } else {
                    $insertCard = $pdo->prepare(
                        "INSERT INTO rfid_cards (user_id, rfid_uid, status)
                         VALUES (:user_id, :rfid_uid, 'active')"
                    );
                    $insertCard->execute([
                        'user_id' => $userId,
                        'rfid_uid' => $rfidUid,
                    ]);
                }
            }
        } else {
            $profileUpdate = $pdo->prepare(
                "UPDATE {$profileTable}
                 SET {$identifierColumn} = :identifier,
                     first_name = :first_name,
                     middle_name = :middle_name,
                     last_name = :last_name,
                     extension_name = :extension_name,
                     sex = :sex,
                     date_of_birth = :date_of_birth,
                     age = :age,
                     contact_number = :contact_number,
                     street_address = :street_address,
                     barangay = :barangay,
                     city_municipality = :city_municipality,
                     province = :province,
                     office_department = :office_department,
                     work_position = :work_position
                 WHERE user_id = :user_id"
            );
            $profileUpdate->execute([
                'identifier' => $identifier,
                'first_name' => $firstName,
                'middle_name' => $middleName !== '' ? $middleName : null,
                'last_name' => $lastName,
                'extension_name' => $extensionName !== '' ? $extensionName : null,
                'sex' => $sex,
                'date_of_birth' => $dateOfBirth,
                'age' => $age,
                'contact_number' => $contactNumber,
                'street_address' => $streetAddress !== '' ? $streetAddress : null,
                'barangay' => $barangay !== '' ? $barangay : null,
                'city_municipality' => $cityMunicipality !== '' ? $cityMunicipality : null,
                'province' => $province !== '' ? $province : null,
                'office_department' => $officeDepartment,
                'work_position' => $workPosition,
                'user_id' => $userId,
            ]);
        }

        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $error;
    }

    if ($role === 'super_admin') {
        try {
            $dashboardSession = new SuperAdminDashboardSession($pdo);

            if ($isActive === 0) {
                $dashboardSession->removeFromStandby($userId);
                $dashboardSession->releaseIfHeldBy($userId);
            } else {
                $dashboardSession->removeFromStandby($userId);
                $holderId = $dashboardSession->getActiveHolderId();

                if ($holderId !== null && $holderId !== $userId) {
                    $dashboardSession->putOnStandby($userId);
                }
            }
        } catch (Throwable) {
            // Optional session sync.
        }
    }

    $updatedUser = fetchUserById($pdo, $userId);

    if (!$updatedUser) {
        throw new RuntimeException('User was updated but could not be reloaded.');
    }

    return $updatedUser;
}

function deleteUserById(PDO $pdo, int $userId, ?int $actorId = null): void
{
    if ($actorId !== null && $actorId === $userId) {
        throw new InvalidArgumentException('You cannot delete your own account.');
    }

    $roleStatement = $pdo->prepare('SELECT role FROM users WHERE id = :id LIMIT 1');
    $roleStatement->execute(['id' => $userId]);
    $role = $roleStatement->fetchColumn();

    if (!$role) {
        throw new InvalidArgumentException('That user was not found.');
    }

    if ((string) $role === 'super_admin') {
        $superAdminCount = (int) $pdo->query(
            "SELECT COUNT(*) FROM users WHERE role = 'super_admin'"
        )->fetchColumn();

        if ($superAdminCount <= 1) {
            throw new InvalidArgumentException('The last super admin account cannot be deleted.');
        }
    }

    $profile = getUserProfileConfiguration((string) $role);
    $profileTable = $profile['table'] ?? null;

    $pdo->beginTransaction();

    try {
        $relatedTables = [
            'password_reset_challenges',
            'account_security_questions',
            'user_login_sessions',
            'login_attempts',
            'rfid_cards',
            'fingerprint_enrollment_jobs',
            'fingerprints',
            'schedules',
            'schedule_edit_history',
            'access_overrides',
            'access_log',
        ];

        foreach ($relatedTables as $table) {
            try {
                $statement = $pdo->prepare("DELETE FROM {$table} WHERE user_id = :user_id");
                $statement->execute(['user_id' => $userId]);
            } catch (PDOException) {
                // Skip tables that are not present in this environment.
            }
        }

        if ($profileTable) {
            $profileDelete = $pdo->prepare("DELETE FROM {$profileTable} WHERE user_id = :user_id");
            $profileDelete->execute(['user_id' => $userId]);
        }

        try {
            $scheduleRefs = $pdo->prepare(
                'UPDATE schedules
                 SET created_by = NULL
                 WHERE created_by = :user_id'
            );
            $scheduleRefs->execute(['user_id' => $userId]);
        } catch (PDOException) {
            // Optional column cleanup.
        }

        try {
            $scheduleApprovals = $pdo->prepare(
                'UPDATE schedules
                 SET approved_by = NULL
                 WHERE approved_by = :user_id'
            );
            $scheduleApprovals->execute(['user_id' => $userId]);
        } catch (PDOException) {
            // Optional column cleanup.
        }

        $userDelete = $pdo->prepare('DELETE FROM users WHERE id = :id');
        $userDelete->execute(['id' => $userId]);

        if ($userDelete->rowCount() < 1) {
            throw new InvalidArgumentException('That user was not found.');
        }

        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $error;
    }
}

function changeUserPasswordById(PDO $pdo, int $userId, string $newPassword, string $confirmPassword): void
{
    if ($newPassword === '') {
        throw new InvalidArgumentException('New password is required.');
    }

    if (strlen($newPassword) < 8) {
        throw new InvalidArgumentException('Password must be at least 8 characters.');
    }

    if (!preg_match('/[A-Z]/', $newPassword)) {
        throw new InvalidArgumentException('Password must include an uppercase letter.');
    }

    if (!preg_match('/[a-z]/', $newPassword)) {
        throw new InvalidArgumentException('Password must include a lowercase letter.');
    }

    if (!preg_match('/\d/', $newPassword)) {
        throw new InvalidArgumentException('Password must include a number.');
    }

    if (!preg_match('/[^A-Za-z0-9]/', $newPassword)) {
        throw new InvalidArgumentException('Password must include a special character.');
    }

    if (strlen($newPassword) > 72) {
        throw new InvalidArgumentException('Password must be 72 characters or fewer.');
    }

    if ($confirmPassword === '') {
        throw new InvalidArgumentException('Please confirm the new password.');
    }

    if ($newPassword !== $confirmPassword) {
        throw new InvalidArgumentException('Password and re-entered password must match.');
    }

    $statement = $pdo->prepare('SELECT id, password_hash FROM users WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $userId]);
    $user = $statement->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        throw new InvalidArgumentException('That user was not found.');
    }

    if (password_verify($newPassword, (string) $user['password_hash'])) {
        throw new InvalidArgumentException('Choose a password that is different from the current password.');
    }

    $update = $pdo->prepare(
        'UPDATE users
         SET password_hash = :password_hash,
             password_updated_at = CURRENT_TIMESTAMP
         WHERE id = :id'
    );
    $update->execute([
        'password_hash' => password_hash($newPassword, PASSWORD_DEFAULT),
        'id' => $userId,
    ]);
}

function setUserBlockStatusById(
    PDO $pdo,
    int $userId,
    bool $shouldBlock,
    ?int $actorId = null,
    bool $demoteToAdmin = false,
    ?array $privileges = null
): array {
    if ($actorId !== null && $actorId === $userId) {
        throw new InvalidArgumentException(
            $shouldBlock
                ? 'You cannot block your own account.'
                : 'You cannot change your own block status this way.'
        );
    }

    $statement = $pdo->prepare(
        'SELECT id, role, is_active FROM users WHERE id = :id LIMIT 1'
    );
    $statement->execute(['id' => $userId]);
    $user = $statement->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        throw new InvalidArgumentException('That user was not found.');
    }

    $isCurrentlyActive = (bool) $user['is_active'];
    $role = (string) ($user['role'] ?? '');
    $dashboardSession = null;

    try {
        $dashboardSession = new SuperAdminDashboardSession($pdo);
    } catch (Throwable) {
        $dashboardSession = null;
    }

    $isStandby = $dashboardSession?->isStandbyUser($userId) ?? false;
    $isBlocked = !$isCurrentlyActive && !$isStandby;

    if ($shouldBlock && $isBlocked) {
        throw new InvalidArgumentException('That user is already blocked.');
    }

    if (!$shouldBlock && $isCurrentlyActive) {
        throw new InvalidArgumentException('That user is not blocked.');
    }

    if ($shouldBlock && $role === 'super_admin' && $isCurrentlyActive) {
        $activeSuperAdminCount = (int) $pdo->query(
            "SELECT COUNT(*) FROM users WHERE role = 'super_admin' AND is_active = 1"
        )->fetchColumn();

        if ($activeSuperAdminCount <= 1) {
            throw new InvalidArgumentException('The last active super admin account cannot be blocked.');
        }
    }

    if ($shouldBlock && $isStandby) {
        $dashboardSession?->removeFromStandby($userId);
    }

    if (!$shouldBlock && $demoteToAdmin) {
        if ($role !== 'super_admin') {
            throw new InvalidArgumentException('Only a Super Admin account can be unblocked as Admin.');
        }

        if (!$isBlocked) {
            throw new InvalidArgumentException('That user is not blocked.');
        }

        if (countOccupiedSuperAdminSlots($pdo, $userId) < 2) {
            throw new InvalidArgumentException(
                'A Super Admin slot is available. Unblock this account as Super Admin instead.'
            );
        }

        if (!is_array($privileges) || $privileges === []) {
            throw new InvalidArgumentException('Select at least one privilege for the Admin account.');
        }

        $pdo->beginTransaction();

        try {
            $update = $pdo->prepare(
                "UPDATE users
                 SET role = 'admin', is_active = 1
                 WHERE id = :id"
            );
            $update->execute(['id' => $userId]);

            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }

            throw $error;
        }

        try {
            $dashboardSession?->releaseIfHeldBy($userId);
            $dashboardSession?->removeFromStandby($userId);
        } catch (Throwable) {
            // Optional session cleanup.
        }

        (new UserPrivilegeService($pdo))->setPrivileges($userId, $privileges);

        $updatedUser = fetchUserById($pdo, $userId);

        if (!$updatedUser) {
            throw new RuntimeException('User was unblocked as Admin but could not be reloaded.');
        }

        return $updatedUser;
    }

    if (!$shouldBlock && $role === 'super_admin' && countOccupiedSuperAdminSlots($pdo, $userId) >= 2) {
        throw new InvalidArgumentException(
            'The maximum of 2 Super Admin accounts has already been reached. Unblock this account as Admin instead.',
            40901
        );
    }

    $update = $pdo->prepare(
        'UPDATE users
         SET is_active = :is_active
         WHERE id = :id'
    );
    $update->execute([
        'is_active' => $shouldBlock ? 0 : 1,
        'id' => $userId,
    ]);

    if ($shouldBlock) {
        try {
            $dashboardSession?->releaseIfHeldBy($userId);
            $dashboardSession?->removeFromStandby($userId);
        } catch (Throwable) {
            // Optional session cleanup.
        }

        try {
            $clearSessions = $pdo->prepare(
                'DELETE FROM user_login_sessions WHERE user_id = :user_id'
            );
            $clearSessions->execute(['user_id' => $userId]);
        } catch (PDOException) {
            // Optional session cleanup.
        }

        try {
            $clearAttempts = $pdo->prepare(
                'DELETE FROM login_attempts WHERE user_id = :user_id'
            );
            $clearAttempts->execute(['user_id' => $userId]);
        } catch (PDOException) {
            // Optional attempt cleanup.
        }
    } else {
        $dashboardSession?->removeFromStandby($userId);

        if ($role === 'super_admin' && $dashboardSession) {
            $holderId = $dashboardSession->getActiveHolderId();

            if ($holderId !== null && $holderId !== $userId) {
                $dashboardSession->putOnStandby($userId);
            }
        }
    }

    $updatedUser = fetchUserById($pdo, $userId);

    if (!$updatedUser) {
        throw new RuntimeException('User status was updated but could not be reloaded.');
    }

    return $updatedUser;
}

try {
    $pdo = entrivo_pdo();

    if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['id'])) {
        $userId = filter_var($_GET['id'], FILTER_VALIDATE_INT);

        if (!$userId) {
            http_response_code(422);
            echo json_encode(['message' => 'A valid user id is required.']);
            exit;
        }

        $user = fetchUserById($pdo, $userId);

        if (!$user) {
            http_response_code(404);
            echo json_encode(['message' => 'That user was not found.']);
            exit;
        }

        echo json_encode([
            'message' => 'User loaded.',
            'user' => $user,
        ]);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
        $input = json_decode(file_get_contents('php://input'), true);

        if (!is_array($input)) {
            http_response_code(400);
            echo json_encode(['message' => 'Invalid JSON payload.']);
            exit;
        }

        $userId = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);

        if (!$userId) {
            http_response_code(422);
            echo json_encode(['message' => 'A valid user id is required.']);
            exit;
        }

        $updatedUser = updateUserById($pdo, $userId, $input);
        $actorId = filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT) ?: null;

        (new ActivityLogService($pdo))->record(
            $actorId,
            'Edit',
            'Edited user profile for ' . activityUserLabel($updatedUser) . '.',
            'Success',
            $userId,
            'user',
            (string) $userId
        );

        echo json_encode([
            'message' => 'User updated successfully.',
            'user' => $updatedUser,
        ]);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $userId = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT);
        $actorId = filter_var($_GET['actor_id'] ?? null, FILTER_VALIDATE_INT) ?: null;

        if (!$userId) {
            $input = json_decode(file_get_contents('php://input'), true);
            if (is_array($input)) {
                $userId = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);
                $actorId = filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT) ?: $actorId;
            }
        }

        if (!$userId) {
            http_response_code(422);
            echo json_encode(['message' => 'A valid user id is required.']);
            exit;
        }

        if (!$actorId) {
            http_response_code(422);
            echo json_encode(['message' => 'A valid actor id is required.']);
            exit;
        }

        require_once dirname(__DIR__) . '/services/UserPrivilegeService.php';
        (new UserPrivilegeService($pdo))->assertActorHasPrivilege(
            $actorId,
            'delete_users',
            'You do not have permission to delete users. Ask a Super Admin to grant Delete Users access.'
        );
        (new UserPrivilegeService($pdo))->assertActorCanDeleteRecords(
            $actorId,
            'Admin accounts cannot delete user records.'
        );

        $existingUser = fetchUserById($pdo, $userId);
        deleteUserById($pdo, $userId, $actorId);

        (new ActivityLogService($pdo))->record(
            $actorId,
            'Delete',
            'Deleted user account for ' . activityUserLabel($existingUser) . '.',
            'Success',
            $userId,
            'user',
            (string) $userId
        );

        echo json_encode([
            'message' => 'User deleted successfully.',
        ]);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);

        if (!is_array($input)) {
            http_response_code(400);
            echo json_encode(['message' => 'Invalid JSON payload.']);
            exit;
        }

        if (($input['action'] ?? '') === 'change_password') {
            $userId = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);

            if (!$userId) {
                http_response_code(422);
                echo json_encode(['message' => 'A valid user id is required.']);
                exit;
            }

            changeUserPasswordById(
                $pdo,
                $userId,
                (string) ($input['new_password'] ?? $input['password'] ?? ''),
                (string) ($input['confirm_password'] ?? '')
            );

            $actorId = filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT) ?: null;
            $targetUser = fetchUserById($pdo, $userId);

            (new ActivityLogService($pdo))->record(
                $actorId,
                'Update',
                'Updated password for ' . activityUserLabel($targetUser) . '.',
                'Success',
                $userId,
                'password',
                (string) $userId
            );

            echo json_encode([
                'message' => 'Password updated successfully.',
            ]);
            exit;
        }

        if (($input['action'] ?? '') === 'set_block_status') {
            $userId = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);
            $actorId = filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT) ?: null;
            $shouldBlock = filter_var($input['blocked'] ?? null, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            $demoteToAdmin = filter_var(
                $input['demote_to_admin'] ?? false,
                FILTER_VALIDATE_BOOLEAN,
                FILTER_NULL_ON_FAILURE
            ) ?? false;
            $privileges = $input['privileges'] ?? null;

            if (!$userId) {
                http_response_code(422);
                echo json_encode(['message' => 'A valid user id is required.']);
                exit;
            }

            if ($shouldBlock === null) {
                http_response_code(422);
                echo json_encode(['message' => 'A valid block status is required.']);
                exit;
            }

            $updatedUser = setUserBlockStatusById(
                $pdo,
                $userId,
                $shouldBlock,
                $actorId,
                $demoteToAdmin,
                is_array($privileges) ? $privileges : null
            );

            (new ActivityLogService($pdo))->record(
                $actorId,
                $shouldBlock ? 'Block' : 'Unblock',
                ($shouldBlock ? 'Blocked' : 'Unblocked') . ' user account for ' . activityUserLabel($updatedUser) . '.',
                'Success',
                $userId,
                'user',
                (string) $userId
            );

            echo json_encode([
                'message' => $shouldBlock
                    ? 'User blocked successfully.'
                    : ($demoteToAdmin
                        ? 'User unblocked as Admin successfully.'
                        : 'User unblocked successfully.'),
                'user' => $updatedUser,
            ]);
            exit;
        }

        $actorId = filter_var($input['actor_id'] ?? $input['created_by'] ?? null, FILTER_VALIDATE_INT) ?: null;
        $requestedRole = strtolower(trim((string) ($input['role'] ?? '')));

        if (in_array($requestedRole, ['admin', 'faculty', 'staff', 'super_admin', 'superadmin'], true)) {
            require_once dirname(__DIR__) . '/services/UserPrivilegeService.php';
            (new UserPrivilegeService($pdo))->assertActorCanDeleteRecords(
                (int) $actorId,
                'Only a Super Admin can create admin, faculty, staff, and super admin accounts.'
            );
        }

        $service = new UserRegistrationService($pdo);
        $savedUser = $service->registerUser($input);

        $savedUserId = (int) ($savedUser['user_id'] ?? $savedUser['id'] ?? 0);

        (new ActivityLogService($pdo))->record(
            $actorId,
            'Add',
            'Added new ' . str_replace('_', ' ', (string) ($savedUser['role'] ?? 'user'))
                . ' account for ' . activityUserLabel($savedUser) . '.',
            'Success',
            $savedUserId > 0 ? $savedUserId : null,
            'user',
            $savedUserId > 0 ? (string) $savedUserId : null
        );

        require_once dirname(__DIR__) . '/services/FirstLoginService.php';
        $firstLogin = new FirstLoginService($pdo);
        $savedUser['fingerprint_note'] = $firstLogin->fingerprintNote($savedUser['fingerprint'] ?? null);
        $savedUser['credential_email_sent'] = false;

        try {
            $firstLogin->sendNewAccountEmail(
                (string) ($savedUser['email'] ?? ''),
                (string) ($savedUser['full_name'] ?? ''),
                (string) ($savedUser['username'] ?? ''),
                (string) ($savedUser['temporary_password'] ?? ''),
                (string) $savedUser['fingerprint_note'],
                $savedUserId,
                $actorId ?: null
            );
            $savedUser['credential_email_sent'] = true;
        } catch (Throwable) {
            (new ActivityLogService($pdo))->record(
                $actorId,
                'Add',
                'Account credential email could not be sent for ' . activityUserLabel($savedUser) . '.',
                'Failed',
                $savedUserId > 0 ? $savedUserId : null,
                'user',
                $savedUserId > 0 ? (string) $savedUserId : null
            );
        }

        $message = 'Account created. The user finishes the remaining details on first login.';

        if (!$savedUser['credential_email_sent']) {
            $message .= ' The credential email could not be sent.';
        }

        http_response_code(201);
        echo json_encode([
            'message' => $message,
            'user' => $savedUser,
        ]);
        exit;
    }

    echo json_encode([
        'message' => 'Users loaded.',
        'users' => [
            'faculty' => fetchUsersByRole($pdo, 'faculty'),
            'staff' => fetchUsersByRole($pdo, 'staff'),
            'admins' => fetchUsersByRole($pdo, 'admins'),
            'students' => fetchUsersByRole($pdo, 'students'),
        ],
    ]);
} catch (RegistrationDuplicateException $error) {
    http_response_code(409);
    echo json_encode([
        'message' => $error->getMessage(),
        'errors' => $error->fieldErrors,
    ]);
} catch (InvalidArgumentException $error) {
    http_response_code(422);
    $payload = [
        'message' => $error->getMessage(),
    ];

    if ((int) $error->getCode() === 40901) {
        $payload['code'] = 'require_demote_to_admin';
    }

    echo json_encode($payload);
} catch (PDOException $error) {
    $isDuplicate = $error->errorInfo[1] ?? null;
    http_response_code($isDuplicate === 1062 ? 409 : 500);
    echo json_encode([
        'message' => $isDuplicate === 1062
            ? 'Username, email, school ID, employee ID, or fingerprint slot already exists.'
            : 'Unable to save user.',
        'error' => $error->getMessage(),
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'message' => 'Unable to load or save users.',
        'error' => $error->getMessage(),
    ]);
}
