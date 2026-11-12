import { useEffect, useState } from 'react';
import axiosClient from '../api/axiosClient';

export const PENDING_OVERRIDES_CHANGED_EVENT = 'entrivo:pending-overrides-changed';
const POLL_MS = 30000;

// Number of override requests waiting for review, for the sidebar badge.
// Polls only while the tab is visible; an approve or reject refreshes it at once.
export default function usePendingOverrideCount(enabled) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return undefined;
    }

    let isActive = true;

    async function load() {
      if (document.visibilityState === 'hidden') return;
      try {
        const response = await axiosClient.get('/api/pending_overrides.php', { params: { counts: 1 } });
        if (isActive) setCount(Number(response.data?.counts?.pending) || 0);
      } catch {
        // Keep the last known count; the next poll tries again.
      }
    }

    void load();
    const intervalId = window.setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', load);
    window.addEventListener('focus', load);
    window.addEventListener(PENDING_OVERRIDES_CHANGED_EVENT, load);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', load);
      window.removeEventListener('focus', load);
      window.removeEventListener(PENDING_OVERRIDES_CHANGED_EVENT, load);
    };
  }, [enabled]);

  return count;
}
