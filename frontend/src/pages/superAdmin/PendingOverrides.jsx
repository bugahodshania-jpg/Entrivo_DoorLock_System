import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarPlus, Check, ChevronDown, Clock, Eye, MoreVertical, RefreshCw, Search, ShieldAlert, Trash2, X } from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import { useActionConfirm } from '../../components/ActionConfirm';
import ErrorNoticeModal from '../../components/ErrorNoticeModal';
import ScheduleCreateModal from '../../components/ScheduleCreateModal';
import TableEmptyState from '../../components/TableEmptyState';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/rfid.css';
import '../../styles/superAdmin/schedules.css';
import '../../styles/superAdmin/activityLogs.css';
import '../../styles/superAdmin/pendingOverrides.css';

const statusFilterOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
];

// Temporary preview data — set to false to use live API results only.
const USE_TEMP_OVERRIDE_PREVIEW = true;

const tempPendingOverrides = [
  {
    id: -101,
    name: 'Maria Santos',
    username: 'msantos',
    email: 'maria.santos@example.com',
    roleLabel: 'Faculty',
    schoolId: 'EMP-1042',
    reason: 'Make-up class for Midterm coverage',
    overrideStart: '2026-10-17 13:00:00',
    dateLabel: 'Oct 17, 2026',
    timeLabel: '01:00 PM - 03:00 PM',
    createdDateLabel: 'Oct 15, 2026',
    createdTimeLabel: '09:24 AM',
    state: 'pending',
    stateLabel: 'Pending',
    canReviewActions: true,
  },
  {
    id: -102,
    name: 'Jose Ramirez',
    username: 'jramirez',
    email: 'jose.ramirez@example.com',
    roleLabel: 'Staff',
    schoolId: 'EMP-2218',
    reason: 'Lab equipment inventory after hours',
    overrideStart: '2026-10-18 17:00:00',
    dateLabel: 'Oct 18, 2026',
    timeLabel: '05:00 PM - 07:00 PM',
    createdDateLabel: 'Oct 16, 2026',
    createdTimeLabel: '02:11 PM',
    state: 'pending',
    stateLabel: 'Pending',
    canReviewActions: true,
  },
  {
    id: -103,
    name: 'Ana Villanueva',
    username: 'avillanueva',
    email: 'ana.villanueva@example.com',
    roleLabel: 'Admin',
    schoolId: 'EMP-0901',
    reason: 'Campus maintenance walkthrough',
    overrideStart: '2026-10-19 08:00:00',
    dateLabel: 'Oct 19, 2026',
    timeLabel: '08:00 AM - 10:00 AM',
    createdDateLabel: 'Oct 16, 2026',
    createdTimeLabel: '04:45 PM',
    state: 'pending',
    stateLabel: 'Pending',
    canReviewActions: true,
  },
];

const tempApprovedOverrides = [
  {
    id: -201,
    name: 'Carlo Dela Cruz',
    username: 'cdelacruz',
    email: 'carlo.delacruz@example.com',
    roleLabel: 'Faculty',
    schoolId: 'EMP-1188',
    reason: 'Thesis defense panel',
    overrideStart: '2026-10-13 09:00:00',
    dateLabel: 'Oct 13, 2026',
    timeLabel: '09:00 AM - 11:00 AM',
    createdDateLabel: 'Oct 12, 2026',
    createdTimeLabel: '11:05 AM',
    state: 'approved',
    stateLabel: 'Approved',
    canReviewActions: false,
    approvedByName: 'Super Admin',
  },
  {
    id: -202,
    name: 'Liza Mendoza',
    username: 'lmendoza',
    email: 'liza.mendoza@example.com',
    roleLabel: 'Staff',
    schoolId: 'EMP-3055',
    reason: 'Library stock transfer',
    overrideStart: '2026-10-14 14:00:00',
    dateLabel: 'Oct 14, 2026',
    timeLabel: '02:00 PM - 04:00 PM',
    createdDateLabel: 'Oct 13, 2026',
    createdTimeLabel: '08:40 AM',
    state: 'approved',
    stateLabel: 'Approved',
    canReviewActions: false,
    approvedByName: 'Super Admin',
  },
  {
    id: -203,
    name: 'Paolo Reyes',
    username: 'preyes',
    email: 'paolo.reyes@example.com',
    roleLabel: 'Faculty',
    schoolId: 'EMP-1420',
    reason: 'Extra consultation hours',
    overrideStart: '2026-10-15 16:00:00',
    dateLabel: 'Oct 15, 2026',
    timeLabel: '04:00 PM - 06:00 PM',
    createdDateLabel: 'Oct 14, 2026',
    createdTimeLabel: '01:18 PM',
    state: 'approved',
    stateLabel: 'Approved',
    canReviewActions: false,
    approvedByName: 'Super Admin',
  },
  {
    id: -204,
    name: 'Grace Tan',
    username: 'gtan',
    email: 'grace.tan@example.com',
    roleLabel: 'Admin',
    schoolId: 'EMP-0777',
    reason: 'Event setup for orientation',
    overrideStart: '2026-10-16 07:00:00',
    dateLabel: 'Oct 16, 2026',
    timeLabel: '07:00 AM - 09:00 AM',
    createdDateLabel: 'Oct 15, 2026',
    createdTimeLabel: '03:22 PM',
    state: 'approved',
    stateLabel: 'Approved',
    canReviewActions: false,
    approvedByName: 'Super Admin',
  },
  {
    id: -205,
    name: 'Mark Aquino',
    username: 'maquino',
    email: 'mark.aquino@example.com',
    roleLabel: 'Staff',
    schoolId: 'EMP-2604',
    reason: 'Server room inspection',
    overrideStart: '2026-10-17 10:00:00',
    dateLabel: 'Oct 17, 2026',
    timeLabel: '10:00 AM - 12:00 PM',
    createdDateLabel: 'Oct 16, 2026',
    createdTimeLabel: '10:09 AM',
    state: 'approved',
    stateLabel: 'Approved',
    canReviewActions: false,
    approvedByName: 'Super Admin',
  },
];

