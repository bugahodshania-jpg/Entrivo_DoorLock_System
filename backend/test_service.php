<?php

require_once 'services/FingerprintEnrollmentService.php';

$service = new FingerprintEnrollmentService();

$result = $service->createEnrollmentJob(
    1,
    "Left Thumb",
    1
);

echo "<pre>";

print_r($result);

echo "</pre>";

