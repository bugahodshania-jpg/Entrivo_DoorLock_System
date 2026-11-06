// Live door access feed for the Super Admin "Access Status" modal.
// The first read only sets a cursor (no popup for old rows). Each later read
// asks for log_id > cursor, so every new access attempt appears exactly once.

export const ACCESS_STATUS_POLL_MS = 500;
export const ACCESS_STATUS_TIMEOUT_MS = 4000;
export const ACCESS_STATUS_QUEUE_LIMIT = 10;

const DENIAL_REASONS = {
  not_registered: 'This credential is not registered to any user.',
  invalid_rfid: 'The RFID card is invalid, inactive, or not assigned.',
  invalid_fingerprint: 'The fingerprint could not be verified for this user.',
  no_schedule: 'The user has no schedule for this time.',
  expired_schedule: 'The user\'s schedule has already ended.',
  schedule_not_started: 'The user\'s schedule has not started yet.',
  unauthorized: 'The user is not authorized to use this door.',
  offline: 'The door controller could not reach the backend.',
};

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  faculty: 'Faculty',
  staff: 'Staff',
  student: 'Student',
};

export function describeAccessEvent(event) {
  const granted = event?.status === 'granted';
  const isExit = event?.direction === 'exit';
  const method = event?.method === 'RFID' ? 'RFID card' : event?.method === 'Override' ? 'Override' : 'Fingerprint';
  let credential = '';
  if (event?.method === 'RFID' && event?.rfidUid) credential = `Card UID ${event.rfidUid}`;
  else if (event?.method === 'Fingerprint' && Number.isInteger(event?.matchedSlot)) {
    credential = `Sensor slot ${event.matchedSlot}`
      + (Number.isInteger(event?.matchConfidence) ? ` · confidence ${event.matchConfidence}` : '');
  }
  return {
    tone: granted ? 'granted' : 'denied',
    title: granted ? (isExit ? 'Exit Granted' : 'Access Granted') : (isExit ? 'Exit Denied' : 'Access Denied'),
    person: String(event?.userName || '').trim() || 'Unknown user',
    role: ROLE_LABELS[event?.userRole] || (event?.userRole ? String(event.userRole) : ''),
    identifier: String(event?.userIdentifier || '').trim(),
    method,
    direction: isExit ? 'Exit' : 'Entry',
    credential,
    when: [event?.date, event?.time].filter(Boolean).join(' · '),
    reason: granted ? '' : (DENIAL_REASONS[event?.denialReason] || 'Access was denied by the backend.'),
  };
}

function validEvent(event) {
  return event && typeof event === 'object' && Number.isInteger(event.id) && event.id > 0
    && ['granted', 'denied'].includes(event.status);
}

/** Serialized polling with a log_id cursor; independent of React so it can be tested. */
export function createAccessStatusPoller({ actorId, client, onEvents, onDoors, onError, now = () => performance.now() }) {
  let cursor = null; // null until the baseline read succeeds
  let pending = null;
  let disposed = false;
  let controller = null;

  function poll() {
    if (disposed || !actorId) return Promise.resolve();
    if (pending) return pending;
    const requestController = new AbortController();
    controller = requestController;
    const startedAt = now();
    pending = Promise.resolve()
      .then(() => client.get('/api/access_status_live.php', {
        params: { actor_id: actorId, after_id: cursor ?? 0, _t: Date.now() },
        signal: requestController.signal,
        timeout: ACCESS_STATUS_TIMEOUT_MS,
      }))
      .then((response) => {
        if (disposed || requestController.signal.aborted) return;
        const data = response?.data;
        if (data?.success !== true) throw new Error(data?.message || 'Access status unavailable');
        if (Array.isArray(data.doors)) onDoors?.(data.doors, startedAt);
        const latestId = Number(data.latest_id) || 0;
        if (cursor === null) {
          cursor = latestId; // baseline: never pop up history
          onError?.('');
          return;
        }
        const events = (Array.isArray(data.events) ? data.events : []).filter(validEvent)
          .filter((event) => event.id > cursor)
          .sort((left, right) => left.id - right.id);
        if (events.length) {
          cursor = events[events.length - 1].id;
          onEvents?.(events);
        } else if (latestId < cursor) {
          cursor = latestId; // table was cleared/reset
        }
        onError?.('');
      })
      .catch((error) => {
        if (disposed || requestController.signal.aborted) return;
        onError?.(error?.message || 'Access status unavailable');
      })
      .finally(() => {
        pending = null;
        controller = null;
      });
    return pending;
  }

  return {
    poll,
    getCursor: () => cursor,
    dispose() {
      disposed = true;
      controller?.abort();
    },
  };
}
