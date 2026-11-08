<?php

require_once __DIR__ . '/ScheduleStatusService.php';

/**
 * Schedule part of a door-entry decision, shared by fingerprint and RFID.
 *
 * Only the authenticated user's own schedules are considered. A schedule is
 * valid when it is approved, occurs on the current date (single date or
 * recurrence), and the current time is inside [time_start, time_end).
 *
 * REGULAR has priority: a valid REGULAR schedule grants as REGULAR even when
 * an OVERRIDE is also valid. Otherwise a valid OVERRIDE grants as OVERRIDE.
 * An override never disables a regular schedule: a regular stamped with
 * overridden_by_schedule_id is still a valid REGULAR schedule.
 */
final class ScheduleAccessPolicy
{
    public function __construct(private PDO $pdo)
    {
    }

    /**
     * @return array{granted: bool, reason: string, message: string,
     *     schedule_id: ?int, override_id: ?int, schedule_kind: ?string}
     */
    public function evaluate(int $userId, DateTimeImmutable $now): array
    {
        $now = $now->setTimezone(new DateTimeZone('Asia/Manila'));
        $date = $now->format('Y-m-d');
        $time = $now->format('H:i:s');

        $statement = $this->pdo->prepare('SELECT * FROM schedules WHERE user_id = ? ORDER BY schedule_id ASC FOR SHARE');
        $statement->execute([$userId]);

        $override = null;
        $futureToday = false;
        $endedToday = false;
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $schedule) {
            if ((int) $schedule['user_id'] !== $userId
                || ScheduleStatusService::normalizeStatus($schedule['status'] ?? null) !== 'approved'
                || !self::occursOn($schedule, $date)) {
                continue;
            }
            $start = (string) $schedule['time_start'];
            $end = (string) $schedule['time_end'];
            if (!preg_match('/^\d{2}:\d{2}:\d{2}$/', $start) || !preg_match('/^\d{2}:\d{2}:\d{2}$/', $end) || $end <= $start) {
                continue;
            }
            $futureToday = $futureToday || $time < $start;
            $endedToday = $endedToday || $time >= $end;
            if ($time < $start || $time >= $end) {
                continue;
            }

            $isOverride = strtolower(trim((string) $schedule['status'])) === 'overridden'
                || strtolower(trim((string) ($schedule['schedule_kind'] ?? 'regular'))) === 'override';
            if (!$isOverride) {
                return $this->grant('regular', (int) $schedule['schedule_id'], null);
            }
            if ($override === null) {
                $overrideId = $this->approvedOverrideId($userId, $date . ' ' . $start, $date . ' ' . $end);
                if ($overrideId !== null) {
                    $override = ['schedule_id' => (int) $schedule['schedule_id'], 'override_id' => $overrideId];
                }
            }
        }

        if ($override !== null) {
            return $this->grant('override', $override['schedule_id'], $override['override_id']);
        }

