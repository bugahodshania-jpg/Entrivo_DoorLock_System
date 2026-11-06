<?php
require_once dirname(__DIR__) . '/config/connection.php';
$pdo = entrivo_pdo();

function cols(PDO $pdo, string $table): array
{
    $out = [];
    foreach ($pdo->query('SHOW COLUMNS FROM `' . str_replace('`', '', $table) . '`') as $c) {
        $out[] = $c['Field'];
    }
    return $out;
}

function pick(array $have, array $want): string
{
    return implode(', ', array_values(array_filter($want, fn ($c) => in_array($c, $have, true))));
}

echo "=== access_log columns ===\n";
$accessCols = cols($pdo, 'access_log');
echo implode(', ', $accessCols) . "\n\n";

echo "=== recent fingerprint access_log ===\n";
$sel = pick($accessCols, ['id', 'log_id', 'access_id', 'user_id', 'fingerprint_id', 'access_status', 'denial_reason', 'method_access', 'access_timestamp', 'access_type', 'matched_slot', 'match_confidence']);
foreach ($pdo->query("SELECT {$sel} FROM access_log WHERE method_access='Fingerprint' ORDER BY 1 DESC LIMIT 20") as $r) {
    echo json_encode($r, JSON_UNESCAPED_SLASHES) . "\n";
}

echo "\n=== recent enrollment jobs ===\n";
foreach ($pdo->query('SELECT job_id,user_id,finger_name,status,progress,assigned_slot,fingerprint_id,finished_at,current_step FROM fingerprint_enrollment_jobs ORDER BY job_id DESC LIMIT 10') as $r) {
    echo json_encode($r, JSON_UNESCAPED_SLASHES) . "\n";
}

echo "\n=== recent fingerprints ===\n";
foreach ($pdo->query('SELECT fingerprint_id,user_id,finger_name,status,enrollment_device_id,enrollment_slot,LEFT(template_hash,16) AS hash16, CHAR_LENGTH(template_data) AS template_bytes, enrolled_at FROM fingerprints ORDER BY fingerprint_id DESC LIMIT 10') as $r) {
    echo json_encode($r, JSON_UNESCAPED_SLASHES) . "\n";
}

echo "\n=== enrollment verifications ===\n";
try {
    foreach ($pdo->query('SELECT job_id,fingerprint_id,enrollment_device_id,stored_slot,matched_slot,confidence,template_bytes,LEFT(template_sha256,16) AS hash16,verified_at FROM fingerprint_enrollment_verifications ORDER BY id DESC LIMIT 10') as $r) {
        echo json_encode($r, JSON_UNESCAPED_SLASHES) . "\n";
    }
} catch (Throwable $e) {
    echo 'no verifications table: ' . $e->getMessage() . "\n";
}

echo "\n=== confirmedEnrollment dry-run for latest fingerprint ===\n";
$fp = $pdo->query('SELECT f.*, u.username, u.is_active, u.approval_status, u.must_change_password, u.onboarding_step, u.role FROM fingerprints f INNER JOIN users u ON u.id=f.user_id WHERE f.status=\'active\' ORDER BY f.fingerprint_id DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);
if ($fp) {
    $deviceId = (int) $fp['enrollment_device_id'];
    $slot = (int) $fp['enrollment_slot'];
    echo 'fingerprint=' . json_encode([
        'fingerprint_id' => (int) $fp['fingerprint_id'],
        'user_id' => (int) $fp['user_id'],
        'finger_name' => $fp['finger_name'],
        'device' => $deviceId,
        'slot' => $slot,
        'enrolled_at' => $fp['enrolled_at'],
        'hash16' => substr((string) $fp['template_hash'], 0, 16),
        'template_bytes' => strlen((string) $fp['template_data']),
        'role' => $fp['role'] ?? null,
        'approval' => $fp['approval_status'],
        'onboarding' => $fp['onboarding_step'],
    ], JSON_UNESCAPED_SLASHES) . "\n";
    $jobs = $pdo->prepare("SELECT job_id,status,progress,user_id,finger_name,fingerprint_id,assigned_slot,finished_at FROM fingerprint_enrollment_jobs WHERE (enrollment_device_id=? AND assigned_slot=?) OR (user_id=? AND status IN ('waiting','processing')) ORDER BY job_id DESC");
    $jobs->execute([$deviceId, $slot, (int) $fp['user_id']]);
    $rows = $jobs->fetchAll(PDO::FETCH_ASSOC);
    echo 'related_jobs=' . json_encode($rows, JSON_UNESCAPED_SLASHES) . "\n";
    $latest = null;
    $blocked = false;
    foreach ($rows as $job) {
        if (in_array($job['status'], ['waiting', 'processing'], true)) { $blocked = true; break; }
        $latest ??= $job;
    }
    $checks = [
        'blocked_by_open_job' => $blocked,
        'latest_null' => $latest === null,
        'latest_status' => $latest['status'] ?? null,
        'latest_progress' => isset($latest['progress']) ? (int) $latest['progress'] : null,
        'user_match' => $latest ? ((int) $latest['user_id'] === (int) $fp['user_id']) : false,
        'finger_match' => $latest ? ((string) $latest['finger_name'] === (string) $fp['finger_name']) : false,
        'fp_id_ok' => !$latest || empty($latest['fingerprint_id']) || (int) $latest['fingerprint_id'] === (int) $fp['fingerprint_id'],
        'enrolled_at_set' => !empty($fp['enrolled_at']),
        'finished_at_set' => !empty($latest['finished_at'] ?? null),
        'finished_ge_enrolled' => $latest && !empty($fp['enrolled_at']) && !empty($latest['finished_at']) ? !((string) $latest['finished_at'] < (string) $fp['enrolled_at']) : false,
        'finished_at' => $latest['finished_at'] ?? null,
        'enrolled_at' => $fp['enrolled_at'],
    ];
    echo 'checks=' . json_encode($checks, JSON_UNESCAPED_SLASHES) . "\n";
    try {
        $proof = $pdo->prepare('SELECT * FROM fingerprint_enrollment_verifications WHERE job_id=? LIMIT 1');
        $proof->execute([(int) ($latest['job_id'] ?? 0)]);
        $p = $proof->fetch(PDO::FETCH_ASSOC);
        echo 'proof=' . json_encode($p ? [
            'job_id' => (int) $p['job_id'],
            'stored_slot' => (int) $p['stored_slot'],
            'matched_slot' => (int) $p['matched_slot'],
            'confidence' => (int) ($p['confidence'] ?? 0),
            'hash16' => substr((string) $p['template_sha256'], 0, 16),
        ] : null, JSON_UNESCAPED_SLASHES) . "\n";
    } catch (Throwable $e) {
        echo 'proof_error=' . $e->getMessage() . "\n";
    }
} else {
    echo "no active fingerprints\n";
}
