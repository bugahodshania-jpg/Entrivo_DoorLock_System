<?php

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['message' => 'Method not allowed']);
    exit;
}

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/MailService.php';
require_once dirname(__DIR__) . '/services/ActivityLogService.php';

function recordRecoveryActivity(PDO $pdo, int $userId, string $activityType, string $description, string $status = 'Success'): void
{
    (new ActivityLogService($pdo))->record(
        $userId,
        $activityType,
        $description,
        $status,
        $userId,
        'recovery',
        null
    );
}

try {
    $pdo = entrivo_pdo();
    ensurePasswordResetTable($pdo);
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) {
        throw new InvalidArgumentException('Request body must be JSON.');
    }

    $step = (string) ($input['step'] ?? '');
    $result = match ($step) {
        'identifier' => startReset($pdo, $input),
        'resend' => resendReset($pdo, $input),
        'otp' => verifyOtp($pdo, $input),
        'questions' => verifyQuestions($pdo, $input),
        'password' => resetPassword($pdo, $input),
        default => throw new InvalidArgumentException('Choose a reset step.'),
    };

    echo json_encode($result);
} catch (InvalidArgumentException $exception) {
    http_response_code(422);
    echo json_encode(['message' => $exception->getMessage()]);
} catch (RuntimeException $exception) {
    http_response_code(500);
    echo json_encode(['message' => $exception->getMessage()]);
} catch (Throwable $exception) {
    http_response_code(500);
    echo json_encode(['message' => 'Password reset could not be completed.']);
}

function ensurePasswordResetTable(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS password_reset_challenges (
            id CHAR(32) NOT NULL PRIMARY KEY,
            user_id INT NOT NULL,
            otp_hash VARCHAR(255) NOT NULL,
            otp_expires_at DATETIME NOT NULL,
            otp_verified_at DATETIME NULL,
            questions_verified_at DATETIME NULL,
            created_at DATETIME NOT NULL,
            INDEX idx_password_reset_user (user_id)
        )"
    );
}

function startReset(PDO $pdo, array $input): array
{
    $schoolId = trim((string) ($input['school_id'] ?? ''));
    if ($schoolId === '') {
        throw new InvalidArgumentException('School ID is required.');
    }

    $account = findAccount($pdo, $schoolId);
    if (!$account) {
        recordRecoveryActivity(
            $pdo,
            0,
            'Recovery',
            'Account recovery failed. No account matched the supplied ID.',
            'Failed'
        );
        throw new InvalidArgumentException('No account was found for that School ID or Employee ID.');
    }

    assertAccountCanReset($pdo, $account);

    if (trim((string) $account['email']) === '') {
        throw new InvalidArgumentException('This account has no registered email.');
    }

    $recent = $pdo->prepare(
        'SELECT id FROM password_reset_challenges
         WHERE user_id = :user_id AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)
         ORDER BY created_at DESC LIMIT 1'
    );
    $recent->execute(['user_id' => $account['id']]);
    if ($recent->fetch()) {
        throw new InvalidArgumentException('A code was just sent. Wait a minute before requesting another.');
    }

    $otp = (string) random_int(100000, 999999);
    $challengeId = bin2hex(random_bytes(16));
    $insert = $pdo->prepare(
        'INSERT INTO password_reset_challenges
            (id, user_id, otp_hash, otp_expires_at, created_at)
         VALUES
            (:id, :user_id, :otp_hash, DATE_ADD(NOW(), INTERVAL 10 MINUTE), NOW())'
    );
    $insert->execute([
        'id' => $challengeId,
        'user_id' => $account['id'],
        'otp_hash' => password_hash($otp, PASSWORD_DEFAULT),
    ]);

    $mail = new MailService();
    $mail->send($account['email'], recoveryEmailSubject(), recoveryEmailBody($otp));

    recordRecoveryActivity(
        $pdo,
        (int) $account['id'],
        'Recovery',
        'Account recovery started. A password reset code was emailed.'
    );

    return [
        'challenge_id' => $challengeId,
        'masked_email' => maskEmail($account['email']),
        'expires_in' => 600,
    ];
}

