import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Fingerprint,
  IdCard,
  LockKeyhole,
  LockKeyholeOpen,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  WifiOff,
} from 'lucide-react';
import axiosClient from '../api/axiosClient';
import { doorStatusView } from '../utils/doorStatus';
import {
  ACCESS_STATUS_POLL_MS,
  ACCESS_STATUS_QUEUE_LIMIT,
  createAccessStatusPoller,
  describeAccessEvent,
  isFailedAttemptAlert,
} from '../utils/accessStatusPoller';
import '../styles/shared/actionConfirm.css';
import '../styles/shared/accessStatusModal.css';

function browserIsActive() {
  return document.visibilityState !== 'hidden' && navigator.onLine !== false;
}

/**
 * Pops up centered on every page the moment a door access attempt is recorded,
 * together with the live lock state. From the 3rd failed attempt in a row by
 * the same person it is a red Security Warning. With alertsOnly (Admin
 * dashboard) only those warnings pop up.
 */
export default function GlobalAccessStatusModal({ actorId, alertsOnly = false }) {
  const [queue, setQueue] = useState([]);
  const [doorSnapshot, setDoorSnapshot] = useState(null);
  const [isLive, setIsLive] = useState(false);
  const okayRef = useRef(null);

  useEffect(() => {
    setQueue([]);
    setDoorSnapshot(null);
    if (!actorId) return undefined;

    let timer = null;
    let stopped = false;
    const poller = createAccessStatusPoller({
      actorId,
      client: axiosClient,
      onEvents: (events) => {
        const shown = alertsOnly ? events.filter(isFailedAttemptAlert) : events;
        if (shown.length) setQueue((current) => [...current, ...shown].slice(-ACCESS_STATUS_QUEUE_LIMIT));
      },
      onDoors: (doors, startedAt) => setDoorSnapshot({ doors, startedAt }),
      onError: (message) => setIsLive(message === ''),
    });

    // Chain the next read right after the previous one finishes: no overlapping
    // requests on the single-threaded PHP server, and no extra waiting.
    const loop = async () => {
      if (stopped) return;
      if (browserIsActive()) await poller.poll();
      if (!stopped) timer = window.setTimeout(loop, ACCESS_STATUS_POLL_MS);
    };
    const resume = () => {
      if (!browserIsActive()) return;
      window.clearTimeout(timer);
      void loop();
    };

    void loop();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      poller.dispose();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
    };
  }, [actorId, alertsOnly]);

  const current = queue[0] || null;
  const dismiss = useCallback(() => setQueue((items) => items.slice(1)), []);

  useEffect(() => {
    if (!current) return undefined;
    okayRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        dismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [current, dismiss]);

  if (!current) return null;

  const view = describeAccessEvent(current);
  const doors = doorSnapshot?.doors || [];
  const report = doors.find((door) => Number(door.device_id) === 1) || doors[0];
  const door = doorStatusView(report, doorSnapshot ? Math.max(0, performance.now() - doorSnapshot.startedAt) : Infinity);
  const DoorIcon = door.state === 'locked' ? LockKeyhole : door.state === 'unlocked' ? LockKeyholeOpen : WifiOff;
  const StatusIcon = view.tone === 'alert' ? ShieldAlert : view.tone === 'granted' ? ShieldCheck : ShieldX;
  const MethodIcon = current.method === 'RFID' ? IdCard : Fingerprint;

  const rows = [
    ['Person', view.person],
    view.role ? ['Role', view.role] : null,
    view.identifier ? ['ID', view.identifier] : null,
    ['Method', `${view.method} · ${view.direction}`],
    view.accessType ? ['Access type', view.accessType] : null,
    view.credential ? ['Credential', view.credential] : null,
    ['Time', view.when || '—'],
    view.schedules.length
      ? ['Schedule today', view.schedules.map((line, index) => <span key={`${index}-${line}`} className="access-status-schedule-line">{line}</span>)]
      : null,
  ].filter(Boolean);

  return createPortal(
    <div className="action-confirm-backdrop access-status-backdrop" role="presentation">
      <section
        className={`action-confirm-modal access-status-modal is-${view.tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="access-status-title"
        aria-describedby="access-status-details"
      >
        <header className="access-status-header">
          <span className="access-status-icon" aria-hidden="true"><StatusIcon size={26} /></span>
          <div>
            <span className="access-status-eyebrow">{view.eyebrow}</span>
            <h2 id="access-status-title">{view.title}</h2>
            <p className="access-status-subtitle">
              <MethodIcon size={14} aria-hidden="true" />
              {view.method} {view.direction.toLowerCase()} · {report?.device_name || 'Door controller'}
            </p>
          </div>
        </header>

        <dl className="access-status-details" id="access-status-details">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        {view.warning ? <p className="access-status-warning" role="alert">{view.warning}</p> : null}
        {view.reason ? <p className="access-status-reason" role="note">{view.reason}</p> : null}

        <div className={`access-status-door is-${door.state}`} role="status" aria-live="polite">
          <DoorIcon size={16} aria-hidden="true" />
          <span>Door <strong>{door.label.toLowerCase()}</strong></span>
          <i aria-hidden="true" />
          <small>{isLive ? 'Live' : 'Reconnecting…'}</small>
        </div>

        <div className="action-confirm-actions access-status-actions">
          {queue.length > 1 ? (
            <span className="access-status-queue">{queue.length - 1} more new {queue.length - 1 === 1 ? 'attempt' : 'attempts'}</span>
          ) : null}
          <button type="button" ref={okayRef} onClick={dismiss}>Okay</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
