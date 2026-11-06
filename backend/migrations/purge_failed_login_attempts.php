<?php

/**
 * Removes failed and blocked login attempts from the Login Logs audit trail.
 *
 * Failed sign-ins are no longer recorded (see LoginSecurityService::LOGGED_STATUSES),
 * so this clears the rows logged before that change. Only "failed" and "blocked"
 * rows are removed; successful logins and logouts are kept.
 *
 * Run: php backend/migrations/purge_failed_login_attempts.php
 */

require_once dirname(__DIR__) . '/config/connection.php';

try {
    $pdo = entrivo_pdo();

    $purge = $pdo->prepare(
        "DELETE FROM login_attempts
         WHERE attempt_status IN ('failed', 'blocked')"
    );
    $purge->execute();

    echo 'Removed ' . $purge->rowCount() . " failed login log row(s).\n";
    echo "Migration complete.\n";
} catch (Throwable $error) {
    echo 'Migration failed: ' . $error->getMessage() . "\n";
    exit(1);
}
