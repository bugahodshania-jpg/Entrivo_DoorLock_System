-- Email: superadmin@entrivo.local
-- Password: AdminPassword1016
-- Role: super_admin

USE entrivo_database_system;

INSERT INTO users (username, email, password_hash, role, is_active)
VALUES (
    'superadmin',
    'superadmin@entrivo.local',
    '$2y$10$Nbe8bIwl45Omw91DikPhROCIB7hCOK7ngWSY/T4EukOVnZz7IuBFS',
    'super_admin',
    TRUE
)
ON DUPLICATE KEY UPDATE
    username = VALUES(username),
    password_hash = VALUES(password_hash),
    role = VALUES(role),
    is_active = TRUE;

INSERT INTO admin_info (
    user_id,
    employee_id,
    first_name,
    last_name,
    contact_number,
    office_department,
    work_position
)
SELECT
    id,
    'ADMIN-0001',
    'System',
    'Administrator',
    'N/A',
    'System Administration',
    'Super Admin'
FROM users
WHERE email = 'superadmin@entrivo.local'
ON DUPLICATE KEY UPDATE
    employee_id = VALUES(employee_id),
    first_name = VALUES(first_name),
    last_name = VALUES(last_name),
    contact_number = VALUES(contact_number),
    office_department = VALUES(office_department),
    work_position = VALUES(work_position);
