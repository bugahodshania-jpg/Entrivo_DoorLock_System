<?php

// CLI only. Approving or rejecting an override request launches this in the
// background with the prepared message, so slow mail never delays the page.
//   php backend/tools/send_override_decision.php <base64 JSON {to, subject, body}>
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/OverrideDecisionEmailService.php';

try {
    $message = json_decode((string) base64_decode((string) ($argv[1] ?? ''), true), true, 8, JSON_THROW_ON_ERROR);
    if (!is_array($message) || !is_string($message['to'] ?? null) || !is_string($message['subject'] ?? null) || !is_string($message['body'] ?? null)) {
        throw new InvalidArgumentException('A base64 JSON message with to, subject and body is required.');
    }
    entrivo_db_config(); // Loads backend/.env so the mail settings are available.
    (new OverrideDecisionEmailService())->send($message);
    echo "Decision email sent.\n";
} catch (Throwable $error) {
    error_log('Override decision email failed: ' . $error->getMessage());
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(1);
}
