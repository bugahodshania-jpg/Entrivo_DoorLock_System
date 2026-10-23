<?php

require_once __DIR__ . '/RegistrationUniquenessService.php';
require_once __DIR__ . '/RegistrationInputValidation.php';

class UserRegistrationService
{
    private const SCHOOL_EMAIL_DOMAIN = 'csucc.edu.ph';
    private const CONTACT_NUMBER_LENGTH = 11;
    private const SECURITY_QUESTIONS = [
        'What is the name of your first school?',
        'What is your mother\'s maiden name?',
        'What city were you born in?',
        'What is the name of your favorite teacher?',
        'What was the name of your first pet?',
        'What is your favorite book?',
    ];
    private const STUDENT_PROGRAMS = [
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

    private const PROFILE_TABLES = [
        'student' => 'student_info',
        'faculty' => 'faculty_info',
        'staff' => 'staff_info',
        'admin' => 'admin_info',
        'super_admin' => 'admin_info',
    ];

    public function __construct(private PDO $pdo)
    {
    }

    public function registerUser(array $input): array
    {
        $role = $this->normalizeRole($input['role'] ?? null);

        if (!isset(self::PROFILE_TABLES[$role])) {
            throw new InvalidArgumentException('Role must be student, faculty, staff, admin, or superadmin.');
        }

        if (in_array($role, ['admin', 'super_admin'], true)) {
            if ($role === 'super_admin') {
                $this->assertCanCreateSuperAdmin();
            } else {
                $this->assertCanCreateActiveAdmin();
            }
        }

        $username = $this->normalizeUsername($this->requiredText($input, 'username', 'Username'));
        $idLabel = $role === 'student' ? 'School ID' : 'Employee ID';
        $identifier = $this->normalizeIssuedId(
            $this->requiredText($input, $role === 'student' ? 'school_id' : 'employee_id', $idLabel),
            $idLabel,
            $role
        );
        $password = $this->temporaryPasswordFromId($username, $identifier);
        $email = $this->normalizeEmail($this->requiredText($input, 'email', 'School email'));
        $firstName = $this->normalizePersonName($this->requiredText($input, 'first_name', 'First name'), 'First name');
        $lastName = $this->normalizePersonName($this->requiredText($input, 'last_name', 'Last name'), 'Last name');
        $rfidUid = $role === 'student'
            ? $this->requireScannedRfidUid($input['rfid_uid'] ?? $input['rfidUid'] ?? null)
            : null;
        (new RegistrationUniquenessService($this->pdo))->assertAvailable([
            ($role === 'student' ? 'school_id' : 'employee_id') => $identifier,
            'email' => $email,
            'username' => $username,
            ...($rfidUid !== null ? ['rfid_uid' => $rfidUid] : []),
        ]);
        $middleName = $this->normalizeTitleText($this->optionalText($input['middle_name'] ?? null));

        $sharedProfile = [
            'first_name' => $firstName,
            'middle_name' => $middleName,
            'last_name' => $lastName,
            'extension_name' => null,
            'sex' => null,
            'date_of_birth' => null,
            'age' => null,
            'contact_number' => null,
            'province' => null,
            'city_municipality' => null,
            'barangay' => null,
            'street_address' => null,
        ];

        if ($role === 'student') {
            $profile = [
                'school_id' => $identifier,
                ...$sharedProfile,
                'college' => null,
                'program_department' => null,
                'year_level' => null,
                'section' => null,
            ];
        } else {
            $profile = [
                'employee_id' => $identifier,
                ...$sharedProfile,
                'office_department' => null,
                'work_position' => null,
                'users_photo' => null,
            ];
        }

        try {
            $this->pdo->beginTransaction();

            $userStatement = $this->pdo->prepare(
                "INSERT INTO users (username, email, password_hash, role, is_active, must_change_password, onboarding_step)
                 VALUES (:username, :email, :password_hash, :role, TRUE, 1, 'password')"
            );
            $userStatement->execute([
                'username' => $username,
                'email' => $email,
                'password_hash' => password_hash($password, PASSWORD_DEFAULT),
                'role' => $role,
            ]);

            $userId = (int)$this->pdo->lastInsertId();
            $this->insertProfile($role, $userId, $profile);
            $fingerprint = $this->createPendingFingerprint($userId);
            $rfid = $rfidUid !== null ? $this->createRfidCard($userId, $rfidUid) : null;

            $this->pdo->commit();

            if (in_array($role, ['admin', 'super_admin'], true)) {
                try {
                    require_once dirname(__DIR__) . '/services/UserPrivilegeService.php';
                    (new UserPrivilegeService($this->pdo))->seedDefaultsIfMissing($userId, $role);
                } catch (Throwable) {
                    // Privileges can be seeded later on login.
                }
            }

            if ($role === 'super_admin') {
                try {
                    require_once dirname(__DIR__) . '/services/SuperAdminDashboardSession.php';
                    (new SuperAdminDashboardSession($this->pdo))->placeOnStandbyIfSessionHeldByOther($userId);
                } catch (Throwable) {
                    // Session standby sync is best-effort.
                }
            }

            return [
                'user_id' => $userId,
                'username' => $username,
                'email' => $email,
                'role' => $role,
                'full_name' => $this->buildFullName($profile),
                'employee_id' => $profile['employee_id'] ?? null,
                'school_id' => $profile['school_id'] ?? null,
                'department' => $profile['office_department'] ?? $profile['college'] ?? null,
                'position' => $profile['work_position'] ?? $profile['program_department'] ?? null,
                'year_level' => $profile['year_level'] ?? null,
                'section' => $profile['section'] ?? null,
                'temporary_password' => $password,
                'rfid' => $rfid,
                'fingerprint' => $fingerprint,
            ];
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $error;
        }
    }

    public function completeOnboardingProfile(int $userId, array $input): void
    {
        $account = $this->loadOnboardingAccount($userId);
        $step = (string) ($account['onboarding_step'] ?? '');

        if (in_array($step, ['security', 'done'], true)) {
            return;
        }

        if ($step !== 'profile') {
            throw new InvalidArgumentException('Set a new password before completing your information.');
        }

        $role = (string) $account['role'];
        $validated = RegistrationInputValidation::profile($input, true);
        $dateOfBirth = $validated['date_of_birth'];
        $shared = [
            'middle_name' => $validated['middle_name'],
            'extension_name' => $this->boundedText($this->optionalText($input['extension_name'] ?? null), 'Suffix', 20),
            'sex' => $this->requiredSex($input['sex'] ?? null),
            'date_of_birth' => $dateOfBirth,
            'age' => $validated['age'],
            'contact_number' => $validated['contact_number'],
            'province' => $validated['province'],
            'city_municipality' => $validated['city_municipality'],
            'barangay' => $validated['barangay'],
            'street_address' => $validated['street_address'],
        ];

        $uniqueness = new RegistrationUniquenessService($this->pdo);
        $contactLock = $uniqueness->acquireContactLock($validated['contact_number']);
        try {
            $uniqueness->assertContactAvailable($validated['contact_number'], $userId);
            $this->pdo->beginTransaction();

            if ($role === 'student') {
                $college = $this->requiredText($input, 'college', 'College');
                $program = $this->requiredText($input, 'program_department', 'Program / Department');

                if (!isset(self::STUDENT_PROGRAMS[$college])) {
                    throw new InvalidArgumentException('Select a college from the list.');
                }

                if (!in_array($program, self::STUDENT_PROGRAMS[$college], true)) {
                    throw new InvalidArgumentException('Select a program for the chosen college.');
                }

                $statement = $this->pdo->prepare(
                    'UPDATE student_info
                     SET middle_name = :middle_name,
                         extension_name = :extension_name,
                         sex = :sex,
                         date_of_birth = :date_of_birth,
                         age = :age,
                         contact_number = :contact_number,
                         college = :college,
                         program_department = :program_department,
                         year_level = :year_level,
                         section = :section,
                         province = :province,
                         city_municipality = :city_municipality,
                         barangay = :barangay,
                         street_address = :street_address
                     WHERE user_id = :user_id'
                );
                $statement->execute([
                    ...$shared,
                    'college' => $college,
                    'program_department' => $program,
                    'year_level' => $this->requiredYearLevel($input['year_level'] ?? null),
                    'section' => $this->optionalSection($input['section'] ?? null),
                    'user_id' => $userId,
                ]);
                $this->createRfidCard($userId, $input['rfid_uid'] ?? null);
            } else {
                $table = self::PROFILE_TABLES[$role];
                $statement = $this->pdo->prepare(
                    "UPDATE {$table}
                     SET middle_name = :middle_name,
                         extension_name = :extension_name,
                         sex = :sex,
                         date_of_birth = :date_of_birth,
                         age = :age,
                         contact_number = :contact_number,
                         office_department = :office_department,
                         work_position = :work_position,
                         province = :province,
                         city_municipality = :city_municipality,
                         barangay = :barangay,
                         street_address = :street_address
                     WHERE user_id = :user_id"
                );
                $statement->execute([
                    ...$shared,
                    'office_department' => $this->boundedText(
                        $this->requiredText($input, 'office_department', 'Department / Office'),
                        'Department / Office',
                        150
                    ),
                    'work_position' => $this->boundedText(
                        $this->requiredText($input, 'work_position', 'Position'),
                        'Position',
                        150
                    ),
                    'user_id' => $userId,
                ]);
            }

            $this->pdo->prepare(
                "UPDATE users SET onboarding_step = 'security' WHERE id = :id AND onboarding_step = 'profile'"
            )->execute(['id' => $userId]);
            $this->pdo->commit();
        } catch (PDOException $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            if (($error->errorInfo[1] ?? null) === 1062) {
                throw new InvalidArgumentException('That RFID UID is already assigned.');
            }

            throw $error;
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $error;
        } finally {
            $uniqueness->releaseContactLock($contactLock);
        }
    }

    public function saveInitialSecurityQuestions(int $userId, array $input): void
    {
        $account = $this->loadOnboardingAccount($userId);
        $step = (string) ($account['onboarding_step'] ?? '');

        if ($step === 'done') {
            return;
        }

        if ($step !== 'security') {
            throw new InvalidArgumentException('Complete your information before setting security questions.');
        }

        $questions = $this->normalizeSecurityQuestions($input['security_questions'] ?? null);

        try {
            $this->pdo->beginTransaction();
            $this->pdo->prepare('DELETE FROM account_security_questions WHERE user_id = :user_id')->execute([
                'user_id' => $userId,
            ]);
            $this->insertSecurityQuestions($userId, $questions);
            $this->pdo->prepare(
                "UPDATE users SET onboarding_step = 'done' WHERE id = :id AND onboarding_step = 'security'"
            )->execute(['id' => $userId]);
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $error;
        }
    }

    public function registerPublicStudent(array $input): array
    {
        $validated = RegistrationInputValidation::profile($input);
        $firstName = $validated['first_name'];
        $lastName = $validated['last_name'];
        try {
            $username = $this->normalizeUsername(
                $this->optionalText($input['username'] ?? null)
                    ?? RegistrationInputValidation::generatedUsername($firstName, $lastName)
            );
        } catch (InvalidArgumentException $error) {
            throw new RegistrationValidationException(['username' => $error->getMessage()]);
        }
        (new RegistrationUniquenessService($this->pdo))->assertAvailable([
            ...$input,
            'username' => $username,
            'email' => $validated['email'],
        ]);
        $password = (string) ($input['password'] ?? '');
        $email = $validated['email'];
        $dateOfBirth = $validated['date_of_birth'];
        $college = $this->requiredText($input, 'college', 'College');
        $program = $this->requiredText($input, 'program_department', 'Program / Department');
        $securityQuestions = $this->normalizeSecurityQuestions($input['security_questions'] ?? null);

        $passwordErrors = RegistrationInputValidation::passwordErrors($password, (string) ($input['confirm_password'] ?? ''));
        if ($passwordErrors !== []) throw new RegistrationValidationException($passwordErrors);

        if (!isset(self::STUDENT_PROGRAMS[$college])) {
            throw new InvalidArgumentException('Select a college from the list.');
        }

        if (!in_array($program, self::STUDENT_PROGRAMS[$college], true)) {
            throw new InvalidArgumentException('Select a program for the chosen college.');
        }

        $profile = [
            'school_id' => $this->normalizeSchoolId($this->requiredText($input, 'school_id', 'School ID')),
            'first_name' => $firstName,
            'middle_name' => $validated['middle_name'],
            'last_name' => $lastName,
            'extension_name' => $this->optionalText($input['extension_name'] ?? null),
            'sex' => $this->requiredSex($input['sex'] ?? null),
            'date_of_birth' => $dateOfBirth,
            'age' => $validated['age'],
            'contact_number' => $validated['contact_number'],
            'college' => $college,
            'program_department' => $program,
            'year_level' => $this->requiredYearLevel($input['year_level'] ?? null),
            'section' => $this->optionalSection($input['section'] ?? null),
            'province' => $validated['province'],
            'city_municipality' => $validated['city_municipality'],
            'barangay' => $validated['barangay'],
            'street_address' => $validated['street_address'],
            'zip_code' => $this->normalizeZipCode($this->requiredText($input, 'zip_code', 'Zip code')),
            'country' => $validated['country'],
            'school_id_photo' => $this->normalizeSchoolIdPhoto($input['school_id_photo'] ?? null),
        ];

        $rfidUid = (new RfidScanService($this->pdo))->verifyForRegistration($input['rfid_uid'] ?? null)['rfid_uid'];
        $approvalDueAt = new DateTimeImmutable('+24 hours');

        $uniqueness = new RegistrationUniquenessService($this->pdo);
        $contactLock = $uniqueness->acquireContactLock($validated['contact_number']);
        try {
            $uniqueness->assertContactAvailable($validated['contact_number']);
            $this->pdo->beginTransaction();

            $userStatement = $this->pdo->prepare(
                'INSERT INTO users (
                    username,
                    email,
                    password_hash,
                    role,
                    is_active,
                    approval_status,
                    approval_due_at
                 ) VALUES (
                    :username,
                    :email,
                    :password_hash,
                    :role,
                    0,
                    :approval_status,
                    :approval_due_at
                 )'
            );
            $userStatement->execute([
                'username' => $username,
                'email' => $email,
                'password_hash' => password_hash($password, PASSWORD_DEFAULT),
                'role' => 'student',
                'approval_status' => 'pending',
                'approval_due_at' => $approvalDueAt->format('Y-m-d H:i:s'),
            ]);

            $userId = (int) $this->pdo->lastInsertId();
            $this->insertProfile('student', $userId, $profile);
            $this->insertSecurityQuestions($userId, $securityQuestions);
            $this->createRfidCard($userId, $rfidUid);
            $this->pdo->commit();

            return [
                'user_id' => $userId,
                'username' => $username,
                'email' => $email,
                'role' => 'student',
                'full_name' => $this->buildFullName($profile),
                'school_id' => $profile['school_id'],
                'approval_status' => 'pending',
                'approval_due_at' => $approvalDueAt->format('F j, Y, \a\t g:i A'),
            ];
        } catch (PDOException $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            if (($error->errorInfo[1] ?? null) === 1062) {
                // Recheck normalized values after a concurrent registration wins the insert.
                (new RegistrationUniquenessService($this->pdo))->assertAvailable([
                    ...$input,
                    'username' => $username,
                    'email' => $email,
                ]);
            }
            throw $error;
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $error;
        } finally {
            $uniqueness->releaseContactLock($contactLock);
        }
    }

