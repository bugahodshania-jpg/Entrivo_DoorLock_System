// Live door access feed for the Super Admin "Access Status" modal.
// The first read only sets a cursor (no popup for old rows). Each later read
// asks for log_id > cursor, so every new access attempt appears exactly once.

export const ACCESS_STATUS_POLL_MS = 500;
export const ACCESS_STATUS_TIMEOUT_MS = 4000;
export const ACCESS_STATUS_QUEUE_LIMIT = 10;
// From this many failed attempts in a row by the same person, administrators
// get a Security Warning (at the 3rd, the 4th, and every one after).
export const FAILED_ATTEMPT_ALERT_AT = 3;

export function isFailedAttemptAlert(event) {
  return event?.status === 'denied' && Number(event?.failedAttempts) >= FAILED_ATTEMPT_ALERT_AT;
}

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

// How a granted access happened (backend AccessEventType).
const ACCESS_TYPE_LABELS = {
  regular: 'Regular schedule',
  override: 'Approved override',
  admin_override: 'Admin permanent override',
  super_admin_override: 'Super Admin permanent override',
  emergency_card: 'Emergency card',
  exit: 'Exit',
  no_schedule: 'No schedule',
};

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  faculty: 'Faculty',
  staff: 'Staff',
  student: 'Student',
};

// '08:00:00' -> '8:00 AM'
function formatClock(value) {
  const match = /^(\d{2}):(\d{2})/.exec(String(value || ''));
  if (!match) return '';
  const hours = Number(match[1]);
  return `${hours % 12 || 12}:${match[2]} ${hours < 12 ? 'AM' : 'PM'}`;
}

/**
 * The person's approved schedules on the day of the attempt, one line each,
 * e.g. "8:00 AM – 10:00 AM · Regular (used)". Empty for unregistered scans.
 */
export function describeSchedules(event) {
  if (!event?.userId) return [];
  const schedules = Array.isArray(event?.schedules) ? event.schedules : [];
  if (!schedules.length) return ['No approved schedule this day'];
  return schedules.map((schedule) => {
    const window = [formatClock(schedule?.time_start), formatClock(schedule?.time_end)].filter(Boolean).join(' – ');
    const kind = schedule?.kind === 'override' ? 'Override' : 'Regular';
    const used = event?.status === 'granted' && Number(schedule?.schedule_id) === Number(event?.scheduleId) ? ' (used)' : '';
    return `${window} · ${kind}${used}`;
  });
}

function denialText(event) {
  // A refused student card is almost always "no instructor inside yet".
  if (event?.denialReason === 'unauthorized' && event?.method === 'RFID' && event?.userRole === 'student'
    && event?.direction !== 'exit') {
    return 'Students can enter only after a faculty member, staff member, or administrator has entered the room.';
  }
  return DENIAL_REASONS[event?.denialReason] || 'Access was denied by the backend.';
}

export function describeAccessEvent(event) {
  const granted = event?.status === 'granted';
  const isExit = event?.direction === 'exit';
  const method = event?.method === 'RFID' ? 'RFID card' : event?.method === 'Override' ? 'Override' : 'Fingerprint';
  // No linked user: a card or finger that is not registered to anyone.
  const unregistered = !granted && !event?.userId && !String(event?.userName || '').trim();
  let credential = '';
  if (event?.method === 'RFID' && event?.rfidUid) {
    credential = `Card UID ${event.rfidUid}` + (unregistered ? ' (not registered)' : '');
  } else if (event?.method === 'Fingerprint' && Number.isInteger(event?.matchedSlot)) {
    credential = `Sensor slot ${event.matchedSlot}`
      + (Number.isInteger(event?.matchConfidence) ? ` · confidence ${event.matchConfidence}` : '');
  } else if (event?.method === 'Fingerprint' && unregistered) {
    credential = 'Fingerprint not registered';
  }
  const alert = isFailedAttemptAlert(event);
  const failedAttempts = Number(event?.failedAttempts) || 0;
  return {
    tone: alert ? 'alert' : granted ? 'granted' : 'denied',
    eyebrow: alert ? 'Security Warning' : 'Door Access Status',
    failedAttempts,
    title: alert
      ? `${failedAttempts} Failed Attempts in a Row`
      : granted ? (isExit ? 'Exit Granted' : 'Access Granted') : (isExit ? 'Exit Denied' : 'Access Denied'),
    person: String(event?.userName || '').trim() || (unregistered ? 'Unregistered person' : 'Unknown user'),
    role: ROLE_LABELS[event?.userRole] || (event?.userRole ? String(event.userRole) : ''),
    identifier: String(event?.userIdentifier || '').trim(),
    method,
    direction: isExit ? 'Exit' : 'Entry',
    credential,
    when: [event?.date, event?.time].filter(Boolean).join(' · '),
    accessType: granted ? (ACCESS_TYPE_LABELS[event?.accessType] || '') : '',
    schedules: describeSchedules(event),
    reason: granted ? '' : denialText(event),
    warning: alert
      ? `This person has failed ${failedAttempts} door access attempts in a row within 10 minutes. Check who is at the door.`
      : '',
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
