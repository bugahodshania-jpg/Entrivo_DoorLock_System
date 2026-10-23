import { useCallback, useEffect, useRef, useState } from 'react';
import axiosClient from '../api/axiosClient';
import {
  createOverrideNotificationPoller,
  OVERRIDE_NOTIFICATION_POLL_MS,
} from '../utils/overrideNotificationPoller';

const EMPTY_STATE = { notifications: [], isAcknowledging: false, error: '' };

export default function useOverrideNotifications(userId) {
  const ownerId = userId ? String(userId) : '';
  const [state, setState] = useState({ ownerId: '', ...EMPTY_STATE });
  const pollerRef = useRef(null);

  useEffect(() => {
    setState({ ownerId, ...EMPTY_STATE });
    if (!ownerId) return undefined;

    const storageKey = `entrivo:override-notifications:${ownerId}`;
    const poller = createOverrideNotificationPoller({
      userId: ownerId,
      client: axiosClient,
      onChange: (nextState) => setState({ ownerId, ...nextState }),
      onNewNotifications: () => {
        window.dispatchEvent(new Event('entrivo:override-notifications'));
      },
      onAcknowledged: () => {
        try {
          // This is only a refresh signal. Other tabs verify unread state with the server.
          window.localStorage.setItem(storageKey, `${Date.now()}:${Math.random()}`);
        } catch {
          // Polling still keeps tabs current when browser storage is unavailable.
        }
      },
    });
    pollerRef.current = { ownerId, poller };

    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'hidden') void poller.poll();
    };
    const refreshFromOtherTab = (event) => {
      if (event.key === storageKey) refreshWhenVisible();
    };

    void poller.poll();
    const intervalId = window.setInterval(refreshWhenVisible, OVERRIDE_NOTIFICATION_POLL_MS);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    window.addEventListener('online', refreshWhenVisible);
    window.addEventListener('pageshow', refreshWhenVisible);
    window.addEventListener('storage', refreshFromOtherTab);

    return () => {
      poller.dispose();
      if (pollerRef.current?.poller === poller) pollerRef.current = null;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
      window.removeEventListener('online', refreshWhenVisible);
      window.removeEventListener('pageshow', refreshWhenVisible);
      window.removeEventListener('storage', refreshFromOtherTab);
    };
  }, [ownerId]);

  const acknowledge = useCallback((id) => {
    const current = pollerRef.current;
    return current?.ownerId === ownerId
      ? current.poller.acknowledge(id)
      : Promise.resolve(false);
  }, [ownerId]);

  // Never show the previous account's notices while an account-change effect starts.
  const currentState = state.ownerId === ownerId ? state : EMPTY_STATE;
  return {
    notifications: currentState.notifications,
    acknowledge,
    isAcknowledging: currentState.isAcknowledging,
    error: currentState.error,
  };
}
