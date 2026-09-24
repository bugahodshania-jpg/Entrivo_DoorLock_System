<?php

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

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/LoginSecurityService.php';

try {
    $pdo = entrivo_pdo();
    $security = new LoginSecurityService($pdo);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $userId = filter_input(INPUT_GET, 'user_id', FILTER_VALIDATE_INT);

        if (!$userId) {
            http_response_code(422);
            echo json_encode(['message' => 'A valid user id is required.']);
            exit;
        }

        $statement = $pdo->prepare(
            'SELECT users.id, users.username, users.email, users.role, users.is_active,
                    admin_info.employee_id, admin_info.first_name, admin_info.middle_name,
                    admin_info.last_name, admin_info.extension_name, admin_info.office_department,
                    admin_info.work_position, admin_info.users_photo
             FROM users
             LEFT JOIN admin_info ON admin_info.user_id = users.id
             WHERE users.id = :user_id
             LIMIT 1'
        );
        $statement->execute(['user_id' => $userId]);
        $user = $statement->fetch();

        if (!$user || !(bool) $user['is_active']) {
            http_response_code(404);
            echo json_encode(['message' => 'User profile was not found.']);
            exit;
        }

        echo json_encode([
            'message' => 'User profile loaded.',
            'user' => $user,
        ]);
        exit;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];

    if (($input['action'] ?? '') === 'logout') {
        $userId = (int) ($input['user_id'] ?? 0);
        $username = trim((string) ($input['username'] ?? ''));

        if ($userId > 0 && $username !== '') {
            $security->recordAttempt($userId, $username, 'logout', null);
        }

        echo json_encode(['message' => 'Logged out.']);
        exit;
    }

    $username = trim((string) ($input['username'] ?? ''));
    $password = (string) ($input['password'] ?? '');

    // Restore lockout UI after refresh — server remaining time is the source of truth.
    if (!empty($input['check_lock'])) {
        if ($username === '') {
            http_response_code(422);
            echo json_encode([
                'message' => 'Username is required.',
                'locked' => false,
                'retry_after' => 0,
                'show_forgot_password' => false,
            ]);
            exit;
        }

        $statement = $pdo->prepare(
            'SELECT id, username
             FROM users
             WHERE username = :username
             LIMIT 1'
        );
        $statement->execute(['username' => $username]);
        $user = $statement->fetch();

        if (!$user) {
            echo json_encode([
                'message' => 'No active lockout.',
                'locked' => false,
                'retry_after' => 0,
                'show_forgot_password' => false,
            ]);
            exit;
        }

        $userId = (int) $user['id'];
        $pdo->beginTransaction();

        try {
            $session = $security->lockSessionRow($userId);
            $session = $security->clearExpiredLock($userId, $session);
            $retryAfter = $security->remainingLockSeconds($session);
            $pdo->commit();
        } catch (Throwable $inner) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $inner;
        }

        if ($retryAfter > 0) {
            echo json_encode([
                'message' => sprintf(
                    'Too many failed login attempts. Please wait %d second%s before trying again.',
                    $retryAfter,
                    $retryAfter === 1 ? '' : 's'
                ),
                'code' => 'locked',
                'locked' => true,
                'retry_after' => $retryAfter,
                'show_forgot_password' => $security->shouldShowForgotPassword(
                    (int) $session['failed_attempts'],
                    true
                ),
                'username' => $user['username'],
            ]);
            exit;
        }

        echo json_encode([
            'message' => 'No active lockout.',
            'locked' => false,
            'retry_after' => 0,
            'show_forgot_password' => false,
            'username' => $user['username'],
        ]);
        exit;
    }

    if ($username === '' || $password === '') {
        http_response_code(422);
        $field = $username === '' ? 'username' : 'password';
        echo json_encode([
            'message' => $username === '' ? 'Username is required.' : 'Password is required.',
            'field' => $field,
            'locked' => false,
            'retry_after' => 0,
            'show_forgot_password' => false,
        ]);
        exit;
    }

    $statement = $pdo->prepare(
        'SELECT users.id, users.username, users.email, users.password_hash, users.role, users.is_active,
                users.approval_status,
                admin_info.employee_id, admin_info.first_name, admin_info.middle_name,
                admin_info.last_name, admin_info.extension_name, admin_info.office_department,
                admin_info.work_position, admin_info.users_photo
         FROM users
         LEFT JOIN admin_info ON admin_info.user_id = users.id
         WHERE users.username = :username
         LIMIT 1'
    );
    $statement->execute(['username' => $username]);
    $user = $statement->fetch();

    if (!$user) {
        $security->recordAttempt(null, $username, 'failed', 'user_not_found');
        http_response_code(401);
        echo json_encode([
            'message' => 'Username not found.',
            'field' => 'username',
            'locked' => false,
            'retry_after' => 0,
            'show_forgot_password' => false,
        ]);
        exit;
    }

    $userId = (int) $user['id'];

    $pdo->beginTransaction();

    try {
        $session = $security->lockSessionRow($userId);
        $session = $security->clearExpiredLock($userId, $session);

        if ($security->isLocked($session)) {
            $payload = $security->registerBlockedAttempt($userId, $username, $session);
            $pdo->commit();

            $retryAfter = (int) $payload['retry_after'];
            http_response_code(429);
            echo json_encode([
                'message' => sprintf(
                    'Too many failed login attempts. Please wait %d second%s before trying again.',
                    $retryAfter,
                    $retryAfter === 1 ? '' : 's'
                ),
                'code' => 'locked',
                'field' => 'password',
                'locked' => true,
                'retry_after' => $retryAfter,
                'show_forgot_password' => !empty($payload['show_forgot_password']),
            ]);
            exit;
        }

        if (($user['approval_status'] ?? 'approved') === 'rejected') {
            $security->recordAttempt($userId, $username, 'failed', 'rejected');
            $pdo->commit();

            http_response_code(403);
            echo json_encode([
                'message' => 'Your registration was not approved. Contact an administrator if you need help.',
                'field' => 'username',
                'locked' => false,
                'retry_after' => 0,
                'show_forgot_password' => false,
            ]);
            exit;
        }

        if (($user['approval_status'] ?? 'approved') === 'pending') {
            $security->recordAttempt($userId, $username, 'failed', 'pending_approval');
            $pdo->commit();

            http_response_code(403);
            echo json_encode([
                'message' => 'Your account is still waiting for approval. If it is still pending after 24 hours, contact an administrator.',
                'field' => 'username',
                'locked' => false,
                'retry_after' => 0,
                'show_forgot_password' => false,
            ]);
            exit;
        }

        if (!(bool) $user['is_active']) {
            $security->recordAttempt($userId, $username, 'failed', 'inactive');
            $pdo->commit();

            http_response_code(403);
            echo json_encode([
                'message' => 'This account is disabled.',
                'field' => 'username',
                'locked' => false,
                'retry_after' => 0,
                'show_forgot_password' => false,
            ]);
            exit;
        }

        if (!password_verify($password, $user['password_hash'])) {
            $payload = $security->registerFailedPassword($userId, $username, $session);
            $pdo->commit();

            if (!empty($payload['locked'])) {
                $retryAfter = (int) $payload['retry_after'];
                http_response_code(429);
                echo json_encode([
                    'message' => sprintf(
                        'Too many failed login attempts. Please wait %d second%s before trying again.',
                        $retryAfter,
                        $retryAfter === 1 ? '' : 's'
                    ),
                    'code' => 'locked',
                    'field' => 'password',
                    'locked' => true,
                    'retry_after' => $retryAfter,
                    'show_forgot_password' => !empty($payload['show_forgot_password']),
                ]);
                exit;
            }

            http_response_code(401);
            echo json_encode([
                'message' => 'Incorrect password.',
                'field' => 'password',
                'locked' => false,
                'retry_after' => 0,
                'show_forgot_password' => !empty($payload['show_forgot_password']),
            ]);
            exit;
        }

        $security->registerSuccessfulLogin($userId, $username);
        $pdo->commit();
    } catch (Throwable $inner) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $inner;
    }

    unset($user['password_hash']);

    echo json_encode([
        'message' => 'Login successful.',
        'user' => $user,
        'locked' => false,
        'retry_after' => 0,
        'show_forgot_password' => false,
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'message' => 'Unable to connect to the authentication service.',
    ]);
}
