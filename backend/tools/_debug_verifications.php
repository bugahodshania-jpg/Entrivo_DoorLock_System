<?php
require_once __DIR__ . "/../config/connection.php";
require_once __DIR__ . "/agent_debug_log.php";
$pdo = entrivo_pdo();
$v = $pdo->query("SELECT job_id,fingerprint_id,user_id,finger_name,enrollment_device_id,stored_slot,matched_slot,LEFT(template_sha256,16) h,verified_at FROM fingerprint_enrollment_verifications ORDER BY job_id DESC")->fetchAll(PDO::FETCH_ASSOC);
$alive = [];
foreach ($v as $row) {
  $q = $pdo->prepare("SELECT fingerprint_id,status,enrollment_slot,CHAR_LENGTH(COALESCE(template_data,'')) tb FROM fingerprints WHERE fingerprint_id=?");
  $q->execute([$row["fingerprint_id"]]);
  $alive[] = ["proof" => $row, "fingerprint_row" => $q->fetch(PDO::FETCH_ASSOC) ?: null];
}
agent_debug_log("C", "_debug_verifications.php", "Proofs vs live fingerprint rows", ["pairs" => $alive], "post-repro");
echo json_encode($alive, JSON_PRETTY_PRINT), PHP_EOL;
