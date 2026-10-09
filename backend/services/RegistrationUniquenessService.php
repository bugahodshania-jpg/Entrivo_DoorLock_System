<?php

class RegistrationDuplicateException extends InvalidArgumentException
{
    public function __construct(public readonly array $fieldErrors)
    {
        parent::__construct('Some registration details are already in use. Please check the highlighted fields.');
    }
}

class RegistrationUniquenessService
{
    public function __construct(private PDO $pdo) {}

    public function check(array $input): array
    {
        $fields = [
            'school_id' => ['student_info', 'School ID already exists. Use your own unique school ID.'],
            'rfid_uid' => ['rfid_cards', 'School ID UID is already registered and cannot be reused.'],
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
            $statement = $this->pdo->prepare("SELECT 1 FROM {$table} WHERE {$field} = :value LIMIT 1");
            $statement->execute(['value' => $value]);
            if ($statement->fetchColumn()) $errors[$field] = $message;
        }
        return $errors;
    }

    public function assertAvailable(array $input): void
    {
        $errors = $this->check($input);
        if ($errors !== []) throw new RegistrationDuplicateException($errors);
    }
}
