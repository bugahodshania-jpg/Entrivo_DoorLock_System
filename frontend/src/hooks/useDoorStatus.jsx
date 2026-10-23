import { createContext, useContext, useEffect, useState } from 'react';
import axiosClient from '../api/axiosClient';
import { doorStatusView } from '../utils/doorStatus';
import { createDoorStatusPoller, DOOR_STATUS_POLL_MS } from '../utils/doorStatusPoller';

const DoorStatusContext = createContext(null);

function browserIsActive() {
  return document.visibilityState !== 'hidden' && navigator.onLine !== false;
}

export function DoorStatusProvider({ actorId, children }) {
  const [snapshot, setSnapshot] = useState(null);
  const [selectedDeviceId, selectDoor] = useState(null);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    setSnapshot(null);
    if (!actorId) return undefined;

    const poller = createDoorStatusPoller({
      actorId,
      client: axiosClient,
      active: browserIsActive(),
      onChange: (nextSnapshot) => {
        setSnapshot(nextSnapshot ? { actorId, ...nextSnapshot } : null);
        setNow(performance.now());
      },
    });

    const refresh = (queueIfBusy = false) => {
      setNow(performance.now());
      const active = browserIsActive();
      poller.setActive(active);
      if (active) void poller.poll({ queueIfBusy });
    };
    const resume = () => refresh(true);

    refresh();
    const timer = window.setInterval(() => refresh(), DOOR_STATUS_POLL_MS);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    window.addEventListener('pageshow', resume);

    return () => {
      poller.dispose();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, [actorId]);

  const current = snapshot?.actorId === actorId ? snapshot : null;
  return <DoorStatusContext.Provider value={{
    doors: current?.doors || [], elapsedMs: current ? Math.max(0, now - current.startedAt) : Infinity,
    selectedDeviceId, selectDoor,
  }}>{children}</DoorStatusContext.Provider>;
}

export function useDoorStatus(deviceId) {
  const context = useContext(DoorStatusContext);
  const doors = context?.doors || [];
  const requestedId = deviceId || context?.selectedDeviceId;
  const report = requestedId
    ? doors.find((door) => Number(door.device_id) === Number(requestedId))
    : doors.find((door) => Number(door.device_id) === 1) || doors[0];
  return { ...doorStatusView(report, context?.elapsedMs ?? Infinity), selectDoor: context?.selectDoor };
}
