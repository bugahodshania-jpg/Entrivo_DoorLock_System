<?php

require_once dirname(__DIR__) . '/config/connection.php';

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
