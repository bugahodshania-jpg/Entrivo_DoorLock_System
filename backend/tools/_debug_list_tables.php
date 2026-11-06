<?php
require_once __DIR__ . '/../config/connection.php';
$pdo = entrivo_pdo();
foreach ($pdo->query("SHOW TABLES LIKE 'fingerprint%'") as $row) {
    echo reset($row) . PHP_EOL;
}