        $reason = $futureToday ? 'schedule_not_started' : ($endedToday ? 'expired_schedule' : 'no_schedule');
        return [
            'granted' => false,
            'reason' => $reason,
            'message' => match ($reason) {
                'schedule_not_started' => 'The approved access schedule has not started yet.',
                'expired_schedule' => 'The approved access schedule has already ended.',
                default => 'There is no current approved access schedule for this account.',
            },
            'schedule_id' => null,
            'override_id' => null,
            'schedule_kind' => null,
        ];
    }

    /**
     * The user's open session today: their latest granted access is an IN
     * (they entered and have not exited). Returns that IN log, or null.
     */
    public function openSession(int $userId, DateTimeImmutable $now): ?array
    {
        if (!$this->hasAccessType()) {
            return null;
        }
        $now = $now->setTimezone(new DateTimeZone('Asia/Manila'));
        $statement = $this->pdo->prepare(
            "SELECT log_id, schedule_id, override_id, access_type FROM access_log
             WHERE user_id = ? AND access_status = 'granted'
               AND access_timestamp >= ? AND access_timestamp <= ?
             ORDER BY access_timestamp DESC, log_id DESC LIMIT 1"
        );
        $statement->execute([$userId, $now->format('Y-m-d 00:00:00'), $now->format('Y-m-d H:i:s')]);
        $last = $statement->fetch(PDO::FETCH_ASSOC);
        return $last && strtoupper((string) $last['access_type']) === 'IN' ? $last : null;
    }

    /**
     * Exit (OUT) details. Exit is never refused for a schedule reason: whoever
     * is inside must always be able to leave. The exit is linked to the
     * session the user entered on; when that schedule has already ended the
     * exit is EXTENDED and the extra minutes are reported.
     *
     * @return array{message: string, schedule_id: ?int, override_id: ?int,
     *     schedule_kind: ?string, extended: bool, extended_minutes: int, scheduled_end: ?string}
     */
    public function exitContext(int $userId, DateTimeImmutable $now): array
    {
        $now = $now->setTimezone(new DateTimeZone('Asia/Manila'));
        $context = [
            'message' => 'Exit recorded.',
            'schedule_id' => null,
            'override_id' => null,
            'schedule_kind' => null,
            'extended' => false,
            'extended_minutes' => 0,
            'scheduled_end' => null,
        ];

        $session = $this->openSession($userId, $now);
        $scheduleId = $session !== null ? (int) ($session['schedule_id'] ?? 0) : 0;
        $overrideId = $session !== null && $session['override_id'] !== null ? (int) $session['override_id'] : null;
        if ($scheduleId <= 0) {
            // No linked entry: fall back to a schedule that is valid right now.
            $current = $this->evaluate($userId, $now);
            if (!$current['granted']) {
                return $context;
            }
            $scheduleId = (int) $current['schedule_id'];
            $overrideId = $current['override_id'];
        }

        $statement = $this->pdo->prepare('SELECT * FROM schedules WHERE schedule_id = ? AND user_id = ?');
        $statement->execute([$scheduleId, $userId]);
        $schedule = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$schedule) {
            return $context;
        }
        $isOverride = strtolower(trim((string) $schedule['status'])) === 'overridden'
            || strtolower(trim((string) ($schedule['schedule_kind'] ?? 'regular'))) === 'override';
        $context['schedule_id'] = $scheduleId;
        $context['override_id'] = $overrideId;
        $context['schedule_kind'] = $isOverride ? 'override' : 'regular';

        $end = (string) $schedule['time_end'];
        if (preg_match('/^\d{2}:\d{2}:\d{2}$/', $end)) {
            $endAt = new DateTimeImmutable($now->format('Y-m-d') . ' ' . $end, new DateTimeZone('Asia/Manila'));
            $context['scheduled_end'] = $endAt->format('g:i A');
            if ($now > $endAt) {
                $minutes = max(1, intdiv($now->getTimestamp() - $endAt->getTimestamp() + 59, 60));
                $context['extended'] = true;
                $context['extended_minutes'] = $minutes;
                $context['message'] = 'Exit recorded as EXTENDED access: ' . $minutes . ' min after the '
                    . $context['scheduled_end'] . ' schedule end.';
                return $context;
            }
        }
        $context['message'] = 'Exit recorded within the ' . strtoupper($context['schedule_kind']) . ' schedule.';
        return $context;
    }

    /** Response and log fields of an exit decision. */
    public static function exitFields(array $exit): array
    {
        return [
            'schedule_id' => $exit['schedule_id'],
            'override_id' => $exit['override_id'],
            'schedule_kind' => $exit['schedule_kind'],
            'extended' => $exit['extended'],
            'extended_minutes' => $exit['extended_minutes'],
            'scheduled_end' => $exit['scheduled_end'],
        ];
    }

    private ?bool $hasAccessType = null;

    private function hasAccessType(): bool
    {
        return $this->hasAccessType ??= (bool) $this->pdo->query("SHOW COLUMNS FROM access_log LIKE 'access_type'")->fetch();
    }

    public static function occursOn(array $schedule, string $date): bool
    {
        if (($schedule['schedule_type'] ?? null) === 'single') {
            return (string) $schedule['schedule_date'] === $date;
        }
        if (($schedule['schedule_type'] ?? null) !== 'recurring' || empty($schedule['start_date']) || empty($schedule['end_date'])
            || $date < $schedule['start_date'] || $date > $schedule['end_date']) {
            return false;
        }
        $day = (new DateTimeImmutable($date, new DateTimeZone('Asia/Manila')))->format('l');
        if ($schedule['repeat_type'] === 'daily') {
            return true;
        }
        if ($schedule['repeat_type'] === 'weekly') {
            $named = trim((string) ($schedule['repeat_day'] ?? ''));
            $expected = $named !== '' ? $named : (new DateTimeImmutable($schedule['start_date'], new DateTimeZone('Asia/Manila')))->format('l');
            return strcasecmp($day, $expected) === 0;
        }
        if ($schedule['repeat_type'] === 'weekly_selected') {
            $days = json_decode((string) ($schedule['repeat_days'] ?? '[]'), true);
            if (is_array($days)) {
                foreach ($days as $selected) {
                    if (is_string($selected) && strcasecmp($day, $selected) === 0) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /** The override schedule and its approved request must both still exist. */
    private function approvedOverrideId(int $userId, string $start, string $end): ?int
    {
        $approval = $this->pdo->prepare(
            'SELECT override_id FROM access_overrides
             WHERE user_id = ? AND approved_by IS NOT NULL
               AND override_start = ? AND override_end = ?
             ORDER BY override_id ASC LIMIT 1 FOR SHARE'
        );
        $approval->execute([$userId, $start, $end]);
        $overrideId = $approval->fetchColumn();
        return $overrideId ? (int) $overrideId : null;
    }

    private function grant(string $kind, int $scheduleId, ?int $overrideId): array
    {
        return [
            'granted' => true,
            'reason' => 'access_granted',
            'message' => $kind === 'regular'
                ? 'Access granted for the current REGULAR schedule.'
                : 'Access granted for the current OVERRIDE schedule.',
            'schedule_id' => $scheduleId,
            'override_id' => $overrideId,
            'schedule_kind' => $kind,
        ];
    }
}
