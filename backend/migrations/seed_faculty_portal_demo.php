<?php

/**
 * Seeds a demo faculty portal account (and sample schedule/access data).
 *
 * Login:
 *   username: faculty.demo
 *   password: FacultyDemo1!
 *
 * Run: php backend/migrations/seed_faculty_portal_demo.php
 */

require_once dirname(__DIR__) . '/config/connection.php';

try {
    $pdo = entrivo_pdo();
    $pdo->beginTransaction();

    $username = 'faculty.demo';
    $email = 'faculty.demo@csucc.edu.ph';
    $passwordHash = password_hash('FacultyDemo1!', PASSWORD_DEFAULT);

    $existing = $pdo->prepare('SELECT id FROM users WHERE username = :username LIMIT 1');
    $existing->execute(['username' => $username]);
    $userId = (int) ($existing->fetchColumn() ?: 0);

    if ($userId > 0) {
        $pdo->prepare(
            'UPDATE users
             SET email = :email,
                 password_hash = :password_hash,
                 role = \'faculty\',
                 is_active = 1,
                 approval_status = \'approved\'
             WHERE id = :id'
        )->execute([
            'email' => $email,
            'password_hash' => $passwordHash,
            'id' => $userId,
        ]);
        echo "Updated existing faculty demo user #{$userId}\n";
    } else {
        $hasApproval = (bool) $pdo->query("SHOW COLUMNS FROM users LIKE 'approval_status'")->fetch();
        if ($hasApproval) {
            $insert = $pdo->prepare(
                'INSERT INTO users (username, email, password_hash, role, is_active, approval_status, password_updated_at)
                 VALUES (:username, :email, :password_hash, \'faculty\', 1, \'approved\', NOW())'
            );
        } else {
            $insert = $pdo->prepare(
                'INSERT INTO users (username, email, password_hash, role, is_active, password_updated_at)
                 VALUES (:username, :email, :password_hash, \'faculty\', 1, NOW())'
            );
        }

        $insert->execute([
            'username' => $username,
            'email' => $email,
            'password_hash' => $passwordHash,
        ]);
        $userId = (int) $pdo->lastInsertId();
        echo "Created faculty demo user #{$userId}\n";
    }

    $profileExists = $pdo->prepare('SELECT faculty_id FROM faculty_info WHERE user_id = :user_id LIMIT 1');
    $profileExists->execute(['user_id' => $userId]);
    $facultyId = (int) ($profileExists->fetchColumn() ?: 0);

    $profilePayload = [
        'user_id' => $userId,
        'employee_id' => 'FAC-DEMO-01',
        'first_name' => 'Liza',
        'middle_name' => 'Santos',
        'last_name' => 'Reyes',
        'extension_name' => null,
        'sex' => 'Female',
        'date_of_birth' => '1988-04-12',
        'age' => 37,
        'contact_number' => '09171234567',
        'office_department' => 'College of Computing',
        'work_position' => 'Faculty Member',
        'province' => 'Surigao del Norte',
        'city_municipality' => 'Surigao City',
        'barangay' => 'Washington',
        'street_address' => 'Rizal St.',
        'users_photo' => null,
    ];

    if ($facultyId > 0) {
        $pdo->prepare(
            'UPDATE faculty_info
             SET employee_id = :employee_id,
                 first_name = :first_name,
                 middle_name = :middle_name,
                 last_name = :last_name,
                 extension_name = :extension_name,
                 sex = :sex,
                 date_of_birth = :date_of_birth,
                 age = :age,
                 contact_number = :contact_number,
                 office_department = :office_department,
                 work_position = :work_position,
                 province = :province,
                 city_municipality = :city_municipality,
                 barangay = :barangay,
                 street_address = :street_address
             WHERE user_id = :user_id'
        )->execute($profilePayload);
    } else {
        $pdo->prepare(
            'INSERT INTO faculty_info (
                user_id, employee_id, first_name, middle_name, last_name, extension_name,
                sex, date_of_birth, age, contact_number, office_department, work_position,
                province, city_municipality, barangay, street_address, users_photo
             ) VALUES (
                :user_id, :employee_id, :first_name, :middle_name, :last_name, :extension_name,
                :sex, :date_of_birth, :age, :contact_number, :office_department, :work_position,
                :province, :city_municipality, :barangay, :street_address, :users_photo
             )'
        )->execute($profilePayload);
    }

    $securityCount = $pdo->prepare(
        'SELECT COUNT(*) FROM account_security_questions WHERE user_id = :user_id'
    );
    $securityCount->execute(['user_id' => $userId]);

    if ((int) $securityCount->fetchColumn() === 0) {
        $questions = [
            1 => ['What city were you born in?', 'surigao'],
            2 => ["What is your mother's maiden name?", 'santos'],
            3 => ['What is your favorite book?', 'noli'],
        ];

        $insertQuestion = $pdo->prepare(
            'INSERT INTO account_security_questions (user_id, question_slot, question, answer_hash, answer_text)
             VALUES (:user_id, :slot, :question, :answer_hash, :answer_text)'
        );

        foreach ($questions as $slot => [$question, $answer]) {
            $insertQuestion->execute([
                'user_id' => $userId,
                'slot' => $slot,
                'question' => $question,
                'answer_hash' => password_hash($answer, PASSWORD_DEFAULT),
                'answer_text' => $answer,
            ]);
        }
    }

    $today = (new DateTimeImmutable('today'))->format('Y-m-d');
    $scheduleCheck = $pdo->prepare(
        "SELECT schedule_id FROM schedules
         WHERE user_id = :user_id AND schedule_date = :schedule_date
         LIMIT 1"
    );
    $scheduleCheck->execute(['user_id' => $userId, 'schedule_date' => $today]);
    $scheduleId = (int) ($scheduleCheck->fetchColumn() ?: 0);

    if ($scheduleId < 1) {
        $pdo->prepare(
            "INSERT INTO schedules (
                user_id, schedule_type, schedule_date, time_start, time_end,
                grace_period_minutes, status, created_at, approved_at
             ) VALUES (
                :user_id, 'single', :schedule_date, '08:00:00', '17:00:00',
                15, 'approved', NOW(), NOW()
             )"
        )->execute([
            'user_id' => $userId,
            'schedule_date' => $today,
        ]);
        $scheduleId = (int) $pdo->lastInsertId();
        echo "Created today's approved schedule #{$scheduleId}\n";
    }

    $accessCheck = $pdo->prepare(
        'SELECT COUNT(*) FROM access_log WHERE user_id = :user_id'
    );
    $accessCheck->execute(['user_id' => $userId]);

    if ((int) $accessCheck->fetchColumn() === 0) {
        $pdo->prepare(
            "INSERT INTO access_log (user_id, schedule_id, access_timestamp, access_status, method_access)
             VALUES
                (:user_id, :schedule_id, CONCAT(CURDATE(), ' 08:12:00'), 'granted', 'Fingerprint'),
                (:user_id, :schedule_id, CONCAT(CURDATE(), ' 12:05:00'), 'granted', 'RFID'),
                (:user_id, NULL, CONCAT(CURDATE(), ' 18:40:00'), 'denied', 'RFID')"
        )->execute([
            'user_id' => $userId,
            'schedule_id' => $scheduleId,
        ]);
        echo "Inserted sample access logs\n";
    }

    $pdo->commit();

    echo "OK: faculty demo account ready\n";
    echo "Username: faculty.demo\n";
    echo "Password: FacultyDemo1!\n";
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }

    echo 'Seed failed: ' . $error->getMessage() . "\n";
    exit(1);
}