    private function insertProfile(string $role, int $userId, array $profile): void
    {
        $table = self::PROFILE_TABLES[$role];

        if ($role === 'student') {
            $statement = $this->pdo->prepare(
                "INSERT INTO {$table} (
                    user_id,
                    school_id,
                    first_name,
                    middle_name,
                    last_name,
                    extension_name,
                    sex,
                    date_of_birth,
                    age,
                    contact_number,
                    college,
                    program_department,
                    year_level,
                    section,
                    province,
                    city_municipality,
                    barangay,
                    street_address,
                    zip_code,
                    country,
                    school_id_photo
                ) VALUES (
                    :user_id,
                    :school_id,
                    :first_name,
                    :middle_name,
                    :last_name,
                    :extension_name,
                    :sex,
                    :date_of_birth,
                    :age,
                    :contact_number,
                    :college,
                    :program_department,
                    :year_level,
                    :section,
                    :province,
                    :city_municipality,
                    :barangay,
                    :street_address,
                    :zip_code,
                    :country,
                    :school_id_photo
                )"
            );

            $statement->execute([
                'user_id' => $userId,
                ...$profile,
                'zip_code' => $profile['zip_code'] ?? null,
                'country' => $profile['country'] ?? null,
                'school_id_photo' => $profile['school_id_photo'] ?? null,
            ]);
            return;
        }

