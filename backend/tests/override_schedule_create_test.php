<?php

require_once dirname(__DIR__) . '/services/OverrideScheduleService.php';
require_once dirname(__DIR__) . '/services/ScheduleStatusService.php';

date_default_timezone_set('Asia/Manila');

function expectOverrideCreate(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function overrideCreateFixture(): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, email TEXT, role TEXT, is_active INTEGER)');
    $pdo->exec('CREATE TABLE access_overrides (
        override_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        approved_by INTEGER,
        reason TEXT,
        override_start TEXT,
        override_end TEXT
    )');
    $pdo->exec('CREATE TABLE schedules (
        schedule_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        schedule_type TEXT,
        schedule_kind TEXT,
        schedule_date TEXT,
        time_start TEXT,
        time_end TEXT,
        start_date TEXT,
        end_date TEXT,
        repeat_type TEXT,
        repeat_days TEXT,
        repeat_day TEXT,
        grace_period_minutes INTEGER,
        status TEXT,
        created_by INTEGER,
        created_at TEXT,
        approved_by INTEGER,
        approved_at TEXT,
        overridden_by_schedule_id INTEGER
    )');
    $users = $pdo->prepare('INSERT INTO users VALUES (?, ?, ?, ?, 1)');
    $users->execute([1, 'admin', 'admin@example.test', 'super_admin']);
    $users->execute([2, 'faculty', 'faculty@example.test', 'faculty']);
    $users->execute([3, 'other', 'other@example.test', 'staff']);
    $pdo->exec("INSERT INTO schedules (
        user_id, schedule_type, schedule_kind, schedule_date, time_start, time_end,
        start_date, end_date, repeat_type, grace_period_minutes, status, created_at
    ) VALUES
        (2, 'single', 'regular', '2026-10-24', '08:00:00', '17:00:00', NULL, NULL, 'none', 15, 'approved', '2026-10-20 09:00:00'),
        (3, 'single', 'regular', '2026-10-24', '09:00:00', '12:00:00', NULL, NULL, 'none', 15, 'approved', '2026-10-20 09:00:00')");
    return $pdo;
}

$pdo = overrideCreateFixture();
$mail = [];
$service = new OverrideScheduleService($pdo);
$preview = $service->preview(2, '2026-10-24', '08:00', '17:00');
expectOverrideCreate(count($preview['affected']) === 1, 'An overlapping regular schedule must be reported as affected.');
expectOverrideCreate($preview['affected'][0]['scheduleKind'] === 'regular', 'The affected row must stay Regular.');
expectOverrideCreate(count($preview['blockingOverrides']) === 0, 'A regular overlap must not block creating an override row.');
expectOverrideCreate(count($preview['others']) === 1, 'Other users with an overlapping regular schedule must be listed for notification.');

$result = $service->createFromAdmin([
    'userId' => 2,
    'scheduleDate' => '2026-10-24',
    'timeStart' => '08:00',
    'timeEnd' => '17:00',
    'createdBy' => 1,
    'requesterName' => 'Faculty One',
    'reason' => 'Coverage change.',
]);

expectOverrideCreate((int) $result['scheduleId'] > 0, 'The override must be inserted as a new schedule row.');
$regular = $pdo->query('SELECT * FROM schedules WHERE schedule_id = 1')->fetch(PDO::FETCH_ASSOC);
$override = $pdo->query('SELECT * FROM schedules WHERE schedule_id = ' . (int) $result['scheduleId'])->fetch(PDO::FETCH_ASSOC);
expectOverrideCreate($regular['schedule_kind'] === 'regular' && $regular['status'] === 'approved', 'The original regular schedule must keep its kind and status.');
expectOverrideCreate($regular['time_start'] === '08:00:00' && $regular['time_end'] === '17:00:00', 'The original regular window must not change.');
expectOverrideCreate((int) $regular['overridden_by_schedule_id'] === (int) $result['scheduleId'], 'The regular schedule must be stamped by the new override row.');
expectOverrideCreate($override['schedule_kind'] === 'override' && $override['status'] === 'approved', 'The new row must be an approved override.');
expectOverrideCreate(count($result['affectedSchedules']) === 1 && $result['affectedSchedules'][0]['isOverridden'] === true, 'The API payload must mark the regular row as overridden without converting it.');
expectOverrideCreate(ScheduleStatusService::normalizeSchedule([
    'status' => $regular['status'],
    'scheduleKind' => $regular['schedule_kind'],
    'overriddenByScheduleId' => $regular['overridden_by_schedule_id'],
])['scheduleKind'] === 'regular', 'A stamped regular schedule must still display as Regular.');

$notices = new NotificationService($pdo, function (string $email) use (&$mail): void {
    $mail[] = $email;
});
$unreadOwner = $notices->getUnacknowledged(2);
$unreadOther = $notices->getUnacknowledged(3);
expectOverrideCreate(count($unreadOwner) === 1, 'The user whose regular schedule was stamped must get a dashboard notice.');
expectOverrideCreate(count($unreadOther) === 1, 'Other overlapping users must still be notified.');
expectOverrideCreate($unreadOwner[0]['requesterName'] === 'Faculty One', 'The notice must identify who requested temporary access.');

$delivery = $notices->deliverPending((int) $result['overrideId']);
expectOverrideCreate($delivery['sent'] === 2, 'Email must be queued for the affected owner and overlapping users.');
sort($mail);
expectOverrideCreate($mail === ['faculty@example.test', 'other@example.test'], 'Override email must go to the affected account addresses.');

try {
    $service->createFromAdmin([
        'userId' => 2,
        'scheduleDate' => '2026-10-24',
        'timeStart' => '08:00',
        'timeEnd' => '17:00',
        'createdBy' => 1,
    ]);
    throw new RuntimeException('A second overlapping override was created.');
} catch (RuntimeException $expected) {
    expectOverrideCreate(
        str_contains($expected->getMessage(), 'existing override'),
        'A second overlapping override for the same person must be blocked.'
    );
}

echo "Override schedule create, stamp, and notification tests passed.\n";
