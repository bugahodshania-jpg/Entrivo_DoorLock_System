<?php

// CLI only. Submitting an override request launches this in the background, so
// slow SMTP never delays the requester's response. Run it by hand to resend:
//   php backend/tools/notify_override_request.php <override id>
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/OverrideRequestAlertService.php';

try {
    $overrideId = filter_var($argv[1] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$overrideId) {
        throw new InvalidArgumentException('Override id must be a positive integer.');
    }
    $pdo = entrivo_pdo();
    OverrideRequestAlertService::ensureSchema($pdo);
    $summary = (new OverrideRequestAlertService($pdo))->notify((int) $overrideId);
    echo json_encode($summary, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable $error) {
    error_log('Override request alert failed: ' . $error->getMessage());
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(1);
}
