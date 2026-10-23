import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOverrideNotificationPoller,
  OVERRIDE_NOTIFICATION_TIMEOUT_MS,
} from '../src/utils/overrideNotificationPoller.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function notice(id) {
  return { id, requesterName: 'Alex Santos', affectedSchedules: [] };
}

function response(...notices) {
  return { data: { notifications: notices } };
}

function setup(client) {
  const states = [];
  const discovered = [];
  const acknowledged = [];
  const poller = createOverrideNotificationPoller({
    userId: '42',
    client,
    onChange: (state) => states.push(state),
    onNewNotifications: (notices) => discovered.push(notices.map(({ id }) => id)),
    onAcknowledged: (id) => acknowledged.push(id),
  });
  return { poller, states, discovered, acknowledged };
}

test('overlapping refreshes serialize requests and collapse into one follow-up', async () => {
  const first = deferred();
  const second = deferred();
  const calls = [];
  const { poller } = setup({
    get: (...args) => {
      calls.push(args);
      return calls.length === 1 ? first.promise : second.promise;
    },
  });
  const pending = poller.poll();
  poller.poll();
  poller.poll();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/notifications.php');
  assert.deepEqual(calls[0][1].params, { user_id: '42' });
  assert.equal(calls[0][1].timeout, OVERRIDE_NOTIFICATION_TIMEOUT_MS);
  first.resolve(response(notice(1)));
  await pending;
  await Promise.resolve();
  assert.equal(calls.length, 2);
  second.resolve(response(notice(2)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.deepEqual(poller.snapshot().notifications.map(({ id }) => id), [2]);
  poller.dispose();
});

test('network failures and malformed responses preserve queued notices, then recover', async () => {
  let nextResponse = response(notice(1));
  const { poller } = setup({ get: async () => {
    if (nextResponse instanceof Error) throw nextResponse;
    return nextResponse;
  } });
  await poller.poll();
  nextResponse = new Error('offline');
  await poller.poll();
  assert.deepEqual(poller.snapshot().notifications.map(({ id }) => id), [1]);
  assert.match(poller.snapshot().error, /Retrying automatically/);
  nextResponse = { data: {} };
  await poller.poll();
  assert.deepEqual(poller.snapshot().notifications.map(({ id }) => id), [1]);
  nextResponse = response(notice(1), notice(2));
  await poller.poll();
  assert.equal(poller.snapshot().error, '');
  assert.deepEqual(poller.snapshot().notifications.map(({ id }) => id), [1, 2]);
});

test('duplicate polls only announce newly discovered notification IDs', async () => {
  let nextResponse = response(notice(1), notice(1));
  const { poller, discovered } = setup({ get: async () => nextResponse });
  await poller.poll();
  await poller.poll();
  nextResponse = response(notice('1'), notice(2));
  await poller.poll();
  nextResponse = response();
  await poller.poll();
  nextResponse = response(notice(1), notice(2));
  await poller.poll();
  assert.deepEqual(discovered, [[1], [2]]);
});

test('acknowledgement is explicit, deduplicated, and survives an older GET response', async () => {
  const staleRead = deferred();
  const ack = deferred();
  const posts = [];
  let reads = 0;
  const { poller, acknowledged } = setup({
    get: async () => ++reads === 1 ? response(notice(1), notice(2)) : staleRead.promise,
    post: (...args) => { posts.push(args); return ack.promise; },
  });
  await poller.poll();
  assert.equal(posts.length, 0);
  const pendingRead = poller.poll();
  const pendingAck = poller.acknowledge(1);
  assert.equal(poller.acknowledge(1), pendingAck);
  assert.equal(poller.snapshot().isAcknowledging, true);
  await Promise.resolve();
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0][1], { action: 'acknowledge', user_id: '42', id: 1 });
  ack.resolve({ data: { acknowledged: true } });
  assert.equal(await pendingAck, true);
  assert.deepEqual(acknowledged, ['1']);
  staleRead.resolve(response(notice(1), notice(2)));
  await pendingRead;
  assert.deepEqual(poller.snapshot().notifications.map(({ id }) => id), [2]);
  assert.equal(poller.snapshot().isAcknowledging, false);
});

test('failed acknowledgements keep the notice and retry error through successful polls', async () => {
  let shouldFail = true;
  const { poller } = setup({
    get: async () => response(notice(1)),
    post: async () => {
      if (shouldFail) throw new Error('offline');
      return { data: { acknowledged: true } };
    },
  });
  await poller.poll();
  assert.equal(await poller.acknowledge(1), false);
  await poller.poll();
  assert.equal(poller.snapshot().notifications.length, 1);
  assert.match(poller.snapshot().error, /Please try again/);
  shouldFail = false;
  assert.equal(await poller.acknowledge(1), true);
  assert.equal(poller.snapshot().notifications.length, 0);
  assert.equal(poller.snapshot().error, '');
});

test('a successful HTTP response without acknowledgement cannot dismiss a notice', async () => {
  const { poller, acknowledged } = setup({
    get: async () => response(notice(1)),
    post: async () => ({ data: { success: true } }),
  });
  await poller.poll();
  assert.equal(await poller.acknowledge(1), false);
  assert.equal(poller.snapshot().notifications.length, 1);
  assert.deepEqual(acknowledged, []);
});

test('disposal cancels reads and acknowledgements and ignores late responses', async () => {
  const pendingRead = deferred();
  const pendingAck = deferred();
  let reads = 0;
  let readSignal;
  let ackSignal;
  const { poller, states, discovered, acknowledged } = setup({
    get: async (_url, config) => {
      readSignal = config.signal;
      return ++reads === 1 ? response(notice(1)) : pendingRead.promise;
    },
    post: async (_url, _body, config) => {
      ackSignal = config.signal;
      return pendingAck.promise;
    },
  });
  await poller.poll();
  const read = poller.poll();
  const ack = poller.acknowledge(1);
  await Promise.resolve();
  const stateCount = states.length;
  poller.dispose();
  assert.equal(readSignal.aborted, true);
  assert.equal(ackSignal.aborted, true);
  pendingRead.resolve(response(notice(2)));
  pendingAck.resolve({ data: { acknowledged: true } });
  await read;
  assert.equal(await ack, false);
  await poller.poll();
  assert.equal(states.length, stateCount);
  assert.equal(reads, 2);
  assert.deepEqual(discovered, [[1]]);
  assert.deepEqual(acknowledged, []);
});