function getRequestedWindowDate(override) {
  const raw = String(override?.overrideStart || override?.dateValue || '');
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
}

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
  const [oldestPending, setOldestPending] = useState(null);
  const [recentApprovedThisWeek, setRecentApprovedThisWeek] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [isStatusFilterMenuOpen, setIsStatusFilterMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [toast, setToast] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [processingId, setProcessingId] = useState(null);
  const [menuState, setMenuState] = useState(null);
  const [review, setReview] = useState(null);
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const [isOverrideCreateOpen, setIsOverrideCreateOpen] = useState(false);
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

  function applyOverridesPayload(data, preferredStatus = statusFilter) {
    const apiOverrides = data.overrides || [];
    const apiOldest = data.oldestPending || null;
    const apiRecent = (data.recentApprovedThisWeek || []).slice(0, 5);
    const apiPending = Number(data.counts?.pending || 0);
    const apiApproved = Number(data.counts?.approved || 0);

    if (USE_TEMP_OVERRIDE_PREVIEW) {
      const tableRows =
        preferredStatus === 'approved' ? tempApprovedOverrides : tempPendingOverrides;
      setOverrides(apiOverrides.length ? apiOverrides : tableRows);
      setCounts({
        pending: Math.max(apiPending, tempPendingOverrides.length),
        approved: Math.max(apiApproved, tempApprovedOverrides.length),
      });
      setOldestPending(apiOldest || tempPendingOverrides[0]);
      setRecentApprovedThisWeek(apiRecent.length ? apiRecent : tempApprovedOverrides.slice(0, 5));
      return;
    }

    setOverrides(apiOverrides);
    setCounts({ pending: apiPending, approved: apiApproved });
    setOldestPending(apiOldest);
    setRecentApprovedThisWeek(apiRecent);
  }

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

        applyOverridesPayload(response.data, statusFilter);
        setErrorMessage('');
      } catch {
        if (!isActive) {
          return;
        }

        if (USE_TEMP_OVERRIDE_PREVIEW) {
          applyOverridesPayload({ overrides: [], counts: {}, oldestPending: null, recentApprovedThisWeek: [] }, statusFilter);
          setErrorMessage('');
        } else {
          setOverrides([]);
          setOldestPending(null);
          setRecentApprovedThisWeek([]);
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
    return overrides.filter((override) => {
      const windowDate = getRequestedWindowDate(override);

      if (dateFrom && (!windowDate || windowDate < dateFrom)) {
        return false;
      }

      if (dateTo && (!windowDate || windowDate > dateTo)) {
        return false;
      }

      if (!normalizedSearchQuery) {
        return true;
      }

      return [
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
        .some((value) => String(value).toLowerCase().includes(normalizedSearchQuery));
    });
  }, [dateFrom, dateTo, normalizedSearchQuery, overrides]);

  const rowsPerPage = 6;
  const totalPages = Math.max(1, Math.ceil(visibleOverrides.length / rowsPerPage));
  const paginatedOverrides = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return visibleOverrides.slice(startIndex, startIndex + rowsPerPage);
  }, [currentPage, visibleOverrides]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [dateFrom, dateTo, normalizedSearchQuery, statusFilter]);

  const activeStatusFilter =
    statusFilterOptions.find((option) => option.value === statusFilter) || statusFilterOptions[0];
  const pendingCount = counts.pending;

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
      applyOverridesPayload(response.data);
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
      setErrorMessage(
        error.response?.data?.message || 'Unable to update that override request right now.',
      );
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
    setIsReviewLoading(true);

    try {
      const response = await axiosClient.get('/api/pending_overrides.php', {
        params: { id: override.id },
      });
      setReview(response.data.override || override);
    } catch (error) {
      setReview(null);
      setErrorMessage(
        error.response?.data?.message || 'Unable to load this override request right now.',
      );
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
        <section className="pending-overrides-top" aria-label="Pending override summary">
          <div className="pending-overrides-summary-stack">
            <article className="dashboard-summary-card rfid-summary-card">
              <div className="dashboard-summary-icon" aria-hidden="true">
                <ShieldAlert size={28} strokeWidth={2.4} />
              </div>
              <div className="dashboard-summary-copy">
                <span className="dashboard-summary-label">Waiting for review</span>
                <strong>{isLoading ? '--' : pendingCount}</strong>
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
                  {isLoading
                    ? '--'
                    : oldestPending?.createdDateLabel || (pendingCount > 0 ? '—' : 'None')}
                </strong>
                <small>
                  {isLoading
                    ? 'Loading request queue'
                    : oldestPending?.createdTimeLabel
                      ? `Submitted at ${oldestPending.createdTimeLabel}`
                      : 'No requests in the queue'}
                </small>
              </div>
            </article>
          </div>

          <aside className="dashboard-recent-card pending-overrides-recent-card" aria-label="Recent approved overrides this week">
            <div className="dashboard-panel-header">
              <div>
                <span>Recent Approved Overrides</span>
                <p>This week only. Resets every Monday. Up to 5 shown.</p>
              </div>
              <button
                type="button"
                className="dashboard-schedule-button pending-overrides-add-button"
                onClick={() => setIsOverrideCreateOpen(true)}
              >
                <CalendarPlus size={14} aria-hidden="true" />
                Add Override
              </button>
            </div>
            <div className="pending-overrides-recent-list">
              {isLoading ? (
                <p className="pending-overrides-recent-empty">Loading approved overrides...</p>
              ) : recentApprovedThisWeek.length ? (
                recentApprovedThisWeek.map((override) => (
                  <div className="pending-overrides-recent-item" key={override.id}>
                    <div className="pending-overrides-recent-copy">
                      <span>{override.name}</span>
                      <strong>
                        {override.dateLabel} · {override.timeLabel}
                      </strong>
                    </div>
                    <small className="dashboard-log-status dashboard-log-status-approved">
                      {override.stateLabel}
                    </small>
                  </div>
                ))
              ) : (
                <p className="pending-overrides-recent-empty">No approved overrides this week.</p>
              )}
            </div>
          </aside>
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
                placeholder="Search name, role, school/employee ID, or reason"
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

            <div className="activity-logs-dates" aria-label="Filter by requested window date">
              <label>
                <span>From</span>
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </label>
              <span className="activity-logs-dates-divider" aria-hidden="true" />
              <label>
                <span>To</span>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </label>
              {dateFrom || dateTo ? (
                <button
                  type="button"
                  className="activity-logs-clear"
                  aria-label="Clear requested window dates"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <button
              type="button"
              className="activity-logs-reset"
              aria-label="Reset filters"
              title="Reset filters"
              onClick={() => {
                setDateFrom('');
                setDateTo('');
                setSearchQuery('');
                setIsStatusFilterMenuOpen(false);
              }}
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          </div>

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

                {!isLoading && visibleOverrides.length === 0 && (
                  <tr>
                    <td className="dashboard-recent-empty" colSpan={columns.length}>
                      <TableEmptyState description={normalizedSearchQuery || dateFrom || dateTo ? 'Try adjusting your search or date filters.' : isPendingView ? 'New temporary access requests will appear here for review.' : 'Approved temporary access requests will appear here.'}>
                        {normalizedSearchQuery || dateFrom || dateTo
                          ? 'No override requests match your filters.'
                          : isPendingView
                            ? 'No override requests are waiting for review.'
                            : 'No approved override requests yet.'}
                      </TableEmptyState>
                    </td>
                  </tr>
                )}

                {!isLoading &&
                  paginatedOverrides.map((override) => (
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

          {!isLoading && visibleOverrides.length > 0 && (
            <div className="manage-users-pagination" aria-label="Override requests pagination">
              <p>
                Showing {(currentPage - 1) * rowsPerPage + 1}-
                {Math.min(currentPage * rowsPerPage, visibleOverrides.length)} of {visibleOverrides.length}
              </p>
              <div className="manage-users-pagination-controls">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </button>
                <span>Page {currentPage} of {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          )}
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
                {!isReviewLoading ? (
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

      <ErrorNoticeModal
        open={Boolean(errorMessage)}
        message={errorMessage}
        onClose={() => setErrorMessage('')}
      />

      <ScheduleCreateModal
        open={isOverrideCreateOpen}
        preset="override"
        onClose={() => setIsOverrideCreateOpen(false)}
        onCreated={async () => {
          try {
            const response = await axiosClient.get('/api/pending_overrides.php', {
              params: { status: statusFilter },
            });
            applyOverridesPayload(response.data, statusFilter);
          } catch {
            // Keep the current page state if refresh fails after create.
          }
        }}
      />
    </>
  );
}
