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

    $pdo->exec("ALTER TABLE schedules
        ADD COLUMN repeat_day VARCHAR(15) NULL DEFAULT NULL
        COMMENT 'Specific day of week for individual recurring schedule entry (e.g. Monday)'
        AFTER repeat_days");

    echo "Migration successful: added repeat_day column to schedules table.\n";
} catch (PDOException $e) {
    if ($e->getCode() == '42S21') {
        echo "Column repeat_day already exists. Skipping.\n";
    } else {
        echo "Migration failed: " . $e->getMessage() . "\n";
        exit(1);
    }
}
