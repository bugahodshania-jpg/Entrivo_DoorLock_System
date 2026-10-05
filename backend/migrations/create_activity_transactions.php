<?php

/**
 * Creates activity_transactions for admin audit events
 * (add, edit, delete, enroll, approve, etc.).
 *
 * Run: php backend/migrations/create_activity_transactions.php
 */

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/ActivityLogService.php';

try {
    $pdo = entrivo_pdo();
    (new ActivityLogService($pdo))->ensureTable();
    echo "OK: activity_transactions\n";
    echo "Migration complete.\n";
} catch (Throwable $error) {
    echo 'Migration failed: ' . $error->getMessage() . "\n";
    exit(1);
}
