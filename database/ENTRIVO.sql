CREATE DATABASE IF NOT EXISTS `entrivo_database_system` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci */;
USE `entrivo_database_system`;

SET FOREIGN_KEY_CHECKS=0;

--
-- Table structure for table `access_log`
--
DROP TABLE IF EXISTS `access_log`;
CREATE TABLE `access_log` (
  `log_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `card_id` int DEFAULT NULL,
  `fingerprint_id` int DEFAULT NULL,
  `schedule_id` int DEFAULT NULL,
  `override_id` int DEFAULT NULL,
  `access_timestamp` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `access_status` enum('granted','denied') NOT NULL,
  `denial_reason` enum('not_registered','invalid_rfid','invalid_fingerprint','no_schedule','expired_schedule','schedule_not_started','unauthorized','offline') DEFAULT NULL,
  `method_access` enum('RFID','Fingerprint','Override') NOT NULL,
  PRIMARY KEY (`log_id`),
  KEY `idx_schedule_id` (`schedule_id`),
  KEY `idx_card_id` (`card_id`),
  KEY `idx_fingerprint_id` (`fingerprint_id`),
  KEY `idx_access_status` (`access_status`),
  KEY `idx_access_time` (`access_timestamp`),
  KEY `idx_access_user` (`user_id`),
  KEY `override_id` (`override_id`),
  CONSTRAINT `access_log_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `access_log_ibfk_2` FOREIGN KEY (`card_id`) REFERENCES `rfid_cards` (`card_id`) ON DELETE SET NULL,
  CONSTRAINT `access_log_ibfk_3` FOREIGN KEY (`fingerprint_id`) REFERENCES `fingerprints` (`fingerprint_id`) ON DELETE SET NULL,
  CONSTRAINT `access_log_ibfk_4` FOREIGN KEY (`schedule_id`) REFERENCES `schedules` (`schedule_id`) ON DELETE SET NULL,
  CONSTRAINT `access_log_ibfk_5` FOREIGN KEY (`override_id`) REFERENCES `access_overrides` (`override_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `access_overrides`
--
DROP TABLE IF EXISTS `access_overrides`;
CREATE TABLE `access_overrides` (
  `override_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `approved_by` int DEFAULT NULL,
  `reason` text,
  `override_start` datetime NOT NULL,
  `override_end` datetime NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`override_id`),
  KEY `user_id` (`user_id`),
  KEY `approved_by` (`approved_by`),
  CONSTRAINT `access_overrides_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `access_overrides_ibfk_2` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `access_overrides_chk_1` CHECK ((`override_end` > `override_start`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `admin_info`
--
DROP TABLE IF EXISTS `admin_info`;
CREATE TABLE `admin_info` (
  `admin_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `employee_id` varchar(20) NOT NULL,
  `first_name` varchar(50) NOT NULL,
  `middle_name` varchar(50) DEFAULT NULL,
  `last_name` varchar(50) NOT NULL,
  `extension_name` varchar(20) DEFAULT NULL,
  `sex` enum('Male','Female') DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `age` int DEFAULT NULL,
  `contact_number` varchar(15) DEFAULT NULL,
  `office_department` varchar(150) DEFAULT NULL,
  `work_position` varchar(150) DEFAULT NULL,
  `province` varchar(100) DEFAULT NULL,
  `city_municipality` varchar(100) DEFAULT NULL,
  `barangay` varchar(100) DEFAULT NULL,
  `street_address` varchar(255) DEFAULT NULL,
  `users_photo` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`admin_id`),
  UNIQUE KEY `user_id` (`user_id`),
  UNIQUE KEY `employee_id` (`employee_id`),
  CONSTRAINT `admin_info_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `faculty_info`
--
DROP TABLE IF EXISTS `faculty_info`;
CREATE TABLE `faculty_info` (
  `faculty_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `employee_id` varchar(20) NOT NULL,
  `first_name` varchar(50) NOT NULL,
  `middle_name` varchar(50) DEFAULT NULL,
  `last_name` varchar(50) NOT NULL,
  `extension_name` varchar(20) DEFAULT NULL,
  `sex` enum('Male','Female') DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `age` int DEFAULT NULL,
  `contact_number` varchar(15) DEFAULT NULL,
  `office_department` varchar(150) DEFAULT NULL,
  `work_position` varchar(150) DEFAULT NULL,
  `province` varchar(100) DEFAULT NULL,
  `city_municipality` varchar(100) DEFAULT NULL,
  `barangay` varchar(100) DEFAULT NULL,
  `street_address` varchar(255) DEFAULT NULL,
  `users_photo` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`faculty_id`),
  UNIQUE KEY `user_id` (`user_id`),
  UNIQUE KEY `employee_id` (`employee_id`),
  CONSTRAINT `faculty_info_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `fingerprint_devices`
--
DROP TABLE IF EXISTS `fingerprint_devices`;
CREATE TABLE `fingerprint_devices` (
  `device_id` int NOT NULL AUTO_INCREMENT,
  `device_name` varchar(100) NOT NULL,
  `device_code` varchar(50) NOT NULL,
  `device_type` enum('enrollment','door') NOT NULL,
  `location` varchar(100) DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `status` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`device_id`),
  UNIQUE KEY `device_code` (`device_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `fingerprints`
