<?php

/**
 * Grants the new "Delete Requests" privilege to existing Admin accounts.
 *
 * Admins with at least one stored user_privileges row resolve their access from those
 * rows instead of the role defaults, so they would otherwise lose the Delete Requests
 * page until their next login re-seeds missing defaults. This backfills them right away.
 * Accounts with no stored rows are skipped: they already resolve through the updated
 * role defaults.
 *
 * Super Admin accounts are deliberately excluded: they delete records directly, so the
 * requester-side privilege is Admin-only.
 *
 * Run: php backend/migrations/grant_delete_requests_privilege.php
 */

require_once dirname(__DIR__) . '/config/connection.php';

try {
    $pdo = entrivo_pdo();

    $grant = $pdo->prepare(
        "INSERT IGNORE INTO user_privileges (user_id, privilege_key)
         SELECT users.id, 'delete_requests'
         FROM users
         WHERE users.role = 'admin'
           AND EXISTS (SELECT 1 FROM user_privileges existing WHERE existing.user_id = users.id)"
    );
    $grant->execute();

    echo 'Granted delete_requests to ' . $grant->rowCount() . " Admin account(s).\n";
    echo "Migration complete.\n";
} catch (Throwable $error) {
    echo 'Migration failed: ' . $error->getMessage() . "\n";
    exit(1);
}
