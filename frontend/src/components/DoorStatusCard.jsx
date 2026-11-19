import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, LockKeyhole, LockKeyholeOpen, UserRound, WifiOff } from 'lucide-react';
import axiosClient from '../api/axiosClient';
import { ActionConfirmProvider, useActionConfirm } from './ActionConfirm';
import { useDoorStatus } from '../hooks/useDoorStatus';
import { ACCESS_TYPE_LABELS, ROLE_LABELS } from '../utils/accessStatusPoller';
import '../styles/shared/actionConfirm.css';
import '../styles/shared/accessStatusModal.css';
import '../styles/shared/doorStatus.css';

const SCHEDULE_MODES = [
  { value: 'auto', label: 'Auto', hint: 'Schedules apply while the door is online. If it loses internet, scheduling turns off by itself and enrolled fingers can enter.' },
  { value: 'on', label: 'On', hint: 'Schedules always apply, even offline. Offline, only the emergency card opens the door.' },
  { value: 'off', label: 'Off', hint: 'No schedule needed: any active registered user can enter.' },
];

export default function DoorStatusCard({ user }) {
  const door = useDoorStatus();
  const [open, setOpen] = useState(false);
  const role = user?.role || '';
  const canControl = role === 'admin' || role === 'super_admin';
  const Icon = door.state === 'locked' ? LockKeyhole : door.state === 'unlocked' ? LockKeyholeOpen : WifiOff;
  // Time first: the card truncates long text, and the time is what must stay visible.
  const time = door.state === 'unknown' && door.updatedAt ? `Last seen ${door.updatedAt}` : door.updatedAt;
  const detail = time ? `${time} · ${door.deviceName}` : door.deviceName;
  const label = door.state === 'unknown' ? 'offline' : door.label.toLowerCase();
  const content = <>
    <Icon size={17} aria-hidden="true" />
    <div><strong>Door {label}</strong><small>{detail}</small></div>
    <span className="door-status-dot" aria-hidden="true" />
  </>;

  // An unlocked door opens "who is using the door"; administrators can always
  // open the panel for the scheduling mode (and, Super Admin, remote lock).
  if (door.state !== 'unlocked' && !canControl && !open) {
    return <div className={`door-status-card is-${door.state}`} role="status"
      aria-label={`Door status: ${door.label}. ${door.deviceName}`} title={`${door.deviceName} · Door ${label}`}>
      {content}
    </div>;
  }
  return <>
    <button type="button" className={`door-status-card is-${door.state} is-clickable`} onClick={() => setOpen(true)}
      aria-haspopup="dialog" aria-label={`Door status: ${door.label}. ${door.deviceName}. Open door details`}
      title={canControl ? 'Door details and controls' : 'Show who is using the door'}>
      {content}
    </button>
    {open ? createPortal(
      <ActionConfirmProvider user={user}>
        <DoorModal door={door} user={user} canControl={canControl} onClose={() => setOpen(false)} />
      </ActionConfirmProvider>,
      document.body,
    ) : null}
  </>;
}

