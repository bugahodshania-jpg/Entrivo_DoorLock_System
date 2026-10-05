import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, X } from 'lucide-react';
import axiosClient from '../api/axiosClient';

const VISIBLE_ROWS = 6;
const MAX_ROWS = 10;
const SEEN_STORAGE_LIMIT = 200;

function transactionWhen(log) {
  return [log?.time, log?.date].filter(Boolean).join(' · ');
}

function statusClassName(status) {
  const value = String(status || '').trim().toLowerCase();

  if (value === 'success' || value === 'failed') {
    return `notification-menu-result is-${value}`;
  }

  return 'notification-menu-result';
}

function seenStorageKey(viewAllHref, paramsKey) {
  return `entrivo_seen_transactions:${viewAllHref}:${paramsKey}`;
}

function readSeenIds(key) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeSeenIds(key, ids) {
  window.localStorage.setItem(key, JSON.stringify([...ids].slice(-SEEN_STORAGE_LIMIT)));
}

function displayValue(value) {
  const text = String(value ?? '').trim();
  return text || '—';
}

function TransactionViewModal({ log, onClose }) {
  const statusValue = String(log.status || '').trim().toLowerCase();
  const hasAccount = Boolean(log.name || log.username || log.role || log.userId);

  return createPortal(
    <div className="notification-view-backdrop" role="presentation" onClick={onClose}>
      <section
        className="notification-view-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-transaction-view-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="notification-transaction-view-title">Activity Details</h2>
            <p>
              {displayValue(log.date)} · {displayValue(log.time)}
            </p>
          </div>
          <button type="button" aria-label="Close activity details" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="notification-view-body">
          <section>
            <h3>Activity</h3>
            <dl>
              <div>
                <dt>Activity</dt>
                <dd>{displayValue(log.activity)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <span className={`notification-view-status is-${statusValue || 'unknown'}`}>
                    {displayValue(log.status)}
                  </span>
                </dd>
              </div>
              <div className="is-wide">
                <dt>Description</dt>
                <dd>{displayValue(log.description)}</dd>
              </div>
            </dl>
          </section>

          {hasAccount ? (
            <section>
              <h3>Account</h3>
              <dl>
                {log.name ? (
                  <div>
                    <dt>Name</dt>
                    <dd>{log.name}</dd>
                  </div>
                ) : null}
                {log.username ? (
                  <div>
                    <dt>Username</dt>
                    <dd>@{log.username}</dd>
                  </div>
                ) : null}
                {log.role ? (
                  <div>
                    <dt>Role</dt>
                    <dd>{log.role}</dd>
                  </div>
                ) : null}
                {log.userId ? (
                  <div>
                    <dt>User ID</dt>
                    <dd>{log.userId}</dd>
                  </div>
                ) : null}
              </dl>
            </section>
          ) : null}

          <section>
            <h3>When and device</h3>
            <dl>
              <div>
                <dt>Date</dt>
                <dd>{displayValue(log.date)}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>{displayValue(log.time)}</dd>
              </div>
              <div>
                <dt>Device</dt>
                <dd>{displayValue(log.device)}</dd>
              </div>
              <div>
                <dt>Detail</dt>
                <dd>{displayValue(log.deviceDetail)}</dd>
              </div>
            </dl>
          </section>
        </div>

        <footer>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export default function NotificationBell({
  requestUrl,
  requestParams,
  viewAllHref,
  badgeCount = 0,
  dismissOpen = false,
  onOpen,
}) {
  const rootRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [viewLog, setViewLog] = useState(null);
  const [logs, setLogs] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const paramsKey = JSON.stringify(requestParams || {});
  const storageKey = seenStorageKey(viewAllHref, paramsKey);
  const [seenIds, setSeenIds] = useState(() => readSeenIds(storageKey));
  const unreadCount = Number(badgeCount) || 0;
  const unseenCount = logs.filter((log) => log?.id && !seenIds.has(String(log.id))).length;
  const displayCount = Math.max(unreadCount, unseenCount);

  useEffect(() => {
    setSeenIds(readSeenIds(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (dismissOpen) {
      setIsOpen(false);
      setViewLog(null);
    }
  }, [dismissOpen]);

  function markSeen(ids) {
    const nextIds = (Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean);

    if (nextIds.length === 0) {
      return;
    }

    setSeenIds((current) => {
      const next = new Set(current);
      let changed = false;

      nextIds.forEach((id) => {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      });

      if (!changed) {
        return current;
      }

      writeSeenIds(storageKey, next);
      return next;
    });
  }

  useEffect(() => {
    let isActive = true;
    const params = JSON.parse(paramsKey);

    async function loadTransactions() {
      setIsLoading(true);
      setErrorMessage('');

      try {
        const response = await axiosClient.get(requestUrl, { params });

        if (!isActive) {
          return;
        }

        const nextLogs = Array.isArray(response.data?.logs) ? response.data.logs.slice(0, MAX_ROWS) : [];
        setLogs(nextLogs);
        setHasMore(Boolean(response.data?.hasMore) || nextLogs.length > MAX_ROWS);
      } catch {
        if (isActive) {
          setLogs([]);
          setHasMore(false);
          setErrorMessage('Unable to load transactions right now.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
          setHasLoaded(true);
        }
      }
    }

    loadTransactions();

    return () => {
      isActive = false;
    };
  }, [isOpen, paramsKey, requestUrl]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (event.target.closest?.('.notification-view-backdrop')) {
        return;
      }

      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key !== 'Escape') {
        return;
      }

      if (viewLog) {
        setViewLog(null);
        return;
      }

      setIsOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, viewLog]);

  return (
    <div className="notification-bell" ref={rootRef}>
      <button
        className="super-admin-icon-button super-admin-notification"
        type="button"
        aria-label="Notifications"
        aria-expanded={isOpen}
        aria-controls="notification-transaction-menu"
        onClick={() => {
          setIsOpen((current) => {
            const nextOpen = !current;
            if (nextOpen) {
              onOpen?.();
            }
            return nextOpen;
          });
        }}
      >
        <Bell size={16} strokeWidth={1.75} />
        {displayCount > 0 ? (
          <span aria-label={`${displayCount} unread notifications`}>
            {displayCount > 99 ? '99+' : displayCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div
          className="notification-menu"
          id="notification-transaction-menu"
          role="dialog"
          aria-label="Recent transactions"
        >
          <div className="notification-menu-header">
            <strong>Transactions</strong>
            <span>Latest activity</span>
          </div>

          {isLoading && !hasLoaded ? <p className="notification-menu-status">Loading transactions...</p> : null}
          {hasLoaded && errorMessage ? (
            <p className="notification-menu-status is-error" role="alert">
              {errorMessage}
            </p>
          ) : null}
          {hasLoaded && !errorMessage && logs.length === 0 ? (
            <p className="notification-menu-status">No transactions yet.</p>
          ) : null}

          {hasLoaded && !errorMessage && logs.length > 0 ? (
            <ul
              className="notification-menu-list"
              style={{ '--notification-visible-rows': VISIBLE_ROWS }}
            >
              {logs.map((log) => {
                const when = transactionWhen(log);
                const isUnseen = Boolean(log.id) && !seenIds.has(String(log.id));

                return (
                  <li className={`notification-menu-item${isUnseen ? ' is-unseen' : ''}`} key={log.id}>
                    <button
                      className="notification-menu-item-button"
                      type="button"
                      onClick={() => {
                        markSeen(log.id);
                        setViewLog(log);
                      }}
                    >
                      <div className="notification-menu-item-top">
                        <strong>{log.activity || 'Activity'}</strong>
                        {when ? <time>{when}</time> : null}
                      </div>
                      <p>{log.description || 'No details recorded.'}</p>
                      {log.name || log.status ? (
                        <small>
                          {log.name ? <span>{log.name}</span> : null}
                          {log.name && log.status ? <span> · </span> : null}
                          {log.status ? <span className={statusClassName(log.status)}>{log.status}</span> : null}
                        </small>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {hasLoaded && !errorMessage && hasMore ? (
            <a
              className="notification-menu-all"
              href={viewAllHref}
              onClick={() => markSeen(logs.map((log) => log.id))}
            >
              View all activity logs
            </a>
          ) : null}
        </div>
      ) : null}

      {viewLog ? <TransactionViewModal log={viewLog} onClose={() => setViewLog(null)} /> : null}
    </div>
  );
}
