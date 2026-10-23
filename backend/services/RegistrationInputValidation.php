<?php

class RegistrationValidationException extends InvalidArgumentException
{
    public function __construct(public readonly array $fieldErrors)
    {
        parent::__construct('Please check the highlighted fields.');
    }
}

/** Validation for public registration and the editable first-login profile fields. */
class RegistrationInputValidation
{
    public static function profile(array $input, bool $completion = false): array
    {
        $values = [];
        $errors = [];
        $names = $completion
            ? ['middle_name' => 'Middle name']
            : ['first_name' => 'First name', 'middle_name' => 'Middle name', 'last_name' => 'Last name'];
        foreach ($names as $field => $label) {
            self::collect($values, $errors, $field, fn() => self::name($input[$field] ?? null, $label, $field === 'middle_name'));
        }
        self::collect($values, $errors, 'contact_number', fn() => self::contactNumber($input['contact_number'] ?? null));
        self::collect($values, $errors, 'date_of_birth', fn() => self::dateOfBirth($input['date_of_birth'] ?? null));
        foreach (['province' => 'Province', 'city_municipality' => 'City / Municipality', 'barangay' => 'Barangay'] as $field => $label) {
            self::collect($values, $errors, $field, fn() => self::address($input[$field] ?? null, $label, $field === 'barangay'));
        }
        self::collect($values, $errors, 'street_address', fn() => self::address($input['street_address'] ?? null, 'Street address', true, $completion, 255, false));
        if (!$completion || array_key_exists('country', $input)) {
            self::collect($values, $errors, 'country', fn() => self::address($input['country'] ?? null, 'Country', false));
        }
        if (!$completion) {
            self::collect($values, $errors, 'email', fn() => self::email($input['email'] ?? null));
        }
        if ($errors !== []) {
            throw new RegistrationValidationException($errors);
        }
        $values['age'] = self::age($values['date_of_birth']);
        return $values;
    }

    public static function name(mixed $value, string $label, bool $optional = false): ?string
    {
        $name = self::text($value, $label, $optional);
        if ($name === null) return null;
        if (mb_strlen(trim($name)) > 50) {
            throw new InvalidArgumentException("{$label} must be 50 characters or fewer.");
        }
        if ($optional && $name === ' ') return null;
        if (str_contains($name, '  ') || !preg_match('/^[A-Za-zÑñ]+(?: [A-Za-zÑñ]+)*$/uD', trim($name, ' '))) {
            throw new InvalidArgumentException('Use letters only, with one space between words.');
        }
        return self::capitalizeWords(trim($name, ' '));
    }

    public static function contactNumber(mixed $value): string
    {
        $number = self::text($value, 'Contact number');
        if (!preg_match('/^09[0-9]{9}$/D', $number)) {
            throw new InvalidArgumentException('Contact number must start with 09 and contain exactly 11 digits without spaces.');
        }
        return $number;
    }

    public static function address(mixed $value, string $label, bool $numbers, bool $optional = false, int $max = 100, bool $capitalize = true): ?string
    {
        $address = self::text($value, $label, $optional);
        if ($address === null) return null;
        if (mb_strlen(trim($address, ' ')) > $max) {
            throw new InvalidArgumentException("{$label} must be {$max} characters or fewer.");
        }
        $allowed = $numbers ? 'A-Za-zÑñ0-9.,-' : 'A-Za-zÑñ.,-';
        if ($optional && $address === ' ') return null;
        if (str_contains($address, '  ') || !preg_match('/^[' . $allowed . ']+(?: [' . $allowed . ']+)*$/uD', trim($address, ' '))
            || !preg_match($numbers ? '/[A-Za-zÑñ0-9]/u' : '/[A-Za-zÑñ]/u', $address)) {
            $characters = $numbers ? 'letters, numbers, dots, commas, and dashes' : 'letters, dots, commas, and dashes';
            throw new InvalidArgumentException("{$label} can only contain {$characters}, with one space between words.");
        }
        $address = trim($address, ' ');
        return $capitalize ? self::capitalizeWords($address) : $address;
    }

    public static function email(mixed $value): string
    {
        $email = trim(self::text($value, 'Institutional email'));
        if (!str_contains($email, '@')) $email .= '@csucc.edu.ph';
        $email = strtolower($email);
        if (strlen($email) > 100 || preg_match('/\s/u', $email) || !filter_var($email, FILTER_VALIDATE_EMAIL) || !str_ends_with($email, '@csucc.edu.ph')) {
            throw new InvalidArgumentException('Use a valid institutional email ending in @csucc.edu.ph.');
        }
        return $email;
    }

    public static function dateOfBirth(mixed $value): string
    {
        $date = self::text($value, 'Date of birth');
        self::age($date);
        return $date;
    }

    public static function age(string $dateOfBirth, ?DateTimeImmutable $today = null): int
    {
        $timezone = new DateTimeZone('Asia/Manila');
        $birthDate = DateTimeImmutable::createFromFormat('!Y-m-d', $dateOfBirth, $timezone);
        if (!$birthDate || $birthDate->format('Y-m-d') !== $dateOfBirth) {
            throw new InvalidArgumentException('Date of birth must be a valid date.');
        }
        $today ??= new DateTimeImmutable('today', $timezone);
        if ($birthDate > $today) {
            throw new InvalidArgumentException('Date of birth cannot be in the future.');
        }
        $age = (int) $birthDate->diff($today)->y;
        if ($age < 17) throw new InvalidArgumentException('You must be at least 17 years old.');
        return $age;
    }

    public static function generatedUsername(string $firstName, string $lastName): string
    {
        $first = implode('', array_slice(explode(' ', $firstName), 0, 2));
        $first = strtolower(str_replace(['Ñ', 'ñ'], ['n', 'n'], $first));
        $last = substr(strtolower(str_replace(['Ñ', 'ñ', ' '], ['n', 'n', ''], $lastName)), 0, 48);
        return substr($first, 0, 49 - strlen($last)) . '.' . $last;
    }

    public static function passwordErrors(string $password, string $confirm): array
    {
        $errors = [];
        if (strlen($password) < 8) $errors['password'] = 'Password must be at least 8 characters.';
        elseif (strlen($password) > 72) $errors['password'] = 'Password is too long. Use a shorter password.';
        elseif (!preg_match('/[A-Z]/', $password)) $errors['password'] = 'Password must include an uppercase letter.';
        elseif (!preg_match('/[a-z]/', $password)) $errors['password'] = 'Password must include a lowercase letter.';
        elseif (!preg_match('/[0-9]/', $password)) $errors['password'] = 'Password must include a number.';
        elseif (!preg_match('/[^A-Za-z0-9]/', $password)) $errors['password'] = 'Password must include a special character.';
        if ($password !== $confirm) $errors['confirm_password'] = 'Password confirmation does not match.';
        return $errors;
    }

    private static function text(mixed $value, string $label, bool $optional = false): ?string
    {
        if ($value === null || $value === '') {
            if ($optional) return null;
            throw new InvalidArgumentException("{$label} is required.");
        }
        if (!is_string($value)) throw new InvalidArgumentException("{$label} must be text.");
        return $value;
    }

    private static function capitalizeWords(string $value): string
    {
        return preg_replace_callback('/(^|[ -])([a-zñ])/u', fn(array $match): string => $match[1] . mb_strtoupper($match[2], 'UTF-8'), $value);
    }

    private static function collect(array &$values, array &$errors, string $field, callable $validate): void
    {
        try {
            $values[$field] = $validate();
        } catch (InvalidArgumentException $error) {
            $errors[$field] = $error->getMessage();
        }
    }
}
