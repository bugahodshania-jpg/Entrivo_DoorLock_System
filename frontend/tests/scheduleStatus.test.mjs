import test from 'node:test';
import assert from 'node:assert/strict';
import { findScheduleConflicts, formatScheduleStatusLabel, getScheduleKind } from '../src/utils/scheduleCalendar.js';
import {
  canCreateOverrideFromSchedule,
  isScheduleOverridden,
  mergeOverrideCreateIntoList,
} from '../src/utils/overrideSchedule.js';

test('regular and override schedules share the Approved lifecycle status', () => {
  assert.equal(formatScheduleStatusLabel('approved'), 'Approved');
  assert.equal(getScheduleKind({ status: 'approved', scheduleKind: 'regular' }), 'regular');
  assert.equal(getScheduleKind({ status: 'approved', scheduleKind: 'override' }), 'override');
});

test('older overridden records display as approved override access', () => {
  assert.equal(formatScheduleStatusLabel('overridden'), 'Approved');
  assert.equal(getScheduleKind({ status: 'overridden', scheduleKind: 'regular' }), 'override');
});

test('terminal statuses preserve their meaning and schedule type', () => {
  assert.equal(formatScheduleStatusLabel('cancelled'), 'Cancelled');
  assert.equal(formatScheduleStatusLabel('completed'), 'Completed');
  assert.equal(getScheduleKind({ status: 'cancelled', scheduleKind: 'override' }), 'override');
});

test('an overlapping override keeps the regular row and stamps it', () => {
  const regular = { id: 1, status: 'approved', scheduleKind: 'regular', overriddenByScheduleId: 9, isOverridden: true };
  const created = { id: 9, status: 'approved', scheduleKind: 'override' };
  assert.equal(getScheduleKind(regular), 'regular');
  assert.equal(isScheduleOverridden(regular), true);
  assert.equal(isScheduleOverridden(created), false);
  assert.equal(canCreateOverrideFromSchedule(regular), true);
  assert.equal(canCreateOverrideFromSchedule(created), false);
  assert.deepEqual(
    mergeOverrideCreateIntoList([regular], { schedule: created, affectedSchedules: [{ ...regular, isOverridden: true }] }).map((row) => row.id),
    [9, 1],
  );
});

test('regular schedules conflict with any person on the same date and time, and an approved override may overlap one regular schedule', () => {
  const existing = [
    {
      id: 1,
      userId: 4,
      status: 'approved',
      scheduleKind: 'regular',
      scheduleDate: '2026-10-23',
      timeStart: '08:00',
      timeEnd: '10:00',
      timeStartLabel: '08:00 AM',
      timeEndLabel: '10:00 AM',
      ownerName: 'Ana Cruz',
    },
    {
      id: 2,
      userId: 4,
      status: 'approved',
      scheduleKind: 'override',
      scheduleDate: '2026-10-24',
      timeStart: '13:00',
      timeEnd: '14:00',
      ownerName: 'Ana Cruz',
    },
  ];

  const regularClash = findScheduleConflicts(existing, {
    userId: 4,
    scheduleKind: 'regular',
    timeStart: '09:00',
    timeEnd: '11:00',
    dates: ['2026-10-23'],
  });
  assert.deepEqual(regularClash.conflicts, ['2026-10-23']);
  assert.deepEqual(regularClash.validDates, []);

  const otherPerson = findScheduleConflicts(existing, {
    userId: 9,
    scheduleKind: 'regular',
    timeStart: '09:30',
    timeEnd: '10:30',
    dates: ['2026-10-23'],
  });
  assert.deepEqual(otherPerson.conflicts, ['2026-10-23']);
  assert.equal(otherPerson.conflictDetails[0].ownerName, 'Ana Cruz');

  const regularOverOverride = findScheduleConflicts([
    {
      id: 3,
      userId: 8,
      status: 'approved',
      scheduleKind: 'override',
      scheduleDate: '2026-10-23',
      timeStart: '09:00',
      timeEnd: '10:00',
      ownerName: 'Luis Reyes',
    },
  ], {
    userId: 4,
    scheduleKind: 'regular',
    timeStart: '09:15',
    timeEnd: '09:45',
    dates: ['2026-10-23'],
  });
  assert.deepEqual(regularOverOverride.conflicts, ['2026-10-23']);

  const touching = findScheduleConflicts(existing, {
    userId: 4,
    scheduleKind: 'regular',
    timeStart: '10:00',
    timeEnd: '11:00',
    dates: ['2026-10-23'],
  });
  assert.deepEqual(touching.conflicts, []);

  const overrideOverRegular = findScheduleConflicts(existing, {
    userId: 4,
    scheduleKind: 'override',
    timeStart: '09:00',
    timeEnd: '11:00',
    dates: ['2026-10-23'],
  });
  assert.deepEqual(overrideOverRegular.conflicts, []);

  const overrideClash = findScheduleConflicts(existing, {
    userId: 4,
    scheduleKind: 'override',
    timeStart: '13:30',
    timeEnd: '15:00',
    dates: ['2026-10-24'],
    excludeId: 9,
  });
  assert.deepEqual(overrideClash.conflicts, ['2026-10-24']);
});
