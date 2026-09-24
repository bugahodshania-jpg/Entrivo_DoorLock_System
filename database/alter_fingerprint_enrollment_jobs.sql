-- Update fingerprint_enrollment_jobs schema
-- 1) Rename column: sensor_slot -> assigned_slot
-- 2) Add columns: started_at, finished_at

USE `entrivo_database_system`;

ALTER TABLE `fingerprint_enrollment_jobs`
    CHANGE COLUMN `sensor_slot` `assigned_slot` INT NULL,
    ADD COLUMN `started_at` DATETIME NULL,
    ADD COLUMN `finished_at` DATETIME NULL;

