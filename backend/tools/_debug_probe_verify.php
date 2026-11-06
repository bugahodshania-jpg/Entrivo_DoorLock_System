<?php
/**
 * Probe: call DirectFingerprintAccessService as if Sensor Search matched slot 1.
 * Confirms H-C without needing ESP32 Search success.
 */
require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/../services/DirectFingerprintAccessService.php';
require_once __DIR__ . '/agent_debug_log.php';

$service = new DirectFingerprintAccessService();
$input = [
    'enrollment_device_id' => 1,
    'matched_slot' => 1,
    'template_hash' => str_repeat('a', 64),
    'direction' => 'entry',
];
$result = $service->verifyRegisteredIdentity($input);
agent_debug_log('C', '_debug_probe_verify.php', 'Simulated Search-match authorize probe', [
    'input_slot' => 1,
    'access_granted' => $result['access_granted'] ?? null,
    'reason' => $result['reason'] ?? null,
    'message' => $result['message'] ?? null,
], 'probe');
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
