<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/FingerprintEnrollmentVerification.php';

FingerprintEnrollmentVerification::ensure(entrivo_pdo());
echo "Migration successful: durable fingerprint enrollment verification is ready.\n";
