<?php
$config = require dirname(__DIR__) . '/config/database.php';
$dsn = sprintf(
    'mysql:host=%s;port=%s;dbname=%s;charset=%s',
    $config['host'],
    $config['port'],
    $config['database'],
    $config['charset']
);

try {
    $pdo = new PDO($dsn, $config['username'], $config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);

    try {
        $pdo->exec("ALTER TABLE users
            ADD COLUMN password_updated_at TIMESTAMP NULL DEFAULT NULL
            AFTER password_hash");
        echo "Migration successful: added password_updated_at column to users table.\n";
    } catch (PDOException $e) {
        if ($e->getCode() == '42S21') {
            echo "Column password_updated_at already exists. Continuing with backfill.\n";
        } else {
            throw $e;
        }
    }

    $updatedRows = $pdo->exec("UPDATE users
        SET password_updated_at = created_at
        WHERE password_updated_at IS NULL");
    echo "Backfill complete: updated {$updatedRows} existing user records.\n";
} catch (PDOException $e) {
    echo "Migration failed: " . $e->getMessage() . "\n";
    exit(1);
}
