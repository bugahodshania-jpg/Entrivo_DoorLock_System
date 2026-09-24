-- STEP 1.1 — Create the Database Table
-- Table: fingerprint_enrollment_jobs
USE `entrivo_database_system`;

CREATE TABLE fingerprint_enrollment_jobs (
    job_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    fingerprint_id INT NULL,
    finger_name VARCHAR(50) NOT NULL,
    enrollment_device_id INT NULL,
    status ENUM(
        'waiting',
        'processing',
        'completed',
        'failed',
        'cancelled'
    ) DEFAULT 'waiting',
    progress TINYINT UNSIGNED DEFAULT 0,
    current_step VARCHAR(150),
    assigned_slot INT NULL,
    error_message TEXT,
    started_at DATETIME NULL,
    finished_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_job_user
        FOREIGN KEY(user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_job_fingerprint
        FOREIGN KEY(fingerprint_id)
        REFERENCES fingerprints(fingerprint_id)
        ON DELETE SET NULL,
    CONSTRAINT fk_job_device
        FOREIGN KEY(enrollment_device_id)
        REFERENCES fingerprint_devices(device_id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
