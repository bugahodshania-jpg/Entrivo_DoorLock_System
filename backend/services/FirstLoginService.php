<?php

require_once __DIR__ . '/MailService.php';
require_once __DIR__ . '/ActivityLogService.php';

class FirstLoginService
{
    public function __construct(private PDO $pdo)
    {
    }

    public function fingerprintNote(?array $fingerprint): string
    {
        $status = strtolower(trim((string) ($fingerprint['status'] ?? '')));

        if (in_array($status, ['active', 'enrolled'], true)) {
            return 'Your fingerprint is enrolled and can be used for door access.';
        }

        if ($status === 'pending') {
            return 'Your fingerprint is not enrolled yet. An administrator can enroll it from the Fingerprint menu.';
        }

        return 'Your fingerprint is not enrolled.';
    }

    public function sendNewAccountEmail(
        string $email,
        string $fullName,
        string $username,
        string $password,
        string $fingerprintNote,
        int $userId,
        ?int $actorUserId = null
    ): void {
        $email = trim($email);
        $username = trim($username);

        if ($email === '' || $username === '' || $password === '') {
            throw new InvalidArgumentException('The account email could not be prepared.');
        }

        $loginUrl = $this->loginUrl($username);
        $greeting = trim($fullName) !== '' ? trim($fullName) : 'there';
        $body = <<<TEXT
Entrivo Door Lock System
Caraga State University - Cabadbaran Campus

Hello {$greeting},

Your Entrivo account was created successfully.

Username: {$username}
Temporary password: {$password}

Fingerprint: {$fingerprintNote}

Sign in here:
{$loginUrl}

After you sign in with this temporary password, Entrivo emails you a verification code. Enter that code, choose a new password, complete the rest of your information, and set your security questions. Your dashboard opens only after those steps are finished.

Do not share this temporary password. It stops working once you replace it.

Entrivo Door Lock System
Caraga State University - Cabadbaran Campus
TEXT;

        $mail = new MailService();
        $mail->send($email, 'Your Entrivo account is ready', $body, MailService::mailbox('credentials'));

        (new ActivityLogService($this->pdo))->record(
            $actorUserId && $actorUserId > 0 ? $actorUserId : null,
            'Add',
            'Emailed the new account username and temporary password.',
            'Success',
            $userId > 0 ? $userId : null,
            'user',
            $userId > 0 ? (string) $userId : null
        );
    }

    public function begin(int $userId, string $email, string $username): array
    {
        $email = trim($email);

        if ($userId < 1 || $email === '') {
            throw new InvalidArgumentException('This account has no email address, so the verification code cannot be sent.');
        }

        $this->assertSendCooldown($userId);

        $otp = (string) random_int(100000, 999999);
        $challengeId = bin2hex(random_bytes(16));

        $this->pdo->prepare('DELETE FROM first_login_challenges WHERE user_id = :user_id')->execute([
            'user_id' => $userId,
        ]);
        $insert = $this->pdo->prepare(
            'INSERT INTO first_login_challenges
                (id, user_id, otp_hash, otp_expires_at, created_at)
             VALUES
                (:id, :user_id, :otp_hash, DATE_ADD(NOW(), INTERVAL 10 MINUTE), NOW())'
        );
        $insert->execute([
            'id' => $challengeId,
            'user_id' => $userId,
            'otp_hash' => password_hash($otp, PASSWORD_DEFAULT),
        ]);

        try {
            $this->sendOtpEmail($email, $username, $otp);
        } catch (Throwable $error) {
            $this->pdo->prepare('DELETE FROM first_login_challenges WHERE id = :id')->execute([
                'id' => $challengeId,
            ]);
            throw $error;
        }

        $this->log($userId, 'Password', 'First-login verification code emailed.');

        return [
            'challenge_id' => $challengeId,
            'masked_email' => $this->maskEmail($email),
            'expires_in' => 600,
        ];
    }

    public function resend(string $challengeId): array
    {
        $challenge = $this->loadChallenge($challengeId);
        $user = $this->loadUser((int) $challenge['user_id']);
        $this->assertStillRequiresSetup($user);
        $this->assertSendCooldown((int) $user['id']);

        return $this->begin((int) $user['id'], (string) $user['email'], (string) $user['username']);
    }

