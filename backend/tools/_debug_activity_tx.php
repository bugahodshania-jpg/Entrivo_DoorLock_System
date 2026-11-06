<?php
require_once __DIR__ . "/../config/connection.php";
require_once __DIR__ . "/agent_debug_log.php";
$pdo = entrivo_pdo();
$cols = $pdo->query("SHOW COLUMNS FROM activity_transactions")->fetchAll(PDO::FETCH_COLUMN);
$rows = $pdo->query("SELECT * FROM activity_transactions ORDER BY 1 DESC LIMIT 30")->fetchAll(PDO::FETCH_ASSOC);
$fp = [];
foreach ($rows as $r) {
  $blob = strtolower(json_encode($r));
  if (str_contains($blob, "fingerprint") || str_contains($blob, "delete") || str_contains($blob, "enroll")) $fp[] = $r;
}
agent_debug_log("C", "activity_transactions", "Recent activity mentioning fingerprint/delete/enroll", [
  "columns" => $cols,
  "matched" => $fp,
  "recent_sample" => array_slice($rows, 0, 5),
], "post-repro");
echo json_encode(["columns"=>$cols,"matched_count"=>count($fp),"matched"=>$fp,"sample"=>array_slice($rows,0,5)], JSON_PRETTY_PRINT);
