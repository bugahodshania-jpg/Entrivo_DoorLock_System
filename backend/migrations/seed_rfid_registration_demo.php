<?php

// Run: php backend/migrations/seed_rfid_registration_demo.php
// Adds a sample scanner read for previewing public registration.
require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/RfidScanService.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('Run this seed from the command line.');
}

try {
    $service = new RfidScanService(entrivo_pdo());
    $uid = $service->normalizeUid('ABCD12345');

    if (!$service->isValidUid($uid)) {
        throw new RuntimeException('The demo UID failed validation.');
    }
    if ($service->isRegistered($uid)) {
        throw new RuntimeException('ABCD12345 is already assigned to a user. Use another unregistered card for previewing registration.');
    }

    $scan = $service->latestScan($uid);
    if ($scan === null) {
        $scan = $service->record($uid, 'Registration UI demo');
    }

    if ($service->latestScan($uid) === null) {
        throw new RuntimeException('The sample scanner read could not be verified.');
    }

    echo "Demo UID {$uid} is ready for registration verification.\n";
    echo "Scan ID: {$scan['scan_id']}\n";
} catch (Throwable $error) {
    fwrite(STDERR, "RFID demo seed failed: {$error->getMessage()}\n");
    exit(1);
}
