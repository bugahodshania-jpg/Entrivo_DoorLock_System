<?php

/**
 * Add schedule_kind to distinguish regular schedules from override schedules.
 *
 * Run: php backend/migrations/add_schedule_kind.php
 */

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

    $column = $pdo->query("SHOW COLUMNS FROM schedules LIKE 'schedule_kind'")->fetch(PDO::FETCH_ASSOC);

    if (!$column) {
        $pdo->exec(
            "ALTER TABLE schedules
             ADD COLUMN schedule_kind ENUM('regular', 'override') NOT NULL DEFAULT 'regular'
             COMMENT 'regular = admin-created schedule; override = approved override request'
             AFTER schedule_type"
        );
        echo "Migration successful: added schedule_kind column to schedules table.\n";
    } else {
        echo "Column schedule_kind already exists. Continuing with backfill.\n";
    }

    $updated = $pdo->exec(
        "UPDATE schedules
         SET schedule_kind = 'override'
         WHERE status = 'overridden'
           AND schedule_kind <> 'override'"
    );

    echo 'Backfill complete: marked ' . (int) $updated . " schedule(s) as override.\n";
} catch (PDOException $error) {
    echo 'Migration failed: ' . $error->getMessage() . "\n";
    exit(1);
}
