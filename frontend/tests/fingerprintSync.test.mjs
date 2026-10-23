import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSyncCancellationEventKey,
  getSyncCancellationNoticeMessage,
  getSyncCancellationReason,
  getSyncJobStatus,
  getSyncPickupRemainingSeconds,
  getUnseenSyncPickupTimeouts,
} from '../src/utils/fingerprintSync.js';

const timedOutJob = {
  queue_id: 42,
  status: 'failed',
  is_cancelled: true,
  cancellation_reason: 'pickup_timeout',
  queued_at: '2026-10-21 10:00:00',
  updated_at: '2026-10-21 10:05:00',
};

test('timeout cancellations display separately from controller sync failures', () => {
  assert.equal(getSyncJobStatus(timedOutJob), 'cancelled');
  assert.equal(getSyncJobStatus({ status: 'failed', is_cancelled: false }), 'failed');
  assert.equal(getSyncJobStatus({ status: 'failed', is_cancelled: '0' }), 'failed');
  assert.equal(getSyncJobStatus({ ...timedOutJob, status: 'pending' }), 'pending');
});

test('polling and reloads suppress the same timeout while a retried queue can notify again', () => {
  const seen = new Set([getSyncCancellationEventKey(timedOutJob)]);
  assert.deepEqual(getUnseenSyncPickupTimeouts([timedOutJob], seen), []);
  assert.deepEqual(getUnseenSyncPickupTimeouts([{ ...timedOutJob, updated_at: '2026-10-21 10:06:00' }], seen), []);

  const retry = { ...timedOutJob, queued_at: '2026-10-21 10:10:00', updated_at: '2026-10-21 10:15:00' };
  assert.deepEqual(getUnseenSyncPickupTimeouts([retry, retry], seen), [retry]);
});

test('first page load catches timeout cancellations without notifying for manual cancellation or claimed jobs', () => {
  const manual = { ...timedOutJob, queue_id: 43, cancellation_reason: 'manual' };
  const syncing = { ...timedOutJob, queue_id: 44, status: 'syncing' };
  assert.deepEqual(getUnseenSyncPickupTimeouts([timedOutJob, manual, syncing], new Set()), [timedOutJob]);
});

test('the modal preserves the server reason and uses cautious fallback connection wording', () => {
  const reason = 'The registered door controller is inactive. Activate it, then retry.';
  assert.equal(getSyncCancellationReason({ ...timedOutJob, error_message: reason }), reason);
  assert.match(getSyncCancellationReason({ ...timedOutJob, controller_issue: 'not_registered' }), /No door controller is registered/);
  assert.match(getSyncCancellationReason({ ...timedOutJob, controller_issue: 'inactive' }), /door controller is inactive/);
  assert.match(getSyncCancellationReason(timedOutJob), /may be disconnected or unreachable/);
  assert.match(getSyncCancellationNoticeMessage([{ ...timedOutJob, user_name: 'Test User', error_message: reason }]), /Queue #42 \(Test User\): The registered/);
});

test('multiple simultaneous timeouts share a notice without repeating identical reasons', () => {
  const message = getSyncCancellationNoticeMessage([timedOutJob, { ...timedOutJob, queue_id: 43 }]);
  assert.match(message, /2 sync jobs were cancelled \(queues #42, #43\)/);
  assert.equal(message.match(/No door controller picked up/g)?.length, 1);
});

test('the pickup countdown uses the Manila queue timestamp and the existing five-minute deadline', () => {
  const pending = { ...timedOutJob, status: 'pending' };
  assert.equal(getSyncPickupRemainingSeconds(pending, Date.parse('2026-10-21T02:00:00Z')), 300);
  assert.equal(getSyncPickupRemainingSeconds(pending, Date.parse('2026-10-21T02:01:01.200Z')), 239);
  assert.equal(getSyncPickupRemainingSeconds(pending, Date.parse('2026-10-21T02:04:59.999Z')), 1);
  assert.equal(getSyncPickupRemainingSeconds({ ...pending, queued_at: '2026-10-21T02:00:00Z' }, Date.parse('2026-10-21T02:01:01.200Z')), 239);
});

test('the countdown clamps at zero and never exceeds five minutes if clocks differ', () => {
  const pending = { ...timedOutJob, status: 'pending' };
  assert.equal(getSyncPickupRemainingSeconds(pending, Date.parse('2026-10-21T02:05:00Z')), 0);
  assert.equal(getSyncPickupRemainingSeconds(pending, Date.parse('2026-10-21T03:00:00Z')), 0);
  assert.equal(getSyncPickupRemainingSeconds(pending, Date.parse('2026-10-21T01:59:50Z')), 300);
});

test('a claimed or finished job and an invalid queue timestamp have no pickup countdown', () => {
  const now = Date.parse('2026-10-21T02:01:00Z');
  for (const status of ['syncing', 'synced', 'failed', 'cancelled']) {
    assert.equal(getSyncPickupRemainingSeconds({ ...timedOutJob, status }, now), null);
  }
  assert.equal(getSyncPickupRemainingSeconds({ status: 'pending', queued_at: '' }, now), null);
  assert.equal(getSyncPickupRemainingSeconds({ status: 'pending', queued_at: 'invalid' }, now), null);
  assert.equal(getSyncPickupRemainingSeconds({ status: 'pending', queued_at: timedOutJob.queued_at }, Number.NaN), null);
});

test('reopening or retrying the same queue uses its timestamp instead of restarting a local timer', () => {
  const pending = { ...timedOutJob, status: 'pending' };
  const now = Date.parse('2026-10-21T02:04:00Z');
  assert.equal(getSyncPickupRemainingSeconds(pending, now), 60);
  assert.equal(getSyncPickupRemainingSeconds({ ...pending }, now), 60);
  assert.equal(getSyncPickupRemainingSeconds({ ...pending, queued_at: '2026-10-21 10:03:00' }, now), 240);
});
