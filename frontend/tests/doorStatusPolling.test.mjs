import test from 'node:test';
import assert from 'node:assert/strict';
import { createDoorStatusPoller, DOOR_STATUS_POLL_MS, DOOR_STATUS_TIMEOUT_MS } from '../src/utils/doorStatusPoller.js';
import { doorStatusView } from '../src/utils/doorStatus.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function response(state = 'locked', expiresInMs = 15000) {
  return { data: { success: true, doors: [{
    device_id: 1, device_name: 'Sensor A', state, online: true,
    can_read_sensor: state === 'locked', expires_in_ms: expiresInMs,
  }] } };
}

function setup(client, options = {}) {
  const states = [];
  const poller = createDoorStatusPoller({ actorId: 9, client, onChange: (state) => states.push(state), ...options });
  return { poller, states };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('successive reads update lock, unlock, and relock without replacing the poller', async () => {
  const calls = [];
  let next = response();
  const { poller, states } = setup({ get: async (...args) => { calls.push(args); return next; } });
  assert.ok(DOOR_STATUS_POLL_MS <= 500);
  for (const state of ['locked', 'unlocked', 'locked']) {
    next = response(state);
    await poller.poll();
    assert.equal(doorStatusView(states.at(-1).doors[0]).state, state);
  }
  assert.equal(calls.length, 3);
  assert.equal(calls[0][0], '/api/door_status.php');
  assert.equal(calls[0][1].params.actor_id, 9);
  assert.equal(typeof calls[0][1].params._t, 'number');
  assert.equal(calls[0][1].timeout, DOOR_STATUS_TIMEOUT_MS);
});

test('request latency cannot extend a report beyond its remaining lifetime', async () => {
  let now = 100;
  const slow = deferred();
  const { poller, states } = setup({ get: () => slow.promise }, { now: () => now });
  const pending = poller.poll();
  now = 800;
  slow.resolve(response('locked', 600));
  await pending;
  const snapshot = states.at(-1);
  assert.equal(snapshot.startedAt, 100);
  assert.equal(doorStatusView(snapshot.doors[0], now - snapshot.startedAt).state, 'unknown');
});

test('busy timer ticks never overlap and repeated resume events queue one fresh read', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const { poller, states } = setup({ get: () => ++calls === 1 ? first.promise : second.promise });
  const pending = poller.poll();
  await Promise.resolve();
  for (let i = 0; i < 10; i++) poller.poll();
  first.resolve(response());
  await pending;
  assert.equal(calls, 1);

  const next = poller.poll();
  for (let i = 0; i < 10; i++) poller.poll({ queueIfBusy: true });
  second.resolve(response('unlocked'));
  await next;
  await settle();
  assert.equal(calls, 3);
  assert.equal(states.at(-1).doors[0].state, 'unlocked');
});

test('failures and invalid responses show unavailable and recover automatically on the next read', async () => {
  let next = response();
  const { poller, states } = setup({ get: async () => {
    if (next instanceof Error) throw next;
    return next;
  } });
  for (const failure of [new Error('timeout'), { data: { success: false, doors: [] } },
    { data: { success: true } }, { data: { success: true, doors: [null] } },
    { data: { success: true, doors: [[]] } }]) {
    await poller.poll();
    assert.equal(states.at(-1).doors[0].state, 'locked');
    next = failure;
    await poller.poll();
    assert.equal(states.at(-1), null);
    assert.equal(doorStatusView(states.at(-1)).state, 'unknown');
    next = response();
  }
  await poller.poll();
  assert.equal(states.at(-1).doors[0].state, 'locked');
});

test('hiding or disconnecting aborts a read and a quick return ignores its stale result', async () => {
  const slow = deferred();
  const configs = [];
  const { poller, states } = setup({ get: async (_url, config) => {
    configs.push(config);
    return configs.length === 1 ? slow.promise : response('unlocked');
  } });
  const pending = poller.poll();
  await Promise.resolve();
  poller.setActive(false);
  assert.equal(configs[0].signal.aborted, true);
  assert.equal(states.at(-1), null);
  await poller.poll();
  assert.equal(configs.length, 1);

  poller.setActive(true);
  poller.poll({ queueIfBusy: true });
  poller.poll({ queueIfBusy: true });
  slow.resolve(response('locked'));
  await pending;
  await settle();
  assert.equal(configs.length, 2);
  assert.equal(states.filter(Boolean).length, 1);
  assert.equal(states.at(-1).doors[0].state, 'unlocked');
});

test('an aborted failure cannot erase the status after returning to the page', async () => {
  const slow = deferred();
  let calls = 0;
  const { poller, states } = setup({ get: () => ++calls === 1 ? slow.promise : Promise.resolve(response()) });
  const pending = poller.poll();
  await Promise.resolve();
  poller.setActive(false);
  poller.setActive(true);
  poller.poll({ queueIfBusy: true });
  slow.reject(new Error('cancelled'));
  await pending;
  await settle();
  assert.equal(calls, 2);
  assert.equal(states.at(-1).doors[0].state, 'locked');
});

test('an initially hidden page waits until active and missing accounts never fetch status', async () => {
  let calls = 0;
  const client = { get: async () => { calls++; return response(); } };
  const { poller } = setup(client, { active: false });
  await poller.poll();
  assert.equal(calls, 0);
  poller.setActive(true);
  await poller.poll();
  assert.equal(calls, 1);
  for (const actorId of [null, undefined, '']) {
    await setup(client, { actorId }).poller.poll();
  }
  assert.equal(calls, 1);
});

test('logout or account replacement aborts requests and discards queued and late updates', async () => {
  const slow = deferred();
  let config;
  let calls = 0;
  const { poller, states } = setup({ get: (_url, options) => { calls++; config = options; return slow.promise; } });
  const pending = poller.poll();
  poller.poll({ queueIfBusy: true });
  await Promise.resolve();
  poller.dispose();
  assert.equal(config.signal.aborted, true);
  slow.resolve(response());
  await pending;
  await poller.poll();
  await settle();
  assert.equal(calls, 1);
  assert.deepEqual(states, []);
});
