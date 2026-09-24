USE `entrivo_database_system`;

ALTER TABLE `fingerprint_enrollment_jobs`
    ADD COLUMN `fingerprint_id` INT NULL AFTER `user_id`,
    ADD KEY `idx_job_fingerprint_id` (`fingerprint_id`),
    ADD CONSTRAINT `fk_job_fingerprint`
        FOREIGN KEY (`fingerprint_id`)
        REFERENCES `fingerprints` (`fingerprint_id`)
        ON DELETE SET NULL;
