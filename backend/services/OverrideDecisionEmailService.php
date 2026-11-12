<?php

require_once __DIR__ . '/MailService.php';

/**
 * Tells the requester whether their override request was approved or
 * rejected. The message is built when the decision is made (a rejected
 * request is deleted right after), then sent by a background worker so a slow
 * mail server never delays the approver's page.
 */
final class OverrideDecisionEmailService
{
    private $sendMail;

    public function __construct(?callable $sendMail = null)
    {
        $this->sendMail = $sendMail ?? static function (string $email, string $subject, string $body): void {
            (new MailService())->send($email, $subject, $body);
        };
    }

    /**
     * @param array $request A row from mapPendingOverride(): name, username, email, reason, overrideStart, overrideEnd, id.
     * @return array{to: string, subject: string, body: string}|null Null when the requester has no email address.
     */
    public static function message(array $request, string $decision, ?string $decidedBy): ?array
    {
        $to = trim((string) ($request['email'] ?? ''));
        if ($to === '' || !in_array($decision, ['approve', 'reject'], true)) {
            return null;
        }
        $approved = $decision === 'approve';
        $zone = new DateTimeZone('Asia/Manila');
        $start = new DateTimeImmutable((string) $request['overrideStart'], $zone);
        $end = new DateTimeImmutable((string) $request['overrideEnd'], $zone);
        $reason = trim((string) ($request['reason'] ?? ''));
        $name = trim((string) ($request['name'] ?? '')) ?: (string) ($request['username'] ?? 'there');
        $by = trim((string) $decidedBy);

        $lines = [
            'Entrivo Door Lock System', '',
            'Hello ' . $name . ',', '',
            $approved
                ? 'Your override request #' . (int) $request['id'] . ' was APPROVED.'
                : 'Your override request #' . (int) $request['id'] . ' was NOT APPROVED.',
            '',
            'Requested access: ' . $start->format('M j, Y g:i A') . ' - ' . $end->format('g:i A') . ' (Asia/Manila)',
            'Reason: ' . ($reason !== '' && $reason !== 'No reason provided' ? $reason : 'No reason provided.'),
        ];
        if ($by !== '') {
            $lines[] = ($approved ? 'Approved by: ' : 'Reviewed by: ') . $by;
        }
        $lines[] = '';
        $lines[] = $approved
            ? 'During this time the door opens for your registered card or fingerprint. To lock it after you leave, tap your card on the exit reader and then touch the sensor.'
            : 'The door will not open for this request. If you still need the room, contact an administrator or send a new request in the Entrivo portal.';

        return [
            'to' => $to,
            'subject' => $approved ? 'Entrivo: your override request was approved' : 'Entrivo: your override request was not approved',
            'body' => implode("\n", $lines),
        ];
    }

    /** Sends a prepared message. Throws when the mail server refuses it. */
    public function send(array $message): void
    {
        ($this->sendMail)((string) $message['to'], (string) $message['subject'], (string) $message['body']);
    }
}
