<?php

require_once dirname(__DIR__) . '/services/NotificationService.php';

date_default_timezone_set('Asia/Manila');

function expectOverrideNotice(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function noticeWindow(string $value): DateTimeImmutable
{
    return new DateTimeImmutable($value, new DateTimeZone('Asia/Manila'));
}

function noticeSchedule(array $changes = []): array
{
    return array_replace([
        'schedule_id' => 12,
        'user_id' => 2,
        'schedule_type' => 'single',
        'schedule_kind' => 'regular',
        'schedule_date' => '2026-10-22',
        'time_start' => '09:00:00',
        'time_end' => '11:00:00',
        'start_date' => null,
        'end_date' => null,
        'repeat_type' => 'none',
        'repeat_days' => null,
        'repeat_day' => null,
        'grace_period_minutes' => 15,
        'status' => 'approved',
    ], $changes);
}

function affectedNoticeOccurrences(array $changes = [], string $start = '2026-10-22 10:00:00', string $end = '2026-10-22 12:00:00'): array
{
    return NotificationService::affectedOccurrences(noticeSchedule($changes), noticeWindow($start), noticeWindow($end));
}

$occurrences = affectedNoticeOccurrences();
expectOverrideNotice(count($occurrences) === 1, 'An approved schedule with a partial overlap must be affected.');
expectOverrideNotice($occurrences[0]['id'] === 12 && $occurrences[0]['date'] === '2026-10-22', 'The notification must preserve the actual schedule occurrence.');
expectOverrideNotice($occurrences[0]['timeStart'] === '09:00:00' && $occurrences[0]['timeEnd'] === '11:00:00', 'The notification must retain the complete original schedule window.');
expectOverrideNotice($occurrences[0]['overlapStart'] === '2026-10-22 10:00:00' && $occurrences[0]['overlapEnd'] === '2026-10-22 11:00:00', 'The affected interval must be clipped to the overlapping part.');

foreach (['pending', 'completed', 'cancelled', 'expired'] as $status) {
    expectOverrideNotice(affectedNoticeOccurrences(['status' => $status]) === [], 'Inactive schedule statuses must not generate affected-user notifications: ' . $status);
}
expectOverrideNotice(count(affectedNoticeOccurrences(['status' => 'overridden'])) === 1, 'Legacy approved override status must remain eligible.');
expectOverrideNotice(affectedNoticeOccurrences(['schedule_date' => '2026-10-23']) === [], 'A schedule on another date must not be affected.');
expectOverrideNotice(affectedNoticeOccurrences(['time_end' => '10:00:00']) === [], 'A schedule ending at the override start must not be affected, including its grace period.');
expectOverrideNotice(affectedNoticeOccurrences(['time_start' => '12:00:00', 'time_end' => '13:00:00']) === [], 'A schedule starting at the override end must not be affected.');
expectOverrideNotice(affectedNoticeOccurrences(['time_start' => '11:00:00', 'time_end' => '09:00:00']) === [], 'An invalid schedule interval must not create an alert.');
expectOverrideNotice(affectedNoticeOccurrences([], '2026-10-22 12:00:00', '2026-10-22 10:00:00') === [], 'An invalid override interval must not create an alert.');

$recurring = [
    'schedule_type' => 'recurring',
    'schedule_date' => null,
    'start_date' => '2026-10-22',
    'end_date' => '2026-10-29',
    'repeat_type' => 'daily',
];
expectOverrideNotice(count(affectedNoticeOccurrences($recurring)) === 1, 'A daily legacy recurrence must include its start date.');
expectOverrideNotice(count(affectedNoticeOccurrences($recurring, '2026-10-29 10:00:00', '2026-10-29 12:00:00')) === 1, 'A daily recurrence must include its end date.');
expectOverrideNotice(affectedNoticeOccurrences($recurring, '2026-10-30 10:00:00', '2026-10-30 12:00:00') === [], 'A legacy recurrence outside its date range must not be affected.');
expectOverrideNotice(count(affectedNoticeOccurrences(array_replace($recurring, ['repeat_type' => 'weekly']))) === 1, 'An unnamed weekly recurrence must follow the start date weekday.');
expectOverrideNotice(affectedNoticeOccurrences(array_replace($recurring, ['repeat_type' => 'weekly', 'repeat_day' => 'Friday'])) === [], 'A weekly recurrence must not alert on a different weekday.');
expectOverrideNotice(count(affectedNoticeOccurrences(array_replace($recurring, ['repeat_type' => 'weekly', 'repeat_day' => 'thURsday']))) === 1, 'A named weekly recurrence must match weekday names without case sensitivity.');
expectOverrideNotice(count(affectedNoticeOccurrences(array_replace($recurring, ['repeat_type' => 'weekly_selected', 'repeat_days' => '["Monday","thursday"]']))) === 1, 'Selected-day recurrence must include the actual weekday.');
foreach (['["Monday"]', 'invalid json', '{}', 'null'] as $days) {
    expectOverrideNotice(affectedNoticeOccurrences(array_replace($recurring, ['repeat_type' => 'weekly_selected', 'repeat_days' => $days])) === [], 'Unselected or invalid weekday lists must not cause an alert.');
}
expectOverrideNotice(affectedNoticeOccurrences(array_replace($recurring, ['repeat_type' => 'monthly'])) === [], 'Unsupported recurrence rules must not be assumed to occur every day.');

function noticeFixture(): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, email TEXT, role TEXT, is_active INTEGER)');
    $pdo->exec('CREATE TABLE access_overrides (override_id INTEGER PRIMARY KEY, user_id INTEGER, approved_by INTEGER, reason TEXT, override_start TEXT, override_end TEXT)');
    $pdo->exec('CREATE TABLE schedules (
        schedule_id INTEGER PRIMARY KEY, user_id INTEGER, schedule_type TEXT, schedule_kind TEXT,
        schedule_date TEXT, time_start TEXT, time_end TEXT, start_date TEXT, end_date TEXT,
        repeat_type TEXT, repeat_days TEXT, repeat_day TEXT, grace_period_minutes INTEGER, status TEXT
    )');
    $users = $pdo->prepare('INSERT INTO users VALUES (?, ?, ?, ?, 1)');
    foreach ([[1, 'requester', 'requester@example.test', 'faculty'], [2, 'affected', 'affected@example.test', 'faculty'], [3, 'recurring', 'recurring@example.test', 'staff'], [4, 'other', 'other@example.test', 'faculty']] as $row) {
        $users->execute($row);
    }
    $pdo->exec("INSERT INTO access_overrides VALUES (100, 1, 99, 'Laboratory session.', '2026-10-22 10:00:00', '2026-10-22 12:00:00')");
    $insert = $pdo->prepare('INSERT INTO schedules VALUES (:schedule_id, :user_id, :schedule_type, :schedule_kind, :schedule_date, :time_start, :time_end, :start_date, :end_date, :repeat_type, :repeat_days, :repeat_day, :grace_period_minutes, :status)');
    foreach ([
        noticeSchedule(['schedule_id' => 1, 'user_id' => 1]),
        noticeSchedule(['schedule_id' => 2, 'user_id' => 2]),
        noticeSchedule(['schedule_id' => 3, 'user_id' => 2, 'time_start' => '11:30:00', 'time_end' => '13:00:00']),
        noticeSchedule(['schedule_id' => 4, 'user_id' => 3, 'schedule_type' => 'recurring', 'schedule_date' => null, 'start_date' => '2026-10-19', 'end_date' => '2026-10-30', 'repeat_type' => 'weekly_selected', 'repeat_days' => '["Thursday"]']),
        noticeSchedule(['schedule_id' => 5, 'user_id' => 4, 'time_end' => '10:00:00']),
        noticeSchedule(['schedule_id' => 6, 'user_id' => 4, 'status' => 'pending']),
        noticeSchedule(['schedule_id' => 7, 'user_id' => 4, 'schedule_date' => '2026-10-23']),
        noticeSchedule(['schedule_id' => 8, 'user_id' => 1, 'schedule_kind' => 'override', 'time_start' => '10:00:00', 'time_end' => '12:00:00']),
    ] as $row) {
        $insert->execute($row);
    }
    return $pdo;
}