function resendReset(PDO $pdo, array $input): array
{
    $challenge = loadChallenge($pdo, (string) ($input['challenge_id'] ?? ''));
    $account = $pdo->prepare(
        'SELECT id, email, is_active, approval_status FROM users WHERE id = :id LIMIT 1'
    );
    $account->execute(['id' => $challenge['user_id']]);
    $user = $account->fetch(PDO::FETCH_ASSOC);
    if (!$user || trim((string) $user['email']) === '') {
        throw new InvalidArgumentException('This account has no registered email.');
    }

    assertAccountCanReset($pdo, $user);

    $recent = $pdo->prepare(
        'SELECT id FROM password_reset_challenges
         WHERE user_id = :user_id AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)
         LIMIT 1'
    );
    $recent->execute(['user_id' => $user['id']]);
    if ($recent->fetch()) {
        throw new InvalidArgumentException('A code was just sent. Wait a minute before requesting another.');
    }

    $otp = (string) random_int(100000, 999999);
    $challengeId = bin2hex(random_bytes(16));
    $insert = $pdo->prepare(
        'INSERT INTO password_reset_challenges
            (id, user_id, otp_hash, otp_expires_at, created_at)
         VALUES
            (:id, :user_id, :otp_hash, DATE_ADD(NOW(), INTERVAL 10 MINUTE), NOW())'
    );
    $insert->execute([
        'id' => $challengeId,
        'user_id' => $user['id'],
        'otp_hash' => password_hash($otp, PASSWORD_DEFAULT),
    ]);

    $mail = new MailService();
    $mail->send($user['email'], recoveryEmailSubject(), recoveryEmailBody($otp));

    recordRecoveryActivity(
        $pdo,
        (int) $user['id'],
        'Recovery',
        'Account recovery code was sent again.'
    );

    return [
        'challenge_id' => $challengeId,
        'masked_email' => maskEmail($user['email']),
        'expires_in' => 600,
    ];
}

function verifyOtp(PDO $pdo, array $input): array
{
    $challenge = loadChallenge($pdo, (string) ($input['challenge_id'] ?? ''));
    $otp = trim((string) ($input['otp'] ?? ''));
    if (!preg_match('/^\d{6}$/', $otp)) {
        throw new InvalidArgumentException('Enter the 6-digit code from your email.');
    }

    if ($challenge['otp_verified_at']) {
        return ['question_sets' => recoveryQuestionSets(accountQuestions($pdo, (int) $challenge['user_id']))];
    }

    if (strtotime((string) $challenge['otp_expires_at']) < time()) {
        recordRecoveryActivity(
            $pdo,
            (int) $challenge['user_id'],
            'Recovery',
            'Account recovery failed. The email code had expired.',
            'Failed'
        );
        throw new InvalidArgumentException('That code has expired. Request a new one.');
    }

    if (!password_verify($otp, (string) $challenge['otp_hash'])) {
        recordRecoveryActivity(
            $pdo,
            (int) $challenge['user_id'],
            'Recovery',
            'Account recovery failed. The email code did not match.',
            'Failed'
        );
        throw new InvalidArgumentException('That code does not match. Check the email and try again.');
    }

    $update = $pdo->prepare(
        'UPDATE password_reset_challenges SET otp_verified_at = NOW() WHERE id = :id'
    );
    $update->execute(['id' => $challenge['id']]);

    recordRecoveryActivity(
        $pdo,
        (int) $challenge['user_id'],
        'Recovery',
        'Account recovery email code was verified.'
    );

    return ['question_sets' => recoveryQuestionSets(accountQuestions($pdo, (int) $challenge['user_id']))];
}

