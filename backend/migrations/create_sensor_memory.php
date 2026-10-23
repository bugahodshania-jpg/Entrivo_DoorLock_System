<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/SensorMemorySchema.php';

SensorMemorySchema::ensure(entrivo_pdo());
echo "Migration successful: R307S sensor memory jobs, snapshots, and full template erase are ready.\n";
