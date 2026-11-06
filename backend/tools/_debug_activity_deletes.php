<?php
require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/agent_debug_log.php';

$pdo = entrivo_pdo();
$tables = $pdo->query("SHOW TABLES LIKE '%activ%'")->fetchAll(PDO::FETCH_NUM);
$out = ['activity_tables' => $tables];

foreach (['activity_logs', 'activity_log', 'system_activity_logs'] as $table) {
    try {
        $cols = $pdo->query("SHOW COLUMNS FROM {$table}")->fetchAll(PDO::FETCH_COLUMN);
        $sql = "SELECT * FROM {$table} WHERE LOWER(CONCAT_WS(' ', "
            . implode(',', array_map(static fn ($c) => "COALESCE({$c},'')", array_slice($cols, 0, min(8, count($cols)))))
            . ")) LIKE '%fingerprint%' ORDER BY 1 DESC LIMIT 20";
        $out[$table] = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        $out[$table . '_error'] = $e->getMessage();
    }
}

try {
    $out['backup_count'] = (int) $pdo->query('SELECT COUNT(*) FROM fingerprints_backup_20260621_095207')->fetchColumn();
} catch (Throwable $e) {
    $out['backup_error'] = $e->getMessage();
}

agent_debug_log('C', '_debug_activity_deletes.php', 'Fingerprint delete activity trail', $out, 'post-repro');
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
