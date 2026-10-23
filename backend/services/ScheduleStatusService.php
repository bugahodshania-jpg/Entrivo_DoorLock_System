<?php

/** Read-only compatibility for older override schedules; never updates stored data. */
final class ScheduleStatusService
{
    public static function normalizeStatus(?string $status): string
    {
        $value = strtolower(trim((string) $status));
        return $value === 'overridden' ? 'approved' : $value;
    }

    public static function normalizeSchedule(array $schedule): array
    {
        $legacyOverride = strtolower(trim((string) ($schedule['status'] ?? ''))) === 'overridden';
        $kind = strtolower(trim((string) ($schedule['scheduleKind'] ?? $schedule['schedule_kind'] ?? 'regular')));
        $schedule['status'] = self::normalizeStatus($schedule['status'] ?? null);
        $schedule['scheduleKind'] = $legacyOverride || $kind === 'override' ? 'override' : 'regular';
        $overriddenBy = (int) ($schedule['overriddenByScheduleId'] ?? $schedule['overridden_by_schedule_id'] ?? 0);
        $schedule['overriddenByScheduleId'] = $overriddenBy > 0 ? $overriddenBy : null;
        $schedule['isOverridden'] = $overriddenBy > 0 && $schedule['scheduleKind'] === 'regular';
        return $schedule;
    }
}
