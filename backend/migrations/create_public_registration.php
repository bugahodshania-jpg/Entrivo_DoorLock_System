<?php

/**
 * Adds pending-approval columns and security questions for public student sign-up.
 *
 * Run: php backend/migrations/create_public_registration.php
 */

require_once dirname(__DIR__) . '/config/connection.php';

try {
    $pdo = entrivo_pdo();

    $approvalStatus = $pdo->query("SHOW COLUMNS FROM users LIKE 'approval_status'")->fetch();
    if (!$approvalStatus) {
        $pdo->exec(
            "ALTER TABLE users
             ADD COLUMN approval_status ENUM('approved', 'pending') NOT NULL DEFAULT 'approved' AFTER is_active"
        );
        echo "OK: users.approval_status\n";
    } else {
        $type = (string) ($approvalStatus['Type'] ?? '');
        if (!str_contains($type, 'rejected')) {
            $pdo->exec(
                "ALTER TABLE users
                 MODIFY COLUMN approval_status ENUM('approved', 'pending', 'rejected') NOT NULL DEFAULT 'approved'"
            );
            echo "OK: users.approval_status includes rejected\n";
        } else {
            echo "SKIP: users.approval_status\n";
        }
    }

    $approvalDueAt = $pdo->query("SHOW COLUMNS FROM users LIKE 'approval_due_at'")->fetch();
    if (!$approvalDueAt) {
        $pdo->exec(
            "ALTER TABLE users
             ADD COLUMN approval_due_at DATETIME NULL DEFAULT NULL AFTER approval_status"
        );
        echo "OK: users.approval_due_at\n";
    } else {
        echo "SKIP: users.approval_due_at\n";
    }

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS account_security_questions (
            question_id INT NOT NULL AUTO_INCREMENT,
            user_id INT NOT NULL,
            question_slot TINYINT NOT NULL,
            question VARCHAR(255) NOT NULL,
            answer_hash VARCHAR(255) NOT NULL,
            answer_text VARCHAR(100) NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (question_id),
            UNIQUE KEY uq_user_question_slot (user_id, question_slot),
            CONSTRAINT fk_security_question_user
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"
    );
    echo "OK: account_security_questions\n";
    echo "Migration complete.\n";
} catch (Throwable $error) {
    echo 'Migration failed: ' . $error->getMessage() . "\n";
    exit(1);
}
