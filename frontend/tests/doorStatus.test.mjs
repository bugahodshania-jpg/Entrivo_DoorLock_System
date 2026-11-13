import test from 'node:test';
import assert from 'node:assert/strict';
import { doorStatusView } from '../src/utils/doorStatus.js';

const report = (state = 'locked') => ({
  device_id: 1, device_name: 'Enrollment Station', state, online: true,
  can_read_sensor: state === 'locked', expires_in_ms: 15000,
});

test('only a recent explicitly confirmed locked state enables reads', () => {
  assert.equal(doorStatusView(report(), 14999).canReadSensor, true);
  const unlocked = doorStatusView(report('unlocked'));
  assert.equal(unlocked.label, 'Unlocked');
  assert.equal(unlocked.canReadSensor, false);
  assert.match(unlocked.readBlockedReason, /Lock the door/);
  assert.equal(doorStatusView({ ...report(), can_read_sensor: false }).canReadSensor, false);
});

test('expiry, a missing report, and offline status never show a locked door', () => {
  for (const result of [doorStatusView(report(), 15000), doorStatusView(null),
    doorStatusView({ ...report(), online: false }), doorStatusView({ ...report(), expires_in_ms: undefined }),
    doorStatusView({ ...report(), state: 'invalid' })]) {
    assert.equal(result.label, 'Unavailable');
    assert.equal(result.canReadSensor, false);
  }
});

test('elapsed time includes time spent fetching a snapshot', () => {
  const result = doorStatusView({ ...report(), expires_in_ms: 250 }, 300);
  assert.equal(result.canReadSensor, false);
  assert.equal(result.state, 'unknown');
});

test('the time of the last controller report is shown as Manila time, without re-zoning', () => {
  const at = (received_at) => doorStatusView({ ...report(), received_at }).updatedAt;
  assert.equal(at('2026-11-11 22:08:29.343000'), '10:08:29 PM');
  assert.equal(at('2026-11-11 00:05:01'), '12:05:01 AM');
  assert.equal(at('2026-11-11 12:00:00'), '12:00:00 PM');
  assert.equal(at(null), '');
  assert.equal(doorStatusView(null).updatedAt, '');
});

test('the person using the door is shown only while it is unlocked', () => {
  const occupant = { name: 'Ana Cruz', role: 'faculty', access_type: 'regular' };
  assert.deepEqual(doorStatusView({ ...report('unlocked'), occupant }).occupant, occupant);
  assert.equal(doorStatusView({ ...report('locked'), occupant }).occupant, null);
  assert.equal(doorStatusView({ ...report('unlocked'), occupant }, 15000).occupant, null, 'an expired report hides it');
  assert.equal(doorStatusView(report('unlocked')).occupant, null);
});
