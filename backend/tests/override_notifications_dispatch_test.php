<?php

require_once dirname(__DIR__) . '/services/NotificationService.php';

// Exercise only process dispatch using a harmless local sleeper. No DB or SMTP.
$directory = sys_get_temp_dir() . DIRECTORY_SEPARATOR . "entrivo notice's " . bin2hex(random_bytes(6));
mkdir($directory);
$worker = $directory . DIRECTORY_SEPARATOR . 'fake worker.php';
$marker = tempnam(sys_get_temp_dir(), 'entrivo_notice_');
unlink($marker);
file_put_contents($worker, '<?php sleep(3); file_put_contents($argv[1], "done");');

try {
    $launch = new ReflectionMethod(NotificationService::class, 'launchDetachedPhp');
    $started = microtime(true);
    if (!$launch->invoke(null, $worker, [$marker])) {
        throw new RuntimeException('The local background PHP fixture did not start.');
    }
    if (microtime(true) - $started >= 3 || is_file($marker)) {
        throw new RuntimeException('Background dispatch blocked while its worker was running.');
    }
    $deadline = microtime(true) + 10;
    while (!is_file($marker) && microtime(true) < $deadline) {
        usleep(100000);
        clearstatcache(true, $marker);
    }
    if (!is_file($marker) || file_get_contents($marker) !== 'done') {
        throw new RuntimeException('The detached PHP fixture did not finish independently.');
    }
    echo "Override notification dispatch returns immediately and runs its quoted local worker independently.\n";
} finally {
    if (is_file($marker)) unlink($marker);
    unlink($worker);
    rmdir($directory);
}
