const ENDPOINT = '/api/notifications.php';
export const OVERRIDE_NOTIFICATION_POLL_MS = 5000;
export const OVERRIDE_NOTIFICATION_TIMEOUT_MS = 10000;

function notificationId(value) {
  return value === undefined || value === null ? '' : String(value);
}

/** Keep polling and acknowledgement races independent of React's render timing. */
export function createOverrideNotificationPoller({
  userId,
  client,
  onChange,
  onNewNotifications = () => {},
  onAcknowledged = () => {},
}) {
  let disposed = false;
  let notifications = [];
  let pollError = '';
  let acknowledgementError = '';
  let pollPromise = null;
  let acknowledgementPromise = null;
  let pollController = null;
  let acknowledgementController = null;
  let refreshQueued = false;
  const acknowledgedIds = new Set();
  const discoveredIds = new Set();

  function snapshot() {
    return {
      notifications,
      isAcknowledging: acknowledgementPromise !== null,
      error: acknowledgementError || pollError,
    };
  }

  function emit() {
    if (!disposed) onChange(snapshot());
  }

  function poll() {
    if (disposed) return Promise.resolve();
    if (pollPromise) {
      // Focus/online events during a request need just one fresh server read.
      refreshQueued = true;
      return pollPromise;
    }

    pollController = new AbortController();
    const controller = pollController;
    pollPromise = Promise.resolve()
      .then(() => {
        if (disposed) return null;
        return client.get(ENDPOINT, {
          params: { user_id: userId },
          signal: controller.signal,
          timeout: OVERRIDE_NOTIFICATION_TIMEOUT_MS,
        });
      })
      .then((response) => {
        if (disposed) return;
        if (!Array.isArray(response?.data?.notifications)) {
          throw new Error('Invalid notification response.');
        }

        const responseIds = new Set();
        const nextNotifications = response.data.notifications.filter((notification) => {
          const id = notificationId(notification?.id);
          if (!id || responseIds.has(id) || acknowledgedIds.has(id)) return false;
          responseIds.add(id);
          return true;
        });
        const newNotifications = nextNotifications.filter((notification) => {
          const id = notificationId(notification.id);
          if (discoveredIds.has(id)) return false;
          discoveredIds.add(id);
          return true;
        });

        notifications = nextNotifications;
        pollError = '';
        emit();
        if (newNotifications.length) onNewNotifications(newNotifications);
      })
      .catch(() => {
        if (disposed) return;
        // Keep notices already on screen through a lost connection or timeout.
        pollError = 'Unable to check for new schedule notices. Retrying automatically.';
        emit();
      })
      .finally(() => {
        pollPromise = null;
        pollController = null;
        if (!disposed && refreshQueued) {
          refreshQueued = false;
          void poll();
        }
      });

    return pollPromise;
  }

  function acknowledge(id) {
    if (disposed) return Promise.resolve(false);
    if (acknowledgementPromise) return acknowledgementPromise;
    const normalizedId = notificationId(id);
    if (!normalizedId || !notifications.some((notice) => notificationId(notice.id) === normalizedId)) {
      return Promise.resolve(false);
    }

    acknowledgementError = '';
    acknowledgementController = new AbortController();
    const controller = acknowledgementController;
    acknowledgementPromise = Promise.resolve()
      .then(() => {
        if (disposed) return null;
        return client.post(ENDPOINT, {
          action: 'acknowledge',
          user_id: userId,
          id,
        }, {
          signal: controller.signal,
          timeout: OVERRIDE_NOTIFICATION_TIMEOUT_MS,
        });
      })
      .then((response) => {
        if (disposed) return false;
        if (response?.data?.acknowledged !== true) {
          throw new Error('Acknowledgement was not confirmed.');
        }
        // A GET started before this POST may still contain the notice.
        acknowledgedIds.add(normalizedId);
        notifications = notifications.filter((notice) => notificationId(notice.id) !== normalizedId);
        onAcknowledged(normalizedId);
        return true;
      })
      .catch(() => {
        if (!disposed) {
          acknowledgementError = 'Unable to confirm this notice. Please try again.';
        }
        return false;
      })
      .finally(() => {
        acknowledgementPromise = null;
        acknowledgementController = null;
        emit();
      });
    emit();
    return acknowledgementPromise;
  }

  return {
    poll,
    acknowledge,
    snapshot,
    dispose() {
      disposed = true;
      refreshQueued = false;
      pollController?.abort();
      acknowledgementController?.abort();
    },
  };
}
