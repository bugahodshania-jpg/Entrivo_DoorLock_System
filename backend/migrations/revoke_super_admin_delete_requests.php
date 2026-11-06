<?php

/**
 * Removes the "Delete Requests" privilege from every Super Admin account.
 *
 * Super Admins delete records directly, so the requester-side delete_requests privilege
 * is Admin-only and should not appear in a Super Admin's privilege set. Earlier
 * backfilling stored it for existing Super Admins; this clears those rows.
 *
 * Run: php backend/migrations/revoke_super_admin_delete_requests.php
 */

require_once dirname(__DIR__) . '/config/connection.php';

try {
    $pdo = entrivo_pdo();

    $revoke = $pdo->prepare(
        "DELETE user_privileges
         FROM user_privileges
         INNER JOIN users ON users.id = user_privileges.user_id
         WHERE users.role = 'super_admin'
           AND user_privileges.privilege_key = 'delete_requests'"
    );
    $revoke->execute();

    echo 'Revoked delete_requests from ' . $revoke->rowCount() . " Super Admin account(s).\n";
    echo "Migration complete.\n";
} catch (Throwable $error) {
    echo 'Migration failed: ' . $error->getMessage() . "\n";
    exit(1);
}
