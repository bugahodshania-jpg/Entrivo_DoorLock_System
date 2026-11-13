<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/DoorOccupant.php';

function occupantAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = entrivo_pdo();
// Connection-local temporary shadows; no real rows are read or changed.
$pdo->exec("CREATE TEMPORARY TABLE access_log (log_id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NULL, schedule_id INT NULL, override_id INT NULL,
    access_timestamp TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, access_status VARCHAR(10), method_access VARCHAR(20), access_type VARCHAR(3) NULL, rfid_uid VARCHAR(30) NULL)");
$pdo->exec("CREATE TEMPORARY TABLE schedules (schedule_id INT PRIMARY KEY, schedule_kind VARCHAR(10), status VARCHAR(20), time_start TIME, time_end TIME)");
$pdo->exec("CREATE TEMPORARY TABLE users (id INT PRIMARY KEY, username VARCHAR(50), role VARCHAR(20))");
$pdo->exec("CREATE TEMPORARY TABLE student_info (user_id INT, school_id VARCHAR(30), first_name VARCHAR(50), last_name VARCHAR(50))");
foreach (['faculty_info', 'staff_info', 'admin_info'] as $profile) {
    $pdo->exec("CREATE TEMPORARY TABLE {$profile} (user_id INT, employee_id VARCHAR(30), first_name VARCHAR(50), last_name VARCHAR(50))");
}
$pdo->exec("INSERT INTO users VALUES (1,'ana','faculty'),(2,'boss','super_admin'),(3,'stud','student')");
$pdo->exec("INSERT INTO faculty_info VALUES (1,'EMP-1','Ana','Cruz')");
$pdo->exec("INSERT INTO schedules VALUES (7,'regular','approved','08:00:00','10:00:00')");

occupantAssert(DoorOccupant::current($pdo) === null, 'No entries means no occupant.');

$pdo->exec("INSERT INTO access_log (user_id,schedule_id,access_status,method_access,access_type) VALUES (1,7,'granted','Fingerprint','IN')");
$pdo->exec("INSERT INTO access_log (user_id,access_status,method_access,access_type) VALUES (3,'denied','Fingerprint','IN')");
$pdo->exec("INSERT INTO access_log (user_id,access_status,method_access,access_type) VALUES (2,'granted','Fingerprint','OUT')");
$current = DoorOccupant::current($pdo);
occupantAssert($current['name'] === 'Ana Cruz' && $current['identifier'] === 'EMP-1', 'The latest granted entry is the occupant; denials and exits are skipped.');
occupantAssert($current['access_type'] === 'regular' && $current['schedule'] === '08:00 AM – 10:00 AM', 'The schedule used is shown.');

$pdo->exec("INSERT INTO access_log (user_id,access_status,method_access,access_type) VALUES (2,'granted','Fingerprint','IN')");
$current = DoorOccupant::current($pdo);
occupantAssert($current['name'] === 'boss' && $current['access_type'] === 'super_admin_override', 'A super admin entry is their permanent override.');

$pdo->exec("INSERT INTO access_log (access_status,method_access,access_type,rfid_uid) VALUES ('granted','RFID','IN','4300C46DDF')");
$current = DoorOccupant::current($pdo, ['4300C46DDF']);
occupantAssert($current['name'] === 'Emergency card' && $current['access_type'] === 'emergency_card', 'The emergency card is named.');

$pdo->exec("UPDATE access_log SET access_timestamp = NOW() - INTERVAL 13 HOUR");
occupantAssert(DoorOccupant::current($pdo) === null, 'Entries older than 12 hours are not the current occupant.');

echo "PASS: an unlocked door shows the person behind its latest granted entry.\n";
