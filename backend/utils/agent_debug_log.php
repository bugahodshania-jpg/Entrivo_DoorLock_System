<?php
/**
 * Session debug logger for enrollment/identify investigation.
 * Writes NDJSON to .cursor/debug-4dd861.log
 */
function agent_debug_log(string $hypothesisId, string $location, string $message, array $data = [], string $runId = 'pre'): void
{
    $path = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . '.cursor' . DIRECTORY_SEPARATOR . 'debug-4dd861.log';
    $payload = [
        'sessionId' => '4dd861',
        'runId' => $runId,
        'hypothesisId' => $hypothesisId,
        'location' => $location,
        'message' => $message,
        'data' => $data,
        'timestamp' => (int) round(microtime(true) * 1000),
    ];
    @file_put_contents($path, json_encode($payload, JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
}
