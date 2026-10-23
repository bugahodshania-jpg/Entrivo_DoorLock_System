import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCESS_LOG_POLL_MS,
  ACCESS_LOG_TIMEOUT_MS,
  createAccessLogPoller,
} from '../src/utils/accessLogPoller.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function response(id = 1, summary = { totalToday: 1, grantedToday: 1, deniedToday: 0 }) {
  return { data: { accessLogs: [{ id, method: 'RFID', status: 'granted' }], summary } };
}

function setup(client, options = {}) {
  const states = [];
  const poller = createAccessLogPoller({
    client,
    onChange: (state) => states.push(state),
    ...options,
  });
  return { poller, states };
}

test('loads the latest server snapshot and refreshes rows and numeric summary together', async () => {
  const calls = [];
  let updatedAt = 100;
  let nextResponse = response();
  const { poller } = setup({ get: async (...args) => {
    calls.push(args);
    return nextResponse;
  } }, { now: () => updatedAt });

  assert.equal(poller.snapshot().isLoading, true);
  assert.equal(ACCESS_LOG_POLL_MS, 2000);
  await poller.poll();
  assert.equal(calls[0][0], '/api/access_logs.php');
  assert.equal(calls[0][1].timeout, ACCESS_LOG_TIMEOUT_MS);
  assert.equal(poller.snapshot().isLoading, false);
  assert.equal(poller.snapshot().isLive, true);
  assert.equal(poller.snapshot().lastUpdated, 100);

  updatedAt = 200;
  nextResponse = response(2, { totalToday: '3', grantedToday: '2', deniedToday: '1' });
  const pending = poller.poll();
  assert.equal(poller.snapshot().isLoading, false);
  assert.deepEqual(poller.snapshot().accessLogs.map(({ id }) => id), [1]);
  await pending;
  assert.deepEqual(poller.snapshot().accessLogs.map(({ id }) => id), [2]);
  assert.deepEqual(poller.snapshot().summary, { totalToday: 3, grantedToday: 2, deniedToday: 1 });
  assert.equal(poller.snapshot().lastUpdated, 200);
});

test('timer ticks skip overlapping reads and explicit resume queues only one fresh read', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const { poller } = setup({ get: () => ++calls === 1 ? first.promise : second.promise });
  const pending = poller.poll();
  poller.poll();
  poller.poll();
  await Promise.resolve();
  assert.equal(calls, 1);
  first.resolve(response(1));
  await pending;
  assert.equal(calls, 1);

  const secondPending = poller.poll();
  poller.poll({ queueIfBusy: true });
  poller.poll({ queueIfBusy: true });
  poller.poll();
  await Promise.resolve();
  assert.equal(calls, 2);
  second.resolve(response(2));
  await secondPending;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 3);
});

test('temporary failures and malformed responses keep the last successful rows, summary and time', async () => {
  let nextResponse = response();
  const { poller } = setup({ get: async () => {
    if (nextResponse instanceof Error) throw nextResponse;
    return nextResponse;
  } }, { now: () => 123 });
  await poller.poll();
  const successful = poller.snapshot();

  for (const failure of [new Error('offline'), { data: {} }, { data: { accessLogs: [null] } }]) {
    nextResponse = failure;
    await poller.poll();
    assert.deepEqual(poller.snapshot().accessLogs, successful.accessLogs);
    assert.deepEqual(poller.snapshot().summary, successful.summary);
    assert.equal(poller.snapshot().lastUpdated, successful.lastUpdated);
    assert.equal(poller.snapshot().isLoading, false);
    assert.equal(poller.snapshot().isLive, false);
    assert.match(poller.snapshot().errorMessage, /Retrying automatically/);
  }

  nextResponse = { data: { accessLogs: [], summary: { totalToday: 0 } } };
  await poller.poll();
  assert.deepEqual(poller.snapshot().accessLogs, []);
  assert.equal(poller.snapshot().isLive, true);
  assert.equal(poller.snapshot().errorMessage, '');
});

test('an initial failure ends the loading state and a later read recovers', async () => {
  let fail = true;
  const { poller } = setup({ get: async () => {
    if (fail) throw new Error('timeout');
    return response();
  } });
  await poller.poll();
  assert.equal(poller.snapshot().isLoading, false);
  assert.equal(poller.snapshot().isLive, false);
  assert.equal(poller.snapshot().lastUpdated, null);
  fail = false;
  await poller.poll();
  assert.equal(poller.snapshot().isLive, true);
});

test('personal requests include their owner and missing user IDs never issue a request', async () => {
  const calls = [];
  const client = { get: async (...args) => { calls.push(args); return response(); } };
  const missing = setup(client, { personal: true }).poller;
  await missing.poll();
  assert.equal(calls.length, 0);
  assert.equal(missing.snapshot().isLoading, false);

  const personal = setup(client, { personal: true, userId: '42' }).poller;
  await personal.poll();
  assert.equal(calls[0][0], '/api/user_portal.php');
  assert.deepEqual(calls[0][1].params, { action: 'access_logs', user_id: '42' });
});

test('pausing cancels a read and ignores its late result, then resumes with one fresh read', async () => {
  const slow = deferred();
  const calls = [];
  const { poller } = setup({ get: async (_url, config) => {
    calls.push(config);
    return calls.length === 1 ? slow.promise : response(2);
  } });
  const pending = poller.poll();
  await Promise.resolve();
  poller.setActive(false);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(poller.snapshot().isLive, false);
  await poller.poll();
  assert.equal(calls.length, 1);

  poller.setActive(true);
  poller.poll({ queueIfBusy: true });
  slow.resolve(response(1));
  await pending;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.deepEqual(poller.snapshot().accessLogs.map(({ id }) => id), [2]);
  assert.equal(poller.snapshot().isLive, true);
});

test('disposal aborts requests and prevents late responses or queued refreshes updating the view', async () => {
  const slow = deferred();
  const calls = [];
  const { poller, states } = setup({ get: async (_url, config) => {
    calls.push(config);
    return slow.promise;
  } });
  const pending = poller.poll();
  poller.poll({ queueIfBusy: true });
  await Promise.resolve();
  const stateCount = states.length;
  poller.dispose();
  assert.equal(calls[0].signal.aborted, true);
  slow.resolve(response(99));
  await pending;
  await poller.poll();
  assert.equal(states.length, stateCount);
  assert.equal(calls.length, 1);
  assert.deepEqual(poller.snapshot().accessLogs, []);
});
