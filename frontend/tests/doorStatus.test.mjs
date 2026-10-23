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
