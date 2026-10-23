<?php

require_once dirname(__DIR__) . '/services/ScheduleStatusService.php';
require_once dirname(__DIR__) . '/services/OverrideRequestCancellationService.php';

function expect(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$legacy = ['id' => 12, 'userId' => 2, 'status' => 'overridden', 'scheduleKind' => 'regular', 'timeStart' => '13:00'];
$normalized = ScheduleStatusService::normalizeSchedule($legacy);
expect($normalized['status'] === 'approved' && $normalized['scheduleKind'] === 'override', 'Legacy override access must be shown as Approved, Type Override.');
expect($legacy['status'] === 'overridden', 'Reading a legacy schedule must not modify the input or stored data.');
expect($normalized['id'] === 12 && $normalized['userId'] === 2 && $normalized['timeStart'] === '13:00', 'Compatibility must preserve the access window and owner.');
expect(ScheduleStatusService::normalizeSchedule($normalized) === $normalized, 'Compatibility must be idempotent.');
foreach (['pending', 'approved', 'completed', 'cancelled'] as $status) {
    foreach (['regular', 'override'] as $kind) {
        $schedule = ['status' => $status, 'scheduleKind' => $kind];
        $normalized = ScheduleStatusService::normalizeSchedule($schedule);
        expect($normalized['status'] === $status && $normalized['scheduleKind'] === $kind, 'Current statuses and schedule types must remain separate.');
        expect(empty($normalized['isOverridden']) && $normalized['overriddenByScheduleId'] === null, 'A schedule is not stamped overridden unless an override row points at it.');
    }
}

function fixture(): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE access_overrides (override_id INTEGER PRIMARY KEY, user_id INTEGER, approved_by INTEGER, override_start TEXT, override_end TEXT)');
    $pdo->exec('CREATE TABLE schedules (schedule_id INTEGER PRIMARY KEY, user_id INTEGER, schedule_kind TEXT, schedule_date TEXT, time_start TEXT, time_end TEXT, status TEXT)');
    $pdo->exec("INSERT INTO access_overrides VALUES (10, 2, 99, '2026-10-20 13:00:00', '2026-10-20 15:00:00')");
    $pdo->exec("INSERT INTO schedules VALUES
        (1, 1, 'regular', '2026-10-20', '12:00:00', '16:00:00', 'approved'),
        (2, 2, 'regular', '2026-10-20', '13:00:00', '15:00:00', 'approved'),
        (3, 2, 'override', '2026-10-20', '13:00:00', '15:00:00', 'approved'),
        (4, 3, 'override', '2026-10-20', '13:00:00', '15:00:00', 'approved'),
        (5, 2, 'override', '2026-10-20', '16:00:00', '17:00:00', 'approved')");
    return $pdo;
}

function status(PDO $pdo, int $id): string
{
    return (string) $pdo->query('SELECT status FROM schedules WHERE schedule_id = ' . $id)->fetchColumn();
}

$now = new DateTimeImmutable('2026-10-17 09:00:00');
$pdo = fixture();
(new OverrideRequestCancellationService($pdo))->cancel(10, 2, $now);
expect(status($pdo, 3) === 'cancelled', 'Cancelling an approved request must cancel its matching override schedule.');
foreach ([1, 2, 4, 5] as $id) {
    expect(status($pdo, $id) === 'approved', 'Other users, regular schedules, and other windows must stay valid.');
}
expect((int) $pdo->query('SELECT COUNT(*) FROM access_overrides')->fetchColumn() === 0, 'The selected request must be cancelled.');

$pdo = fixture();
$pdo->exec("UPDATE schedules SET status = 'overridden', schedule_kind = 'regular' WHERE schedule_id = 3");
(new OverrideRequestCancellationService($pdo))->cancel(10, 2, $now);
expect(status($pdo, 3) === 'cancelled' && status($pdo, 2) === 'approved', 'Legacy override cancellation must preserve regular access.');

$pdo = fixture();
$pdo->exec('UPDATE access_overrides SET approved_by = NULL WHERE override_id = 10');
(new OverrideRequestCancellationService($pdo))->cancel(10, 2, $now);
expect(status($pdo, 3) === 'approved', 'Cancelling an unapproved request must not revoke an existing approved schedule.');

$pdo = fixture();
$pdo->exec("INSERT INTO access_overrides VALUES (11, 2, 99, '2026-10-20 13:00:00', '2026-10-20 15:00:00')");
$service = new OverrideRequestCancellationService($pdo);
$service->cancel(10, 2, $now);
expect(status($pdo, 3) === 'approved', 'An identical approved request must keep shared override access valid.');
$service->cancel(11, 2, $now);
expect(status($pdo, 3) === 'cancelled', 'Cancelling the last approved request must revoke the matching override schedule.');

foreach ([['userId' => 3, 'now' => $now], ['userId' => 2, 'now' => new DateTimeImmutable('2026-10-21 09:00:00')]] as $case) {
    $pdo = fixture();
    try {
        (new OverrideRequestCancellationService($pdo))->cancel(10, $case['userId'], $case['now']);
        throw new RuntimeException('An invalid cancellation was accepted.');
    } catch (InvalidArgumentException $expected) {
        expect((int) $pdo->query('SELECT COUNT(*) FROM access_overrides')->fetchColumn() === 1, 'Rejected cancellation must preserve the request.');
        expect(status($pdo, 3) === 'approved' && !$pdo->inTransaction(), 'Rejected cancellation must preserve access and release its transaction.');
    }
}

$pdo = fixture();
$pdo->exec("CREATE TRIGGER fail_cancellation BEFORE UPDATE ON schedules BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
try {
    (new OverrideRequestCancellationService($pdo))->cancel(10, 2, $now);
    throw new RuntimeException('The failing schedule update unexpectedly succeeded.');
} catch (PDOException $expected) {
    expect((int) $pdo->query('SELECT COUNT(*) FROM access_overrides')->fetchColumn() === 1, 'A failed schedule update must roll back cancellation of the request.');
    expect(status($pdo, 3) === 'approved' && !$pdo->inTransaction(), 'A failed update must leave existing access intact.');
}

echo "Schedule status and override cancellation tests passed.\n";