function DoorModal({ door, user, canControl, onClose }) {
  const closeRef = useRef(null);
  const [busy, setBusy] = useState(false);
  // The door status refreshes every few seconds and passes a new onClose each
  // time. Keep it in a ref so the focus below runs once, not on every refresh
  // (that stole focus from the security password box).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const busyRef = useRef(false);
  busyRef.current = busy;
  const confirmingRef = useRef(false);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event) => {
      // Escape in the confirmation/password dialog closes only that dialog.
      if (event.key === 'Escape' && !busyRef.current && !confirmingRef.current) onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
  const offline = door.state === 'unknown';
  const DoorIcon = door.state === 'locked' ? LockKeyhole : door.state === 'unlocked' ? LockKeyholeOpen : WifiOff;

  return (
    <div className="action-confirm-backdrop door-panel-backdrop" role="presentation"
      onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="action-confirm-modal access-status-modal is-granted door-occupant-modal" role="dialog"
        aria-modal="true" aria-labelledby="door-occupant-title">
        <header className="access-status-header">
          <span className="access-status-icon" aria-hidden="true">{door.state === 'unlocked' ? <UserRound size={24} /> : <DoorIcon size={24} />}</span>
          <div>
            <span className="access-status-eyebrow">{door.deviceName}</span>
            <h2 id="door-occupant-title">{door.state === 'unlocked' ? 'Currently using the door' : 'Door'}</h2>
          </div>
        </header>

        {offline ? null : door.state !== 'unlocked' ? (
          <p className="door-occupant-empty">The door is {door.label.toLowerCase()} now, so no one is using it.</p>
        ) : rows.length ? (
          <dl className="access-status-details">
            {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        ) : (
          <p className="door-occupant-empty">The door is unlocked, but no recent entry shows who unlocked it.</p>
        )}

        <DoorControlPanel door={door} user={user} canControl={canControl}
          onBusyChange={setBusy} confirmingRef={confirmingRef} />

        <div className="action-confirm-actions access-status-actions">
          <button type="button" ref={closeRef} onClick={onClose} disabled={busy}>Close</button>
        </div>
      </section>
    </div>
  );
}

/**
 * The door's connection notice, live state, scheduling mode and (Super Admin)
 * remote lock. Used in the header door popup and on the Settings page.
 * Must render inside an ActionConfirmProvider.
 */
export function DoorControlPanel({
  door, user, canControl = true, onBusyChange, confirmingRef, variant = 'compact', modeDetails = null, lockGuide = null,
}) {
  const confirmAction = useActionConfirm();
  const [busy, setBusyState] = useState(false);
  const [notice, setNotice] = useState({ text: '', error: false });
  const isSuperAdmin = user?.role === 'super_admin';
  const setBusy = (value) => {
    setBusyState(value);
    onBusyChange?.(value);
  };
  const setConfirming = (value) => {
    if (confirmingRef) confirmingRef.current = value;
  };

  async function send(payload, confirm) {
    setConfirming(true);
    let password;
    try {
      password = await confirmAction({ ...confirm, returnPassword: true });
    } finally {
      setConfirming(false);
    }
    if (!password) return;
    setBusy(true);
    setNotice({ text: '', error: false });
    try {
      const response = await axiosClient.post('/api/door_control.php', {
        ...payload, actor_id: user?.id, password, device_id: door.deviceId || 1,
      });
      setNotice({ text: response.data?.message || 'Saved.', error: false });
    } catch (error) {
      setNotice({ text: error.response?.data?.message || 'The door control is unavailable right now.', error: true });
    } finally {
      setBusy(false);
    }
  }

  const setMode = (mode) => {
    if (mode === door.scheduleMode) return;
    const option = SCHEDULE_MODES.find((item) => item.value === mode);
    void send({ action: 'schedule_mode', mode }, {
      title: `Set scheduling to ${option.label}?`,
      message: option.hint,
      confirmLabel: `Set to ${option.label}`,
      danger: mode === 'off',
    });
  };

  const toggleLock = () => {
    const unlock = door.state === 'locked';
    void send({ action: unlock ? 'unlock' : 'lock' }, {
      title: unlock ? 'Unlock the door remotely?' : 'Lock the door remotely?',
      message: unlock
        ? 'The solenoid opens and the room stays unlocked until someone locks it (touch, then a registered finger) or you lock it here.'
        : 'The solenoid locks the room now. Anyone still inside can leave with the exit reader.',
      confirmLabel: unlock ? 'Unlock door' : 'Lock door',
      danger: unlock,
    });
  };

  const offline = door.state === 'unknown';
  const DoorIcon = door.state === 'locked' ? LockKeyhole : door.state === 'unlocked' ? LockKeyholeOpen : WifiOff;
  const pending = door.pendingCommand;

  const lockLabel = pending ? `${pending === 'lock' ? 'Locking' : 'Unlocking'}… waiting for the door`
    : door.state === 'locked' ? 'Locked · click to unlock' : door.state === 'unlocked' ? 'Unlocked · click to lock' : 'Unavailable while offline';

  if (variant === 'sections') {
    const lockState = door.state === 'locked' ? 'lock' : door.state === 'unlocked' ? 'unlock' : '';
    return (
      <div className="door-sections">
        <section className={`door-section door-section-status is-${door.state}`} aria-labelledby="door-section-status-title">
          <div className="door-section-status-main" role="status" aria-live="polite">
            <span className="door-section-status-icon"><DoorIcon size={20} aria-hidden="true" /></span>
            <div>
              <h4 id="door-section-status-title">Door {offline ? 'offline' : door.label.toLowerCase()}</h4>
              <small>{door.updatedAt ? `Updated ${door.updatedAt}` : 'Live'}</small>
            </div>
          </div>
          <p className="door-section-status-text">
            {offline ? (
              <>
                <strong>Connection lost.</strong> The door controller is not reaching the internet.{' '}
                {door.scheduleMode === 'on'
                  ? 'Scheduling stays on, so only the emergency card opens the door.'
                  : 'Scheduling is off for now: enrolled fingers can enter, and their entries are saved for the access logs.'}
              </>
            ) : 'The door controller is online and receives changes within a few seconds.'}
          </p>
        </section>

        {notice.text ? <p className={`door-control-notice${notice.error ? ' is-error' : ''}`} role="status">{notice.text}</p> : null}

        {canControl ? (
          <section className="door-section" aria-labelledby="door-section-mode-title">
            <header className="door-section-head">
              <span className="door-section-step" aria-hidden="true">1</span>
              <div>
                <h4 id="door-section-mode-title"><CalendarClock size={16} aria-hidden="true" /> Scheduling mode</h4>
                <p>Decides who the door lets in. Click a mode to switch to it.</p>
              </div>
            </header>
            <div className="door-mode-cards" role="radiogroup" aria-label="Scheduling mode">
              {SCHEDULE_MODES.map((option) => {
                const active = door.scheduleMode === option.value;
                return (
                  <button key={option.value} type="button" role="radio" aria-checked={active} disabled={busy}
                    className={`door-mode-card${active ? ' is-active' : ''}`} onClick={() => setMode(option.value)}>
                    <span className="door-mode-card-head">
                      <span className="door-mode-card-radio" aria-hidden="true" />
                      <strong>{option.label}</strong>
                      {option.value === 'auto' ? <small>Recommended</small> : null}
                      {active ? <em>Current</em> : null}
                    </span>
                    <span className="door-mode-card-text">{modeDetails?.[option.value] || option.hint}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {canControl && isSuperAdmin ? (
          <section className="door-section" aria-labelledby="door-section-lock-title">
            <header className="door-section-head">
              <span className="door-section-step" aria-hidden="true">2</span>
              <div>
                <h4 id="door-section-lock-title"><LockKeyhole size={16} aria-hidden="true" /> Remote lock</h4>
                <p>Super Admin only. Needs your confirmation, then your password. The door stays locked by default.</p>
              </div>
            </header>
            <div className="door-lock-layout">
              <button type="button" role="switch" aria-checked={door.state === 'locked'}
                className={`door-lock-switch is-${door.state}`} disabled={busy || offline || Boolean(pending)} onClick={toggleLock}>
                <span className="door-lock-switch-track" aria-hidden="true"><span /></span>
                <span>{lockLabel}</span>
              </button>
              {lockGuide ? (
                <dl className="door-lock-guide">
                  {lockGuide.map((item) => {
                    const current = item.key === 'offline' ? offline : !offline && item.key === lockState;
                    return (
                      <div key={item.key} className={current ? 'is-current' : ''}>
                        <dt>{item.title}{current ? <em> · now</em> : null}</dt>
                        <dd>{item.text}</dd>
                      </div>
                    );
                  })}
                </dl>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <>
        {offline ? (
          <p className="door-control-offline" role="status">
            <WifiOff size={15} aria-hidden="true" />
            <span>
              <strong>Connection lost.</strong> The door controller is not reaching the internet.{' '}
              {door.scheduleMode === 'on'
                ? 'Scheduling stays on, so only the emergency card opens the door.'
                : 'Scheduling is disabled automatically: enrolled fingers can enter, and their entries are saved for the access logs.'}
            </span>
          </p>
        ) : null}

        <div className={`access-status-door is-${door.state}`} role="status" aria-live="polite">
          <DoorIcon size={16} aria-hidden="true" />
          <span>Door <strong>{offline ? 'offline' : door.label.toLowerCase()}</strong></span>
          <i aria-hidden="true" />
          <small>{door.updatedAt ? `Updated ${door.updatedAt}` : 'Live'}</small>
        </div>

        {canControl ? (
          <div className="door-controls">
            <div className="door-control-group">
              <span className="door-control-label"><CalendarClock size={15} aria-hidden="true" /> Scheduling</span>
              <div className="door-mode-switch" role="radiogroup" aria-label="Scheduling mode">
                {SCHEDULE_MODES.map((option) => (
                  <button key={option.value} type="button" role="radio" aria-checked={door.scheduleMode === option.value}
                    className={door.scheduleMode === option.value ? 'is-active' : ''} disabled={busy}
                    onClick={() => setMode(option.value)}>
                    {option.label}
                  </button>
                ))}
              </div>
              <small>{SCHEDULE_MODES.find((option) => option.value === door.scheduleMode)?.hint}</small>
            </div>

            {isSuperAdmin ? (
              <div className="door-control-group">
                <span className="door-control-label"><LockKeyhole size={15} aria-hidden="true" /> Remote lock</span>
                <button type="button" role="switch" aria-checked={door.state === 'locked'}
                  className={`door-lock-switch is-${door.state}`} disabled={busy || offline || Boolean(pending)} onClick={toggleLock}>
                  <span className="door-lock-switch-track" aria-hidden="true"><span /></span>
                  <span>{lockLabel}</span>
                </button>
                <small>Needs your confirmation, then your password. The door stays locked by default and unlocks for valid credentials.</small>
              </div>
            ) : null}

            {notice.text ? <p className={`door-control-notice${notice.error ? ' is-error' : ''}`} role="status">{notice.text}</p> : null}
          </div>
        ) : null}

    </>
  );
}
