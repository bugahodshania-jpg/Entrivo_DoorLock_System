<?php

$envPath = dirname(__DIR__) . '/.env';

$envLines = @file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
if (is_array($envLines)) {
    foreach ($envLines as $line) {
        if (str_starts_with(trim($line), '#') || !str_contains($line, '=')) {
            continue;
        }

        [$key, $value] = array_map('trim', explode('=', $line, 2));
        $_ENV[$key] = $value;
        putenv("$key=$value");
    }
}

// Online (APP_ENV=production) the database settings must come from the host's
// environment variables; never fall back to the local XAMPP database.
if (getenv('APP_ENV') === 'production') {
    $missing = array_filter(
        ['DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USERNAME', 'DB_PASSWORD'],
        static fn (string $key): bool => getenv($key) === false || getenv($key) === ''
    );
    if ($missing !== []) {
        error_log('Entrivo: missing database environment variables: ' . implode(', ', $missing));
        throw new RuntimeException('Database is not configured.');
    }
}

return [
    'host' => getenv('DB_HOST') ?: '127.0.0.1',
    'port' => getenv('DB_PORT') ?: '3307',
    'database' => getenv('DB_DATABASE') ?: 'entrivo_database_system',
    'username' => getenv('DB_USERNAME') ?: 'root',
    'password' => getenv('DB_PASSWORD') ?: '',
    'charset' => 'utf8mb4',
    'timezone' => 'Asia/Manila',
    'timezone_offset' => '+08:00',
];
