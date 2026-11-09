<?php

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/ScheduleAccessPolicy.php';

function expectDayListing(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = entrivo_pdo();
// Connection-local shadow table: real schedules are never read or changed.
$pdo->exec("CREATE TEMPORARY TABLE schedules (
    schedule_id INT PRIMARY KEY, user_id INT, schedule_type VARCHAR(20), schedule_kind VARCHAR(20),
    schedule_date DATE NULL, time_start TIME, time_end TIME, start_date DATE NULL, end_date DATE NULL,
    repeat_type VARCHAR(30), repeat_day VARCHAR(15) NULL, repeat_days TEXT NULL,
    grace_period_minutes INT DEFAULT 15, status VARCHAR(20), overridden_by_schedule_id INT NULL
) ENGINE=InnoDB");
$insert = $pdo->prepare('INSERT INTO schedules (schedule_id,user_id,schedule_type,schedule_kind,schedule_date,time_start,time_end,start_date,end_date,repeat_type,repeat_day,repeat_days,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
// 2026-11-09 is a Monday.
$insert->execute([1, 7, 'single', 'regular', '2026-11-09', '13:00:00', '15:00:00', null, null, 'none', null, null, 'approved']);
$insert->execute([2, 7, 'recurring', 'regular', null, '08:00:00', '10:00:00', '2026-11-01', '2026-12-31', 'weekly_selected', null, '["Monday","Wednesday"]', 'approved']);
$insert->execute([3, 7, 'single', 'override', '2026-11-09', '16:00:00', '17:00:00', null, null, 'none', null, null, 'approved']);
$insert->execute([4, 7, 'single', 'regular', '2026-11-09', '18:00:00', '19:00:00', null, null, 'none', null, null, 'pending']);
$insert->execute([5, 7, 'single', 'regular', '2026-11-10', '08:00:00', '09:00:00', null, null, 'none', null, null, 'approved']);
$insert->execute([6, 8, 'single', 'regular', '2026-11-09', '08:00:00', '09:00:00', null, null, 'none', null, null, 'approved']);
$insert->execute([7, 7, 'recurring', 'regular', null, '11:00:00', '12:00:00', '2026-11-01', '2026-12-31', 'weekly_selected', null, '["Tuesday"]', 'approved']);

$policy = new ScheduleAccessPolicy($pdo);
$day = $policy->schedulesOn(7, '2026-11-09');
expectDayListing(array_column($day, 'schedule_id') === [2, 1, 3],
    'Only the user\'s approved schedules occurring that day are listed, earliest first. Got ' . json_encode($day));
expectDayListing($day[0]['time_start'] === '08:00:00' && $day[0]['time_end'] === '10:00:00' && $day[0]['kind'] === 'regular',
    'A listed schedule carries its time window and kind.');
expectDayListing($day[2]['kind'] === 'override', 'An override schedule is labelled as an override.');
expectDayListing($policy->schedulesOn(7, '2026-11-11') === [['schedule_id' => 2, 'time_start' => '08:00:00', 'time_end' => '10:00:00', 'kind' => 'regular']],
    'A recurring schedule appears only on its selected days.');
expectDayListing($policy->schedulesOn(99, '2026-11-09') === [], 'A user without schedules gets an empty list.');

echo "PASS: approved schedules for one user and date, recurrence days, override kind, pending and other-user schedules excluded, earliest first.\n";
