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
            ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0
            AFTER password_updated_at");
        echo "Added users.must_change_password.\n";
    } catch (PDOException $error) {
        if ($error->getCode() == '42S21') {
            echo "Column must_change_password already exists.\n";
        } else {
            throw $error;
        }
    }

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS first_login_challenges (
            id CHAR(32) NOT NULL,
            user_id INT NOT NULL,
            otp_hash VARCHAR(255) NOT NULL,
            otp_expires_at DATETIME NOT NULL,
            otp_verified_at DATETIME NULL,
            attempt_count INT NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            KEY user_id (user_id),
            CONSTRAINT first_login_challenges_user_fk
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"
    );
    echo "first_login_challenges is ready.\n";
} catch (PDOException $error) {
    echo 'Migration failed: ' . $error->getMessage() . "\n";
    exit(1);
}
