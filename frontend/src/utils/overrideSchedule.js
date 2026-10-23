import { getScheduleKind } from './scheduleCalendar.js';

export function isScheduleOverridden(schedule) {
  if (getScheduleKind(schedule) !== 'regular') {
    return false;
  }

  return Boolean(schedule?.isOverridden || Number(schedule?.overriddenByScheduleId) > 0);
}

export function canCreateOverrideFromSchedule(schedule) {
  if (!schedule || getScheduleKind(schedule) !== 'regular') {
    return false;
  }

  return !['cancelled', 'completed', 'expired'].includes(String(schedule.status || '').toLowerCase());
}

export function mergeOverrideCreateIntoList(schedules, data) {
  const created = data?.schedule;
  const affectedById = new Map((data?.affectedSchedules || []).map((schedule) => [schedule.id, schedule]));
  const next = (schedules || []).map((schedule) => affectedById.get(schedule.id) || schedule);

  if (created && !next.some((schedule) => schedule.id === created.id)) {
    return [created, ...next];
  }

  return next;
}
