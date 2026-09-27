<?php

/**
 * Creates the exclusive super-admin dashboard session lock table.
 *
 * Run: php backend/migrations/create_super_admin_dashboard_session.php
 */

require_once dirname(__DIR__) . '/config/connection.php';

try {
    $pdo = entrivo_pdo();

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS super_admin_dashboard_session (
            id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
            user_id INT UNSIGNED NOT NULL,
            username VARCHAR(191) NOT NULL,
            heartbeat_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT chk_super_admin_dashboard_session_singleton CHECK (id = 1)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    echo "OK: super_admin_dashboard_session\n";
    echo "Migration complete.\n";
} catch (Throwable $error) {
    echo 'Migration failed: ' . $error->getMessage() . "\n";
    exit(1);
}
