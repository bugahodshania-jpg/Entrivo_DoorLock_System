<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/ActivityLogService.php';

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'POST'], true)) {
    http_response_code(405);
    echo json_encode(['message' => 'Method not allowed']);
    exit;
}

function normalizeText($value): ?string
{
    $text = trim((string)($value ?? ''));
    return $text === '' ? null : $text;
}

function normalizeSex($value): ?string
{
    $normalized = strtolower(trim((string)($value ?? '')));

    return match ($normalized) {
        'male' => 'Male',
        'female' => 'Female',
        default => null,
    };
}

function adminSecurityQuestionOptions(): array
{
    return [
        'What is the name of your first school?',
        'What is your mother\'s maiden name?',
        'What city were you born in?',
        'What is the name of your favorite teacher?',
        'What was the name of your first pet?',
        'What is your favorite book?',
    ];
}

function saveAdminSecurityQuestions(PDO $pdo, int $userId, mixed $questions): void
{
    $account = $pdo->prepare('SELECT id, role, is_active FROM users WHERE id = :id LIMIT 1');
    $account->execute(['id' => $userId]);
    $user = $account->fetch();

    if (!$user || !(bool) $user['is_active'] || !in_array($user['role'], ['admin', 'super_admin'], true)) {
        http_response_code(404);
        echo json_encode(['message' => 'Admin profile was not found.']);
        return;
    }

    if (!is_array($questions) || count($questions) !== 3) {
        http_response_code(422);
        echo json_encode(['message' => 'Provide exactly three security questions.']);
        return;
    }

    $allowed = adminSecurityQuestionOptions();
    $normalized = [];
    $seen = [];

    foreach (array_values($questions) as $index => $item) {
        if (!is_array($item)) {
            http_response_code(422);
            echo json_encode(['message' => 'Provide exactly three security questions.']);
            return;
        }

        $question = trim((string) ($item['question'] ?? ''));
        $answer = preg_replace('/\s+/', ' ', trim((string) ($item['answer'] ?? '')));

        if (!in_array($question, $allowed, true)) {
            http_response_code(422);
            echo json_encode(['message' => 'Select a security question from the list.']);
            return;
        }

        if (isset($seen[$question])) {
            http_response_code(422);
            echo json_encode(['message' => 'Choose three different security questions.']);
            return;
        }

        if ($answer !== '' && strlen($answer) > 100) {
            http_response_code(422);
            echo json_encode(['message' => 'Each security answer must be 100 characters or fewer.']);
            return;
        }

        $slot = $index + 1;
        $exists = $pdo->prepare(
            'SELECT question_id, question
             FROM account_security_questions
             WHERE user_id = :user_id AND question_slot = :slot
             LIMIT 1'
        );
        $exists->execute(['user_id' => $userId, 'slot' => $slot]);
        $row = $exists->fetch();
        $keepExisting = $answer === '' && $row && $question === trim((string) $row['question']);

        if (!$keepExisting && ($answer === '' || strlen($answer) < 2)) {
            http_response_code(422);
            echo json_encode(['message' => 'Each security answer must be at least 2 characters.']);
            return;
        }

        $seen[$question] = true;
        $normalized[] = [
            'slot' => $slot,
            'question' => $question,
            'keep_existing' => $keepExisting,
            'question_id' => $row ? (int) $row['question_id'] : null,
            'answer_hash' => $keepExisting ? null : password_hash(strtolower($answer), PASSWORD_DEFAULT),
            'answer_text' => $keepExisting ? null : $answer,
        ];
    }

    $pdo->beginTransaction();

    try {
        foreach ($normalized as $item) {
            if ($item['keep_existing']) {
                continue;
            }

            if ($item['question_id']) {
                $save = $pdo->prepare(
                    'UPDATE account_security_questions
                     SET question = :question,
                         answer_hash = :answer_hash,
                         answer_text = :answer_text
                     WHERE question_id = :question_id'
                );
                $save->execute([
                    'question' => $item['question'],
                    'answer_hash' => $item['answer_hash'],
                    'answer_text' => $item['answer_text'],
                    'question_id' => $item['question_id'],
                ]);
            } else {
                $save = $pdo->prepare(
                    'INSERT INTO account_security_questions (user_id, question_slot, question, answer_hash, answer_text)
                     VALUES (:user_id, :slot, :question, :answer_hash, :answer_text)'
                );
                $save->execute([
                    'user_id' => $userId,
                    'slot' => $item['slot'],
                    'question' => $item['question'],
                    'answer_hash' => $item['answer_hash'],
                    'answer_text' => $item['answer_text'],
                ]);
            }
        }

        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $error;
    }

    (new ActivityLogService($pdo))->record(
        $userId,
        'Update',
        'Updated admin account security questions.',
        'Success',
        $userId,
        'security_questions',
        (string) $userId
    );

    echo json_encode(['message' => 'Security questions updated successfully.']);
}

