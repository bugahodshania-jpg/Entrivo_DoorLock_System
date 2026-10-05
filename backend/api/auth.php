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
require_once dirname(__DIR__) . '/services/SuperAdminDashboardSession.php';
require_once dirname(__DIR__) . '/services/UserPrivilegeService.php';

try {
    $pdo = entrivo_pdo();
    $security = new LoginSecurityService($pdo);
    $superAdminSession = new SuperAdminDashboardSession($pdo);
    $privilegeService = new UserPrivilegeService($pdo);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $userId = filter_input(INPUT_GET, 'user_id', FILTER_VALIDATE_INT);

        if (!$userId) {
            http_response_code(422);
            echo json_encode(['message' => 'A valid user id is required.']);
            exit;
        }

        $statement = $pdo->prepare(
            'SELECT users.id, users.username, users.email, users.role, users.is_active,
                    COALESCE(admin_info.employee_id, faculty_info.employee_id, staff_info.employee_id) AS employee_id,
                    COALESCE(admin_info.first_name, faculty_info.first_name, staff_info.first_name) AS first_name,
                    COALESCE(admin_info.middle_name, faculty_info.middle_name, staff_info.middle_name) AS middle_name,
                    COALESCE(admin_info.last_name, faculty_info.last_name, staff_info.last_name) AS last_name,
                    COALESCE(admin_info.extension_name, faculty_info.extension_name, staff_info.extension_name) AS extension_name,
                    COALESCE(admin_info.office_department, faculty_info.office_department, staff_info.office_department) AS office_department,
                    COALESCE(admin_info.work_position, faculty_info.work_position, staff_info.work_position) AS work_position,
                    COALESCE(admin_info.users_photo, faculty_info.users_photo, staff_info.users_photo) AS users_photo
             FROM users
             LEFT JOIN admin_info ON admin_info.user_id = users.id
             LEFT JOIN faculty_info ON faculty_info.user_id = users.id
             LEFT JOIN staff_info ON staff_info.user_id = users.id
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

        if (($user['role'] ?? '') === 'super_admin') {
            try {
                $superAdminSession->heartbeat((int) $user['id']);
            } catch (InvalidArgumentException) {
                try {
                    $superAdminSession->claim((int) $user['id'], (string) $user['username']);
                } catch (InvalidArgumentException $sessionError) {
                    http_response_code(409);
                    echo json_encode([
                        'message' => $sessionError->getMessage(),
                        'code' => 'super_admin_session_taken',
                    ]);
                    exit;
                }
            }
        }

        echo json_encode([
            'message' => 'User profile loaded.',
            'user' => attachUserPrivileges($privilegeService, $user),
        ]);
        exit;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];

    if (($input['action'] ?? '') === 'logout') {
        $userId = (int) ($input['user_id'] ?? 0);
        $username = trim((string) ($input['username'] ?? ''));

        if ($userId > 0 && $username !== '') {
            $security->recordAttempt($userId, $username, 'logout', null);
            $superAdminSession->release($userId);
        }

        echo json_encode(['message' => 'Logged out.']);
        exit;
    }

    if (($input['action'] ?? '') === 'super_admin_heartbeat') {
        $userId = (int) ($input['user_id'] ?? 0);

        if ($userId < 1) {
            http_response_code(422);
            echo json_encode(['message' => 'A valid user id is required.']);
            exit;
        }

        $roleCheck = $pdo->prepare(
            'SELECT role, is_active, username FROM users WHERE id = :id LIMIT 1'
        );
        $roleCheck->execute(['id' => $userId]);
        $roleRow = $roleCheck->fetch(PDO::FETCH_ASSOC);

        if (!$roleRow || !(bool) $roleRow['is_active'] || ($roleRow['role'] ?? '') !== 'super_admin') {
            http_response_code(403);
            echo json_encode([
                'message' => 'Only an active super admin can hold the dashboard session.',
                'code' => 'super_admin_session_taken',
            ]);
            exit;
        }

        try {
            $payload = $superAdminSession->heartbeat($userId);
            echo json_encode([
                'message' => 'Dashboard session refreshed.',
                'session' => $payload,
            ]);
        } catch (InvalidArgumentException $sessionError) {
            http_response_code(409);
            echo json_encode([
                'message' => $sessionError->getMessage(),
                'code' => 'super_admin_session_taken',
            ]);
        }
        exit;
    }

    $action = (string) ($input['action'] ?? '');
    if (in_array($action, ['first_login_verify', 'first_login_resend', 'first_login_password', 'first_login_profile', 'first_login_security'], true)) {
        require_once dirname(__DIR__) . '/services/FirstLoginService.php';
        $firstLogin = new FirstLoginService($pdo);

        if ($action === 'first_login_verify') {
            $firstLogin->verifyOtp((string) ($input['challenge_id'] ?? ''), (string) ($input['otp'] ?? ''));
            echo json_encode(['message' => 'Code accepted. Set a new password to continue.']);
            exit;
        }

        if ($action === 'first_login_resend') {
            try {
                $setup = $firstLogin->resend((string) ($input['challenge_id'] ?? ''));
            } catch (InvalidArgumentException $resendError) {
                throw $resendError;
            } catch (Throwable) {
                http_response_code(502);
                echo json_encode(['message' => 'The verification email could not be sent. Try again.']);
                exit;
            }

            echo json_encode([
                'message' => 'A new verification code was sent.',
                'challenge_id' => $setup['challenge_id'],
                'masked_email' => $setup['masked_email'],
                'expires_in' => $setup['expires_in'],
            ]);
            exit;
        }

        if ($action === 'first_login_profile') {
            $progress = $firstLogin->completeProfile((string) ($input['challenge_id'] ?? ''), $input);
            echo json_encode([
                'message' => 'Information saved. Set your security questions to continue.',
                'next_step' => $progress['next_step'],
            ]);
            exit;
        }

        if ($action === 'first_login_security') {
            $completed = $firstLogin->saveSecurityQuestions((string) ($input['challenge_id'] ?? ''), $input);
            completeAuthenticatedLogin(
                $pdo,
                $security,
                $superAdminSession,
                $privilegeService,
                (int) $completed['id']
            );
            exit;
        }

        $completed = $firstLogin->replaceTemporaryPassword(
            (string) ($input['challenge_id'] ?? ''),
            (string) ($input['password'] ?? ''),
            (string) ($input['confirm_password'] ?? '')
        );

        if (($completed['next_step'] ?? 'done') !== 'done') {
            echo json_encode([
                'message' => 'Password saved. Complete your information to continue.',
                'next_step' => $completed['next_step'],
                'setup' => $completed['setup'] ?? null,
            ]);
            exit;
        }

        completeAuthenticatedLogin(
            $pdo,
            $security,
            $superAdminSession,
            $privilegeService,
            (int) $completed['id']
        );
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
                users.must_change_password, users.onboarding_step, users.approval_status,
                COALESCE(admin_info.employee_id, faculty_info.employee_id, staff_info.employee_id) AS employee_id,
                COALESCE(admin_info.first_name, faculty_info.first_name, staff_info.first_name, student_info.first_name) AS first_name,
                COALESCE(admin_info.middle_name, faculty_info.middle_name, staff_info.middle_name, student_info.middle_name) AS middle_name,
                COALESCE(admin_info.last_name, faculty_info.last_name, staff_info.last_name, student_info.last_name) AS last_name,
                COALESCE(admin_info.extension_name, faculty_info.extension_name, staff_info.extension_name, student_info.extension_name) AS extension_name,
                COALESCE(admin_info.office_department, faculty_info.office_department, staff_info.office_department) AS office_department,
                COALESCE(admin_info.work_position, faculty_info.work_position, staff_info.work_position) AS work_position,
                COALESCE(admin_info.users_photo, faculty_info.users_photo, staff_info.users_photo) AS users_photo
         FROM users
         LEFT JOIN admin_info ON admin_info.user_id = users.id
         LEFT JOIN faculty_info ON faculty_info.user_id = users.id
         LEFT JOIN staff_info ON staff_info.user_id = users.id
         LEFT JOIN student_info ON student_info.user_id = users.id
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

            $inactiveMessage = 'This account has been blocked. Contact an administrator for help.';

            if (($user['role'] ?? '') === 'super_admin') {
                try {
                    if ($superAdminSession->isStandbyUser($userId)) {
                        $inactiveMessage = 'Another Super Admin is currently active. Only one Super Admin can be active at a time. Please try again later.';
                    }
                } catch (Throwable) {
                    // Keep the default blocked message.
                }
            }

            http_response_code(403);
            echo json_encode([
                'message' => $inactiveMessage,
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

        if ((int) ($user['must_change_password'] ?? 0) === 1) {
            if (trim((string) ($user['email'] ?? '')) === '') {
                $pdo->commit();
                http_response_code(422);
                echo json_encode([
                    'message' => 'This account has no email address, so the verification code cannot be sent.',
                    'field' => 'username',
                    'locked' => false,
                    'retry_after' => 0,
                    'show_forgot_password' => false,
                ]);
                exit;
            }

            $security->clearFailedAttempts($userId);
            $pdo->commit();

            require_once dirname(__DIR__) . '/services/FirstLoginService.php';

            try {
                $setup = (new FirstLoginService($pdo))->begin(
                    $userId,
                    (string) $user['email'],
                    (string) $user['username']
                );
            } catch (InvalidArgumentException $setupError) {
                http_response_code(422);
                echo json_encode([
                    'message' => $setupError->getMessage(),
                    'field' => 'password',
                    'locked' => false,
                    'retry_after' => 0,
                    'show_forgot_password' => false,
                ]);
                exit;
            } catch (Throwable) {
                http_response_code(502);
                echo json_encode([
                    'message' => 'Your password was accepted, but the verification email could not be sent. Try signing in again.',
                    'field' => 'password',
                    'locked' => false,
                    'retry_after' => 0,
                    'show_forgot_password' => false,
                ]);
                exit;
            }

            echo json_encode([
                'message' => 'Credentials accepted. Enter the verification code sent to your email.',
                'requires_first_login' => true,
                'next_step' => 'otp',
                'challenge_id' => $setup['challenge_id'],
                'masked_email' => $setup['masked_email'],
                'expires_in' => $setup['expires_in'],
                'locked' => false,
                'retry_after' => 0,
                'show_forgot_password' => false,
            ]);
            exit;
        }

        $onboardingStep = (string) ($user['onboarding_step'] ?? 'done');
        if (in_array($onboardingStep, ['profile', 'security'], true)) {
            $security->clearFailedAttempts($userId);
            $pdo->commit();

            require_once dirname(__DIR__) . '/services/FirstLoginService.php';

            try {
                $setup = (new FirstLoginService($pdo))->beginContinuation($userId);
            } catch (InvalidArgumentException $setupError) {
                http_response_code(422);
                echo json_encode([
                    'message' => $setupError->getMessage(),
                    'field' => 'password',
                    'locked' => false,
                    'retry_after' => 0,
                    'show_forgot_password' => false,
                ]);
                exit;
            } catch (Throwable) {
                http_response_code(502);
                echo json_encode([
                    'message' => 'Your password was accepted, but account setup could not be opened. Try signing in again.',
                    'field' => 'password',
                    'locked' => false,
                    'retry_after' => 0,
                    'show_forgot_password' => false,
                ]);
                exit;
            }

            echo json_encode([
                'message' => 'Sign-in accepted. Finish account setup to open your dashboard.',
                'requires_first_login' => true,
                'next_step' => $setup['next_step'],
                'challenge_id' => $setup['challenge_id'],
                'masked_email' => $setup['masked_email'],
                'expires_in' => $setup['expires_in'],
                'setup' => $setup['setup'],
                'locked' => false,
                'retry_after' => 0,
                'show_forgot_password' => false,
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

    if (($user['role'] ?? '') === 'super_admin') {
        try {
            $superAdminSession->claim($userId, (string) $user['username']);
        } catch (InvalidArgumentException $sessionError) {
            http_response_code(409);
            echo json_encode([
                'message' => $sessionError->getMessage(),
                'field' => 'username',
                'locked' => false,
                'retry_after' => 0,
                'show_forgot_password' => false,
                'code' => 'super_admin_session_taken',
            ]);
            exit;
        }
    }

    unset($user['password_hash'], $user['must_change_password'], $user['onboarding_step']);

    echo json_encode([
        'message' => 'Login successful.',
        'user' => attachUserPrivileges($privilegeService, $user),
        'locked' => false,
        'retry_after' => 0,
        'show_forgot_password' => false,
    ]);
} catch (InvalidArgumentException $error) {
    http_response_code(422);
    echo json_encode([
        'message' => $error->getMessage(),
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'message' => 'Unable to connect to the authentication service.',
    ]);
}

function completeAuthenticatedLogin(
    PDO $pdo,
    LoginSecurityService $security,
    SuperAdminDashboardSession $superAdminSession,
    UserPrivilegeService $privilegeService,
    int $userId
): void {
    $statement = $pdo->prepare(
        'SELECT users.id, users.username, users.email, users.password_hash, users.role, users.is_active,
                users.must_change_password, users.onboarding_step,
                COALESCE(admin_info.employee_id, faculty_info.employee_id, staff_info.employee_id) AS employee_id,
                COALESCE(admin_info.first_name, faculty_info.first_name, staff_info.first_name, student_info.first_name) AS first_name,
                COALESCE(admin_info.middle_name, faculty_info.middle_name, staff_info.middle_name, student_info.middle_name) AS middle_name,
                COALESCE(admin_info.last_name, faculty_info.last_name, staff_info.last_name, student_info.last_name) AS last_name,
                COALESCE(admin_info.extension_name, faculty_info.extension_name, staff_info.extension_name, student_info.extension_name) AS extension_name,
                COALESCE(admin_info.office_department, faculty_info.office_department, staff_info.office_department) AS office_department,
                COALESCE(admin_info.work_position, faculty_info.work_position, staff_info.work_position) AS work_position,
                COALESCE(admin_info.users_photo, faculty_info.users_photo, staff_info.users_photo) AS users_photo
         FROM users
         LEFT JOIN admin_info ON admin_info.user_id = users.id
         LEFT JOIN faculty_info ON faculty_info.user_id = users.id
         LEFT JOIN staff_info ON staff_info.user_id = users.id
         LEFT JOIN student_info ON student_info.user_id = users.id
         WHERE users.id = :id
         LIMIT 1'
    );
    $statement->execute(['id' => $userId]);
    $user = $statement->fetch();

    if (!$user || !(bool) $user['is_active']) {
        http_response_code(403);
        echo json_encode(['message' => 'This account cannot be opened.']);
        return;
    }

    $security->registerSuccessfulLogin($userId, (string) $user['username']);

    if (($user['role'] ?? '') === 'super_admin') {
        try {
            $superAdminSession->claim($userId, (string) $user['username']);
        } catch (InvalidArgumentException $sessionError) {
            http_response_code(409);
            echo json_encode([
                'message' => $sessionError->getMessage(),
                'field' => 'username',
                'locked' => false,
                'retry_after' => 0,
                'show_forgot_password' => false,
                'code' => 'super_admin_session_taken',
            ]);
            return;
        }
    }

    unset($user['password_hash'], $user['must_change_password'], $user['onboarding_step']);

    echo json_encode([
        'message' => 'Login successful.',
        'user' => attachUserPrivileges($privilegeService, $user),
        'locked' => false,
        'retry_after' => 0,
        'show_forgot_password' => false,
    ]);
}

function attachUserPrivileges(UserPrivilegeService $privilegeService, array $user): array
{
    $role = (string) ($user['role'] ?? '');

    if (!in_array($role, ['admin', 'super_admin'], true)) {
        $user['privileges'] = [];
        return $user;
    }

    try {
        $user['privileges'] = $privilegeService->seedDefaultsIfMissing((int) $user['id'], $role);
    } catch (Throwable) {
        $user['privileges'] = UserPrivilegeService::defaultsForRole($role);
    }

    return $user;
}
