<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/AccessLogSchema.php';

AccessLogSchema::ensureRfidUid(entrivo_pdo());
echo "Migration successful: access logs can retain scanned RFID UIDs.\n";
