<?php

require dirname(__DIR__) . '/config/connection.php';

$pdo = entrivo_pdo();

foreach ([
    'zip_code' => "ALTER TABLE student_info ADD COLUMN zip_code VARCHAR(10) NULL DEFAULT NULL AFTER street_address",
    'country' => "ALTER TABLE student_info ADD COLUMN country VARCHAR(100) NULL DEFAULT NULL AFTER zip_code",
] as $column => $sql) {
    $exists = $pdo->query("SHOW COLUMNS FROM student_info LIKE " . $pdo->quote($column))->fetch();
    if ($exists) {
        echo "SKIP: student_info.$column\n";
        continue;
    }

    $pdo->exec($sql);
    echo "OK: student_info.$column\n";
}
