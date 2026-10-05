import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Clock, Eye, MoreVertical, Search, ShieldAlert, Trash2, X } from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import { useActionConfirm } from '../../components/ActionConfirm';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/rfid.css';
import '../../styles/superAdmin/schedules.css';

const statusFilterOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
];

function getActorId() {
  try {
    const raw =
      window.localStorage.getItem('entrivo_user') ||
      window.sessionStorage.getItem('entrivo_user');
    return raw ? JSON.parse(raw)?.id : undefined;
  } catch {
    return undefined;
  }
}

export default function PendingOverrides() {
  const confirmAction = useActionConfirm();
  const statusFilterMenuRef = useRef(null);
  const [overrides, setOverrides] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0 });
  const [statusFilter, setStatusFilter] = useState('pending');
  const [isStatusFilterMenuOpen, setIsStatusFilterMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [toast, setToast] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [processingId, setProcessingId] = useState(null);
  const [menuState, setMenuState] = useState(null);
  const [review, setReview] = useState(null);
  const [reviewError, setReviewError] = useState('');
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const isPendingView = statusFilter === 'pending';
  const columns = [
    'Requester',
    'Role',
    'School / Employee ID',
    'Requested window',
    'Reason',
    'Submitted',
    'Status',
    'Action',
  ];

  useEffect(() => {
    let isActive = true;

    async function loadOverrides() {
      setIsLoading(true);

      try {
        const response = await axiosClient.get('/api/pending_overrides.php', {
          params: { status: statusFilter },
        });

        if (!isActive) {
          return;
        }

        setOverrides(response.data.overrides || []);
        setCounts({
          pending: Number(response.data.counts?.pending || 0),
          approved: Number(response.data.counts?.approved || 0),
        });
        setErrorMessage('');
      } catch {
        if (isActive) {
          setOverrides([]);
          setErrorMessage('Unable to load pending override requests right now.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadOverrides();

    return () => {
      isActive = false;
    };
  }, [statusFilter]);

  useEffect(() => {
    if (!isStatusFilterMenuOpen) {
      return undefined;
    }

    function closeOnOutsideClick(event) {
      if (!statusFilterMenuRef.current?.contains(event.target)) {
        setIsStatusFilterMenuOpen(false);
      }
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setIsStatusFilterMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isStatusFilterMenuOpen]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleOverrides = useMemo(() => {
    if (!normalizedSearchQuery) {
      return overrides;
    }

    return overrides.filter((override) =>
      [
        override.name,
        override.username,
        override.email,
        override.roleLabel,
        override.schoolId,
        override.reason,
        override.dateLabel,
        override.timeLabel,
        override.stateLabel,
        override.approvedByName,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearchQuery)),
    );
  }, [normalizedSearchQuery, overrides]);

  const activeStatusFilter =
    statusFilterOptions.find((option) => option.value === statusFilter) || statusFilterOptions[0];
  const pendingCount = counts.pending;
  const oldestPending = isPendingView ? overrides[0] : null;

  async function updateOverride(override, action) {
    if (!override.canReviewActions) {
      return;
    }

    const confirmed = await confirmAction({
      title: action === 'approve' ? 'Approve override request' : 'Reject override request',
      danger: action === 'reject',
      message:
        action === 'approve'
          ? `Approve temporary access for ${override.name} on ${override.dateLabel} (${override.timeLabel})?`
          : `Reject the override request from ${override.name}? This request will be removed.`,
    });

    if (!confirmed) {
      return;
    }

    setMenuState(null);
    setProcessingId(override.id);
    setToast(null);
    setErrorMessage('');

    try {
      const response = await axiosClient.post('/api/pending_overrides.php', {
        override_id: override.id,
        action,
        status: statusFilter,
        actor_id: getActorId(),
      });
      setOverrides(response.data.overrides || []);
      setCounts({
        pending: Number(response.data.counts?.pending || 0),
        approved: Number(response.data.counts?.approved || 0),
      });
      const message = response.data.message || 'Override request updated.';
      const toastId = Date.now();
      setToast({ id: toastId, message });
      window.setTimeout(() => {
        setToast((current) => (current?.id === toastId ? null : current));
      }, 20000);
      if (review?.id === override.id) {
        setReview(null);
      }
    } catch (error) {
      setErrorMessage(error.response?.data?.message || 'Unable to update that override request right now.');
    } finally {
      setProcessingId(null);
    }
  }

  function toggleMenu(event, override) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();

    if (menuState?.id === override.id) {
      setMenuState(null);
      return;
    }

    const width = 188;
    const height = override.canReviewActions ? 156 : 56;
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    const top =
      rect.bottom + 6 + height < window.innerHeight
        ? rect.bottom + 6
        : Math.max(8, rect.top - height - 6);

    setMenuState({
      id: override.id,
      top,
      left,
      override,
    });
  }

  async function openReview(override) {
    setMenuState(null);
    setReview(override);
    setReviewError('');
    setIsReviewLoading(true);

    try {
      const response = await axiosClient.get('/api/pending_overrides.php', {
        params: { id: override.id },
      });
      setReview(response.data.override || override);
    } catch (error) {
      setReviewError(error.response?.data?.message || 'Unable to load this override request right now.');
    } finally {
      setIsReviewLoading(false);
    }
  }

  useEffect(() => {
    if (!menuState) {
      return undefined;
    }

    function closeMenu() {
      setMenuState(null);
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setMenuState(null);
      }
    }

    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);

    return () => {
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [menuState]);

  const reviewGroups = review
    ? [
        {
          title: 'Requester',
          fields: [
            ['Full name', review.name, true],
            ['Role', review.roleLabel],
            ['Username', review.username],
            ['Email', review.email],
            ['School / Employee ID', review.schoolId],
          ],
        },
        {
          title: 'Requested access window',
          fields: [
            ['Date', review.dateLabel],
            ['Time start', review.timeStartLabel],
            ['Time end', review.timeEndLabel],
            ['Full window', `${review.startLabel} – ${review.endLabel}`, true],
          ],
        },
        {
          title: 'Request details',
          fields: [
            ['Reason', review.reason, true],
            ['Submitted', review.createdAt],
            ['Status', review.stateLabel],
            ['Approved by', review.approvedByName],
          ],
        },
      ]
        .map((group) => ({
          ...group,
          fields: group.fields.filter(([, value]) => value),
        }))
        .filter((group) => group.fields.length > 0)
    : [];

  return (
    <>
      <main className="admin-dashboard rfid-page pending-registrations-page pending-overrides-page" aria-label="Pending override requests">
        <section className="manage-users-summary-grid rfid-summary-grid" aria-label="Pending override summary">
          <article className="dashboard-summary-card rfid-summary-card">
            <div className="dashboard-summary-icon" aria-hidden="true">
              <ShieldAlert size={28} strokeWidth={2.4} />
            </div>
            <div className="dashboard-summary-copy">
              <span className="dashboard-summary-label">Waiting for review</span>
              <strong>{isLoading && isPendingView ? '--' : pendingCount}</strong>
              <small>Override requests from faculty, staff, and admins</small>
            </div>
          </article>
          <article className="dashboard-summary-card rfid-summary-card">
            <div className="dashboard-summary-icon" aria-hidden="true">
              <Clock size={28} strokeWidth={2.4} />
            </div>
            <div className="dashboard-summary-copy">
              <span className="dashboard-summary-label">Oldest pending</span>
              <strong>
                {isLoading && isPendingView
                  ? '--'
                  : oldestPending?.createdDateLabel || (pendingCount > 0 ? '—' : 'None')}
              </strong>
              <small>
                {isLoading && isPendingView
                  ? 'Loading request queue'
                  : oldestPending?.createdTimeLabel
                    ? `Submitted at ${oldestPending.createdTimeLabel}`
                    : pendingCount > 0
                      ? 'Switch to Pending to see the oldest request'
                      : 'No requests in the queue'}
              </small>
            </div>
          </article>
        </section>

        <section className="dashboard-recent-card rfid-card">
          <div className="dashboard-panel-header pending-registrations-header">
            <div>
              <span>Pending override requests</span>
              <p>Review temporary access requests before approving or rejecting them.</p>
            </div>
            <label className="rfid-search pending-registrations-search" aria-label="Search override requests">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search name, role, or reason"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
          </div>

          <div className="schedules-table-filters pending-overrides-toolbar">
            <div
              className="schedules-table-tabs schedules-status-filter"
              ref={statusFilterMenuRef}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setIsStatusFilterMenuOpen(false);
                }
              }}
            >
              <button
                type="button"
                className={`schedules-table-tab-trigger${isStatusFilterMenuOpen ? ' is-open' : ''}`}
                aria-haspopup="listbox"
                aria-expanded={isStatusFilterMenuOpen}
                aria-controls="pending-overrides-status-filter-menu"
                aria-label={`Status filter: ${activeStatusFilter.label}`}
                disabled={isLoading}
                onClick={() => setIsStatusFilterMenuOpen((open) => !open)}
              >
                <span className="schedules-table-tab-trigger-label">{activeStatusFilter.label}</span>
                <span className="schedules-table-tab-count">
                  {isLoading ? '--' : counts[statusFilter] || 0}
                </span>
                <ChevronDown className="schedules-table-tab-chevron" size={14} aria-hidden="true" />
              </button>

              {isStatusFilterMenuOpen ? (
                <div
                  id="pending-overrides-status-filter-menu"
                  className="schedules-table-tab-menu"
                  role="listbox"
                  aria-label="Filter by status"
                >
                  {statusFilterOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      className={`schedules-table-tab-option${
                        statusFilter === option.value ? ' is-active' : ''
                      }`}
                      aria-selected={statusFilter === option.value}
                      onClick={() => {
                        setStatusFilter(option.value);
                        setSearchQuery('');
                        setIsStatusFilterMenuOpen(false);
                      }}
                    >
                      <Check className="schedules-table-tab-check" size={15} aria-hidden="true" />
                      <span className="schedules-table-tab-option-label">{option.label}</span>
                      <span className="schedules-table-tab-count">
                        {isLoading ? '--' : counts[option.value] || 0}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {errorMessage && !isLoading ? (
            <p className="pending-registration-error" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <div className="dashboard-recent-table-wrap pending-registrations-table-wrap">
            <table className="dashboard-recent-table pending-registrations-table pending-overrides-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td className="dashboard-recent-empty" colSpan={columns.length}>
                      Loading {isPendingView ? 'pending' : 'approved'} override requests...
                    </td>
                  </tr>
                )}

                {!isLoading && !errorMessage && visibleOverrides.length === 0 && (
                  <tr>
                    <td className="dashboard-recent-empty" colSpan={columns.length}>
                      {normalizedSearchQuery
                        ? 'No override requests match your search.'
                        : isPendingView
                          ? 'No override requests are waiting for review.'
                          : 'No approved override requests yet.'}
                    </td>
                  </tr>
                )}

                {!isLoading &&
                  visibleOverrides.map((override) => (
                    <tr key={override.id}>
                      <td>
                        <strong>{override.name}</strong>
                        <span>{override.email || override.username}</span>
                      </td>
                      <td>{override.roleLabel}</td>
                      <td>{override.schoolId}</td>
                      <td>
                        <strong>{override.dateLabel}</strong>
                        <span>{override.timeLabel}</span>
                      </td>
                      <td>
                        <span className="pending-override-reason">{override.reason}</span>
                      </td>
                      <td>
                        <strong>{override.createdDateLabel}</strong>
                        <span>{override.createdTimeLabel}</span>
                      </td>
                      <td>
                        <span className={`dashboard-log-status dashboard-log-status-${override.state || 'pending'}`}>
                          {override.stateLabel}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="pending-registration-menu-button"
                          aria-label={`Actions for ${override.name}`}
                          aria-haspopup="menu"
                          aria-expanded={menuState?.id === override.id}
                          onClick={(event) => toggleMenu(event, override)}
                          disabled={processingId === override.id}
                        >
                          <MoreVertical size={16} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {menuState
        ? createPortal(
            <div
              className="pending-registration-menu"
              role="menu"
              style={{ top: menuState.top, left: menuState.left }}
              onClick={(event) => event.stopPropagation()}
            >
              <button type="button" role="menuitem" onClick={() => openReview(menuState.override)}>
                <Eye size={16} strokeWidth={1.75} aria-hidden="true" />
                {menuState.override.canReviewActions ? 'Review' : 'View'}
              </button>
              {menuState.override.canReviewActions ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => updateOverride(menuState.override, 'approve')}
                  >
                    <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                    Approve
                  </button>
                  <div className="pending-registration-menu-divider" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className="is-danger"
                    onClick={() => updateOverride(menuState.override, 'reject')}
                  >
                    <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                    Reject
                  </button>
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}

      {review
        ? createPortal(
            <div
              className="pending-registration-review-backdrop"
              role="presentation"
              onClick={() => setReview(null)}
            >
              <section
                className="pending-registration-review"
                role="dialog"
                aria-modal="true"
                aria-labelledby="pending-override-review-title"
                onClick={(event) => event.stopPropagation()}
              >
                <header>
                  <div>
                    <h2 id="pending-override-review-title">
                      {review.canReviewActions ? 'Review Override Request' : 'Override Request Details'}
                    </h2>
                    <p>
                      {review.canReviewActions
                        ? 'Review this temporary access request before approving or rejecting it.'
                        : 'This override request has already been approved.'}
                    </p>
                  </div>
                  <button type="button" aria-label="Close review" onClick={() => setReview(null)}>
                    <X size={16} aria-hidden="true" />
                  </button>
                </header>
                {isReviewLoading ? (
                  <p className="pending-registration-review-note">Loading override request...</p>
                ) : null}
                {reviewError ? (
                  <p className="pending-registration-error" role="alert">
                    {reviewError}
                  </p>
                ) : null}
                {!isReviewLoading && !reviewError ? (
                  <div className="pending-registration-review-body">
                    {reviewGroups.map((group) => (
                      <section className="pending-registration-review-card" key={group.title}>
                        <h3>{group.title}</h3>
                        <dl>
                          {group.fields.map(([label, value, isWide]) => (
                            <div key={label} className={isWide ? 'is-wide' : undefined}>
                              <dt>{label}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    ))}
                  </div>
                ) : null}
                <footer>
                  {review.canReviewActions ? (
                    <>
                      <button
                        type="button"
                        className="pending-registration-reject"
                        onClick={() => updateOverride(review, 'reject')}
                        disabled={processingId === review.id || isReviewLoading}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="pending-registration-approve"
                        onClick={() => updateOverride(review, 'approve')}
                        disabled={processingId === review.id || isReviewLoading}
                      >
                        {processingId === review.id ? 'Saving...' : 'Approve'}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="pending-registration-approve" onClick={() => setReview(null)}>
                      Close
                    </button>
                  )}
                </footer>
              </section>
            </div>,
            document.body,
          )
        : null}

      {toast ? (
        <div className="fingerprint-toast-stack" aria-live="polite" aria-atomic="true">
          <div className="fingerprint-toast fingerprint-toast-success" role="status">
            <div className="fingerprint-toast-copy">
              <strong>Override Notice</strong>
              <p>{toast.message}</p>
            </div>
            <button
              type="button"
              className="fingerprint-toast-close"
              aria-label="Dismiss notice"
              onClick={() => setToast(null)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
