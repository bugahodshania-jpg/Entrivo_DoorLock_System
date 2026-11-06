-- Temporary template backup staged between the second and third enrollment scans.
CREATE TABLE IF NOT EXISTS fingerprint_enrollment_backups (
    job_id INT NOT NULL PRIMARY KEY,
    enrollment_device_id INT NOT NULL,
    stored_slot INT NOT NULL,
    template_data BLOB NOT NULL,
    template_bytes INT NOT NULL,
    template_sha256 CHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
