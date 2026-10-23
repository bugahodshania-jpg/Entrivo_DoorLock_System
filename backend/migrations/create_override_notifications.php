<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/NotificationService.php';

(new NotificationService(entrivo_pdo()))->ensureSchema();
echo "Migration successful: approved override notifications are ready.\n";
