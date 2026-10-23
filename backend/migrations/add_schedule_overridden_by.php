<?php

/**
 * Stamp a regular schedule when an overlapping override is created.
 *
 * Run: php backend/migrations/add_schedule_overridden_by.php
 */

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/OverrideScheduleService.php';

try {
    $service = new OverrideScheduleService(entrivo_pdo());
    $service->ensureStampColumn();
    echo "Migration successful: schedules.overridden_by_schedule_id is ready.\n";
} catch (Throwable $error) {
    echo 'Migration failed: ' . $error->getMessage() . "\n";
    exit(1);
}
