<?php

/**
 * Revokes "Update Fingerprints" from every existing Admin account.
 *
 * Admins no longer receive fingerprint_update as a default privilege. Earlier
 * default seeding already stored it for existing Admins, so this clears it.
 * Super Admin accounts keep the privilege.
 *
 * Run: php backend/migrations/revoke_admin_fingerprint_update.php
 */

require_once dirname(__DIR__) . '/config/connection.php';

try {
    $pdo = entrivo_pdo();

    $revoke = $pdo->prepare(
        "DELETE user_privileges
         FROM user_privileges
         INNER JOIN users ON users.id = user_privileges.user_id
         WHERE users.role = 'admin'
           AND user_privileges.privilege_key = 'fingerprint_update'"
    );
    $revoke->execute();

    echo 'Revoked fingerprint_update from ' . $revoke->rowCount() . " Admin account(s).\n";
    echo "Migration complete.\n";
} catch (Throwable $error) {
    echo 'Migration failed: ' . $error->getMessage() . "\n";
    exit(1);
}