function approvedNoticeOverride(array $changes = []): array
{
    return array_replace([
        'id' => 100,
        'userId' => 1,
        'name' => 'Requester One',
        'reason' => 'Laboratory session.',
        'overrideStart' => '2026-10-22 10:00:00',
        'overrideEnd' => '2026-10-22 12:00:00',
        'isApproved' => true,
    ], $changes);
}

function noticeService(PDO $pdo, ?callable $sendMail = null): NotificationService
{
    return new NotificationService($pdo, $sendMail, static fn (): DateTimeImmutable => noticeWindow('2026-10-22 09:00:00'));
}

$pdo = noticeFixture();
$mail = [];
$service = noticeService($pdo, function (string $email, string $subject, string $body) use (&$mail): void {
    $mail[] = compact('email', 'subject', 'body');
});
$service->ensureSchema();

try {
    $service->createForApprovedOverride(approvedNoticeOverride());
    throw new RuntimeException('Notification creation without an approval transaction unexpectedly succeeded.');
} catch (LogicException $expected) {
}

// Notification creation must roll back with approval and must not send mail before commit.
$pdo->beginTransaction();
$ids = $service->createForApprovedOverride(approvedNoticeOverride());
expectOverrideNotice(count($ids) === 2, 'Create exactly one notification per affected other user, grouping multiple schedules.');
expectOverrideNotice($mail === [], 'Creating notifications in an approval transaction must not send email.');
try {
    $service->deliverPending(100);
    throw new RuntimeException('Email delivery before approval commit unexpectedly succeeded.');
} catch (LogicException $expected) {
}
$pdo->rollBack();
expectOverrideNotice($service->getUnacknowledged(2) === [], 'Rolling back approval must roll back its pending modal.');
expectOverrideNotice($service->deliverPending()['sent'] === 0 && $mail === [], 'Rolling back approval must not leave an email to deliver.');

