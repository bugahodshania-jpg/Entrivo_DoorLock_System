<?php

require_once dirname(__DIR__) . '/services/OverrideRequestAlertService.php';

// SQLite and an injected mail callback: no live email, no production database.
function expectSame(mixed $expected, mixed $actual, string $label): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($label . ': expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, email TEXT, role TEXT, is_active INTEGER)');
$pdo->exec('CREATE TABLE user_privileges (user_id INTEGER, privilege_key TEXT)');
$pdo->exec('CREATE TABLE access_overrides (override_id INTEGER PRIMARY KEY, user_id INTEGER, approved_by INTEGER, reason TEXT, override_start TEXT, override_end TEXT,
    approver_alert_status TEXT, approver_alert_at TEXT)');

$pdo->exec("INSERT INTO users VALUES
    (1, 'root', 'root@example.test', 'super_admin', 1),
    (2, 'admin.default', 'default@example.test', 'admin', 1),
    (3, 'admin.limited', 'limited@example.test', 'admin', 1),
    (4, 'admin.granted', 'granted@example.test', 'admin', 1),
    (5, 'admin.inactive', 'inactive@example.test', 'admin', 0),
    (6, 'admin.noemail', '', 'admin', 1),
    (7, 'faculty.one', 'faculty@example.test', 'faculty', 1)");
// Admin 3 has explicit privileges without approval; admin 4 has it explicitly.
$pdo->exec("INSERT INTO user_privileges VALUES (3, 'dashboard'), (4, 'dashboard'), (4, 'pending_overrides')");
$pdo->exec("INSERT INTO access_overrides (override_id, user_id, approved_by, reason, override_start, override_end) VALUES
    (10, 7, NULL, 'Make-up class', '2026-11-20 13:00:00', '2026-11-20 15:00:00'),
    (11, 7, 1, 'Already approved', '2026-11-21 13:00:00', '2026-11-21 15:00:00'),
    (12, 1, NULL, 'Own request', '2026-11-22 13:00:00', '2026-11-22 15:00:00')");

$sent = [];
$service = new OverrideRequestAlertService($pdo, static function (string $email, string $subject, string $body) use (&$sent): void {
    if ($email === 'granted@example.test') {
        throw new RuntimeException('Mailbox unavailable.');
    }
    $sent[] = ['email' => $email, 'subject' => $subject, 'body' => $body];
});

// Only approvers are alerted: super admins, default admins and admins granted the privilege.
expectSame([1, 2, 4], array_column($service->recipients(), 'id'), 'approver list');

// One failing mailbox does not stop the others.
$summary = $service->notify(10);
expectSame(['sent' => 2, 'failed' => 1, 'skipped' => false], $summary, 'pending request summary');
expectSame(['root@example.test', 'default@example.test'], array_column($sent, 'email'), 'emails sent');
expectSame('Entrivo: new override request from faculty.one', $sent[0]['subject'], 'subject');
foreach (['faculty.one (faculty)', 'Nov 20, 2026 1:00 PM - 3:00 PM', 'Reason: Make-up class', 'request #10'] as $needle) {
    if (!str_contains($sent[0]['body'], $needle)) {
        throw new RuntimeException('Email body is missing: ' . $needle);
    }
}

// The result is stored on the request for the Pending Overrides table.
$alertStatus = static fn (int $id): mixed => $pdo->query('SELECT approver_alert_status FROM access_overrides WHERE override_id = ' . $id)->fetchColumn();
expectSame('partial', $alertStatus(10), 'stored result after one failed mailbox');
$service->markQueued(10, true);
expectSame('queued', $alertStatus(10), 'queued marker');
$service->markQueued(10, false);
expectSame('failed', $alertStatus(10), 'worker that could not start');

// A decided or missing request sends nothing.
$sent = [];
expectSame(['sent' => 0, 'failed' => 0, 'skipped' => true], $service->notify(11), 'approved request');
expectSame(['sent' => 0, 'failed' => 0, 'skipped' => true], $service->notify(999), 'missing request');
expectSame([], $sent, 'no email for decided or missing requests');
expectSame(null, $alertStatus(11), 'decided request keeps no result');

// A super admin's own request is not emailed back to them.
$service->notify(12);
expectSame(['default@example.test'], array_column($sent, 'email'), 'requester excluded');
expectSame('partial', $alertStatus(12), 'own request result');

// Every mailbox accepting gives "sent"; no approver with an email gives "none".
$allGood = new OverrideRequestAlertService($pdo, static function (): void {});
$allGood->notify(10);
expectSame('sent', $alertStatus(10), 'all approvers emailed');
$pdo->exec("UPDATE users SET email = '' WHERE role IN ('admin', 'super_admin')");
$allGood->notify(10);
expectSame('none', $alertStatus(10), 'no approver has an email');
$pdo->exec("UPDATE users SET email = username || '@example.test' WHERE role IN ('admin', 'super_admin') AND id <> 6");

// Without a privilege table every active admin keeps the role default.
$pdo->exec('DROP TABLE user_privileges');
expectSame([1, 2, 3, 4], array_column($service->recipients(), 'id'), 'approvers without a privilege table');

echo "Override request alerts reach only approvers, record their result, survive a failed mailbox, and skip decided requests.\n";