    public function verifyOtp(string $challengeId, string $otp): void
    {
        $challenge = $this->loadChallenge($challengeId);

        if (!empty($challenge['otp_verified_at'])) {
            return;
        }

        if (strtotime((string) $challenge['otp_expires_at']) < time()) {
            throw new InvalidArgumentException('This code has expired. Request a new code or sign in again.');
        }

        if ((int) $challenge['attempt_count'] >= 5) {
            throw new InvalidArgumentException('Too many incorrect codes. Sign in again to get a new code.');
        }

        $otp = trim($otp);
        if (!preg_match('/^\d{6}$/', $otp) || !password_verify($otp, (string) $challenge['otp_hash'])) {
            $attempts = (int) $challenge['attempt_count'] + 1;
            $this->pdo->prepare(
                'UPDATE first_login_challenges SET attempt_count = attempt_count + 1 WHERE id = :id'
            )->execute(['id' => $challenge['id']]);

            if ($attempts >= 5) {
                $this->pdo->prepare('DELETE FROM first_login_challenges WHERE id = :id')->execute([
                    'id' => $challenge['id'],
                ]);
                throw new InvalidArgumentException('Too many incorrect codes. Sign in again to get a new code.');
            }

            throw new InvalidArgumentException('That code is incorrect.');
        }

        $this->pdo->prepare(
            'UPDATE first_login_challenges
             SET otp_verified_at = NOW(),
                 otp_expires_at = DATE_ADD(NOW(), INTERVAL 20 MINUTE)
             WHERE id = :id'
        )->execute(['id' => $challenge['id']]);

        $this->log((int) $challenge['user_id'], 'Password', 'First-login verification code accepted.');
    }

    public function replaceTemporaryPassword(string $challengeId, string $password, string $confirm): array
    {
        $challenge = $this->loadChallenge($challengeId);

        if (empty($challenge['otp_verified_at'])) {
            throw new InvalidArgumentException('Enter the verification code before setting a new password.');
        }

        if (strtotime((string) $challenge['otp_expires_at']) < time()) {
            throw new InvalidArgumentException('This setup session has expired. Sign in again.');
        }

        $this->assertPassword($password, $confirm);
        $user = $this->loadUser((int) $challenge['user_id']);
        $this->assertStillRequiresSetup($user);

        if (password_verify($password, (string) $user['password_hash'])) {
            throw new InvalidArgumentException('Choose a password that is different from the temporary password.');
        }

        $this->pdo->beginTransaction();

        try {
            $update = $this->pdo->prepare(
                'UPDATE users
                 SET password_hash = :password_hash,
                     password_updated_at = NOW(),
                     must_change_password = 0
                 WHERE id = :id
                   AND must_change_password = 1'
            );
            $update->execute([
                'password_hash' => password_hash($password, PASSWORD_DEFAULT),
                'id' => $user['id'],
            ]);

            if ($update->rowCount() < 1) {
                throw new InvalidArgumentException('This temporary password was already replaced.');
            }

            $onboarding = (string) ($user['onboarding_step'] ?? 'done');
            $nextStep = 'done';

            if ($onboarding === 'password') {
                $this->pdo->prepare(
                    "UPDATE users SET onboarding_step = 'profile' WHERE id = :id AND onboarding_step = 'password'"
                )->execute(['id' => $user['id']]);
                $this->pdo->prepare(
                    'UPDATE first_login_challenges
                     SET password_replaced_at = NOW(),
                         otp_expires_at = DATE_ADD(NOW(), INTERVAL 45 MINUTE)
                     WHERE id = :id'
                )->execute(['id' => $challenge['id']]);
                $nextStep = 'profile';
            } else {
                $this->pdo->prepare('DELETE FROM first_login_challenges WHERE user_id = :user_id')->execute([
                    'user_id' => $user['id'],
                ]);
            }

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $error;
        }

        $this->log((int) $user['id'], 'Password', 'Replaced the temporary password during first login.');

        $result = [
            'id' => (int) $user['id'],
            'username' => (string) $user['username'],
            'next_step' => $nextStep,
        ];

        if ($nextStep === 'profile') {
            $user['onboarding_step'] = 'profile';
            $result['setup'] = $this->setupSnapshot($user);
        }

        return $result;
    }

