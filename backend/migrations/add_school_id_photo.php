<?php

require dirname(__DIR__) . '/config/connection.php';

$pdo = entrivo_pdo();
$column = 'school_id_photo';
$exists = $pdo->query('SHOW COLUMNS FROM student_info LIKE ' . $pdo->quote($column))->fetch();

if ($exists) {
    echo "SKIP: student_info.$column\n";
    return;
}

$pdo->exec('ALTER TABLE student_info ADD COLUMN school_id_photo MEDIUMTEXT NULL DEFAULT NULL AFTER country');
echo "OK: student_info.$column\n";