function verifyQuestions(PDO $pdo, array $input): array
{
    $challenge = loadChallenge($pdo, (string) ($input['challenge_id'] ?? ''));
    if (!$challenge['otp_verified_at']) {
        throw new InvalidArgumentException('Verify the email code before answering security questions.');
    }

    $answers = $input['answers'] ?? null;
    if (!is_array($answers) || count($answers) !== 3) {
        throw new InvalidArgumentException('Answer all three security questions.');
    }

    $stored = $pdo->prepare(
        'SELECT question, answer_hash FROM account_security_questions
         WHERE user_id = :user_id ORDER BY question_slot ASC'
    );
    $stored->execute(['user_id' => $challenge['user_id']]);
    $rows = $stored->fetchAll(PDO::FETCH_ASSOC);
    $byQuestion = [];
    foreach ($rows as $row) {
        $byQuestion[$row['question']] = $row['answer_hash'];
    }

    $seen = [];
    foreach ($answers as $item) {
        $question = trim((string) ($item['question'] ?? ''));
        $answer = trim((string) ($item['answer'] ?? ''));
        if ($question === '' || !isset($byQuestion[$question])) {
            throw new InvalidArgumentException('Select a security question from the ones set during enrollment.');
        }
        if (isset($seen[$question])) {
            throw new InvalidArgumentException('Choose a different question for each answer.');
        }
        if ($answer === '') {
            throw new InvalidArgumentException('Each security answer is required.');
        }
        if (!password_verify(strtolower($answer), $byQuestion[$question])) {
            recordRecoveryActivity(
                $pdo,
                (int) $challenge['user_id'],
                'Recovery',
                'Account recovery failed. A security answer did not match.',
                'Failed'
            );
            throw new InvalidArgumentException('One or more security answers do not match.');
        }
        $seen[$question] = true;
    }

    $update = $pdo->prepare(
        'UPDATE password_reset_challenges SET questions_verified_at = NOW() WHERE id = :id'
    );
    $update->execute(['id' => $challenge['id']]);

    recordRecoveryActivity(
        $pdo,
        (int) $challenge['user_id'],
        'Recovery',
        'Account recovery security answers were verified.'
    );

    return ['verified' => true];
}

function resetPassword(PDO $pdo, array $input): array
{
    $challenge = loadChallenge($pdo, (string) ($input['challenge_id'] ?? ''));
    if (!$challenge['questions_verified_at']) {
        throw new InvalidArgumentException('Answer the security questions before choosing a new password.');
    }

    $password = (string) ($input['password'] ?? '');
    $confirm = (string) ($input['confirm_password'] ?? '');
    assertPassword($password, $confirm);

    $user = $pdo->prepare('SELECT password_hash FROM users WHERE id = :id LIMIT 1');
    $user->execute(['id' => $challenge['user_id']]);
    $row = $user->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        throw new InvalidArgumentException('This account is no longer available.');
    }

    if (password_verify($password, (string) $row['password_hash'])) {
        throw new InvalidArgumentException('Choose a password that is different from your last password.');
    }

    $pdo->beginTransaction();
    $update = $pdo->prepare(
        'UPDATE users SET password_hash = :password_hash, password_updated_at = NOW() WHERE id = :id'
    );
    $update->execute([
        'password_hash' => password_hash($password, PASSWORD_DEFAULT),
        'id' => $challenge['user_id'],
    ]);
    $clear = $pdo->prepare('DELETE FROM password_reset_challenges WHERE user_id = :user_id');
    $clear->execute(['user_id' => $challenge['user_id']]);
    $pdo->commit();

    recordRecoveryActivity(
        $pdo,
        (int) $challenge['user_id'],
        'Recovery',
        'Account recovery completed and the password was reset.'
    );

    return ['reset' => true];
}

