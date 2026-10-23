export const DOOR_STATUS_POLL_MS = 500;
export const DOOR_STATUS_TIMEOUT_MS = 3000;

/** Keep one current read, even when focus or reconnect events interrupt polling. */
export function createDoorStatusPoller({
  actorId,
  client,
  onChange,
  active = true,
  now = () => performance.now(),
}) {
  let disposed = false;
  let isActive = active;
  let snapshot = null;
  let pendingRequest = null;
  let controller = null;
  let refreshQueued = false;

  function emit() {
    if (!disposed) onChange(snapshot);
  }

  function poll({ queueIfBusy = false } = {}) {
    if (disposed || !actorId || !isActive) return Promise.resolve();
    if (pendingRequest) {
      // Timer ticks skip a busy read; resume events need one fresh read afterward.
      if (queueIfBusy) refreshQueued = true;
      return pendingRequest;
    }

    const requestController = new AbortController();
    controller = requestController;
    const startedAt = now();
    pendingRequest = Promise.resolve()
      .then(() => {
        if (disposed || requestController.signal.aborted) return null;
        return client.get('/api/door_status.php', {
          params: { actor_id: actorId, _t: Date.now() },
          signal: requestController.signal,
          timeout: DOOR_STATUS_TIMEOUT_MS,
        });
      })
      .then((response) => {
        if (disposed || requestController.signal.aborted) return;
        const doors = response?.data?.doors;
        if (response?.data?.success !== true || !Array.isArray(doors)
          || doors.some((door) => !door || typeof door !== 'object' || Array.isArray(door))) {
          throw new Error('Door status unavailable');
        }

        // Count request latency against the server's freshness deadline.
        snapshot = { doors, startedAt };
        emit();
      })
      .catch(() => {
        if (disposed || requestController.signal.aborted) return;
        snapshot = null;
        emit();
      })
      .finally(() => {
        pendingRequest = null;
        controller = null;
        if (!disposed && isActive && refreshQueued) {
          refreshQueued = false;
          void poll();
        }
      });

    return pendingRequest;
  }

  return {
    poll,
    setActive(value) {
      if (disposed || isActive === value) return;
      isActive = value;
      if (!isActive) {
        refreshQueued = false;
        controller?.abort();
        snapshot = null;
        emit();
      }
    },
    dispose() {
      disposed = true;
      refreshQueued = false;
      controller?.abort();
    },
  };
}
