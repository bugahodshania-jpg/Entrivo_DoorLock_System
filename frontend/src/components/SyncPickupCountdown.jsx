import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { getSyncJobStatus, getSyncPickupRemainingSeconds } from '../utils/fingerprintSync';

export default function SyncPickupCountdown({ job }) {
  const [, setTick] = useState(0);
  const status = getSyncJobStatus(job);
  const queuedAt = job?.queued_at;
  const remainingSeconds = getSyncPickupRemainingSeconds(job);

  useEffect(() => {
    const pendingJob = { status, queued_at: queuedAt };
    const remaining = getSyncPickupRemainingSeconds(pendingJob);

    if (remaining === null || remaining === 0) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setTick((tick) => tick + 1);

      if (getSyncPickupRemainingSeconds(pendingJob) === 0) {
        window.clearInterval(intervalId);
      }
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [queuedAt, status]);

  if (remainingSeconds === null) {
    return null;
  }

  const minutes = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const seconds = String(remainingSeconds % 60).padStart(2, '0');
  const time = `${minutes}:${seconds}`;

  return (
    <span
      className="fingerprint-sync-countdown"
      title="Time left for the door controller to pick up this sync before automatic cancellation"
      aria-label={`${time} left before automatic cancellation if the door controller does not pick up this sync`}
    >
      <Clock size={13} aria-hidden="true" />
      {time} left
    </span>
  );
}
