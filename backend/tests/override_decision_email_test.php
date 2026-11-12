<?php

require_once dirname(__DIR__) . '/services/OverrideDecisionEmailService.php';

// Injected mail callback: no live email is sent.
function expectDecision(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$request = [
    'id' => 42, 'name' => 'Juan Dela Cruz', 'username' => 'juan', 'email' => 'juan@example.test',
    'reason' => 'Thesis defense', 'overrideStart' => '2026-11-20 13:00:00', 'overrideEnd' => '2026-11-20 15:00:00',
];

$approved = OverrideDecisionEmailService::message($request, 'approve', 'root');
expectDecision($approved['to'] === 'juan@example.test', 'The requester receives the decision.');
expectDecision($approved['subject'] === 'Entrivo: your override request was approved', 'Approval subject.');
foreach (['Hello Juan Dela Cruz', 'request #42 was APPROVED', 'Nov 20, 2026 1:00 PM - 3:00 PM', 'Reason: Thesis defense', 'Approved by: root', 'exit reader'] as $needle) {
    expectDecision(str_contains($approved['body'], $needle), 'Approval email is missing: ' . $needle);
}

$rejected = OverrideDecisionEmailService::message($request, 'reject', 'admin.one');
expectDecision($rejected['subject'] === 'Entrivo: your override request was not approved', 'Rejection subject.');
foreach (['request #42 was NOT APPROVED', 'Reviewed by: admin.one', 'send a new request'] as $needle) {
    expectDecision(str_contains($rejected['body'], $needle), 'Rejection email is missing: ' . $needle);
}
expectDecision(!str_contains($rejected['body'], 'exit reader'), 'A rejection must not explain how to use the door.');

// No address or an unknown decision: nothing to send.
expectDecision(OverrideDecisionEmailService::message([...$request, 'email' => '  '], 'approve', 'root') === null, 'No email address means no message.');
expectDecision(OverrideDecisionEmailService::message($request, 'maybe', 'root') === null, 'Only approve or reject are emailed.');
// The placeholder reason from the list view is not shown as a real reason; a missing approver name is left out.
$plain = OverrideDecisionEmailService::message([...$request, 'reason' => 'No reason provided'], 'approve', null);
expectDecision(str_contains($plain['body'], 'Reason: No reason provided.') && !str_contains($plain['body'], 'Approved by'), 'Fallback reason and no approver line.');

// The prepared message is what gets sent.
$sent = [];
(new OverrideDecisionEmailService(static function (string $to, string $subject, string $body) use (&$sent): void {
    $sent[] = [$to, $subject, $body];
}))->send($approved);
expectDecision($sent === [[$approved['to'], $approved['subject'], $approved['body']]], 'send() delivers exactly the prepared message.');

echo "PASS: requesters get an approved or not-approved email with the request window, reason and reviewer; no address means no email.\n";
