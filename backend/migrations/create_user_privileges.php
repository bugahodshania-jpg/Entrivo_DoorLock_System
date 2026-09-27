<?php

/**
 * Creates user_privileges for Roles & Privileges management.
 *
 * Run: php backend/migrations/create_user_privileges.php
 */

require_once dirname(__DIR__) . '/config/connection.php';

try {
    $pdo = entrivo_pdo();

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS user_privileges (
            user_id INT UNSIGNED NOT NULL,
            privilege_key VARCHAR(64) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, privilege_key),
            KEY idx_user_privileges_key (privilege_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    echo "OK: user_privileges\n";
    echo "Migration complete.\n";
} catch (Throwable $error) {
    echo 'Migration failed: ' . $error->getMessage() . "\n";
    exit(1);
}
