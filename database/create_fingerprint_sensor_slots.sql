-- Slot ownership for Sensor A. Free slots are reused only after the ESP32
-- reports them empty and no active, reserved, orphaned, or cleanup job owns them.
USE `entrivo_database_system`;

CREATE TABLE IF NOT EXISTS fingerprint_sensor_slots (
    device_id INT NOT NULL,
    slot INT NOT NULL,
    state ENUM('free','reserved','active','orphaned','awaiting_cleanup') NOT NULL DEFAULT 'free',
    fingerprint_id INT NULL,
    job_id INT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (device_id, slot),
    KEY idx_sensor_slot_state (device_id, state, slot),
    KEY idx_sensor_slot_fingerprint (fingerprint_id),
    KEY idx_sensor_slot_job (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE fingerprint_enrollment_jobs
    MODIFY status ENUM(
        'waiting',
        'processing',
        'stored_pending_commit',
        'completed',
        'needs_reconciliation',
        'failed',
        'cancelled'
    ) DEFAULT 'waiting';

ALTER TABLE fingerprint_enrollment_jobs
    ADD COLUMN IF NOT EXISTS job_mode ENUM('enroll','update') NULL AFTER fingerprint_id,
    ADD COLUMN IF NOT EXISTS previous_slot INT NULL AFTER assigned_slot;
