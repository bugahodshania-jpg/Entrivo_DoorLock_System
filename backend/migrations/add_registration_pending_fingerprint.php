<?php

$config = require dirname(__DIR__) . '/config/database.php';
$dsn = sprintf(
    'mysql:host=%s;port=%s;dbname=%s;charset=%s',
    $config['host'],
    $config['port'],
    $config['database'],
    $config['charset']
);

$pdo = new PDO($dsn, $config['username'], $config['password'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);

$profileTables = ['faculty_info', 'staff_info', 'admin_info'];

foreach ($profileTables as $table) {
    $column = $pdo->prepare(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table_name
           AND COLUMN_NAME = "users_photo"'
    );
    $column->execute(['table_name' => $table]);

    if ((int)$column->fetchColumn() === 0) {
        $pdo->exec("ALTER TABLE {$table} ADD COLUMN users_photo VARCHAR(255) NULL AFTER contact_number");
    }
}

function fingerprintColumnExists(PDO $pdo, string $columnName): bool
{
    $column = $pdo->prepare(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = "fingerprints"
           AND COLUMN_NAME = :column_name'
    );
    $column->execute(['column_name' => $columnName]);

    return (int)$column->fetchColumn() > 0;
}

$pdo->exec('ALTER TABLE users MODIFY email VARCHAR(100) NULL');

if (fingerprintColumnExists($pdo, 'sensor_slot_id')) {
    $pdo->exec('ALTER TABLE fingerprints MODIFY sensor_slot_id INT NULL');
}

if (fingerprintColumnExists($pdo, 'finger_name')) {
    $pdo->exec('ALTER TABLE fingerprints MODIFY finger_name VARCHAR(50) NULL');
}

$pdo->exec("ALTER TABLE fingerprints MODIFY status ENUM('pending', 'active', 'inactive') DEFAULT 'pending'");

echo "Migration successful: registration photos and pending fingerprints are supported.\n";