$pdo->beginTransaction();
$ids = $service->createForApprovedOverride(approvedNoticeOverride([
    'userId' => 4,
    'reason' => 'Untrusted client reason',
    'overrideStart' => '2026-10-23 14:00:00',
    'overrideEnd' => '2026-10-23 15:00:00',
]));
$pdo->commit();
$pdo->beginTransaction();
$service->createForApprovedOverride(approvedNoticeOverride());
$pdo->commit();
expectOverrideNotice(count($service->getUnacknowledged(2)) === 1 && count($service->getUnacknowledged(3)) === 1, 'Repeating approval handling must not duplicate persisted notifications.');
expectOverrideNotice($service->getUnacknowledged(1) === [] && $service->getUnacknowledged(4) === [], 'The requester and users without an approved overlap must not be notified.');
expectOverrideNotice((int) $pdo->query("SELECT COUNT(*) FROM schedules WHERE status = 'approved'")->fetchColumn() === 7, 'Notifying affected users must preserve their approved access schedules.');
$notice = $service->getUnacknowledged(2)[0];
expectOverrideNotice($notice['overrideStart'] === '2026-10-22 10:00:00' && $notice['overrideEnd'] === '2026-10-22 12:00:00' && $notice['reason'] === 'Laboratory session.', 'The approved database request must determine recipients, window, and reason instead of client-supplied snapshots.');
expectOverrideNotice(count($notice['affectedSchedules']) === 2, 'A user with two overlapping schedules must see both in the same notification.');

$delivery = $service->deliverPending(100);
expectOverrideNotice($delivery['sent'] === 2 && count($mail) === 2, 'Post-commit dispatch must send one email to each affected user.');
$emails = array_column($mail, 'email');
sort($emails);
expectOverrideNotice($emails === ['affected@example.test', 'recurring@example.test'], 'Only affected account email addresses must receive notices.');
foreach ($mail as $message) {
    expectOverrideNotice(str_contains($message['body'], 'Requester One') && str_contains($message['body'], 'Laboratory session.'), 'Email must identify who requested the override and why.');
}
expectOverrideNotice($service->deliverPending(100)['sent'] === 0 && count($mail) === 2, 'Successful email delivery must not repeat on the next poll.');

