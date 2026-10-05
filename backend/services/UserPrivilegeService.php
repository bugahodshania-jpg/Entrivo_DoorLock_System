<?php

class UserPrivilegeService
{
    public const PRIVILEGES = [
        'dashboard' => [
            'label' => 'Dashboard',
            'description' => 'View the overview dashboard.',
            'path' => '/super-admin/dashboard',
        ],
        'manage_users' => [
            'label' => 'Manage Users',
            'description' => 'View and manage user accounts.',
            'path' => '/super-admin/manage-users',
        ],
        'delete_users' => [
            'label' => 'Delete Users',
            'description' => 'Permanently delete user accounts from Manage Users.',
            'path' => null,
        ],
        'pending_registrations' => [
            'label' => 'Pending Registration',
            'description' => 'Review and approve pending registrations.',
            'path' => '/super-admin/pending-registrations',
        ],
        'fingerprint' => [
            'label' => 'Fingerprint',
            'description' => 'View fingerprint records and enroll new fingerprints.',
            'path' => '/super-admin/fingerprint',
        ],
        'fingerprint_update' => [
            'label' => 'Update Fingerprints',
            'description' => 'Update existing fingerprint templates.',
            'path' => null,
        ],
        'rfid_cards' => [
            'label' => 'RFID Cards',
            'description' => 'Manage RFID card assignments.',
            'path' => '/super-admin/rfid-cards',
        ],
        'schedules' => [
            'label' => 'Schedules',
            'description' => 'Create and manage access schedules.',
            'path' => '/super-admin/schedules',
        ],
        'pending_overrides' => [
            'label' => 'Pending Overrides',
            'description' => 'Review and approve temporary access override requests.',
            'path' => '/super-admin/pending-overrides',
        ],
        'access_logs' => [
            'label' => 'Access Logs',
            'description' => 'View door access logs.',
            'path' => '/super-admin/access-logs',
        ],
        'activity_logs' => [
            'label' => 'Activity Logs',
            'description' => 'View system activity logs.',
            'path' => '/super-admin/activity-logs',
        ],
        'reports' => [
            'label' => 'Reports',
            'description' => 'Generate and export reports.',
            'path' => '/super-admin/reports',
        ],
        'settings' => [
            'label' => 'Settings',
            'description' => 'Access system settings.',
            'path' => '/super-admin/settings',
        ],
    ];

    public const ROLE_DEFAULTS = [
        'super_admin' => [
            'dashboard',
            'manage_users',
            'delete_users',
            'pending_registrations',
            'fingerprint',
            'fingerprint_update',
            'rfid_cards',
            'schedules',
            'pending_overrides',
            'access_logs',
            'activity_logs',
            'reports',
            'settings',
        ],
        'admin' => [
            'dashboard',
            'manage_users',
            'pending_registrations',
            'fingerprint',
            'fingerprint_update',
            'rfid_cards',
            'schedules',
            'pending_overrides',
            'access_logs',
            'activity_logs',
            'reports',
            'settings',
        ],
    ];