try {
    $pdo = entrivo_pdo();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $userId = filter_input(INPUT_GET, 'user_id', FILTER_VALIDATE_INT);

        if (!$userId) {
            http_response_code(422);
            echo json_encode(['message' => 'A valid user id is required.']);
            exit;
        }

        $statement = $pdo->prepare(
            'SELECT users.id,
                    users.username,
                    users.email,
                    users.role,
                    users.is_active,
                    users.created_at,
                    users.password_updated_at,
                    DATE_FORMAT(COALESCE(users.password_updated_at, users.created_at), "%M %e, %Y %h:%i %p") AS password_last_updated_label,
                    admin_info.employee_id,
                    admin_info.first_name,
                    admin_info.middle_name,
                    admin_info.last_name,
                    admin_info.extension_name,
                    admin_info.sex,
                    admin_info.age,
                    admin_info.contact_number,
                    admin_info.office_department,
                    admin_info.work_position,
                    admin_info.province,
                    admin_info.city_municipality,
                    admin_info.barangay,
                    admin_info.street_address,
                    (SELECT COUNT(*)
                     FROM fingerprints
                     WHERE fingerprints.user_id = users.id
                       AND fingerprints.status = \'active\') AS fingerprint_count,
                    (SELECT COUNT(*)
                     FROM rfid_cards
                     WHERE rfid_cards.user_id = users.id
                       AND rfid_cards.status = \'active\') AS rfid_count
             FROM users
             LEFT JOIN admin_info ON admin_info.user_id = users.id
             WHERE users.id = :user_id
             LIMIT 1'
        );
        $statement->execute(['user_id' => $userId]);
        $user = $statement->fetch();

        if (!$user || !(bool)$user['is_active']) {
            http_response_code(404);
            echo json_encode(['message' => 'User profile was not found.']);
            exit;
        }

        $questionStatement = $pdo->prepare(
            'SELECT question_slot, question, answer_text
             FROM account_security_questions
             WHERE user_id = :user_id
             ORDER BY question_slot ASC'
        );
        $questionStatement->execute(['user_id' => $userId]);
        $user['security_questions'] = array_map(
            static fn ($row) => [
                'question_slot' => (int) $row['question_slot'],
                'question' => $row['question'],
                'answer' => (string) ($row['answer_text'] ?? ''),
            ],
            $questionStatement->fetchAll()
        );

        echo json_encode([
            'message' => 'Admin profile loaded.',
            'profile' => $user,
        ]);
        exit;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $userId = filter_var($input['user_id'] ?? null, FILTER_VALIDATE_INT);

    if (!$userId) {
        http_response_code(422);
        echo json_encode(['message' => 'A valid user id is required.']);
        exit;
    }

    if (($input['action'] ?? '') === 'update_security_questions') {
        saveAdminSecurityQuestions($pdo, (int) $userId, $input['security_questions'] ?? null);
        exit;
    }

    $sex = normalizeSex($input['sex'] ?? null);

    if (array_key_exists('sex', $input) && $input['sex'] !== null && trim((string)$input['sex']) !== '' && $sex === null) {
        http_response_code(422);
        echo json_encode(['message' => 'Sex must be Male or Female.']);
        exit;
    }

    $age = $input['age'] ?? null;
    $ageValue = null;
    if ($age !== null && $age !== '') {
        $ageValue = filter_var($age, FILTER_VALIDATE_INT);
        if ($ageValue === false || $ageValue < 0 || $ageValue > 120) {
            http_response_code(422);
            echo json_encode(['message' => 'Age must be between 0 and 120.']);
            exit;
        }
    }

    $province = normalizeText($input['province'] ?? null);
    $cityMunicipality = normalizeText($input['city_municipality'] ?? null);
    $barangay = normalizeText($input['barangay'] ?? null);
    $streetAddress = normalizeText($input['street_address'] ?? null);

    $currentPassword = (string)($input['current_password'] ?? '');
    $newPassword = (string)($input['new_password'] ?? '');
    $shouldValidateCurrentPassword = (bool)($input['validate_current_password'] ?? false);

    if ($shouldValidateCurrentPassword) {
        if ($currentPassword === '') {
            http_response_code(422);
            echo json_encode(['message' => 'Current password is required.']);
            exit;
        }

        $authStatement = $pdo->prepare('SELECT password_hash, is_active FROM users WHERE id = :user_id LIMIT 1');
        $authStatement->execute(['user_id' => $userId]);
        $authRow = $authStatement->fetch();

        if (!$authRow || !(bool)$authRow['is_active']) {
            http_response_code(404);
            echo json_encode(['message' => 'User profile was not found.']);
            exit;
        }

        if (!password_verify($currentPassword, $authRow['password_hash'])) {
            http_response_code(401);
            echo json_encode(['message' => 'Current password is incorrect.']);
            exit;
        }

        echo json_encode([
            'message' => 'Current password matched.',
            'valid' => true,
        ]);
        exit;
    }

    $pdo->beginTransaction();

    $profileStatement = $pdo->prepare('SELECT user_id FROM admin_info WHERE user_id = :user_id LIMIT 1');
    $profileStatement->execute(['user_id' => $userId]);
    $profileExists = (bool)$profileStatement->fetch();

    if (!$profileExists) {
        $pdo->rollBack();
        http_response_code(404);
        echo json_encode(['message' => 'Admin profile record was not found.']);
        exit;
    }

    $updateProfile = $pdo->prepare(
        'UPDATE admin_info
         SET sex = :sex,
             age = :age,
             province = :province,
             city_municipality = :city_municipality,
             barangay = :barangay,
             street_address = :street_address
         WHERE user_id = :user_id'
    );
    $updateProfile->execute([
        'sex' => $sex,
        'age' => $ageValue,
        'province' => $province,
        'city_municipality' => $cityMunicipality,
        'barangay' => $barangay,
        'street_address' => $streetAddress,
        'user_id' => $userId,
    ]);

    if ($newPassword !== '') {
        if ($currentPassword === '') {
            $pdo->rollBack();
            http_response_code(422);
            echo json_encode(['message' => 'Current password is required to change the password.']);
            exit;
        }

        if (mb_strlen($newPassword) < 6) {
            $pdo->rollBack();
            http_response_code(422);
            echo json_encode(['message' => 'New password must be at least 6 characters long.']);
            exit;
        }

        $authStatement = $pdo->prepare('SELECT password_hash FROM users WHERE id = :user_id LIMIT 1');
        $authStatement->execute(['user_id' => $userId]);
        $authRow = $authStatement->fetch();

        if (!$authRow || !password_verify($currentPassword, $authRow['password_hash'])) {
            $pdo->rollBack();
            (new ActivityLogService($pdo))->record(
                (int) $userId,
                'Password',
                'Password change failed. The current password was incorrect.',
                'Failed',
                (int) $userId,
                'password',
                (string) $userId
            );
            http_response_code(401);
            echo json_encode(['message' => 'Current password is incorrect.']);
            exit;
        }

        $newHash = password_hash($newPassword, PASSWORD_DEFAULT);
        $passwordStatement = $pdo->prepare(
            'UPDATE users
             SET password_hash = :hash,
                 password_updated_at = CURRENT_TIMESTAMP
             WHERE id = :user_id'
        );
        $passwordStatement->execute(['hash' => $newHash, 'user_id' => $userId]);
    }

    $pdo->commit();

    $activityLog = new ActivityLogService($pdo);
    $activityLog->record(
        (int) $userId,
        'Update',
        'Updated admin account profile details.',
        'Success',
        (int) $userId,
        'profile',
        (string) $userId
    );

    if ($newPassword !== '') {
        $activityLog->record(
            (int) $userId,
            'Password',
            'Changed admin account password.',
            'Success',
            (int) $userId,
            'password',
            (string) $userId
        );
    }

    echo json_encode([
        'message' => 'Admin profile updated.',
    ]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }

    http_response_code(500);
    echo json_encode([
        'message' => 'Unable to update admin profile.',
        'error' => $error->getMessage(),
    ]);
}