$unread = $service->getUnacknowledged(2);
$noticeId = (int) $unread[0]['id'];
expectOverrideNotice(!$service->acknowledge(3, $noticeId), 'One user must not acknowledge another user\'s notification.');
expectOverrideNotice(count($service->getUnacknowledged(2)) === 1, 'Another user\'s acknowledgement attempt must leave the modal pending.');
expectOverrideNotice($service->acknowledge(2, $noticeId) && $service->acknowledge(2, $noticeId), 'Acknowledgement must be owned and safely repeatable.');
expectOverrideNotice(noticeService($pdo, static function (): void {})->getUnacknowledged(2) === [], 'Acknowledgement must persist across new sessions and service instances.');

$pdo->exec('DELETE FROM access_overrides WHERE override_id = 100');
expectOverrideNotice($service->getUnacknowledged(3) === [], 'A cancelled override must no longer present an outdated unread modal.');

// Safe transport failures keep the notification and remain eligible for a bounded retry.
$pdo = noticeFixture();
$failures = 0;
$service = noticeService($pdo, function () use (&$failures): void {
    $failures++;
    throw new RuntimeException('Fixture mail transport unavailable.');
});
$service->ensureSchema();
$pdo->beginTransaction();
$service->createForApprovedOverride(approvedNoticeOverride());
$pdo->commit();
$delivery = $service->deliverPending(100);
expectOverrideNotice($delivery['failed'] === 2 && $failures === 2, 'A known delivery failure must be recorded without losing pending notices.');
expectOverrideNotice(count($service->getUnacknowledged(2)) === 1, 'An email transport failure must not suppress the in-app modal.');
$retriedMail = [];
$retryService = noticeService($pdo, function (string $email) use (&$retriedMail): void {
    $retriedMail[] = $email;
});
expectOverrideNotice($retryService->deliverPending(100)['sent'] === 2 && count($retriedMail) === 2, 'A known transport failure must be recoverable without creating duplicate notices.');
expectOverrideNotice(count($retryService->getUnacknowledged(2)) === 1, 'Retrying email must preserve the same unacknowledged notice.');

// A pending or cancelled request cannot create or send an override warning.
$pdo = noticeFixture();
$mail = [];
$service = noticeService($pdo, function (string $email) use (&$mail): void { $mail[] = $email; });
$service->ensureSchema();
$pdo->exec('UPDATE access_overrides SET approved_by = NULL WHERE override_id = 100');
$pdo->beginTransaction();
expectOverrideNotice($service->createForApprovedOverride(approvedNoticeOverride()) === [], 'A client approval flag must not notify users when the stored request is pending.');
$pdo->commit();
$pdo->exec('UPDATE access_overrides SET approved_by = 99 WHERE override_id = 100');
$pdo->beginTransaction();
$service->createForApprovedOverride(approvedNoticeOverride());
$pdo->commit();
$pdo->exec("UPDATE schedules SET status = 'cancelled' WHERE schedule_id = 8");
expectOverrideNotice($service->getUnacknowledged(2) === [] && $service->deliverPending(100)['sent'] === 0 && $mail === [], 'Cancelling requester access must suppress both outdated modals and unsent emails.');

// A lost SMTP acceptance response may already have delivered mail: never resend automatically.
$pdo = noticeFixture();
$uncertainAttempts = 0;
$service = noticeService($pdo, function () use (&$uncertainAttempts): void {
    $uncertainAttempts++;
    throw new MailDeliveryUncertainException('Fixture SMTP acceptance reply lost.');
});
$service->ensureSchema();
$pdo->beginTransaction();
$service->createForApprovedOverride(approvedNoticeOverride());
$pdo->commit();
expectOverrideNotice($service->deliverPending(100)['uncertain'] === 2 && $uncertainAttempts === 2, 'Ambiguous SMTP responses must be tracked separately from safe retry failures.');
$service->deliverPending(100);
expectOverrideNotice($uncertainAttempts === 2 && count($service->getUnacknowledged(2)) === 1, 'Ambiguous deliveries must not automatically duplicate emails or discard in-app warnings.');

