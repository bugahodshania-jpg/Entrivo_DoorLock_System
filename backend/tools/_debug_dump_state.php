<?php
require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/agent_debug_log.php';

$pdo = entrivo_pdo();

$cols = $pdo->query('SHOW COLUMNS FROM fingerprints')->fetchAll(PDO::FETCH_COLUMN);
$selectCols = array_values(array_filter([
    'fingerprint_id', 'user_id', 'finger_name', 'status',
    'enrollment_device_id', 'enrollment_slot',
    in_array('template_hash', $cols, true) ? "LEFT(COALESCE(template_hash,''),16) AS hash16" : null,
    in_array('enrolled_at', $cols, true) ? 'enrolled_at' : null,
    in_array('updated_at', $cols, true) ? 'updated_at' : null,
]));

$fingerprints = $pdo->query(
    'SELECT ' . implode(',', $selectCols) . ' FROM fingerprints ORDER BY fingerprint_id DESC LIMIT 30'
)->fetchAll(PDO::FETCH_ASSOC);

$jobs = $pdo->query(
    "SELECT job_id,user_id,status,progress,assigned_slot,fingerprint_id,LEFT(COALESCE(error_message,''),120) err,finished_at
     FROM fingerprint_enrollment_jobs ORDER BY job_id DESC LIMIT 12"
)->fetchAll(PDO::FETCH_ASSOC);

$slots = [];
try {
    $slots = $pdo->query("SELECT device_id,slot,state,fingerprint_id,job_id FROM fingerprint_sensor_slots ORDER BY slot ASC LIMIT 40")->fetchAll(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
    $slots = ['error' => $e->getMessage()];
}

$accessCols = [];
$access = [];
$methodCol = null;
try {
    $accessCols = $pdo->query('SHOW COLUMNS FROM access_log')->fetchAll(PDO::FETCH_COLUMN);
    $methodCol = in_array('method_access', $accessCols, true) ? 'method_access' : (in_array('method', $accessCols, true) ? 'method' : null);
    $orderCol = in_array('log_id', $accessCols, true) ? 'log_id' : (in_array('access_log_id', $accessCols, true) ? 'access_log_id' : '1');
    $access = $pdo->query("SELECT * FROM access_log ORDER BY {$orderCol} DESC LIMIT 15")->fetchAll(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
    $access = ['error' => $e->getMessage()];
}

$proofs = [];
try {
    $proofs = $pdo->query(
        "SELECT job_id,fingerprint_id,stored_slot,matched_slot,LEFT(COALESCE(template_sha256,''),16) hash16
         FROM fingerprint_enrollment_proofs ORDER BY job_id DESC LIMIT 10"
    )->fetchAll(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
    $proofs = ['error' => $e->getMessage()];
}

$data = [
    'fingerprint_columns' => $cols,
    'fingerprints' => $fingerprints,
    'jobs' => $jobs,
    'nonfree_slots' => array_values(array_filter($slots, static fn ($r) => ($r['state'] ?? $r['status'] ?? '') !== 'free')),
    'slot_sample' => array_slice($slots, 0, 5),
    'access_log_columns' => $accessCols,
    'recent_access_logs' => $access,
    'proofs' => $proofs,
    'method_col' => $methodCol,
];

agent_debug_log('H0', '_debug_dump_state.php', 'Post-reproduce DB dump', $data, 'post-repro');
echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
