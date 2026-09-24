USE entrivo_database_system;

SET @column_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'access_log'
      AND COLUMN_NAME = 'access_type'
);

SET @statement = IF(
    @column_exists = 0,
    "ALTER TABLE access_log ADD COLUMN access_type ENUM('IN','OUT') NOT NULL DEFAULT 'IN' AFTER method_access",
    "SELECT 'access_type already exists' AS message"
);

PREPARE add_access_type_statement FROM @statement;
EXECUTE add_access_type_statement;
DEALLOCATE PREPARE add_access_type_statement;