    public function beginContinuation(int $userId): array
    {
        $user = $this->loadUser($userId);
        $step = (string) ($user['onboarding_step'] ?? 'done');

        if (!(bool) $user['is_active'] || !in_array($step, ['profile', 'security'], true)) {
            throw new InvalidArgumentException('This account does not need more setup.');
        }

        $challengeId = bin2hex(random_bytes(16));
        $this->pdo->prepare('DELETE FROM first_login_challenges WHERE user_id = :user_id')->execute([
            'user_id' => $userId,
        ]);
        $this->pdo->prepare(
            'INSERT INTO first_login_challenges
                (id, user_id, otp_hash, otp_expires_at, otp_verified_at, password_replaced_at, created_at)
             VALUES
                (:id, :user_id, :otp_hash, DATE_ADD(NOW(), INTERVAL 45 MINUTE), NOW(), NOW(), NOW())'
        )->execute([
            'id' => $challengeId,
            'user_id' => $userId,
            'otp_hash' => password_hash(bin2hex(random_bytes(8)), PASSWORD_DEFAULT),
        ]);

        return [
            'challenge_id' => $challengeId,
            'masked_email' => $this->maskEmail((string) $user['email']),
            'expires_in' => 2700,
            'next_step' => $step,
            'setup' => $this->setupSnapshot($user),
        ];
    }

    public function completeProfile(string $challengeId, array $input): array
    {
        $challenge = $this->loadChallenge($challengeId);
        $this->assertSetupSession($challenge, 'profile');

        require_once __DIR__ . '/UserRegistrationService.php';
        (new UserRegistrationService($this->pdo))->completeOnboardingProfile((int) $challenge['user_id'], $input);
        $this->extendSetupSession((string) $challenge['id']);
        $this->log((int) $challenge['user_id'], 'Update', 'Completed account details during first login.');

        return ['next_step' => 'security'];
    }

    public function saveSecurityQuestions(string $challengeId, array $input): array
    {
        $challenge = $this->loadChallenge($challengeId);
        $user = $this->assertSetupSession($challenge, 'security');

        require_once __DIR__ . '/UserRegistrationService.php';
        (new UserRegistrationService($this->pdo))->saveInitialSecurityQuestions((int) $user['id'], $input);
        $this->pdo->prepare('DELETE FROM first_login_challenges WHERE user_id = :user_id')->execute([
            'user_id' => $user['id'],
        ]);
        $this->log((int) $user['id'], 'Update', 'Set security questions during first login.');

        return [
            'id' => (int) $user['id'],
            'username' => (string) $user['username'],
        ];
    }

    private function sendOtpEmail(string $email, string $username, string $otp): void
    {
        $body = <<<TEXT
Entrivo Door Lock System
Caraga State University - Cabadbaran Campus

Hello {$username},

Use this verification code to finish signing in to Entrivo for the first time.

Verification code: {$otp}

This code expires in 10 minutes. Enter it on the Entrivo login screen, choose a new password, complete your information, and set your security questions. Your dashboard opens after that setup is finished.

If you did not try to sign in, ignore this email. Do not share this code with anyone.

Entrivo Door Lock System
Caraga State University - Cabadbaran Campus
TEXT;

        $mail = new MailService();
        $mail->send($email, 'Entrivo first login verification code', $body, MailService::mailbox('otp'));
    }

    private function loginUrl(string $username): string
    {
        $base = trim((string) (getenv('APP_LOGIN_URL') ?: 'http://127.0.0.1:5173/login'));
        $separator = str_contains($base, '?') ? '&' : '?';

        return $base . $separator . 'username=' . rawurlencode($username);
    }

    private function assertSendCooldown(int $userId): void
    {
        $recent = $this->pdo->prepare(
            'SELECT id FROM first_login_challenges
             WHERE user_id = :user_id AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)
             LIMIT 1'
        );
        $recent->execute(['user_id' => $userId]);