        $statement = $this->pdo->prepare(
            "INSERT INTO {$table} (
                user_id,
                employee_id,
                first_name,
                middle_name,
                last_name,
                extension_name,
                sex,
                date_of_birth,
                age,
                contact_number,
                office_department,
                work_position,
                province,
                city_municipality,
                barangay,
                street_address,
                users_photo
            ) VALUES (
                :user_id,
                :employee_id,
                :first_name,
                :middle_name,
                :last_name,
                :extension_name,
                :sex,
                :date_of_birth,
                :age,
                :contact_number,
                :office_department,
                :work_position,
                :province,
                :city_municipality,
                :barangay,
                :street_address,
                :users_photo
            )"
        );

        $statement->execute([
            'user_id' => $userId,
            ...$profile,
        ]);
    }

    private function createPendingFingerprint(int $userId): array
    {
        $statement = $this->pdo->prepare(
            "INSERT INTO fingerprints (user_id, status)
             VALUES (:user_id, 'pending')"
        );
        $statement->execute([
            'user_id' => $userId,
        ]);

        return [
            'fingerprint_id' => (int)$this->pdo->lastInsertId(),
            'user_id' => $userId,
            'sensor_slot_id' => null,
            'finger_name' => null,
            'status' => 'pending',
        ];
    }

    private function createRfidCard(int $userId, mixed $rfidUid): ?array
    {
        $normalizedUid = $this->normalizeRfidUid($rfidUid);

        if ($normalizedUid === null) {
            return null;
        }

        $statement = $this->pdo->prepare(
            "INSERT INTO rfid_cards (user_id, rfid_uid, status)
             VALUES (:user_id, :rfid_uid, 'active')"
        );
        $statement->execute([
            'user_id' => $userId,
            'rfid_uid' => $normalizedUid,
        ]);

        return [
            'card_id' => (int)$this->pdo->lastInsertId(),
            'user_id' => $userId,
            'rfid_uid' => $normalizedUid,
            'status' => 'active',
        ];
    }

    private function generateEmployeeId(string $role, int $userId): string
    {
        $prefix = match ($role) {
            'faculty' => 'FAC',
            'staff' => 'STF',
            'admin', 'super_admin' => 'ADM',
            default => 'EMP',
        };

        return sprintf('%s-%04d', $prefix, $userId);
    }

    private function requiredText(array $input, string $key, string $label): string
    {
        $value = $this->optionalText($input[$key] ?? null);

        if ($value === null) {
            throw new InvalidArgumentException("{$label} is required.");
        }

        return $value;
    }

    private function optionalText(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $normalized = trim((string)$value);
        return $normalized === '' ? null : $normalized;
    }

    private function optionalInteger(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        return max(0, (int)$value);
    }

    private function normalizePersonName(string $value, string $label): string
    {
        $name = trim($value);

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

        return $name;
    }

    private function normalizeTitleText(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        return preg_replace_callback(
            '/(^|[\s-])([a-z])/i',
            fn(array $matches): string => $matches[1] . strtoupper($matches[2]),
            strtolower($value)
        );
    }

    private function normalizeContactNumber(mixed $value): ?string
    {
        $normalized = $this->optionalText($value);

        if ($normalized === null) {
            return null;
        }

        $digits = preg_replace('/\D+/', '', $normalized);

        if (strlen($digits) !== self::CONTACT_NUMBER_LENGTH) {
            throw new InvalidArgumentException('Contact number must be 11 digits.');
        }

        return $digits;
    }

    private function normalizeZipCode(string $zipCode): string
    {
        $digits = preg_replace('/\D+/', '', $zipCode) ?? '';

        if (!preg_match('/^\d{4}$/', $digits)) {
            throw new InvalidArgumentException('Zip code must be 4 digits.');
        }

        return $digits;
    }

    private function normalizeUsername(string $username): string
    {
        $username = trim($username);

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

        return $username;
    }

    private function normalizeIssuedId(string $value, string $label, string $role = 'student'): string
    {
        $normalized = trim($value);
        $isStudent = $role === 'student';
        $pattern = $isStudent ? '/^\d{4}-\d{4}$/' : '/^\d{6}-\d{6}$/';
        $format = $isStudent ? 'xxxx-xxxx' : 'xxxxxx-xxxxxx';

        if (!preg_match($pattern, $normalized)) {
            throw new InvalidArgumentException("{$label} must use {$format} format.");
        }

        return $normalized;
    }

    private function temporaryPasswordFromId(string $username, string $identifier): string
    {
        $parts = explode('-', $identifier, 2);
        $password = $username . '@' . ($parts[1] ?? '');

        if (strlen($password) < 8 || strlen($password) > 72) {
            throw new InvalidArgumentException('The generated temporary password is not valid. Check the username and ID.');
        }

        return $password;
    }

    private function boundedText(?string $value, string $label, int $max): ?string
    {
        if ($value === null) {
            return null;
        }

        if (strlen($value) > $max) {
            throw new InvalidArgumentException("{$label} must be {$max} characters or fewer.");
        }

        return $value;
    }

    private function loadOnboardingAccount(int $userId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, role, onboarding_step, is_active
             FROM users
             WHERE id = :id
             LIMIT 1'
        );
        $statement->execute(['id' => $userId]);
        $account = $statement->fetch(PDO::FETCH_ASSOC);

        if (!$account || !(bool) $account['is_active']) {
            throw new InvalidArgumentException('This account could not be found.');
        }

        return $account;
    }

    private function normalizeSchoolId(string $schoolId): string
    {
        $normalized = trim($schoolId);

        if (!preg_match('/^\d{4}-\d{4}$/', $normalized)) {
            throw new InvalidArgumentException('School ID must use xxxx-xxxx format.');
        }

        return $normalized;
    }

    private function normalizeSchoolIdPhoto(mixed $photo): string
    {
        $value = trim((string) $photo);

        if ($value === '') {
            throw new InvalidArgumentException('A photo of the school ID is required.');
        }

        if (!preg_match('#^data:image/(jpeg|png);base64,#', $value)) {
            throw new InvalidArgumentException('School ID photo must be a JPG or PNG image.');
        }

        if (strlen($value) > 2500000) {
            throw new InvalidArgumentException('School ID photo must be 2MB or smaller.');
        }

        return $value;
    }

    private function requireScannedRfidUid(mixed $rfidUid): string
    {
        require_once __DIR__ . '/RfidScanService.php';

        $scans = new RfidScanService($this->pdo);
        $normalized = $scans->normalizeUid($rfidUid);

        if (!$scans->isValidUid($normalized)) {
            throw new InvalidArgumentException('Enter the RFID UID shown on the scanner.');
        }

        if ($scans->isRegistered($normalized)) {
            throw new InvalidArgumentException(RfidScanService::REGISTERED_UID_MESSAGE);
        }

        if ($scans->latestScan($normalized) === null) {
            throw new InvalidArgumentException('This UID was not scanned yet. Scan your school ID at the RFID station, then enter the UID shown on the screen.');
        }

        return $normalized;
    }

    private function normalizeRfidUid(mixed $rfidUid): ?string
    {
        $normalized = strtoupper(preg_replace('/\s+/', '', (string)($rfidUid ?? '')));

        if ($normalized === '') {
            return null;
        }

        if (strlen($normalized) > 30) {
            throw new InvalidArgumentException('RFID UID must be 30 characters or fewer.');
        }

        return $normalized;
    }

    private function normalizeEmail(mixed $value): ?string
    {
        $email = $this->optionalText($value);

        if ($email === null) {
            return null;
        }

        $email = strtolower(str_replace(' ', '', $email));

        if (!str_contains($email, '@')) {
            $email .= '@' . self::SCHOOL_EMAIL_DOMAIN;
        }

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException('Email must be a valid email address.');
        }

        if (!str_ends_with($email, '@' . self::SCHOOL_EMAIL_DOMAIN)) {
            throw new InvalidArgumentException('Email must use the @' . self::SCHOOL_EMAIL_DOMAIN . ' domain.');
        }

        return $email;
    }

    private function calculateAge(string $dateOfBirth): ?int
    {
        $birthDate = DateTimeImmutable::createFromFormat('Y-m-d', $dateOfBirth);

        if (!$birthDate || $birthDate->format('Y-m-d') !== $dateOfBirth) {
            throw new InvalidArgumentException('Date of birth must be a valid date.');
        }

        $today = new DateTimeImmutable('today');

        if ($birthDate > $today) {
            throw new InvalidArgumentException('Date of birth cannot be in the future.');
        }

        return (int)$birthDate->diff($today)->y;
    }

    private function normalizeRole(mixed $role): string
    {
        $normalized = strtolower(trim((string)$role));

        return match ($normalized) {
            'admins', 'admin' => 'admin',
            'superadmin', 'super_admin' => 'super_admin',
            default => $normalized,
        };
    }

    private function assertCanCreateActiveAdmin(): void
    {
        $activeAdminCount = (int) $this->pdo->query(
            "SELECT COUNT(*) FROM users WHERE role IN ('admin', 'super_admin') AND is_active = 1"
        )->fetchColumn();

        if ($activeAdminCount >= 2) {
            throw new InvalidArgumentException(
                'Only 2 active admin accounts are allowed. Block an existing admin before creating another.'
            );
        }
    }

    private function assertCanCreateSuperAdmin(): void
    {
        $superAdmins = $this->pdo->query(
            "SELECT id, is_active FROM users WHERE role = 'super_admin'"
        )->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $standbyMap = [];

        try {
            require_once dirname(__DIR__) . '/services/SuperAdminDashboardSession.php';
            $standbyMap = (new SuperAdminDashboardSession($this->pdo))->standbyUserIdMap();
        } catch (Throwable) {
            $standbyMap = [];
        }

        $occupiedSlots = 0;

        foreach ($superAdmins as $row) {
            $userId = (int) ($row['id'] ?? 0);
            $isActive = (bool) ($row['is_active'] ?? false);
            $isStandby = !empty($standbyMap[$userId]);

            // Blocked accounts free a slot; active and session-standby still occupy one.
            if ($isActive || $isStandby) {
                $occupiedSlots += 1;
            }
        }

        if ($occupiedSlots >= 2) {
            throw new InvalidArgumentException(
                'Only 2 active super admin accounts are allowed. Block an existing super admin before creating another.'
            );
        }
    }

    private function normalizeSex(mixed $sex): ?string
    {
        $normalized = strtolower(trim((string)$sex));

        return match ($normalized) {
            'male' => 'Male',
            'female' => 'Female',
            default => null,
        };
    }

    private function requiredSex(mixed $sex): string
    {
        $normalized = $this->normalizeSex($sex);

        if ($normalized === null) {
            throw new InvalidArgumentException('Sex is required.');
        }

        return $normalized;
    }

    private function requiredYearLevel(mixed $yearLevel): string
    {
        $normalized = strtolower(trim((string)$yearLevel));

        return match ($normalized) {
            'first year' => 'First Year',
            'second year' => 'Second Year',
            'third year' => 'Third Year',
            'fourth year' => 'Fourth Year',
            default => throw new InvalidArgumentException('Year level is required.'),
        };
    }

    private function optionalSection(mixed $section): ?string
    {
        $normalized = strtolower(trim((string)$section));

        if ($normalized === '') {
            return null;
        }

        return match ($normalized) {
            'block a' => 'Block A',
            'block b' => 'Block B',
            'block c' => 'Block C',
            'block d' => 'Block D',
            default => throw new InvalidArgumentException('Section must be Block A, Block B, Block C, or Block D.'),
        };
    }

    private function buildFullName(array $profile): string
    {
        return trim(implode(' ', array_filter([
            $profile['first_name'],
            $profile['middle_name'],
            $profile['last_name'],
            $profile['extension_name'],
        ])));
    }

    private function normalizeSecurityQuestions(mixed $questions): array
    {
        $questions = is_array($questions) ? array_values($questions) : [];
        $normalized = [];
        $seenQuestions = [];
        $errors = [];

        for ($index = 0; $index < 3; $index++) {
            $question = is_array($questions[$index] ?? null) ? $questions[$index] : [];
            $slot = $index + 1;
            $prompt = is_string($question['question'] ?? null) ? trim($question['question']) : '';
            $answer = is_string($question['answer'] ?? null) ? preg_replace('/\s+/', ' ', trim($question['answer'])) : '';

            if (!in_array($prompt, self::SECURITY_QUESTIONS, true)) {
                $errors["security_question_{$slot}"] = 'Select a security question from the list.';
            } elseif (isset($seenQuestions[$prompt])) {
                $errors["security_question_{$slot}"] = 'Choose three different security questions.';
            }

            if ($answer === null || strlen($answer) < 2) {
                $errors["security_answer_{$slot}"] = 'Each security answer must be at least 2 characters.';
            } elseif (strlen($answer) > 100) {
                $errors["security_answer_{$slot}"] = 'Answer is too long. Use a shorter answer.';
            }

            $seenQuestions[$prompt] = true;
            $normalized[] = [
                'slot' => $slot,
                'question' => $prompt,
                'answer_text' => $answer,
            ];
        }

        if (count($questions) !== 3 && $errors === []) {
            $errors['security_question_3'] = 'Three security questions are required.';
        }
        if ($errors !== []) throw new RegistrationValidationException($errors);

        return array_map(fn(array $question): array => [
            ...$question,
            'answer_hash' => password_hash(strtolower($question['answer_text']), PASSWORD_DEFAULT),
        ], $normalized);
    }

    private function insertSecurityQuestions(int $userId, array $questions): void
    {
        $statement = $this->pdo->prepare(
            'INSERT INTO account_security_questions (user_id, question_slot, question, answer_hash, answer_text)
             VALUES (:user_id, :question_slot, :question, :answer_hash, :answer_text)'
        );

        foreach ($questions as $question) {
            $statement->execute([
                'user_id' => $userId,
                'question_slot' => $question['slot'],
                'question' => $question['question'],
                'answer_hash' => $question['answer_hash'],
                'answer_text' => $question['answer_text'],
            ]);
        }
    }
}
