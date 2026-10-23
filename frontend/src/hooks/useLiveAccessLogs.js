import { useEffect, useState } from 'react';
import axiosClient from '../api/axiosClient';
import {
  ACCESS_LOG_POLL_MS,
  createAccessLogPoller,
  initialAccessLogState,
} from '../utils/accessLogPoller';

function browserIsActive() {
  return document.visibilityState !== 'hidden' && navigator.onLine !== false;
}

export default function useLiveAccessLogs({ personal = false, userId } = {}) {
  const ownerId = userId === undefined || userId === null ? '' : String(userId);
  const scopeKey = `${personal ? 'personal' : 'admin'}:${ownerId}`;
  const enabled = !personal || ownerId !== '';
  const [state, setState] = useState(() => ({ scopeKey, ...initialAccessLogState(enabled) }));

  useEffect(() => {
    setState({ scopeKey, ...initialAccessLogState(enabled) });
    if (!enabled) return undefined;

    const poller = createAccessLogPoller({
      personal,
      userId: ownerId,
      client: axiosClient,
      active: browserIsActive(),
      onChange: (nextState) => setState({ scopeKey, ...nextState }),
    });

    const refresh = (queueIfBusy = false) => {
      const active = browserIsActive();
      poller.setActive(active);
      if (active) void poller.poll({ queueIfBusy });
    };
    const resume = () => refresh(true);
    const pause = () => poller.setActive(browserIsActive());

    refresh();
    const intervalId = window.setInterval(() => refresh(), ACCESS_LOG_POLL_MS);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', pause);
    window.addEventListener('pageshow', resume);

    return () => {
      poller.dispose();
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', pause);
      window.removeEventListener('pageshow', resume);
    };
  }, [enabled, ownerId, personal, scopeKey]);

  // A render following an account change cannot expose the previous account's rows.
  if (state.scopeKey !== scopeKey) return initialAccessLogState(enabled);
  const { scopeKey: _scopeKey, ...currentState } = state;
  return currentState;
}