function findAccount(PDO $pdo, string $identifier): ?array
{
    $statement = $pdo->prepare(
        'SELECT users.id, users.email, users.is_active, users.approval_status
         FROM users
         LEFT JOIN student_info ON student_info.user_id = users.id
         LEFT JOIN faculty_info ON faculty_info.user_id = users.id
         LEFT JOIN staff_info ON staff_info.user_id = users.id
         LEFT JOIN admin_info ON admin_info.user_id = users.id
         WHERE student_info.school_id = :identifier
            OR faculty_info.employee_id = :identifier
            OR staff_info.employee_id = :identifier
            OR admin_info.employee_id = :identifier
         LIMIT 1'
    );
    $statement->execute(['identifier' => $identifier]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row ?: null;
}

function assertAccountCanReset(PDO $pdo, array $account): void
{
    if (($account['approval_status'] ?? 'approved') === 'pending') {
        throw new InvalidArgumentException('This account is still pending approval. Password reset is not available.');
    }

    if (($account['approval_status'] ?? 'approved') === 'rejected' || !(bool) $account['is_active']) {
        throw new InvalidArgumentException('This account is blocked. Password reset is not available.');
    }

    $lock = $pdo->prepare(
        'SELECT locked_until FROM user_login_sessions
         WHERE user_id = :user_id AND locked_until IS NOT NULL AND locked_until > NOW()
         LIMIT 1'
    );
    $lock->execute(['user_id' => $account['id']]);
    if ($lock->fetch()) {
        throw new InvalidArgumentException('This account is blocked. Password reset is not available.');
    }
}

function loadChallenge(PDO $pdo, string $id): array
{
    if (!preg_match('/^[a-f0-9]{32}$/', $id)) {
        throw new InvalidArgumentException('This reset session is no longer valid. Start again.');
    }

    $statement = $pdo->prepare(
        'SELECT id, user_id, otp_hash, otp_expires_at, otp_verified_at, questions_verified_at
         FROM password_reset_challenges WHERE id = :id LIMIT 1'
    );
    $statement->execute(['id' => $id]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        throw new InvalidArgumentException('This reset session is no longer valid. Start again.');
    }

    return $row;
}

function accountQuestions(PDO $pdo, int $userId): array
{
    $statement = $pdo->prepare(
        'SELECT question FROM account_security_questions
         WHERE user_id = :user_id ORDER BY question_slot ASC'
    );
    $statement->execute(['user_id' => $userId]);
    $questions = array_column($statement->fetchAll(PDO::FETCH_ASSOC), 'question');
    if (count($questions) < 3) {
        throw new InvalidArgumentException('This account does not have security questions on file.');
    }

    return array_values(array_slice($questions, 0, 3));
}

function recoveryQuestionSets(array $enrolled): array
{
    $decoys = array_values(array_diff(recoveryDecoyQuestions(), $enrolled));
    shuffle($decoys);

    if (count($decoys) < 15) {
        throw new RuntimeException('Recovery questions could not be prepared.');
    }

    $sets = [];
    foreach ($enrolled as $index => $correct) {
        $options = array_merge([$correct], array_slice($decoys, $index * 5, 5));
        shuffle($options);
        $sets[] = array_values($options);
    }

    return $sets;
}

function recoveryDecoyQuestions(): array
{
    return [
        'What is the name of your first school?',
        'What is your mother\'s maiden name?',
        'What city were you born in?',
        'What is the name of your favorite teacher?',
        'What was the name of your first pet?',
        'What is your favorite book?',
        'What was the name of your first street?',
        'What is your favorite food?',
        'What was the model of your first phone?',
        'What is the name of your childhood best friend?',
        'What is your father\'s middle name?',
        'What was the name of your first teacher?',
        'What city did you first travel to?',
        'What is the name of the hospital where you were born?',
        'What was your favorite subject in grade school?',
        'What is the name of your first cousin?',
        'What color was your first bicycle?',
        'What is the last name of your first neighbor?',
        'What was the name of your elementary school principal?',
        'What is your favorite movie?',
        'What month did your family move to a new home?',
        'What is the name of your favorite sports team?',
    ];
}

function assertPassword(string $password, string $confirm): void
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

function recoveryEmailSubject(): string
{
    return 'Entrivo password reset verification code';
}

function recoveryEmailBody(string $otp): string
{
    return <<<TEXT
Entrivo Door Lock System
Caraga State University - Cabadbaran Campus

Hello,

A password reset was requested for your Entrivo account. Use the verification code below to confirm that you own this account.

Verification code: {$otp}

This code expires in 10 minutes. Enter it on the Entrivo reset screen to continue. After the code is accepted, you will answer your security questions and choose a new password.

If you did not request this reset, ignore this email. Your password will stay the same. Do not share this code with anyone.

Entrivo Door Lock System
Caraga State University - Cabadbaran Campus
TEXT;
}

function maskEmail(string $email): string
{
    $parts = explode('@', $email, 2);
    if (count($parts) !== 2) {
        return $email;
    }

    $name = $parts[0];
    $visible = substr($name, 0, 1);

    return $visible . str_repeat('*', max(2, strlen($name) - 1)) . '@' . $parts[1];
}
