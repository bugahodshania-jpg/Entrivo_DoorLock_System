<?php

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

        $username = $this->requiredText($input, 'username', 'Username');
        $password = (string)($input['password'] ?? '');
        $email = $this->normalizeEmail($this->requiredText($input, 'email', 'Email'));
        $firstName = $this->normalizeTitleText($this->requiredText($input, 'first_name', 'First name'));
        $lastName = $this->normalizeTitleText($this->requiredText($input, 'last_name', 'Last name'));
        $dateOfBirth = $this->requiredText($input, 'date_of_birth', 'Date of birth');

        if (strlen($password) < 8) {
            throw new InvalidArgumentException('Password must be at least 8 characters.');
        }

        if ($role === 'student' && !str_contains($username, '.')) {
            throw new InvalidArgumentException('Username must include a dot (.).');
        }

        $profile = [
            'first_name' => $firstName,
            'middle_name' => $this->normalizeTitleText($this->optionalText($input['middle_name'] ?? null)),
            'last_name' => $lastName,
            'extension_name' => $this->optionalText($input['extension_name'] ?? $input['suffix'] ?? null),
            'sex' => $this->requiredSex($input['sex'] ?? null),
            'date_of_birth' => $dateOfBirth,
            'age' => $this->calculateAge($dateOfBirth),
            'contact_number' => $this->normalizeContactNumber($this->requiredText($input, 'contact_number', 'Contact number')),
            'province' => $this->normalizeTitleText($this->requiredText($input, 'province', 'Province')),
            'city_municipality' => $this->normalizeTitleText($this->requiredText($input, 'city_municipality', 'City / Municipality')),
            'barangay' => $this->normalizeTitleText($this->requiredText($input, 'barangay', 'Barangay')),
            'street_address' => $this->optionalText($input['street_address'] ?? $input['address'] ?? null),
        ];

        if ($role === 'student') {
            $profile = [
                'school_id' => $this->normalizeSchoolId($this->requiredText($input, 'school_id', 'School ID')),
                ...$profile,
                'college' => $this->requiredText($input, 'college', 'College'),
                'program_department' => $this->requiredText($input, 'program_department', 'Program / Department'),
                'year_level' => $this->requiredYearLevel($input['year_level'] ?? null),
                'section' => $this->optionalSection($input['section'] ?? null),
            ];
        } else {
            $profile = [
                'employee_id' => $this->requiredText($input, 'employee_id', 'Employee ID'),
                ...$profile,
                'office_department' => $this->requiredText($input, 'office_department', 'Department'),
                'work_position' => $this->requiredText($input, 'work_position', 'Position'),
                'users_photo' => $this->optionalText($input['users_photo'] ?? null),
            ];
        }

        try {
            $this->pdo->beginTransaction();

            $userStatement = $this->pdo->prepare(
                'INSERT INTO users (username, email, password_hash, role, is_active)
                 VALUES (:username, :email, :password_hash, :role, TRUE)'
            );
            $userStatement->execute([
                'username' => $username,
                'email' => $email,
                'password_hash' => password_hash($password, PASSWORD_DEFAULT),
                'role' => $role,
            ]);

            $userId = (int)$this->pdo->lastInsertId();
            $this->insertProfile($role, $userId, $profile);
            $rfidCard = $role === 'student' ? $this->createRfidCard($userId, $input['rfid_uid'] ?? null) : null;
            $fingerprint = $role === 'student' ? null : $this->createPendingFingerprint($userId);

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
                'rfid' => $rfidCard,
                'fingerprint' => $fingerprint,
            ];
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $error;
        }
    }

    public function registerPublicStudent(array $input): array
    {
        $username = $this->requiredText($input, 'username', 'Username');
        $password = (string) ($input['password'] ?? '');
        $email = $this->normalizeEmail($this->requiredText($input, 'email', 'Email'));
        $firstName = $this->normalizeTitleText($this->requiredText($input, 'first_name', 'First name'));
        $lastName = $this->normalizeTitleText($this->requiredText($input, 'last_name', 'Last name'));
        $dateOfBirth = $this->requiredText($input, 'date_of_birth', 'Date of birth');
        $college = $this->requiredText($input, 'college', 'College');
        $program = $this->requiredText($input, 'program_department', 'Program / Department');
        $securityQuestions = $this->normalizeSecurityQuestions($input['security_questions'] ?? null);

        if (strlen($username) > 50) {
            throw new InvalidArgumentException('Username must be 50 characters or fewer.');
        }

        if (!str_contains($username, '.')) {
            throw new InvalidArgumentException('Username must include a dot (.).');
        }

        if (preg_match('/\s/', $username)) {
            throw new InvalidArgumentException('Username cannot contain spaces.');
        }

        if (strlen($password) < 8) {
            throw new InvalidArgumentException('Password must be at least 8 characters.');
        }

        if (!preg_match('/[A-Z]/', $password)) {
            throw new InvalidArgumentException('Password must include an uppercase letter.');
        }

        if (!preg_match('/[a-z]/', $password)) {
            throw new InvalidArgumentException('Password must include a lowercase letter.');
        }

        if (!preg_match('/\d/', $password)) {
            throw new InvalidArgumentException('Password must include a number.');
        }

        if (!preg_match('/[^A-Za-z0-9]/', $password)) {
            throw new InvalidArgumentException('Password must include a special character.');
        }

        if (strlen($password) > 72) {
            throw new InvalidArgumentException('Password must be 72 characters or fewer.');
        }

        if ($password !== (string) ($input['confirm_password'] ?? '')) {
            throw new InvalidArgumentException('Password and re-entered password must match.');
        }

        if (!isset(self::STUDENT_PROGRAMS[$college])) {
            throw new InvalidArgumentException('Select a college from the list.');
        }

        if (!in_array($program, self::STUDENT_PROGRAMS[$college], true)) {
            throw new InvalidArgumentException('Select a program for the chosen college.');
        }

        $profile = [
            'school_id' => $this->normalizeSchoolId($this->requiredText($input, 'school_id', 'School ID')),
            'first_name' => $firstName,
            'middle_name' => $this->normalizeTitleText($this->optionalText($input['middle_name'] ?? null)),
            'last_name' => $lastName,
            'extension_name' => $this->optionalText($input['extension_name'] ?? null),
            'sex' => $this->requiredSex($input['sex'] ?? null),
            'date_of_birth' => $dateOfBirth,
            'age' => $this->calculateAge($dateOfBirth),
            'contact_number' => $this->normalizeContactNumber($this->requiredText($input, 'contact_number', 'Contact number')),
            'college' => $college,
            'program_department' => $program,
            'year_level' => $this->requiredYearLevel($input['year_level'] ?? null),
            'section' => $this->optionalSection($input['section'] ?? null),
            'province' => $this->normalizeTitleText($this->requiredText($input, 'province', 'Province')),
            'city_municipality' => $this->normalizeTitleText($this->requiredText($input, 'city_municipality', 'City / Municipality')),
            'barangay' => $this->normalizeTitleText($this->requiredText($input, 'barangay', 'Barangay')),
            'street_address' => $this->requiredText($input, 'street_address', 'Street address'),
            'zip_code' => $this->normalizeZipCode($this->requiredText($input, 'zip_code', 'Zip code')),
            'country' => $this->normalizeTitleText($this->requiredText($input, 'country', 'Country')),
            'school_id_photo' => $this->normalizeSchoolIdPhoto($input['school_id_photo'] ?? null),
        ];

        $approvalDueAt = new DateTimeImmutable('+24 hours');

        try {
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
            $this->createRfidCard($userId, $input['rfid_uid'] ?? null);
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
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $error;
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
        if (!is_array($questions) || count($questions) !== 3) {
            throw new InvalidArgumentException('Three security questions are required.');
        }

        $normalized = [];
        $seenQuestions = [];

        foreach (array_values($questions) as $index => $question) {
            if (!is_array($question)) {
                throw new InvalidArgumentException('Three security questions are required.');
            }

            $prompt = trim((string) ($question['question'] ?? ''));
            $answer = preg_replace('/\s+/', ' ', trim((string) ($question['answer'] ?? '')));

            if (!in_array($prompt, self::SECURITY_QUESTIONS, true)) {
                throw new InvalidArgumentException('Select a security question from the list.');
            }

            if (isset($seenQuestions[$prompt])) {
                throw new InvalidArgumentException('Choose three different security questions.');
            }

            if ($answer === null || strlen($answer) < 2) {
                throw new InvalidArgumentException('Each security answer must be at least 2 characters.');
            }

            if (strlen($answer) > 100) {
                throw new InvalidArgumentException('Each security answer must be 100 characters or fewer.');
            }

            $seenQuestions[$prompt] = true;
            $normalized[] = [
                'slot' => $index + 1,
                'question' => $prompt,
                'answer_hash' => password_hash(strtolower($answer), PASSWORD_DEFAULT),
            ];
        }

        return $normalized;
    }

    private function insertSecurityQuestions(int $userId, array $questions): void
    {
        $statement = $this->pdo->prepare(
            'INSERT INTO account_security_questions (user_id, question_slot, question, answer_hash)
             VALUES (:user_id, :question_slot, :question, :answer_hash)'
        );

        foreach ($questions as $question) {
            $statement->execute([
                'user_id' => $userId,
                'question_slot' => $question['slot'],
                'question' => $question['question'],
                'answer_hash' => $question['answer_hash'],
            ]);
        }
    }
}
