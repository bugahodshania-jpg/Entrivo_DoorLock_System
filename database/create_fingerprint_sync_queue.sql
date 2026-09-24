-- Create Sensor B fingerprint template sync queue.
USE `entrivo_database_system`;

CREATE TABLE IF NOT EXISTS `fingerprint_sync_queue` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `fingerprint_sync_queue`
    ADD CONSTRAINT `fk_sync_queue_fingerprint`
        FOREIGN KEY (`fingerprint_id`)
        REFERENCES `fingerprints` (`fingerprint_id`)
        ON DELETE CASCADE;

ALTER TABLE `fingerprint_sync_queue`
    ADD CONSTRAINT `fk_sync_queue_device`
        FOREIGN KEY (`device_id`)
        REFERENCES `fingerprint_devices` (`device_id`)
        ON DELETE CASCADE;
