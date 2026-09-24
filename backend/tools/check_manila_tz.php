<?php

require __DIR__ . '/../config/connection.php';

$pdo = entrivo_pdo();
$row = $pdo->query('SELECT @@session.time_zone AS session_tz, NOW() AS db_now, UTC_TIMESTAMP() AS utc_now')->fetch();

echo json_encode([
    'session_tz' => $row['session_tz'],
    'db_now' => $row['db_now'],
    'utc_now' => $row['utc_now'],
    'php_now' => entrivo_now(),
    'php_tz' => date_default_timezone_get(),
], JSON_PRETTY_PRINT) . PHP_EOL;
