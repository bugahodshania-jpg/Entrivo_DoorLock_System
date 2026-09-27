<?php

/**
 * Ensures only one super admin can hold the dashboard session at a time.
 * First successful login claims the lock and marks other super admins inactive.
 * Logout or heartbeat timeout releases the lock and restores standby accounts.
 */
class SuperAdminDashboardSession
{
    public const HEARTBEAT_TIMEOUT_SECONDS = 90;

    private PDO $pdo;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
        $this->ensureTable();
    }

    public function claim(int $userId, string $username): void
    {
        $this->pdo->beginTransaction();

        try {
            $this->lockRowForUpdate();
            $current = $this->fetchCurrent();

            if ($current && (int) $current['user_id'] !== $userId && !$this->isExpired($current)) {
                throw new InvalidArgumentException(
                    'Another Super Admin is currently active. Only one Super Admin can be active at a time. Please try again later.'
                );
            }

            if (!$current || $this->isExpired($current) || (int) ($current['user_id'] ?? 0) !== $userId) {
                $this->restoreStandbyUsers();
                $this->clearHolder();
            }

            $this->deactivateOtherSuperAdmins($userId);
            $this->upsertHolder($userId, $username);
            $this->reactivateHolder($userId);
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $error;
        }
    }

    public function heartbeat(int $userId): array
    {
        $this->pdo->beginTransaction();

        try {
            $this->lockRowForUpdate();
            $current = $this->fetchCurrent();

            if (!$current || $this->isExpired($current)) {
                $this->restoreStandbyUsers();
                $this->clearHolder();
                $this->pdo->commit();

                throw new InvalidArgumentException(
                    'Your super admin dashboard session has expired. Please sign in again.'
                );
            }

            if ((int) $current['user_id'] !== $userId) {
                $this->pdo->commit();

                throw new InvalidArgumentException(
                    'Another Super Admin is currently active. Only one Super Admin can be active at a time. Please try again later.'
                );
            }

            $update = $this->pdo->prepare(
                'UPDATE super_admin_dashboard_session
                 SET heartbeat_at = NOW()
                 WHERE id = 1 AND user_id = :user_id'
            );
            $update->execute(['user_id' => $userId]);
            $this->pdo->commit();

            return [
                'active' => true,
                'user_id' => $userId,
            ];
        } catch (InvalidArgumentException $error) {
            throw $error;
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $error;
        }
    }

    public function release(int $userId): void
    {
        try {
            $this->pdo->beginTransaction();
            $this->lockRowForUpdate();
            $current = $this->fetchCurrent();

            if ($current && (int) $current['user_id'] === $userId) {
                $this->restoreStandbyUsers();
                $this->clearHolder();
            }

            $this->pdo->commit();
        } catch (PDOException) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
        }
    }

    public function releaseIfHeldBy(int $userId): void
    {
        $this->release($userId);
    }

    public function isStandbyUser(int $userId): bool
    {
        try {
            $statement = $this->pdo->prepare(
                'SELECT 1 FROM super_admin_session_standby WHERE user_id = :user_id LIMIT 1'
            );
            $statement->execute(['user_id' => $userId]);

            return (bool) $statement->fetchColumn();
        } catch (PDOException) {
            return false;
        }
    }

    /** @return array<int, true> */
    public function standbyUserIdMap(): array
    {
        try {
            $rows = $this->pdo->query(
                'SELECT user_id FROM super_admin_session_standby'
            )->fetchAll(PDO::FETCH_COLUMN);

            $map = [];
            foreach ($rows as $id) {
                $map[(int) $id] = true;
            }

            return $map;
        } catch (PDOException) {
            return [];
        }
    }

    public function removeFromStandby(int $userId): void
    {
        try {
            $statement = $this->pdo->prepare(
                'DELETE FROM super_admin_session_standby WHERE user_id = :user_id'
            );
            $statement->execute(['user_id' => $userId]);
        } catch (PDOException) {
            // Optional.
        }
    }

    public function putOnStandby(int $userId): void
    {
        try {
            $insert = $this->pdo->prepare(
                'INSERT IGNORE INTO super_admin_session_standby (user_id, created_at)
                 VALUES (:user_id, NOW())'
            );
            $insert->execute(['user_id' => $userId]);

            $update = $this->pdo->prepare(
                'UPDATE users SET is_active = 0 WHERE id = :user_id AND role = \'super_admin\''
            );
            $update->execute(['user_id' => $userId]);
        } catch (PDOException) {
            // Optional.
        }
    }

    /**
     * If another Super Admin already holds the dashboard session,
     * mark this Super Admin inactive (standby) until that session ends.
     */
    public function placeOnStandbyIfSessionHeldByOther(int $userId): bool
    {
        $holderId = $this->getActiveHolderId();

        if ($holderId === null || $holderId === $userId) {
            return false;
        }

        $this->putOnStandby($userId);

        return true;
    }

    public function getActiveHolderId(): ?int
    {
        $current = $this->fetchCurrent();

        if (!$current || $this->isExpired($current)) {
            return null;
        }

        return (int) $current['user_id'];
    }

    private function deactivateOtherSuperAdmins(int $holderUserId): void
    {
        $statement = $this->pdo->prepare(
            "SELECT id FROM users
             WHERE role = 'super_admin'
               AND is_active = 1
               AND id <> :holder_id"
        );
        $statement->execute(['holder_id' => $holderUserId]);
        $otherIds = array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN) ?: []);

        if ($otherIds === []) {
            return;
        }

        $placeholders = implode(',', array_fill(0, count($otherIds), '?'));
        $deactivate = $this->pdo->prepare(
            "UPDATE users SET is_active = 0 WHERE id IN ({$placeholders})"
        );
        $deactivate->execute($otherIds);

        $insert = $this->pdo->prepare(
            'INSERT IGNORE INTO super_admin_session_standby (user_id, created_at)
             VALUES (?, NOW())'
        );

        foreach ($otherIds as $otherId) {
            $insert->execute([$otherId]);
        }
    }

    private function reactivateHolder(int $userId): void
    {
        $this->removeFromStandby($userId);
        $update = $this->pdo->prepare(
            "UPDATE users SET is_active = 1 WHERE id = :user_id AND role = 'super_admin'"
        );
        $update->execute(['user_id' => $userId]);
    }

    private function restoreStandbyUsers(): void
    {
        try {
            $ids = $this->pdo->query(
                'SELECT user_id FROM super_admin_session_standby'
            )->fetchAll(PDO::FETCH_COLUMN) ?: [];

            if ($ids === []) {
                return;
            }

            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $reactivate = $this->pdo->prepare(
                "UPDATE users
                 SET is_active = 1
                 WHERE id IN ({$placeholders})
                   AND role = 'super_admin'"
            );
            $reactivate->execute(array_map('intval', $ids));
            $this->pdo->exec('DELETE FROM super_admin_session_standby');
        } catch (PDOException) {
            // Optional.
        }
    }

    private function ensureTable(): void
    {
        try {
            $this->pdo->exec(
                "CREATE TABLE IF NOT EXISTS super_admin_dashboard_session (
                    id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
                    user_id INT UNSIGNED NOT NULL,
                    username VARCHAR(191) NOT NULL,
                    heartbeat_at DATETIME NOT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
        } catch (PDOException) {
            // Ignore create races / restricted environments.
        }

        try {
            $this->pdo->exec(
                "CREATE TABLE IF NOT EXISTS super_admin_session_standby (
                    user_id INT UNSIGNED NOT NULL PRIMARY KEY,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
        } catch (PDOException) {
            // Ignore create races / restricted environments.
        }
    }

    private function lockRowForUpdate(): void
    {
        try {
            $this->pdo->query(
                'SELECT id FROM super_admin_dashboard_session WHERE id = 1 LIMIT 1 FOR UPDATE'
            );
        } catch (PDOException) {
            // Empty table is fine.
        }
    }

    private function fetchCurrent(): ?array
    {
        try {
            $statement = $this->pdo->query(
                'SELECT user_id, username, heartbeat_at
                 FROM super_admin_dashboard_session
                 WHERE id = 1
                 LIMIT 1'
            );
            $row = $statement ? $statement->fetch(PDO::FETCH_ASSOC) : false;

            return $row ?: null;
        } catch (PDOException) {
            return null;
        }
    }

    private function isExpired(array $session): bool
    {
        $heartbeatAt = (string) ($session['heartbeat_at'] ?? '');

        if ($heartbeatAt === '') {
            return true;
        }

        $check = $this->pdo->prepare(
            'SELECT CASE
                WHEN TIMESTAMPDIFF(SECOND, :heartbeat_at, NOW()) >= :timeout THEN 1
                ELSE 0
             END'
        );
        $check->execute([
            'heartbeat_at' => $heartbeatAt,
            'timeout' => self::HEARTBEAT_TIMEOUT_SECONDS,
        ]);

        return (int) $check->fetchColumn() === 1;
    }

    private function upsertHolder(int $userId, string $username): void
    {
        $statement = $this->pdo->prepare(
            'INSERT INTO super_admin_dashboard_session (id, user_id, username, heartbeat_at, created_at)
             VALUES (1, :user_id, :username, NOW(), NOW())
             ON DUPLICATE KEY UPDATE
                user_id = VALUES(user_id),
                username = VALUES(username),
                heartbeat_at = NOW()'
        );
        $statement->execute([
            'user_id' => $userId,
            'username' => substr($username, 0, 191),
        ]);
    }

    private function clearHolder(): void
    {
        try {
            $this->pdo->exec('DELETE FROM super_admin_dashboard_session WHERE id = 1');
        } catch (PDOException) {
            // Optional.
        }
    }
}
