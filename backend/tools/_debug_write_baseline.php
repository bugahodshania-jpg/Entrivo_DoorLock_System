<?php
require_once dirname(__DIR__) . '/config/connection.php';
require_once __DIR__ . '/agent_debug_log.php';

$pdo = entrivo_pdo();

$active = $pdo->query("SELECT fingerprint_id,user_id,finger_name,status,enrollment_device_id,enrollment_slot,LEFT(COALESCE(template_hash,''),16) hash16, CHAR_LENGTH(template_data) tb FROM fingerprints WHERE status='active'")->fetchAll(PDO::FETCH_ASSOC);
$pending = $pdo->query("SELECT fingerprint_id,user_id,status,enrollment_slot FROM fingerprints WHERE status='pending'")->fetchAll(PDO::FETCH_ASSOC);
$jobs = $pdo->query("SELECT job_id,user_id,status,progress,assigned_slot,fingerprint_id,finished_at FROM fingerprint_enrollment_jobs ORDER BY job_id DESC LIMIT 5")->fetchAll(PDO::FETCH_ASSOC);
$proofs = $pdo->query("SELECT job_id,fingerprint_id,stored_slot,matched_slot,LEFT(template_sha256,16) hash16 FROM fingerprint_enrollment_verifications ORDER BY job_id DESC LIMIT 5")->fetchAll(PDO::FETCH_ASSOC);
$slots = $pdo->query("SELECT device_id,slot,state,fingerprint_id,job_id FROM fingerprint_sensor_slots WHERE state<>'free' OR fingerprint_id IS NOT NULL")->fetchAll(PDO::FETCH_ASSOC);
$fpLogs = $pdo->query("SELECT log_id,user_id,fingerprint_id,access_status,denial_reason,access_timestamp FROM access_log WHERE method_access='Fingerprint' ORDER BY log_id DESC LIMIT 10")->fetchAll(PDO::FETCH_ASSOC);

agent_debug_log('H0', 'baseline_snapshot.php', 'DB baseline before reproduce', [
    'active_fingerprints' => $active,
    'pending_fingerprints_count' => count($pending),
    'recent_jobs' => $jobs,
    'recent_proofs' => $proofs,
    'nonfree_slots' => $slots,
    'recent_fingerprint_access_logs' => $fpLogs,
], 'baseline');

echo "baseline written\n";
echo 'active_count=' . count($active) . "\n";
echo 'fingerprint_access_logs=' . count($fpLogs) . "\n";