--
DROP TABLE IF EXISTS `fingerprints`;
CREATE TABLE `fingerprints` (
  `fingerprint_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `finger_name` varchar(50) DEFAULT NULL,
  `enrollment_device_id` int DEFAULT NULL,
  `enrollment_slot` int DEFAULT NULL,
  `shared_door_slot` int DEFAULT NULL,
  `template_data` longblob,
  `template_hash` varchar(255) DEFAULT NULL,
  `status` enum('pending','active','inactive') DEFAULT 'pending',
  `door_sync_status` enum('pending','synced','partial','failed') DEFAULT 'pending',
  `door_synced_at` timestamp NULL DEFAULT NULL,
  `enrolled_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`fingerprint_id`),
  UNIQUE KEY `user_id` (`user_id`,`finger_name`),
  UNIQUE KEY `shared_door_slot` (`shared_door_slot`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_shared_door_slot` (`shared_door_slot`),
  KEY `idx_enrollment_device_id` (`enrollment_device_id`),
  CONSTRAINT `fingerprints_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fingerprints_ibfk_2` FOREIGN KEY (`enrollment_device_id`) REFERENCES `fingerprint_devices` (`device_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `fingerprint_sync_queue`
--
DROP TABLE IF EXISTS `fingerprint_sync_queue`;
CREATE TABLE `fingerprint_sync_queue` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `fingerprint_id` int NOT NULL,
  `device_id` int NOT NULL,
  `status` enum('pending','syncing','synced','failed') NOT NULL DEFAULT 'pending',
  `attempts` int unsigned NOT NULL DEFAULT '0',
  `error_message` text,
  `queued_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `processing_at` timestamp NULL DEFAULT NULL,
  `synced_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `active_sync_key` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_pending_sync` (`active_sync_key`),
  KEY `idx_sync_queue_device_status` (`device_id`,`status`,`queued_at`),
  KEY `idx_sync_queue_fingerprint_id` (`fingerprint_id`),
  CONSTRAINT `fk_sync_queue_device` FOREIGN KEY (`device_id`) REFERENCES `fingerprint_devices` (`device_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sync_queue_fingerprint` FOREIGN KEY (`fingerprint_id`) REFERENCES `fingerprints` (`fingerprint_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `fingerprints_backup_20260621_095207`
--
DROP TABLE IF EXISTS `fingerprints_backup_20260621_095207`;
CREATE TABLE `fingerprints_backup_20260621_095207` (
  `fingerprint_id` int NOT NULL DEFAULT '0',
  `user_id` int NOT NULL,
  `sensor_slot_id` int NOT NULL,
  `finger_name` varchar(50) NOT NULL,
  `status` enum('active','inactive') DEFAULT 'active',
  `registered_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `rfid_cards`
--
DROP TABLE IF EXISTS `rfid_cards`;
CREATE TABLE `rfid_cards` (
  `card_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `rfid_uid` varchar(30) NOT NULL,
  `status` enum('active','inactive','lost') DEFAULT 'active',
  `issued_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`card_id`),
  UNIQUE KEY `user_id` (`user_id`),
  UNIQUE KEY `rfid_uid` (`rfid_uid`),
  KEY `idx_rfid_uid` (`rfid_uid`),
  CONSTRAINT `rfid_cards_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `schedule_edit_history`
--
DROP TABLE IF EXISTS `schedule_edit_history`;
CREATE TABLE `schedule_edit_history` (
  `history_id` int unsigned NOT NULL AUTO_INCREMENT,
  `schedule_id` int unsigned NOT NULL,
  `edited_by` int unsigned DEFAULT NULL,
  `edited_by_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `change_summary` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `edited_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`history_id`),
  KEY `idx_schedule_edit_history_schedule_id` (`schedule_id`),
  KEY `idx_schedule_edit_history_edited_at` (`edited_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `schedules`
--
DROP TABLE IF EXISTS `schedules`;
CREATE TABLE `schedules` (
  `schedule_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `schedule_type` enum('single','recurring') NOT NULL DEFAULT 'single',
  `schedule_kind` enum('regular','override') NOT NULL DEFAULT 'regular' COMMENT 'regular = admin-created schedule; override = approved override request',
  `schedule_date` date DEFAULT NULL,
  `time_start` time NOT NULL,
  `time_end` time NOT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `repeat_type` enum('none','daily','weekly','weekly_selected') DEFAULT 'none',
  `repeat_days` json DEFAULT NULL COMMENT 'JSON array of selected days for weekly recurrence (e.g.,    ["Monday","Wednesday","Friday"])',
  `repeat_day` varchar(15) DEFAULT NULL COMMENT 'Specific day of week for individual recurring schedule entry (e.g. Monday)',
  `grace_period_minutes` int DEFAULT '15',
  `notify_time` datetime DEFAULT NULL COMMENT 'Time to notify user # mins before schedule',
  `status` enum('pending','approved','overridden','completed','cancelled','expired') DEFAULT 'pending',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `approved_by` int DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`schedule_id`),
  KEY `idx_schedule_time` (`time_start`,`time_end`),
  KEY `idx_schedule_user` (`user_id`),
  KEY `idx_schedule_date` (`schedule_date`),
  KEY `idx_schedule_status` (`status`),
  KEY `created_by` (`created_by`),
  KEY `approved_by` (`approved_by`),
  CONSTRAINT `schedules_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `schedules_ibfk_2` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`),
  CONSTRAINT `schedules_ibfk_3` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `schedules_chk_1` CHECK ((`time_end` > `time_start`)),
  CONSTRAINT `schedules_chk_2` CHECK ((((`schedule_type` = _utf8mb4'single') and (`schedule_date` is not null)) or ((`schedule_type` = _utf8mb4'recurring') and (`start_date` is not null) and (`end_date` is not null)))),
  CONSTRAINT `schedules_chk_3` CHECK (((`end_date` is null) or (`end_date` >= `start_date`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `staff_info`
--
DROP TABLE IF EXISTS `staff_info`;
CREATE TABLE `staff_info` (
  `staff_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `employee_id` varchar(20) NOT NULL,
  `first_name` varchar(50) NOT NULL,
  `middle_name` varchar(50) DEFAULT NULL,
  `last_name` varchar(50) NOT NULL,
  `extension_name` varchar(20) DEFAULT NULL,
  `sex` enum('Male','Female') DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `age` int DEFAULT NULL,
  `contact_number` varchar(15) DEFAULT NULL,
  `office_department` varchar(150) DEFAULT NULL,
  `work_position` varchar(150) DEFAULT NULL,
  `province` varchar(100) DEFAULT NULL,
  `city_municipality` varchar(100) DEFAULT NULL,
  `barangay` varchar(100) DEFAULT NULL,
  `street_address` varchar(255) DEFAULT NULL,
  `users_photo` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`staff_id`),
  UNIQUE KEY `user_id` (`user_id`),
  UNIQUE KEY `employee_id` (`employee_id`),
  CONSTRAINT `staff_info_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `student_info`
--
DROP TABLE IF EXISTS `student_info`;
CREATE TABLE `student_info` (
  `student_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `school_id` varchar(20) NOT NULL,
  `first_name` varchar(50) NOT NULL,
  `middle_name` varchar(50) DEFAULT NULL,
  `last_name` varchar(50) NOT NULL,
  `extension_name` varchar(20) DEFAULT NULL,
  `sex` enum('Male','Female') DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `age` int DEFAULT NULL,
  `contact_number` varchar(15) DEFAULT NULL,
  `college` varchar(150) DEFAULT NULL,
  `program_department` varchar(150) DEFAULT NULL,
  `year_level` enum('First Year','Second Year','Third Year','Fourth Year') DEFAULT NULL,
  `section` varchar(50) DEFAULT NULL,
  `province` varchar(100) DEFAULT NULL,
  `city_municipality` varchar(100) DEFAULT NULL,
  `barangay` varchar(100) DEFAULT NULL,
  `street_address` varchar(255) DEFAULT NULL,
  `zip_code` varchar(10) DEFAULT NULL,
  `country` varchar(100) DEFAULT NULL,
  `school_id_photo` mediumtext DEFAULT NULL,
  PRIMARY KEY (`student_id`),
  UNIQUE KEY `user_id` (`user_id`),
  UNIQUE KEY `school_id` (`school_id`),
  CONSTRAINT `student_info_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `users`
--
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `password_updated_at` timestamp NULL DEFAULT NULL,
  `must_change_password` tinyint(1) NOT NULL DEFAULT '0',
  `onboarding_step` enum('password','profile','security','done') NOT NULL DEFAULT 'done',
  `role` enum('student','faculty','staff','admin','super_admin') NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `first_login_challenges`
--
DROP TABLE IF EXISTS `first_login_challenges`;
CREATE TABLE `first_login_challenges` (
  `id` char(32) NOT NULL,
  `user_id` int NOT NULL,
  `otp_hash` varchar(255) NOT NULL,
  `otp_expires_at` datetime NOT NULL,
  `otp_verified_at` datetime DEFAULT NULL,
  `password_replaced_at` datetime DEFAULT NULL,
  `attempt_count` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `first_login_challenges_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS=1;
