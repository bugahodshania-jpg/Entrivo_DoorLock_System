<?php

require_once __DIR__ . '/RfidScanService.php';

class RegistrationDuplicateException extends InvalidArgumentException
{
    public function __construct(public readonly array $fieldErrors)
    {
        parent::__construct('Some registration details are already in use. Please check the highlighted fields.');
    }
}

class RegistrationUniquenessService
{
    public const CONTACT_DUPLICATE_MESSAGE = 'Contact number already exists. Use a different contact number.';

    public function __construct(private PDO $pdo) {}

    public function check(array $input): array
    {
        $fields = [
            'school_id' => ['student_info', 'School ID already exists. Use your own unique school ID.'],
            'rfid_uid' => ['rfid_cards', RfidScanService::REGISTERED_UID_MESSAGE],
            'username' => ['users', 'Username already exists. Choose another username.'],
            'email' => ['users', 'Email already exists. Use a different school email.'],
        ];
        $errors = [];
        foreach ($fields as $field => [$table, $message]) {
            if (!isset($input[$field]) || !is_string($input[$field])) continue;
            $value = trim($input[$field]);
            if ($field === 'rfid_uid') $value = strtoupper(preg_replace('/\s+/', '', $value));
            if ($field === 'email' && $value !== '') {
                $value = strtolower(preg_replace('/\s+/', '', $value));
                if (!str_contains($value, '@')) $value .= '@csucc.edu.ph';
            }
            if ($value === '' || strlen($value) > ($field === 'email' ? 255 : 50)) continue;
            $column = $field === 'rfid_uid' ? 'UPPER(rfid_uid)' : $field;
            $statement = $this->pdo->prepare("SELECT 1 FROM {$table} WHERE {$column} = :value LIMIT 1");
            $statement->execute(['value' => $value]);
            if ($statement->fetchColumn()) $errors[$field] = $message;
        }

        if (isset($input['employee_id']) && is_string($input['employee_id'])) {
            $value = trim($input['employee_id']);
            if ($value !== '' && strlen($value) <= 50) {
                foreach (['faculty_info', 'staff_info', 'admin_info'] as $table) {
                    $statement = $this->pdo->prepare("SELECT 1 FROM {$table} WHERE employee_id = :value LIMIT 1");
                    $statement->execute(['value' => $value]);
                    if ($statement->fetchColumn()) {
                        $errors['employee_id'] = 'Employee ID already exists.';
                        break;
                    }
                }
            }
        }

        return [...$errors, ...$this->checkContactNumber($input['contact_number'] ?? null)];
    }

    /** The exclusion must come from an authenticated account or verified setup challenge. */
    public function checkContactNumber(mixed $value, ?int $excludeUserId = null): array
    {
        if (!is_string($value) || !preg_match('/^09[0-9]{9}$/D', $value)) return [];

        foreach (['student_info', 'faculty_info', 'staff_info', 'admin_info'] as $table) {
            $exclude = $excludeUserId !== null ? ' AND user_id <> :user_id' : '';
            $statement = $this->pdo->prepare("SELECT 1 FROM {$table} WHERE contact_number = :value{$exclude} LIMIT 1");
            $statement->execute([
                'value' => $value,
                ...($excludeUserId !== null ? ['user_id' => $excludeUserId] : []),
            ]);
            if ($statement->fetchColumn()) return ['contact_number' => self::CONTACT_DUPLICATE_MESSAGE];
        }

        return [];
    }

    public function assertContactAvailable(string $value, ?int $excludeUserId = null): void
    {
        $errors = $this->checkContactNumber($value, $excludeUserId);
        if ($errors !== []) throw new RegistrationDuplicateException($errors);
    }

    /** Serialize saves of the same number across profile tables without a schema change. */
    public function acquireContactLock(string $value): ?string
    {
        if ($this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'mysql') return null;

        $lock = 'entrivo_contact_' . hash('sha1', $value);
        $statement = $this->pdo->prepare('SELECT GET_LOCK(:lock_name, 10)');
        $statement->execute(['lock_name' => $lock]);
        if ((int) $statement->fetchColumn() !== 1) {
            throw new RuntimeException('Unable to check the contact number right now. Please try again.');
        }
        return $lock;
    }

    public function releaseContactLock(?string $lock): void
    {
        if ($lock === null) return;
        $this->pdo->prepare('SELECT RELEASE_LOCK(:lock_name)')->execute(['lock_name' => $lock]);
    }

    public function assertAvailable(array $input): void
    {
        $errors = $this->check($input);
        if ($errors !== []) throw new RegistrationDuplicateException($errors);
    }
}