// A cancellation during a slow SMTP batch must stop later recipients in that batch.
$pdo = noticeFixture();
$duringCancellation = 0;
$service = noticeService($pdo, function () use ($pdo, &$duringCancellation): void {
    $duringCancellation++;
    $pdo->exec('DELETE FROM access_overrides WHERE override_id = 100');
});
$service->ensureSchema();
$pdo->beginTransaction();
$service->createForApprovedOverride(approvedNoticeOverride());
$pdo->commit();
expectOverrideNotice($service->deliverPending(100)['sent'] === 1 && $duringCancellation === 1, 'Each delivery claim must recheck cancellation before sending from a previously selected batch.');

// Historical dashboard notices remain reviewable, but an ended override must not email late.
$pdo = noticeFixture();
$lateMail = [];
$service = noticeService($pdo, function (string $email) use (&$lateMail): void { $lateMail[] = $email; });
$service->ensureSchema();
$pdo->beginTransaction();
$service->createForApprovedOverride(approvedNoticeOverride());
$pdo->commit();
$expiredService = new NotificationService($pdo, function (string $email) use (&$lateMail): void { $lateMail[] = $email; }, static fn (): DateTimeImmutable => noticeWindow('2026-10-22 12:00:00'));
expectOverrideNotice($expiredService->deliverPending(100)['sent'] === 0 && $lateMail === [], 'An override that has ended must not send a late warning email.');
expectOverrideNotice(count($expiredService->getUnacknowledged(2)) === 1, 'An unacknowledged historical notice must remain available after the override ends.');

// Repeated known failures must stop automatically while preserving the dashboard notice.
$pdo = noticeFixture();
$pdo->exec('DELETE FROM schedules WHERE user_id = 3');
$boundedAttempts = 0;
$service = noticeService($pdo, function () use (&$boundedAttempts): void {
    $boundedAttempts++;
    throw new RuntimeException('Fixture repeat transport failure.');
});
$service->ensureSchema();
$pdo->beginTransaction();
$service->createForApprovedOverride(approvedNoticeOverride());
$pdo->commit();
for ($attempt = 0; $attempt < 5; $attempt++) {
    $delivery = $service->deliverPending(100);
}
expectOverrideNotice($boundedAttempts === 5 && $delivery['retryable'] === 0, 'A persistent transport failure must exhaust the bounded delivery attempts.');
$service->deliverPending(100);
expectOverrideNotice($boundedAttempts === 5 && count($service->getUnacknowledged(2)) === 1, 'Exhausted retries must not send again or remove the in-app notice.');

// A second worker entering during SMTP must not reclaim the first worker's in-flight email.
$pdo = noticeFixture();
$concurrentMail = [];
$enteredSecondWorker = false;
$service = noticeService($pdo, function (string $email) use ($pdo, &$concurrentMail, &$enteredSecondWorker): void {
    $concurrentMail[] = $email;
    if (!$enteredSecondWorker) {
        $enteredSecondWorker = true;
        $secondWorker = noticeService($pdo, function (string $recipient) use (&$concurrentMail): void { $concurrentMail[] = $recipient; });
        $secondWorker->deliverPending(100);
    }
});
$service->ensureSchema();
$pdo->beginTransaction();
$service->createForApprovedOverride(approvedNoticeOverride());
$pdo->commit();
$service->deliverPending(100);
expectOverrideNotice(count($concurrentMail) === 2 && count(array_unique($concurrentMail)) === 2, 'An in-flight email must not be duplicated by another worker or a stale batch.');

$wireMessage = MailService::formatMessage('user@example.test', "Override notice\r\nBcc: injected@example.test", "First\r\n.Second\n.\rLast", 'sender@example.test', 'Entrivo');
expectOverrideNotice(!str_contains($wireMessage, "\r\r\n") && !preg_match('/(?<!\r)\n/', $wireMessage), 'SMTP messages must use a single canonical CRLF for each line.');
expectOverrideNotice(str_contains($wireMessage, "\r\n..Second\r\n..\r\nLast"), 'Leading dots in SMTP body lines must be escaped so user text cannot terminate the message.');
expectOverrideNotice(!str_contains($wireMessage, "\r\nBcc:"), 'Newlines in a subject must not inject an additional email header.');

echo "Override notification recurrence, delivery, and acknowledgement tests passed.\n";
