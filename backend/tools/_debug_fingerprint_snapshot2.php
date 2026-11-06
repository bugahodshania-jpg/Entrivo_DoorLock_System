<?php
require_once dirname(__DIR__) . '/config/connection.php';
$pdo = entrivo_pdo();

echo "fingerprints columns:\n";
foreach ($pdo->query('SHOW COLUMNS FROM fingerprints') as $c) {
    echo $c['Field'] . ' ' . $c['Type'] . "\n";
}
echo "\nall fingerprints rows:\n";
foreach ($pdo->query('SELECT fingerprint_id,user_id,finger_name,status,enrollment_device_id,enrollment_slot,shared_door_slot,template_hash,CHAR_LENGTH(template_data) AS tb,enrolled_at,door_sync_status FROM fingerprints') as $r) {
    echo json_encode($r, JSON_UNESCAPED_SLASHES) . "\n";
}
echo "\nsensor slots:\n";
try {
    foreach ($pdo->query('SELECT * FROM fingerprint_sensor_slots') as $r) {
        echo json_encode($r, JSON_UNESCAPED_SLASHES) . "\n";
    }
} catch (Throwable $e) {
    echo $e->getMessage() . "\n";
}
echo "\nverifications:\n";
try {
    foreach ($pdo->query('SHOW COLUMNS FROM fingerprint_enrollment_verifications') as $c) {
        echo $c['Field'] . ' ';
    }
    echo "\n";
    foreach ($pdo->query('SELECT * FROM fingerprint_enrollment_verifications LIMIT 20') as $r) {
        $copy = $r;
        if (isset($copy['template_sha256'])) $copy['template_sha256'] = substr((string) $copy['template_sha256'], 0, 16);
        unset($copy['template_data']);
        echo json_encode($copy, JSON_UNESCAPED_SLASHES) . "\n";
    }
} catch (Throwable $e) {
    echo $e->getMessage() . "\n";
}
echo "\njob 7 detail:\n";
foreach ($pdo->query('SELECT * FROM fingerprint_enrollment_jobs WHERE job_id=7') as $r) {
    echo json_encode($r, JSON_UNESCAPED_SLASHES) . "\n";
}
echo "\nusers id=1:\n";
foreach ($pdo->query('SELECT id,username,role,is_active,approval_status,must_change_password,onboarding_step FROM users WHERE id=1') as $r) {
    echo json_encode($r, JSON_UNESCAPED_SLASHES) . "\n";
}
