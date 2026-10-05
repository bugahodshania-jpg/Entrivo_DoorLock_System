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

    $onboarding = $pdo->query("SHOW COLUMNS FROM users LIKE 'onboarding_step'")->fetch();
    if (!$onboarding) {
        $pdo->exec(
            "ALTER TABLE users
             ADD COLUMN onboarding_step ENUM('password', 'profile', 'security', 'done')
             NOT NULL DEFAULT 'done'
             AFTER must_change_password"
        );
        echo "Added users.onboarding_step.\n";
    } else {
        echo "Column onboarding_step already exists.\n";
    }

    $passwordReplaced = $pdo->query("SHOW COLUMNS FROM first_login_challenges LIKE 'password_replaced_at'")->fetch();
    if (!$passwordReplaced) {
        $pdo->exec(
            "ALTER TABLE first_login_challenges
             ADD COLUMN password_replaced_at DATETIME NULL DEFAULT NULL
             AFTER otp_verified_at"
        );
        echo "Added first_login_challenges.password_replaced_at.\n";
    } else {
        echo "Column password_replaced_at already exists.\n";
    }

    foreach (['faculty_info', 'staff_info', 'admin_info'] as $table) {
        $pdo->exec("ALTER TABLE {$table} MODIFY office_department VARCHAR(150) NULL");
        $pdo->exec("ALTER TABLE {$table} MODIFY work_position VARCHAR(150) NULL");
        echo "Allowed incomplete work details on {$table}.\n";
    }

    $pdo->exec("ALTER TABLE student_info MODIFY college VARCHAR(150) NULL");
    $pdo->exec("ALTER TABLE student_info MODIFY program_department VARCHAR(150) NULL");
    $pdo->exec(
        "ALTER TABLE student_info
         MODIFY year_level ENUM('First Year', 'Second Year', 'Third Year', 'Fourth Year') NULL"
    );
    echo "Allowed incomplete student details on student_info.\n";
    echo "Migration complete.\n";
} catch (Throwable $error) {
    echo 'Migration failed: ' . $error->getMessage() . "\n";
    exit(1);
}
