export const ACCESS_LOG_POLL_MS = 2000;
export const ACCESS_LOG_TIMEOUT_MS = 10000;

export const EMPTY_ACCESS_LOG_SUMMARY = {
  totalToday: 0,
  grantedToday: 0,
  deniedToday: 0,
};

export function initialAccessLogState(enabled = true) {
  return {
    accessLogs: [],
    summary: { ...EMPTY_ACCESS_LOG_SUMMARY },
    isLoading: enabled,
    errorMessage: '',
    isLive: false,
    lastUpdated: null,
  };
}

function readSummary(summary) {
  return Object.fromEntries(Object.keys(EMPTY_ACCESS_LOG_SUMMARY).map((key) => {
    const count = Number(summary?.[key]);
    return [key, Number.isFinite(count) && count >= 0 ? count : 0];
  }));
}

/** Serialize reads independently of React, preserving the last complete server snapshot. */
export function createAccessLogPoller({
  personal = false,
  userId,
  client,
  onChange,
  active = true,
  now = Date.now,
}) {
  const enabled = !personal || (userId !== undefined && userId !== null && String(userId) !== '');
  let state = initialAccessLogState(enabled);
  let disposed = false;
  let isActive = active;
  let lastFetchSucceeded = false;
  let pendingRequest = null;
  let controller = null;
  let refreshQueued = false;

  function snapshot() {
    return { ...state, isLive: enabled && isActive && lastFetchSucceeded };
  }

  function emit() {
    if (!disposed) onChange(snapshot());
  }

  function poll({ queueIfBusy = false } = {}) {
    if (disposed || !enabled || !isActive) return Promise.resolve();
    if (pendingRequest) {
      // Timer ticks skip a busy request. Focus/resume events request one fresh read afterward.
      if (queueIfBusy) refreshQueued = true;
      return pendingRequest;
    }

    const requestController = new AbortController();
    controller = requestController;
    pendingRequest = Promise.resolve()
      .then(() => {
        if (disposed || requestController.signal.aborted) return null;
        return client.get(personal ? '/api/user_portal.php' : '/api/access_logs.php', {
          ...(personal ? { params: { action: 'access_logs', user_id: userId } } : {}),
          signal: requestController.signal,
          timeout: ACCESS_LOG_TIMEOUT_MS,
        });
      })
      .then((response) => {
        if (disposed || requestController.signal.aborted) return;
        const rows = response?.data?.accessLogs;
        if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
          throw new Error('Invalid access log response.');
        }

        state = {
          accessLogs: rows,
          summary: readSummary(response.data.summary),
          isLoading: false,
          errorMessage: '',
          lastUpdated: now(),
        };
        lastFetchSucceeded = true;
      })
      .catch(() => {
        if (disposed || requestController.signal.aborted) return;
        lastFetchSucceeded = false;
        state = {
          ...state,
          isLoading: false,
          errorMessage: 'Unable to refresh access logs. Retrying automatically.',
        };
      })
      .finally(() => {
        pendingRequest = null;
        controller = null;
        emit();
        if (!disposed && isActive && refreshQueued) {
          refreshQueued = false;
          void poll();
        }
      });

    return pendingRequest;
  }

  return {
    poll,
    snapshot,
    setActive(value) {
      if (disposed || isActive === value) return;
      isActive = value;
      if (!isActive) {
        refreshQueued = false;
        controller?.abort();
      }
      emit();
    },
    dispose() {
      disposed = true;
      refreshQueued = false;
      controller?.abort();
    },
  };
}
