import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { getEnrollmentPickupRemainingSeconds } from '../utils/fingerprintEnrollment';
import '../styles/shared/enrollmentPickupCountdown.css';

export default function EnrollmentPickupCountdown({ job }) {
  const [, setTick] = useState(0);
  const status = job?.status;
  const queuedAt = job?.updated_at || job?.created_at;
  const remaining = getEnrollmentPickupRemainingSeconds(job);

  useEffect(() => {
    const pendingJob = { status, updated_at: queuedAt };
    const seconds = getEnrollmentPickupRemainingSeconds(pendingJob);
    if (seconds === null || seconds === 0) return undefined;

    const intervalId = window.setInterval(() => {
      setTick(tick => tick + 1);
      if (getEnrollmentPickupRemainingSeconds(pendingJob) === 0) window.clearInterval(intervalId);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [queuedAt, status]);

  if (remaining === null) return null;
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  return <span className="fingerprint-enrollment-pickup-countdown" role="timer">
    <Clock size={13} aria-hidden="true" />
    {remaining > 0
      ? `Automatic cancellation in ${minutes}:${seconds}`
      : 'Three-minute wait ended. Checking Sensor A status...'}
  </span>;
}
