<?php

/**
 * Creates user_login_sessions + login_attempts for lockout / audit tracking.
 * Does not modify the users table.
 *
 * Run: php backend/migrations/create_login_security_tables.php
 */

require_once dirname(__DIR__) . '/config/connection.php';

try {
    $pdo = entrivo_pdo();

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS user_login_sessions (
            session_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id INT UNSIGNED NOT NULL,
            failed_attempts INT UNSIGNED NOT NULL DEFAULT 0,
            current_batch TINYINT UNSIGNED NOT NULL DEFAULT 0,
            lock_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
            locked_until DATETIME NULL DEFAULT NULL,
            last_failed_at DATETIME NULL DEFAULT NULL,
            last_login_at DATETIME NULL DEFAULT NULL,
            session_status VARCHAR(32) NOT NULL DEFAULT 'active',
            ip_address VARCHAR(45) NULL DEFAULT NULL,
            user_agent VARCHAR(512) NULL DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (session_id),
            UNIQUE KEY uq_user_login_sessions_user_id (user_id),
            KEY idx_user_login_sessions_locked_until (locked_until),
            KEY idx_user_login_sessions_status (session_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    echo "OK: user_login_sessions\n";

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS login_attempts (
            attempt_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id INT UNSIGNED NULL DEFAULT NULL,
            username_attempted VARCHAR(191) NOT NULL,
            attempt_status VARCHAR(32) NOT NULL,
            failure_reason VARCHAR(64) NULL DEFAULT NULL,
            ip_address VARCHAR(45) NULL DEFAULT NULL,
            user_agent VARCHAR(512) NULL DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (attempt_id),
            KEY idx_login_attempts_user_id (user_id),
            KEY idx_login_attempts_username (username_attempted),
            KEY idx_login_attempts_status (attempt_status),
            KEY idx_login_attempts_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    echo "OK: login_attempts\n";

    echo "Migration complete.\n";
} catch (Throwable $error) {
    echo 'Migration failed: ' . $error->getMessage() . "\n";
    exit(1);
}