    private PDO $pdo;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
        $this->ensureTable();
    }

    public static function catalog(): array
    {
        $items = [];

        foreach (self::PRIVILEGES as $key => $meta) {
            $items[] = [
                'key' => $key,
                'label' => $meta['label'],
                'description' => $meta['description'],
                'path' => $meta['path'],
            ];
        }

        return $items;
    }

    public static function defaultsForRole(string $role): array
    {
        return self::ROLE_DEFAULTS[$role] ?? self::ROLE_DEFAULTS['admin'];
    }

    public static function privilegeForPath(string $path): ?string
    {
        foreach (self::PRIVILEGES as $key => $meta) {
            if (!empty($meta['path']) && $meta['path'] === $path) {
                return $key;
            }
        }

        if (str_starts_with($path, '/super-admin/register-user')) {
            return 'manage_users';
        }

        if ($path === '/super-admin/profile') {
            return null;
        }

        return null;
    }

    public function getPrivileges(int $userId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT privilege_key FROM user_privileges WHERE user_id = :user_id ORDER BY privilege_key ASC'
        );
        $statement->execute(['user_id' => $userId]);
        $keys = array_values(array_filter(array_map('strval', $statement->fetchAll(PDO::FETCH_COLUMN) ?: [])));

        if ($keys !== []) {
            return array_values(array_intersect(array_keys(self::PRIVILEGES), $keys));
        }

        $roleStatement = $this->pdo->prepare('SELECT role FROM users WHERE id = :id LIMIT 1');
        $roleStatement->execute(['id' => $userId]);
        $role = (string) ($roleStatement->fetchColumn() ?: 'admin');

        return self::defaultsForRole($role);
    }

    public function setPrivileges(int $userId, array $privileges): array
    {
        $allowed = array_keys(self::PRIVILEGES);
        $normalized = [];

        foreach ($privileges as $privilege) {
            $key = strtolower(trim((string) $privilege));

            if (in_array($key, $allowed, true)) {
                $normalized[$key] = true;
            }
        }

        $keys = array_keys($normalized);

        if ($keys === []) {
            throw new InvalidArgumentException('Select at least one privilege.');
        }

        if (!in_array('dashboard', $keys, true)) {
            array_unshift($keys, 'dashboard');
            $keys = array_values(array_unique($keys));
        }

        $this->pdo->beginTransaction();

        try {
            $delete = $this->pdo->prepare('DELETE FROM user_privileges WHERE user_id = :user_id');
            $delete->execute(['user_id' => $userId]);

            $insert = $this->pdo->prepare(
                'INSERT INTO user_privileges (user_id, privilege_key) VALUES (:user_id, :privilege_key)'
            );

            foreach ($keys as $key) {
                $insert->execute([
                    'user_id' => $userId,
                    'privilege_key' => $key,
                ]);
            }

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $error;
        }

        return $keys;
    }

    public function seedDefaultsIfMissing(int $userId, string $role): array
    {
        $statement = $this->pdo->prepare(
            'SELECT COUNT(*) FROM user_privileges WHERE user_id = :user_id'
        );
        $statement->execute(['user_id' => $userId]);

        if ((int) $statement->fetchColumn() > 0) {
            if ($role === 'super_admin') {
                $this->grantMissingPrivileges($userId, [
                    'delete_users',
                    'fingerprint_update',
                    'pending_overrides',
                ]);
            }

            if ($role === 'admin') {
                $this->grantMissingPrivileges($userId, self::ROLE_DEFAULTS['admin']);
            }

            return $this->getPrivileges($userId);
        }

        return $this->setPrivileges($userId, self::defaultsForRole($role));
    }

    public function actorHasPrivilege(int $actorId, string $privilegeKey): bool
    {
        $statement = $this->pdo->prepare(
            'SELECT role, is_active FROM users WHERE id = :id LIMIT 1'
        );
        $statement->execute(['id' => $actorId]);
        $actor = $statement->fetch(PDO::FETCH_ASSOC);

        if (!$actor || !(bool) $actor['is_active']) {
            return false;
        }

        if (!in_array((string) $actor['role'], ['admin', 'super_admin'], true)) {
            return false;
        }

        return in_array($privilegeKey, $this->getPrivileges($actorId), true);
    }

    public function assertActorHasPrivilege(int $actorId, string $privilegeKey, string $message): void
    {
        if (!$this->actorHasPrivilege($actorId, $privilegeKey)) {
            throw new InvalidArgumentException($message);
        }
    }

    public function assertActorCanDeleteRecords(int $actorId, string $message): void
    {
        if ($this->actorRole($actorId) !== 'super_admin') {
            throw new InvalidArgumentException($message);
        }
    }

    public function actorRole(int $actorId): ?string
    {
        $statement = $this->pdo->prepare(
            'SELECT role, is_active FROM users WHERE id = :id LIMIT 1'
        );
        $statement->execute(['id' => $actorId]);
        $actor = $statement->fetch(PDO::FETCH_ASSOC);

        if (!$actor || !(bool) $actor['is_active']) {
            return null;
        }

        return (string) $actor['role'];
    }

    private function grantMissingPrivileges(int $userId, array $privilegeKeys): void
    {
        $insert = $this->pdo->prepare(
            'INSERT IGNORE INTO user_privileges (user_id, privilege_key) VALUES (:user_id, :privilege_key)'
        );

        foreach ($privilegeKeys as $key) {
            if (!isset(self::PRIVILEGES[$key])) {
                continue;
            }

            $insert->execute([
                'user_id' => $userId,
                'privilege_key' => $key,
            ]);
        }
    }

    private function ensureTable(): void
    {
        try {
            $this->pdo->exec(
                "CREATE TABLE IF NOT EXISTS user_privileges (
                    user_id INT UNSIGNED NOT NULL,
                    privilege_key VARCHAR(64) NOT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, privilege_key),
                    KEY idx_user_privileges_key (privilege_key)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
        } catch (PDOException) {
            // Ignore create races / restricted environments.
        }
    }
}
