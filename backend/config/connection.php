<?php

/**
 * Shared DB connection + Asia/Manila timezone bootstrap.
 * All API/model code should use entrivo_pdo() so NOW()/TIMESTAMP/DATETIME
 * and PHP date() stay aligned to Asia/Manila (+08:00).
 */

date_default_timezone_set('Asia/Manila');

if (!defined('ENTRIVO_TIMEZONE')) {
    define('ENTRIVO_TIMEZONE', 'Asia/Manila');
    define('ENTRIVO_TIMEZONE_OFFSET', '+08:00');
}

function entrivo_db_config(): array
{
    static $config = null;

    if ($config === null) {
        $config = require __DIR__ . '/database.php';
    }

    return $config;
}

function entrivo_pdo(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $config = entrivo_db_config();
    $dsn = sprintf(
        'mysql:host=%s;port=%s;dbname=%s;charset=%s',
        $config['host'],
        $config['port'],
        $config['database'],
        $config['charset']
    );

    $pdo = new PDO($dsn, $config['username'], $config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    $pdo->exec("SET time_zone = '" . ENTRIVO_TIMEZONE_OFFSET . "'");

    return $pdo;
}

function entrivo_now(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone(ENTRIVO_TIMEZONE)))->format('Y-m-d H:i:s');
}

function entrivo_today(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone(ENTRIVO_TIMEZONE)))->format('Y-m-d');
}
