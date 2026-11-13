import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LockKeyhole, LockKeyholeOpen, UserRound, WifiOff } from 'lucide-react';
import { useDoorStatus } from '../hooks/useDoorStatus';
import { ACCESS_TYPE_LABELS, ROLE_LABELS } from '../utils/accessStatusPoller';
import '../styles/shared/actionConfirm.css';
import '../styles/shared/accessStatusModal.css';
import '../styles/shared/doorStatus.css';

export default function DoorStatusCard() {
  const door = useDoorStatus();
  const [open, setOpen] = useState(false);
  const Icon = door.state === 'locked' ? LockKeyhole : door.state === 'unlocked' ? LockKeyholeOpen : WifiOff;
  // Time first: the card truncates long text, and the time is what must stay visible.
  const time = door.state === 'unknown' && door.updatedAt ? `Last seen ${door.updatedAt}` : door.updatedAt;
  const detail = time ? `${time} · ${door.deviceName}` : door.deviceName;
  const content = <>
    <Icon size={17} aria-hidden="true" />
    <div><strong>Door {door.label.toLowerCase()}</strong><small>{detail}</small></div>
    <span className="door-status-dot" aria-hidden="true" />
  </>;

  // Only an unlocked door opens the "who is using the door" modal.
  if (door.state !== 'unlocked' && !open) {
    return <div className={`door-status-card is-${door.state}`} role="status"
      aria-label={`Door status: ${door.label}. ${door.deviceName}`} title={`${door.deviceName} · Door ${door.label.toLowerCase()}`}>
      {content}
    </div>;
  }
  return <>
    <button type="button" className={`door-status-card is-${door.state} is-clickable`} onClick={() => setOpen(true)}
      aria-haspopup="dialog" aria-label={`Door status: ${door.label}. ${door.deviceName}. Show who is using the door`}
      title="Show who is using the door">
      {content}
    </button>
    {open ? <DoorOccupantModal door={door} onClose={() => setOpen(false)} /> : null}
  </>;
}

function DoorOccupantModal({ door, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const occupant = door.occupant;
  const rows = occupant ? [
    ['Person', occupant.name],
    occupant.role ? ['Role', ROLE_LABELS[occupant.role] || occupant.role] : null,
    occupant.identifier ? ['ID', occupant.identifier] : null,
    ['Method', occupant.method === 'RFID' ? 'RFID card' : occupant.method || '—'],
    ACCESS_TYPE_LABELS[occupant.access_type] ? ['Access type', ACCESS_TYPE_LABELS[occupant.access_type]] : null,
    occupant.schedule ? ['Schedule', occupant.schedule] : null,
    ['Entered', [occupant.entered_time, occupant.entered_date].filter(Boolean).join(' · ') || '—'],
  ].filter(Boolean) : [];
  const DoorIcon = door.state === 'locked' ? LockKeyhole : door.state === 'unlocked' ? LockKeyholeOpen : WifiOff;

  return createPortal(
    <div className="action-confirm-backdrop access-status-backdrop" role="presentation"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="action-confirm-modal access-status-modal is-granted door-occupant-modal" role="dialog"
        aria-modal="true" aria-labelledby="door-occupant-title">
        <header className="access-status-header">
          <span className="access-status-icon" aria-hidden="true"><UserRound size={24} /></span>
          <div>
            <span className="access-status-eyebrow">{door.deviceName}</span>
            <h2 id="door-occupant-title">Currently using the door</h2>
          </div>
        </header>

        {door.state !== 'unlocked' ? (
          <p className="door-occupant-empty">The door is {door.label.toLowerCase()} now, so no one is using it.</p>
        ) : rows.length ? (
          <dl className="access-status-details">
            {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        ) : (
          <p className="door-occupant-empty">The door is unlocked, but no recent entry shows who unlocked it.</p>
        )}

        <div className={`access-status-door is-${door.state}`} role="status" aria-live="polite">
          <DoorIcon size={16} aria-hidden="true" />
          <span>Door <strong>{door.label.toLowerCase()}</strong></span>
          <i aria-hidden="true" />
          <small>{door.updatedAt ? `Updated ${door.updatedAt}` : 'Live'}</small>
        </div>

        <div className="action-confirm-actions access-status-actions">
          <button type="button" ref={closeRef} onClick={onClose}>Close</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
