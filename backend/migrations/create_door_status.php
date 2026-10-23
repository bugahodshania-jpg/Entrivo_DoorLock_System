<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/DoorStatusSchema.php';
entrivo_pdo()->exec(DoorStatusSchema::definition());
echo "Migration successful: controller door status is ready.\n";
