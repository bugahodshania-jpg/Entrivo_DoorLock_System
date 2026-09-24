<?php

$config = require __DIR__ . '/../config/database.php';

$dsn = sprintf(
    'mysql:host=%s;port=%s;charset=%s',
    $config['host'],
    $config['port'],
    $config['charset']
);

$pdo = new PDO(
    $dsn,
    $config['username'],
    $config['password'],
    [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]
);

$pdo->exec('USE `' . str_replace('`', '``', $config['database']) . '`');

$existingTable = $pdo->query("SHOW TABLES LIKE 'fingerprint_sync_queue'")->fetch();

if ($existingTable) {
    $generatedColumn = $pdo->query("SHOW COLUMNS FROM `fingerprint_sync_queue` LIKE 'active_sync_key'")->fetch();

    if ($generatedColumn && stripos((string) ($generatedColumn['Extra'] ?? ''), 'STORED GENERATED') !== false) {
        $count = (int) $pdo->query('SELECT COUNT(*) AS row_count FROM `fingerprint_sync_queue`')->fetch()['row_count'];

        if ($count === 0) {
            $pdo->exec('DROP TABLE `fingerprint_sync_queue`');
            $existingTable = false;
        } else {
            throw new RuntimeException('fingerprint_sync_queue uses an incompatible generated active_sync_key column. Please migrate existing rows before rerunning this migration.');
        }
    }
}

$pdo->exec(
    "CREATE TABLE IF NOT EXISTS `fingerprint_sync_queue` (
        `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        `fingerprint_id` INT NOT NULL,
        `device_id` INT NOT NULL,
        `status` ENUM('pending', 'syncing', 'synced', 'failed') NOT NULL DEFAULT 'pending',
        `attempts` INT UNSIGNED NOT NULL DEFAULT 0,
        `error_message` TEXT NULL,
        `queued_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        `processing_at` TIMESTAMP NULL DEFAULT NULL,
        `synced_at` TIMESTAMP NULL DEFAULT NULL,
        `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        `active_sync_key` VARCHAR(64) NULL,
        PRIMARY KEY (`id`),
        UNIQUE KEY `unique_pending_sync` (`active_sync_key`),
        KEY `idx_sync_queue_device_status` (`device_id`, `status`, `queued_at`),
        KEY `idx_sync_queue_fingerprint_id` (`fingerprint_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"
);

$constraints = $pdo->prepare(
    'SELECT CONSTRAINT_NAME
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = :schema_name
       AND TABLE_NAME = "fingerprint_sync_queue"'
);
$constraints->execute(['schema_name' => $config['database']]);
$existingConstraints = array_column($constraints->fetchAll(), 'CONSTRAINT_NAME');

if (!in_array('fk_sync_queue_fingerprint', $existingConstraints, true)) {
    $pdo->exec(
        'ALTER TABLE `fingerprint_sync_queue`
         ADD CONSTRAINT `fk_sync_queue_fingerprint`
         FOREIGN KEY (`fingerprint_id`)
         REFERENCES `fingerprints` (`fingerprint_id`)
         ON DELETE CASCADE'
    );
}

if (!in_array('fk_sync_queue_device', $existingConstraints, true)) {
    $pdo->exec(
        'ALTER TABLE `fingerprint_sync_queue`
         ADD CONSTRAINT `fk_sync_queue_device`
         FOREIGN KEY (`device_id`)
         REFERENCES `fingerprint_devices` (`device_id`)
         ON DELETE CASCADE'
    );
}

echo "Migration successful: fingerprint_sync_queue is ready.\n";
