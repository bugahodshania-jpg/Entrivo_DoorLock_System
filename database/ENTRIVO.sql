-- Entrivo DoorLock System: complete database structure.
-- Every table and column the backend uses, including the ones it creates or adds
-- itself (backend/migrations and the services' schema checks). Structure only:
-- no data. For the first Super Admin account, run seed_super_admin.sql after this.
--
-- WARNING: each table is dropped and recreated. Run this only on a new, empty
-- database, never on one that holds real records.
-- Generated 2026-11-20 (38 tables).

CREATE DATABASE IF NOT EXISTS `entrivo_database_system` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci */;
USE `entrivo_database_system`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=0;

-- ============================================================
-- Accounts and profiles
-- ============================================================

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
  `approval_status` enum('approved','pending','rejected') NOT NULL DEFAULT 'approved',
  `approval_due_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`)
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
  `school_id_photo` mediumtext,
  PRIMARY KEY (`student_id`),
  UNIQUE KEY `user_id` (`user_id`),
  UNIQUE KEY `school_id` (`school_id`),
  CONSTRAINT `student_info_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `user_privileges`
--
DROP TABLE IF EXISTS `user_privileges`;
CREATE TABLE `user_privileges` (
  `user_id` int unsigned NOT NULL,
  `privilege_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`,`privilege_key`),
  KEY `idx_user_privileges_key` (`privilege_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `account_security_questions`
