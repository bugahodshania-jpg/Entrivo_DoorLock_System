<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/DirectFingerprintImportSchema.php';

DirectFingerprintImportSchema::ensure(entrivo_pdo());
echo "Migration successful: direct fingerprint database imports are ready.\n";
