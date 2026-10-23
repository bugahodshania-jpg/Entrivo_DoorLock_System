<?php

final class DoorStatusSchema
{
    public static function exists(PDO $pdo): bool
    {
        try {
            $pdo->query('SELECT 1 FROM door_controller_status LIMIT 0');
            return true;
        } catch (PDOException $error) {
            if ($error->getCode() === '42S02') return false;
            throw $error;
        }
    }

    public static function definition(): string
    {
        return "CREATE TABLE IF NOT EXISTS door_controller_status (
            device_id INT NOT NULL PRIMARY KEY,
            door_state ENUM('locked','unlocked') NOT NULL,
            boot_id CHAR(32) NOT NULL,
            report_sequence BIGINT UNSIGNED NOT NULL,
            received_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
    }
}
