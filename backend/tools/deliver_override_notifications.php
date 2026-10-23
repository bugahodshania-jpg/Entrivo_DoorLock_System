<?php

// CLI only. Approval launches --loop automatically; a scheduler can also run this.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/NotificationService.php';

try {
    $limit = isset($argv[1]) ? filter_var($argv[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 100]]) : 20;
    if (!$limit) {
        throw new InvalidArgumentException('Batch size must be between 1 and 100.');
    }
    $overrideId = isset($argv[2]) ? filter_var($argv[2], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) : null;
    if ($overrideId === false) {
        throw new InvalidArgumentException('Override id must be a positive integer.');
    }
    $service = new NotificationService(entrivo_pdo());
    $service->ensureSchema();
    if (($argv[3] ?? '') !== '--loop') {
        echo json_encode($service->deliverPending($overrideId, (int) $limit), JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n";
        exit;
    }
    // One recipient per pass keeps a mail outage from blocking a large batch.
    // Retry safe failures with backoff for at most three minutes/five attempts.
    $deadline = microtime(true) + 180;
    $attempts = 0;
    $failures = 0;
    $summary = ['sent' => 0, 'failed' => 0, 'uncertain' => 0, 'pending' => 0, 'retryable' => 0];
    do {
        $batch = $service->deliverPending($overrideId, 1);
        foreach (['sent', 'failed', 'uncertain'] as $key) {
            $summary[$key] += $batch[$key];
        }
        $summary['pending'] = $batch['pending'];
        $summary['retryable'] = $batch['retryable'];
        $attempts++;
        if ($batch['retryable'] === 0 || $attempts >= (int) $limit * 5 || microtime(true) >= $deadline) {
            break;
        }
        if ($batch['failed'] > 0) {
            $delay = min(30, 5 * (2 ** min(3, $failures++)));
            $remaining = (int) floor($deadline - microtime(true));
            if ($remaining < $delay) {
                break;
            }
            sleep($delay);
        } else {
            $failures = 0;
        }
    } while (microtime(true) < $deadline);
    if ($overrideId !== null && $summary['retryable'] > 0
        && $summary['sent'] + $summary['failed'] + $summary['uncertain'] > 0) {
        // Continue a large/slow approval in a fresh bounded worker. Every claimed
        // recipient advances toward sent/uncertain or its five-attempt limit.
        $summary['continuationStarted'] = NotificationService::dispatchDelivery((int) $overrideId, (int) $limit);
        if (!$summary['continuationStarted']) {
            error_log('Override #' . $overrideId . ' has queued email; its continuation worker could not start.');
        }
    }
    echo json_encode($summary, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable $error) {
    fwrite(STDERR, 'Unable to deliver override notifications: ' . $error->getMessage() . "\n");
    exit(1);
}
