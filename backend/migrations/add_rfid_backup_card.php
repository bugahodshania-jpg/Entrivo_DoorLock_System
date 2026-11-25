<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/RfidCardSlots.php';

RfidCardSlots::ensureSchema(entrivo_pdo());
echo "Migration successful: faculty, staff, admins and super admins can hold a backup RFID card.\n";