        if ($recent->fetch()) {
            throw new InvalidArgumentException('A code was just sent. Wait a minute before requesting another.');
        }
    }

    private function assertStillRequiresSetup(array $user): void
    {
        if (!(bool) $user['is_active'] || (int) $user['must_change_password'] !== 1) {
            throw new InvalidArgumentException('This account does not need first-login setup.');
        }
    }

    private function assertPassword(string $password, string $confirm): void
    {
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
        if ($password !== $confirm) {
            throw new InvalidArgumentException('Password confirmation does not match.');
        }
    }

    private function loadChallenge(string $challengeId): array
    {
        $challengeId = strtolower(trim($challengeId));

        if (!preg_match('/^[a-f0-9]{32}$/', $challengeId)) {
            throw new InvalidArgumentException('This verification session is no longer valid. Sign in again.');
        }

        $statement = $this->pdo->prepare(
            'SELECT id, user_id, otp_hash, otp_expires_at, otp_verified_at, password_replaced_at, attempt_count
             FROM first_login_challenges
             WHERE id = :id
             LIMIT 1'
        );
        $statement->execute(['id' => $challengeId]);
        $challenge = $statement->fetch(PDO::FETCH_ASSOC);

        if (!$challenge) {
            throw new InvalidArgumentException('This verification session is no longer valid. Sign in again.');
        }

        return $challenge;
    }

    private function loadUser(int $userId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, username, email, password_hash, role, is_active, must_change_password, onboarding_step
             FROM users
             WHERE id = :id
             LIMIT 1'
        );
        $statement->execute(['id' => $userId]);
        $user = $statement->fetch(PDO::FETCH_ASSOC);

        if (!$user) {
            throw new InvalidArgumentException('This account could not be found.');
        }

        return $user;
    }

    private function assertSetupSession(array $challenge, string $expectedStep): array
    {
        if (empty($challenge['password_replaced_at'])) {
            throw new InvalidArgumentException('Set a new password before continuing.');
        }

        if (strtotime((string) $challenge['otp_expires_at']) < time()) {
            throw new InvalidArgumentException('This setup session has expired. Sign in again.');
        }

        $user = $this->loadUser((int) $challenge['user_id']);

        if (!(bool) $user['is_active'] || (string) ($user['onboarding_step'] ?? '') !== $expectedStep) {
            throw new InvalidArgumentException('This setup step is no longer available. Sign in again.');
        }

        return $user;
    }

    private function extendSetupSession(string $challengeId): void
    {
        $this->pdo->prepare(
            'UPDATE first_login_challenges
             SET otp_expires_at = DATE_ADD(NOW(), INTERVAL 45 MINUTE)
             WHERE id = :id'
        )->execute(['id' => $challengeId]);
    }

    private function setupSnapshot(array $user): array
    {
        $role = (string) ($user['role'] ?? '');
        $table = match ($role) {
            'student' => 'student_info',
            'faculty' => 'faculty_info',
            'staff' => 'staff_info',
            default => 'admin_info',
        };
        $idColumn = $role === 'student' ? 'school_id' : 'employee_id';
        $statement = $this->pdo->prepare(
            "SELECT first_name, middle_name, last_name, {$idColumn} AS identifier
             FROM {$table}
             WHERE user_id = :user_id
             LIMIT 1"
        );
        $statement->execute(['user_id' => $user['id']]);
        $profile = $statement->fetch(PDO::FETCH_ASSOC) ?: [];

        return [
            'role' => $role,
            'first_name' => (string) ($profile['first_name'] ?? ''),
            'middle_name' => (string) ($profile['middle_name'] ?? ''),
            'last_name' => (string) ($profile['last_name'] ?? ''),
            'identifier' => (string) ($profile['identifier'] ?? ''),
            'identifier_label' => $role === 'student' ? 'School ID' : 'Employee ID',
            'email' => (string) ($user['email'] ?? ''),
        ];
    }

    private function maskEmail(string $email): string
    {
        $parts = explode('@', $email, 2);
        if (count($parts) !== 2) {
            return $email;
        }

        $name = $parts[0];
        $visible = substr($name, 0, 1);

        return $visible . str_repeat('*', max(2, strlen($name) - 1)) . '@' . $parts[1];
    }

    private function log(int $userId, string $activityType, string $description, string $status = 'Success'): void
    {
        if ($userId < 1) {
            return;
        }

        (new ActivityLogService($this->pdo))->record(
            $userId,
            $activityType,
            $description,
            $status,
            $userId,
            'user',
            (string) $userId
        );
    }
}
