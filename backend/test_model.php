<?php

require_once 'models/FingerprintEnrollmentJob.php';

$model = new FingerprintEnrollmentJob();

$job = $model->getPendingJob();

echo "<pre>";
print_r($job);
echo "</pre>";
