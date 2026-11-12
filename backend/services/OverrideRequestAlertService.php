<?php

require_once __DIR__ . '/MailService.php';

/**
 * Emails the people who can approve override requests when a new request
 * arrives, so an approver who is away from the portal still learns about it.
 */
final class OverrideRequestAlertService
{
    private const APPROVAL_PRIVILEGE = 'pending_overrides';

    /** What the Pending Overrides table shows for each stored alert result. */
    public const STATUS_LABELS = [
        'queued' => 'Sending',
        'sent' => 'Sent',
        'partial' => 'Partly sent',
        'failed' => 'Failed',
        'none' => 'No approver email',
    ];

    private static bool $columnsReady = false;

    private $sendMail;

    public function __construct(private PDO $pdo, ?callable $sendMail = null)
    {
        $this->sendMail = $sendMail ?? static function (string $email, string $subject, string $body): void {
            (new MailService())->send($email, $subject, $body);
        };
    }

    /**
     * Adds the two columns that remember the alert result on each request.
     * MySQL DDL commits implicitly, so call this outside a transaction.
     */
    public static function ensureSchema(PDO $pdo): bool
    {
        if (self::$columnsReady) {
            return true;
        }
        try {
            if (!$pdo->query("SHOW COLUMNS FROM access_overrides LIKE 'approver_alert_status'")->fetch(PDO::FETCH_ASSOC)) {
                $pdo->exec(
                    'ALTER TABLE access_overrides
                     ADD COLUMN approver_alert_status VARCHAR(16) NULL,
                     ADD COLUMN approver_alert_at DATETIME NULL'
                );
            }
            self::$columnsReady = true;
        } catch (Throwable) {
            // Restricted database user or an alter race: alerts still send, unrecorded.
        }

        return self::$columnsReady;
    }

    /** Select-list fragment that stays valid when the columns could not be added. */
    public static function selectColumnsSql(): string
    {
        return self::$columnsReady
            ? 'access_overrides.approver_alert_status, access_overrides.approver_alert_at,'
            : 'NULL AS approver_alert_status, NULL AS approver_alert_at,';
    }

    /** The request was saved; record whether the background email worker started. */
    public function markQueued(int $overrideId, bool $workerStarted): void
    {
        $this->record($overrideId, $workerStarted ? 'queued' : 'failed');
    }

    /**
     * Active super admins, plus active admins who hold the Pending Overrides
     * privilege (their role default when no explicit privileges are stored).
     */
    public function recipients(int $exceptUserId = 0): array
    {
        $accounts = $this->pdo->query(
            "SELECT id, username, email, role FROM users
             WHERE is_active = 1 AND role IN ('admin', 'super_admin')
               AND email IS NOT NULL AND email <> ''
             ORDER BY id"
        )->fetchAll(PDO::FETCH_ASSOC);

        $recipients = [];
        foreach ($accounts as $account) {
            $id = (int) $account['id'];
            if ($id === $exceptUserId) {
                continue; // Someone requesting for themselves needs no alert.
            }
            if ($account['role'] === 'admin' && !$this->adminCanApprove($id)) {
                continue;
            }
            $recipients[] = ['id' => $id, 'username' => (string) $account['username'], 'email' => (string) $account['email']];
        }

        return $recipients;
    }

    /** Sends one email per approver. A failed recipient never stops the others. */
    public function notify(int $overrideId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT access_overrides.override_id, access_overrides.user_id, access_overrides.reason,
                    access_overrides.override_start, access_overrides.override_end, access_overrides.approved_by,
                    users.username, users.role
             FROM access_overrides
             JOIN users ON users.id = access_overrides.user_id
             WHERE access_overrides.override_id = :override_id'
        );
        $statement->execute(['override_id' => $overrideId]);
        $request = $statement->fetch(PDO::FETCH_ASSOC);

        $summary = ['sent' => 0, 'failed' => 0, 'skipped' => false];
        // Nothing to review: the request was withdrawn or already decided.
        if (!$request || $request['approved_by'] !== null) {
            $summary['skipped'] = true;
            return $summary;
        }

        $subject = 'Entrivo: new override request from ' . $request['username'];
        $body = self::emailBody($request);
        $recipients = $this->recipients((int) $request['user_id']);
        foreach ($recipients as $recipient) {
            try {
                ($this->sendMail)($recipient['email'], $subject, $body);
                $summary['sent']++;
            } catch (Throwable $error) {
                $summary['failed']++;
                error_log('Override request #' . $overrideId . ' alert to user #' . $recipient['id'] . ' failed: ' . $error->getMessage());
            }
        }

        $this->record($overrideId, match (true) {
            $recipients === [] => 'none',
            $summary['failed'] === 0 => 'sent',
            $summary['sent'] === 0 => 'failed',
            default => 'partial',
        });

        return $summary;
    }

    private function record(int $overrideId, string $status): void
    {
        try {
            $statement = $this->pdo->prepare(
                'UPDATE access_overrides SET approver_alert_status = :status, approver_alert_at = :at WHERE override_id = :override_id'
            );
            $statement->execute([
                'status' => $status,
                'at' => (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d H:i:s'),
                'override_id' => $overrideId,
            ]);
        } catch (PDOException $error) {
            // Columns missing: the email result simply is not shown in the table.
            error_log('Override request #' . $overrideId . ' alert result was not recorded: ' . $error->getMessage());
        }
    }

    private function adminCanApprove(int $userId): bool
    {
        try {
            $statement = $this->pdo->prepare('SELECT privilege_key FROM user_privileges WHERE user_id = :user_id');
            $statement->execute(['user_id' => $userId]);
            $keys = $statement->fetchAll(PDO::FETCH_COLUMN) ?: [];
        } catch (PDOException) {
            $keys = []; // No privilege table yet: every admin still has the role defaults.
        }

        // No stored rows means the admin role defaults apply, which include approval.
        return $keys === [] || in_array(self::APPROVAL_PRIVILEGE, $keys, true);
    }

    private static function emailBody(array $request): string
    {
        $zone = new DateTimeZone('Asia/Manila');
        $start = new DateTimeImmutable((string) $request['override_start'], $zone);
        $end = new DateTimeImmutable((string) $request['override_end'], $zone);
        $reason = trim((string) $request['reason']);

        return implode("\n", [
            'Entrivo Door Lock System', '',
            $request['username'] . ' (' . $request['role'] . ') sent an override request that is waiting for your review.', '',
            'Requested access: ' . $start->format('M j, Y g:i A') . ' - ' . $end->format('g:i A') . ' (Asia/Manila)',
            'Reason: ' . ($reason !== '' ? $reason : 'No reason provided.'), '',
            'Sign in to the Entrivo portal and open Pending Overrides to approve or reject request #' . (int) $request['override_id'] . '.',
        ]);
    }
}