--
DROP TABLE IF EXISTS `account_security_questions`;
CREATE TABLE `account_security_questions` (
  `question_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `question_slot` tinyint NOT NULL,
  `question` varchar(255) NOT NULL,
  `answer_hash` varchar(255) NOT NULL,
  `answer_text` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`question_id`),
  UNIQUE KEY `uq_user_question_slot` (`user_id`,`question_slot`),
  CONSTRAINT `fk_security_question_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- Sign-in and account security
-- ============================================================

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
  `pending_password_hash` varchar(255) DEFAULT NULL,
  `pending_profile` mediumtext,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `first_login_challenges_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `password_reset_challenges`
--
DROP TABLE IF EXISTS `password_reset_challenges`;
CREATE TABLE `password_reset_challenges` (
  `id` char(32) COLLATE utf8mb4_general_ci NOT NULL,
  `user_id` int NOT NULL,
  `otp_hash` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `otp_expires_at` datetime NOT NULL,
  `otp_verified_at` datetime DEFAULT NULL,
  `questions_verified_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_password_reset_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `login_attempts`
--
DROP TABLE IF EXISTS `login_attempts`;
CREATE TABLE `login_attempts` (
  `attempt_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned DEFAULT NULL,
  `username_attempted` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `attempt_status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `failure_reason` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`attempt_id`),
  KEY `idx_login_attempts_user_id` (`user_id`),
  KEY `idx_login_attempts_username` (`username_attempted`),
  KEY `idx_login_attempts_status` (`attempt_status`),
  KEY `idx_login_attempts_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `user_login_sessions`
--
DROP TABLE IF EXISTS `user_login_sessions`;
CREATE TABLE `user_login_sessions` (
  `session_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `failed_attempts` int unsigned NOT NULL DEFAULT '0',
  `current_batch` tinyint unsigned NOT NULL DEFAULT '0',
  `lock_count` tinyint unsigned NOT NULL DEFAULT '0',
  `locked_until` datetime DEFAULT NULL,
  `last_failed_at` datetime DEFAULT NULL,
  `last_login_at` datetime DEFAULT NULL,
  `session_status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`session_id`),
  UNIQUE KEY `uq_user_login_sessions_user_id` (`user_id`),
  KEY `idx_user_login_sessions_locked_until` (`locked_until`),
  KEY `idx_user_login_sessions_status` (`session_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `super_admin_dashboard_session`
--
DROP TABLE IF EXISTS `super_admin_dashboard_session`;
CREATE TABLE `super_admin_dashboard_session` (
  `id` tinyint unsigned NOT NULL DEFAULT '1',
  `user_id` int unsigned NOT NULL,
  `username` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `heartbeat_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_super_admin_dashboard_session_singleton` CHECK ((`id` = 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Schedules and overrides
-- ============================================================

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
  `overridden_by_schedule_id` int DEFAULT NULL,
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
-- Table structure for table `schedule_edit_history`
--
DROP TABLE IF EXISTS `schedule_edit_history`;
CREATE TABLE `schedule_edit_history` (
  `history_id` int unsigned NOT NULL AUTO_INCREMENT,
  `schedule_id` int unsigned NOT NULL,
  `edited_by` int unsigned DEFAULT NULL,
  `edited_by_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `change_summary` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `edited_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`history_id`),
  KEY `idx_schedule_edit_history_schedule_id` (`schedule_id`),
  KEY `idx_schedule_edit_history_edited_at` (`edited_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  `approver_alert_status` varchar(16) DEFAULT NULL,
  `approver_alert_at` datetime DEFAULT NULL,
  PRIMARY KEY (`override_id`),
  KEY `user_id` (`user_id`),
  KEY `approved_by` (`approved_by`),
  CONSTRAINT `access_overrides_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `access_overrides_ibfk_2` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `access_overrides_chk_1` CHECK ((`override_end` > `override_start`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `override_notifications`
--
DROP TABLE IF EXISTS `override_notifications`;
CREATE TABLE `override_notifications` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `override_id` int NOT NULL,
  `user_id` int NOT NULL,
  `requester_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `recipient_email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `override_start` datetime NOT NULL,
  `override_end` datetime NOT NULL,
  `affected_schedules` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL,
  `acknowledged_at` datetime DEFAULT NULL,
  `email_status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `email_attempts` int NOT NULL DEFAULT '0',
  `email_attempted_at` datetime DEFAULT NULL,
  `email_sent_at` datetime DEFAULT NULL,
  `email_error` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  UNIQUE KEY `override_id` (`override_id`,`user_id`),
  KEY `override_notifications_owner` (`user_id`,`acknowledged_at`,`id`),
  KEY `override_notifications_delivery` (`email_status`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Access logs and activity
-- ============================================================

--
-- Table structure for table `access_log`
--
DROP TABLE IF EXISTS `access_log`;
CREATE TABLE `access_log` (
  `log_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `card_id` int DEFAULT NULL,
  `rfid_uid` varchar(30) DEFAULT NULL,
  `fingerprint_id` int DEFAULT NULL,
  `schedule_id` int DEFAULT NULL,
  `override_id` int DEFAULT NULL,
  `access_timestamp` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `access_status` enum('granted','denied') NOT NULL,
  `denial_reason` enum('not_registered','invalid_rfid','invalid_fingerprint','no_schedule','expired_schedule','schedule_not_started','unauthorized','offline') DEFAULT NULL,
  `method_access` enum('RFID','Fingerprint','Override') NOT NULL,
  `access_type` enum('IN','OUT','VERIFY') NOT NULL DEFAULT 'IN',
  `matched_slot` int DEFAULT NULL,
  `match_confidence` int DEFAULT NULL,
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
-- Table structure for table `activity_transactions`
--
DROP TABLE IF EXISTS `activity_transactions`;
CREATE TABLE `activity_transactions` (
  `transaction_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `actor_user_id` int unsigned DEFAULT NULL,
  `target_user_id` int unsigned DEFAULT NULL,
  `activity_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `entity_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Success',
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`transaction_id`),
  KEY `idx_activity_transactions_type` (`activity_type`),
  KEY `idx_activity_transactions_status` (`status`),
  KEY `idx_activity_transactions_actor` (`actor_user_id`),
  KEY `idx_activity_transactions_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `delete_requests`
--
DROP TABLE IF EXISTS `delete_requests`;
CREATE TABLE `delete_requests` (
  `request_id` int unsigned NOT NULL AUTO_INCREMENT,
  `target_type` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_id` int unsigned NOT NULL,
  `target_label` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `proof_path` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('pending','approved','rejected','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `requested_by` int unsigned NOT NULL,
  `reviewed_by` int unsigned DEFAULT NULL,
  `review_note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reviewed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`request_id`),
  KEY `idx_delete_requests_status` (`status`,`created_at`),
  KEY `idx_delete_requests_target` (`target_type`,`target_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- RFID cards
-- ============================================================

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
-- Table structure for table `rfid_scan_log`
--
DROP TABLE IF EXISTS `rfid_scan_log`;
CREATE TABLE `rfid_scan_log` (
  `scan_id` int NOT NULL AUTO_INCREMENT,
  `rfid_uid` varchar(30) NOT NULL,
  `scanned_at` datetime NOT NULL,
  `device_label` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`scan_id`),
  KEY `idx_rfid_scan_uid_time` (`rfid_uid`,`scanned_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- Door controller
-- ============================================================

--
-- Table structure for table `door_controller_status`
--
DROP TABLE IF EXISTS `door_controller_status`;
CREATE TABLE `door_controller_status` (
  `device_id` int NOT NULL,
  `door_state` enum('locked','unlocked') COLLATE utf8mb4_unicode_ci NOT NULL,
  `boot_id` char(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `report_sequence` bigint unsigned NOT NULL,
  `received_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `wifi_rssi` smallint DEFAULT NULL,
  PRIMARY KEY (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `door_controller_controls`
--
DROP TABLE IF EXISTS `door_controller_controls`;
CREATE TABLE `door_controller_controls` (
  `device_id` int NOT NULL,
  `schedule_mode` varchar(10) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'auto',
  `command` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `command_id` int NOT NULL DEFAULT '0',
  `command_by` int DEFAULT NULL,
  `command_at` datetime DEFAULT NULL,
  `command_done_id` int NOT NULL DEFAULT '0',
  `command_done_at` datetime DEFAULT NULL,
  `mode_updated_by` int DEFAULT NULL,
  `mode_updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `door_event_log`
--
DROP TABLE IF EXISTS `door_event_log`;
CREATE TABLE `door_event_log` (
  `event_id` char(32) COLLATE utf8mb4_general_ci NOT NULL,
  `log_id` int DEFAULT NULL,
  `recorded_at` datetime NOT NULL,
  PRIMARY KEY (`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `door_emergency_cards`
--
DROP TABLE IF EXISTS `door_emergency_cards`;
CREATE TABLE `door_emergency_cards` (
  `rfid_uid` varchar(10) COLLATE utf8mb4_general_ci NOT NULL,
  `card_name` varchar(60) COLLATE utf8mb4_general_ci NOT NULL,
  `device_id` int DEFAULT NULL,
  `reported_at` datetime NOT NULL,
  PRIMARY KEY (`rfid_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================
-- Fingerprints, sensor and enrollment
-- ============================================================

--
-- Table structure for table `direct_fingerprint_import_jobs`
--
DROP TABLE IF EXISTS `direct_fingerprint_import_jobs`;
CREATE TABLE `direct_fingerprint_import_jobs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `actor_id` int NOT NULL,
  `user_id` int NOT NULL,
  `fingerprint_id` int NOT NULL,
  `enrollment_device_id` int NOT NULL,
  `target_slot` int NOT NULL,
  `employee_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `finger_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_data` longblob NOT NULL,
  `template_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_enrolled_at` datetime DEFAULT NULL,
  `source_device_id` int DEFAULT NULL,
  `source_slot` int DEFAULT NULL,
  `status` enum('pending','processing','completed','failed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `progress` tinyint unsigned NOT NULL DEFAULT '0',
  `current_step` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Waiting for Sensor A',
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `queued_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processing_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `active_device_key` int DEFAULT NULL,
  `active_fingerprint_key` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_direct_import_device` (`active_device_key`),
  UNIQUE KEY `unique_direct_import_fingerprint` (`active_fingerprint_key`),
  KEY `idx_direct_import_device_status` (`enrollment_device_id`,`status`,`queued_at`),
  KEY `idx_direct_import_fingerprint` (`fingerprint_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
-- Table structure for table `fingerprint_enrollment_backups`
--
DROP TABLE IF EXISTS `fingerprint_enrollment_backups`;
CREATE TABLE `fingerprint_enrollment_backups` (
  `job_id` int NOT NULL,
  `enrollment_device_id` int NOT NULL,
  `stored_slot` int NOT NULL,
  `template_data` blob NOT NULL,
  `template_bytes` int NOT NULL,
  `template_sha256` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `matched_slot` int DEFAULT NULL,
  `confidence` int DEFAULT NULL,
  `fresh_scan_verified` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`job_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `fingerprint_enrollment_jobs`
--
DROP TABLE IF EXISTS `fingerprint_enrollment_jobs`;
CREATE TABLE `fingerprint_enrollment_jobs` (
  `job_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `fingerprint_id` int DEFAULT NULL,
  `finger_name` varchar(50) NOT NULL,
  `enrollment_device_id` int DEFAULT NULL,
  `status` enum('waiting','processing','stored_pending_commit','completed','needs_reconciliation','failed','cancelled') DEFAULT 'waiting',
  `progress` tinyint unsigned DEFAULT '0',
  `current_step` varchar(150) DEFAULT NULL,
  `assigned_slot` int DEFAULT NULL,
  `error_message` text,
  `started_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `job_mode` enum('enroll','update') DEFAULT NULL,
  `previous_slot` int DEFAULT NULL,
  PRIMARY KEY (`job_id`),
  KEY `fk_job_user` (`user_id`),
  KEY `fk_job_fingerprint` (`fingerprint_id`),
  KEY `fk_job_device` (`enrollment_device_id`),
  CONSTRAINT `fk_job_device` FOREIGN KEY (`enrollment_device_id`) REFERENCES `fingerprint_devices` (`device_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_job_fingerprint` FOREIGN KEY (`fingerprint_id`) REFERENCES `fingerprints` (`fingerprint_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_job_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `fingerprint_enrollment_verifications`
--
DROP TABLE IF EXISTS `fingerprint_enrollment_verifications`;
CREATE TABLE `fingerprint_enrollment_verifications` (
  `job_id` int NOT NULL,
  `fingerprint_id` int NOT NULL,
  `user_id` int NOT NULL,
  `finger_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `enrollment_device_id` int NOT NULL,
  `fresh_scan_verified` tinyint(1) NOT NULL,
  `stored_slot` int NOT NULL,
  `matched_slot` int NOT NULL,
  `confidence` int NOT NULL,
  `template_bytes` int NOT NULL,
  `template_sha256` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `verified_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`job_id`),
  KEY `idx_enrollment_verification_fingerprint` (`fingerprint_id`,`job_id`),
  KEY `idx_enrollment_verification_device_slot` (`enrollment_device_id`,`stored_slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `fingerprint_enrollment_verify_jobs`
--
DROP TABLE IF EXISTS `fingerprint_enrollment_verify_jobs`;
CREATE TABLE `fingerprint_enrollment_verify_jobs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `enrollment_job_id` int NOT NULL,
  `actor_id` int DEFAULT NULL,
  `user_id` int NOT NULL,
  `fingerprint_id` int NOT NULL,
  `enrollment_device_id` int NOT NULL,
  `target_slot` int NOT NULL,
  `user_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `finger_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `template_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `current_step` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Place the same finger to verify enrollment',
  `claim_token` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `matched_slot` int DEFAULT NULL,
  `confidence` int DEFAULT NULL,
  `identified` tinyint(1) NOT NULL DEFAULT '0',
  `access_log_id` int DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `queued_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processing_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  `active_device_key` int DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `fingerprint_sensor_slots`
--
DROP TABLE IF EXISTS `fingerprint_sensor_slots`;
CREATE TABLE `fingerprint_sensor_slots` (
  `device_id` int NOT NULL,
  `slot` int NOT NULL,
  `state` enum('free','reserved','active','orphaned','awaiting_cleanup') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'free',
  `fingerprint_id` int DEFAULT NULL,
  `job_id` int DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`device_id`,`slot`),
  KEY `idx_sensor_slot_state` (`device_id`,`state`,`slot`),
  KEY `idx_sensor_slot_fingerprint` (`fingerprint_id`),
  KEY `idx_sensor_slot_job` (`job_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `fingerprint_sync_queue`
--
DROP TABLE IF EXISTS `fingerprint_sync_queue`;
CREATE TABLE `fingerprint_sync_queue` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `fingerprint_id` int NOT NULL,
  `device_id` int NOT NULL,
  `status` enum('pending','syncing','synced','failed') NOT NULL DEFAULT 'pending',
  `progress_step` varchar(32) DEFAULT NULL,
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
-- Table structure for table `sensor_memory_inventories`
--
DROP TABLE IF EXISTS `sensor_memory_inventories`;
CREATE TABLE `sensor_memory_inventories` (
  `job_id` bigint unsigned NOT NULL,
  `device_id` int NOT NULL,
  `capacity` int unsigned NOT NULL,
  `template_count` int unsigned NOT NULL,
  `occupied_slots` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `captured_at` datetime DEFAULT NULL,
  `received_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`job_id`),
  KEY `idx_sensor_memory_inventory_device` (`device_id`,`job_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `sensor_memory_jobs`
--
DROP TABLE IF EXISTS `sensor_memory_jobs`;
CREATE TABLE `sensor_memory_jobs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `actor_id` int NOT NULL,
  `device_id` int NOT NULL,
  `kind` enum('inventory','template','empty','delete_slot') COLLATE utf8mb4_unicode_ci NOT NULL,
  `inventory_id` bigint unsigned DEFAULT NULL,
  `target_slot` int unsigned DEFAULT NULL,
  `status` enum('pending','processing','completed','failed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `claim_token` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `report_hash` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error_message` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `queued_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processing_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  `active_device_key` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_sensor_memory_device` (`active_device_key`),
  KEY `idx_sensor_memory_device` (`device_id`,`kind`,`status`,`id`),
  KEY `idx_sensor_memory_parent` (`inventory_id`,`target_slot`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `sensor_memory_templates`
--
DROP TABLE IF EXISTS `sensor_memory_templates`;
CREATE TABLE `sensor_memory_templates` (
  `job_id` bigint unsigned NOT NULL,
  `inventory_id` bigint unsigned NOT NULL,
  `device_id` int NOT NULL,
  `slot_id` int unsigned NOT NULL,
  `template_data` blob NOT NULL,
  `template_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_bytes` int unsigned NOT NULL,
  `captured_at` datetime DEFAULT NULL,
  `received_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`job_id`),
  KEY `idx_sensor_memory_template_slot` (`inventory_id`,`slot_id`,`job_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Table structure for table `super_admin_session_standby`
--
DROP TABLE IF EXISTS `super_admin_session_standby`;
CREATE TABLE `super_admin_session_standby` (
  `user_id` int unsigned NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS=1;
