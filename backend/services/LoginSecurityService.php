<?php

/**
 * Server-side login attempt tracking and temporary lockouts.
 * Source of truth: database timestamps (Asia/Manila via entrivo_pdo).
 */
class LoginSecurityService
{
    private const LOCK_SECONDS = [
        1 => 15,
        2 => 30,
        3 => 60,
    ];

    private PDO $pdo;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
    }

    public function clientIp(): ?string
    {
        $ip = $_SERVER['REMOTE_ADDR'] ?? null;
        if (!is_string($ip) || $ip === '') {
            return null;
        }

        return substr($ip, 0, 45);
    }

    public function userAgent(): ?string
    {
        $ua = $_SERVER['HTTP_USER_AGENT'] ?? null;
        if (!is_string($ua) || $ua === '') {
            return null;
        }

        return substr($ua, 0, 512);
    }

    public function recordAttempt(
        ?int $userId,
        string $username,
        string $status,
        ?string $failureReason = null
    ): void {
        $statement = $this->pdo->prepare(
            'INSERT INTO login_attempts
                (user_id, username_attempted, attempt_status, failure_reason, ip_address, user_agent, created_at)
             VALUES
                (:user_id, :username_attempted, :attempt_status, :failure_reason, :ip_address, :user_agent, NOW())'
        );
        $statement->execute([
            'user_id' => $userId,
            'username_attempted' => substr($username, 0, 191),
            'attempt_status' => $status,
            'failure_reason' => $failureReason,
            'ip_address' => $this->clientIp(),
            'user_agent' => $this->userAgent(),
        ]);
    }

    /**
     * Lock and return the security row for a user (creates if missing).
     * Must be called inside an open transaction.
     */
    public function lockSessionRow(int $userId): array
    {
        $select = $this->pdo->prepare(
            'SELECT *
             FROM user_login_sessions
             WHERE user_id = :user_id
             LIMIT 1
             FOR UPDATE'
        );
        $select->execute(['user_id' => $userId]);
        $row = $select->fetch();

        if ($row) {
            return $row;
        }

        $insert = $this->pdo->prepare(
            'INSERT INTO user_login_sessions
                (user_id, failed_attempts, current_batch, lock_count, session_status, ip_address, user_agent, created_at, updated_at)
             VALUES
                (:user_id, 0, 0, 0, \'active\', :ip_address, :user_agent, NOW(), NOW())'
        );
        $insert->execute([
            'user_id' => $userId,
            'ip_address' => $this->clientIp(),
            'user_agent' => $this->userAgent(),
        ]);

        $select->execute(['user_id' => $userId]);
        $row = $select->fetch();

        if (!$row) {
            throw new RuntimeException('Unable to initialize login security session.');
        }

        return $row;
    }

    public function remainingLockSeconds(?array $session): int
    {
        if (!$session || empty($session['locked_until']) || empty($session['user_id'])) {
            return 0;
        }

        $check = $this->pdo->prepare(
            'SELECT GREATEST(0, TIMESTAMPDIFF(SECOND, NOW(), locked_until)) AS remaining
             FROM user_login_sessions
             WHERE user_id = :user_id
             LIMIT 1'
        );
        $check->execute(['user_id' => $session['user_id']]);

        return max(0, (int) ($check->fetchColumn() ?: 0));
    }

    public function isLocked(array $session): bool
    {
        return $this->remainingLockSeconds($session) > 0;
    }

    public function shouldShowForgotPassword(int $failedAttempts, bool $isLocked = false): bool
    {
        // Visible on the 2nd attempt of each batch (2, 5, 8...).
        // While locked, keep it available for recovery; UI hides it when the timer ends.
        if ($isLocked) {
            return true;
        }

        return $failedAttempts > 0 && $failedAttempts % 3 === 2;
    }

    public function lockSecondsForCount(int $lockCount): int
    {
        if ($lockCount <= 1) {
            return self::LOCK_SECONDS[1];
        }
        if ($lockCount === 2) {
            return self::LOCK_SECONDS[2];
        }

        return self::LOCK_SECONDS[3];
    }

    /**
     * Apply a failed password attempt. Returns updated public security payload.
     */
    public function registerFailedPassword(int $userId, string $username, array $session): array
    {
        $failedAttempts = ((int) $session['failed_attempts']) + 1;
        $currentBatch = (int) ceil($failedAttempts / 3);
        $lockCount = (int) $session['lock_count'];
        $lockedUntil = null;
        $sessionStatus = 'active';
        $retryAfter = 0;

        if ($failedAttempts % 3 === 0) {
            $lockCount += 1;
            $retryAfter = $this->lockSecondsForCount($lockCount);
            $sessionStatus = 'locked';

            $until = $this->pdo->query(
                'SELECT DATE_ADD(NOW(), INTERVAL ' . (int) $retryAfter . ' SECOND) AS locked_until'
            );
            $lockedUntil = $until ? $until->fetchColumn() : null;
        }

        $update = $this->pdo->prepare(
            'UPDATE user_login_sessions
             SET failed_attempts = :failed_attempts,
                 current_batch = :current_batch,
                 lock_count = :lock_count,
                 locked_until = :locked_until,
                 last_failed_at = NOW(),
                 session_status = :session_status,
                 ip_address = :ip_address,
                 user_agent = :user_agent,
                 updated_at = NOW()
             WHERE user_id = :user_id'
        );
        $update->execute([
            'failed_attempts' => $failedAttempts,
            'current_batch' => $currentBatch,
            'lock_count' => $lockCount,
            'locked_until' => $lockedUntil,
            'session_status' => $sessionStatus,
            'ip_address' => $this->clientIp(),
            'user_agent' => $this->userAgent(),
            'user_id' => $userId,
        ]);

        $this->recordAttempt($userId, $username, 'failed', 'wrong_password');

        return [
            'failed_attempts' => $failedAttempts,
            'locked' => $retryAfter > 0,
            'retry_after' => $retryAfter,
            'show_forgot_password' => $this->shouldShowForgotPassword($failedAttempts, $retryAfter > 0),
            'lock_seconds' => $retryAfter,
        ];
    }

    public function registerBlockedAttempt(int $userId, string $username, array $session): array
    {
        $this->recordAttempt($userId, $username, 'blocked', 'locked');
        $retryAfter = $this->remainingLockSeconds($session);

        return [
            'failed_attempts' => (int) $session['failed_attempts'],
            'locked' => $retryAfter > 0,
            'retry_after' => $retryAfter,
            'show_forgot_password' => $this->shouldShowForgotPassword((int) $session['failed_attempts'], $retryAfter > 0),
            'lock_seconds' => $retryAfter,
        ];
    }

    public function clearFailedAttempts(int $userId): void
    {
        $update = $this->pdo->prepare(
            'UPDATE user_login_sessions
             SET failed_attempts = 0,
                 current_batch = 0,
                 lock_count = 0,
                 locked_until = NULL,
                 session_status = \'active\',
                 updated_at = NOW()
             WHERE user_id = :user_id'
        );
        $update->execute(['user_id' => $userId]);
    }

    public function registerSuccessfulLogin(int $userId, string $username): void
    {
        $update = $this->pdo->prepare(
            'UPDATE user_login_sessions
             SET failed_attempts = 0,
                 current_batch = 0,
                 lock_count = 0,
                 locked_until = NULL,
                 last_login_at = NOW(),
                 session_status = \'active\',
                 ip_address = :ip_address,
                 user_agent = :user_agent,
                 updated_at = NOW()
             WHERE user_id = :user_id'
        );
        $update->execute([
            'ip_address' => $this->clientIp(),
            'user_agent' => $this->userAgent(),
            'user_id' => $userId,
        ]);

        // Ensure a row exists even on first successful login
        if ($update->rowCount() === 0) {
            $insert = $this->pdo->prepare(
                'INSERT INTO user_login_sessions
                    (user_id, failed_attempts, current_batch, lock_count, locked_until, last_login_at,
                     session_status, ip_address, user_agent, created_at, updated_at)
                 VALUES
                    (:user_id, 0, 0, 0, NULL, NOW(), \'active\', :ip_address, :user_agent, NOW(), NOW())
                 ON DUPLICATE KEY UPDATE
                    failed_attempts = 0,
                    current_batch = 0,
                    lock_count = 0,
                    locked_until = NULL,
                    last_login_at = NOW(),
                    session_status = \'active\',
                    ip_address = VALUES(ip_address),
                    user_agent = VALUES(user_agent),
                    updated_at = NOW()'
            );
            $insert->execute([
                'user_id' => $userId,
                'ip_address' => $this->clientIp(),
                'user_agent' => $this->userAgent(),
            ]);
        }

        $this->recordAttempt($userId, $username, 'success', null);
    }

    public function clearExpiredLock(int $userId, array $session): array
    {
        if (empty($session['locked_until'])) {
            return $session;
        }

        if ($this->remainingLockSeconds($session) > 0) {
            return $session;
        }

        $update = $this->pdo->prepare(
            'UPDATE user_login_sessions
             SET locked_until = NULL,
                 session_status = \'active\',
                 updated_at = NOW()
             WHERE user_id = :user_id
               AND locked_until IS NOT NULL
               AND locked_until <= NOW()'
        );
        $update->execute(['user_id' => $userId]);

        $session['locked_until'] = null;
        $session['session_status'] = 'active';

        return $session;
    }

    public function publicLockPayload(array $security): array
    {
        return [
            'locked' => !empty($security['locked']),
            'retry_after' => (int) ($security['retry_after'] ?? 0),
            'show_forgot_password' => !empty($security['show_forgot_password']),
        ];
    }
}
