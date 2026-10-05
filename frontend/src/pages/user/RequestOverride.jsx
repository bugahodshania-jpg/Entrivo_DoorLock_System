import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Eye,
  Pencil,
  Send,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import RowActionMenu from '../../components/RowActionMenu';
import { useActionConfirm } from '../../components/ActionConfirm';
import PortalToast from '../../components/PortalToast';
import { getManilaDateStamp } from '../../utils/dateTime';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/schedules.css';
import '../../styles/superAdmin/accessLogs.css';
import '../../styles/superAdmin/activityLogs.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/rfid.css';
import '../../styles/user/userPortal.css';

const statusFilterOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'upcoming', label: 'Incoming' },
  { value: 'active', label: 'Active' },
  { value: 'done', label: 'Done' },
];

const emptyEditForm = {
  scheduleDate: '',
  timeStart: '08:00',
  timeEnd: '17:00',
  reason: '',
};

function getInitialOverrideForm() {
  const params = new URLSearchParams(window.location.search);
  const dateParam = params.get('date');
  const today = getManilaDateStamp();
  const scheduleDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  return {
    scheduleDate,
    timeStart: '08:00',
    timeEnd: '17:00',
    reason: '',
  };
}

function validateOverrideWindow({ scheduleDate, timeStart, timeEnd, reason }) {
  if (!scheduleDate) {
    return 'Schedule date is required.';
  }

  if (!timeStart || !timeEnd) {
    return 'Time start and time end are required.';
  }

  if (timeEnd <= timeStart) {
    return 'Time end must be after time start.';
  }

  if (!reason) {
    return 'A reason is required for the override request.';
  }

  return '';
}

function splitDateTimeLabel(value) {
  const label = String(value || '').trim();

  if (!label) {
    return { dateLabel: '—', timeLabel: '' };
  }

  const match = label.match(/^(.*\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)$/i);

  if (match) {
    return { dateLabel: match[1].trim(), timeLabel: match[2].trim() };
  }

  return { dateLabel: label, timeLabel: '' };
}

function getOverrideAccessParts(override) {
  const dateLabel =
    override.dateLabel ||
    override.scheduleDate ||
    splitDateTimeLabel(override.start).dateLabel;

  const timeLabel =
    override.time ||
    [override.timeStartLabel, override.timeEndLabel].filter(Boolean).join(' - ') ||
    [
      splitDateTimeLabel(override.start).timeLabel,
      splitDateTimeLabel(override.end).timeLabel,
    ]
      .filter(Boolean)
      .join(' - ');

  return {
    dateLabel: dateLabel || '—',
    timeLabel: timeLabel || '—',
  };
}

function getOverrideRequestedParts(override) {
  if (override.createdDateLabel || override.createdTimeLabel) {
    return {
      dateLabel: override.createdDateLabel || '—',
      timeLabel: override.createdTimeLabel || '',
    };
  }

  return splitDateTimeLabel(override.createdAt);
}

export default function RequestOverride({ user }) {
  const confirmAction = useActionConfirm();
  const statusFilterMenuRef = useRef(null);
  const [form, setForm] = useState(getInitialOverrideForm);
  const [overrides, setOverrides] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isStatusFilterMenuOpen, setIsStatusFilterMenuOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [viewOverride, setViewOverride] = useState(null);
  const [editingOverride, setEditingOverride] = useState(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editError, setEditError] = useState('');
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);
  const [cancelOverride, setCancelOverride] = useState(null);
  const [isCancelSubmitting, setIsCancelSubmitting] = useState(false);
  const rowsPerPage = 7;

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    let isActive = true;

    async function loadOverrides() {
      try {
        const response = await axiosClient.get('/api/user_portal.php', {
          params: { action: 'overrides', user_id: user.id },
        });

        if (!isActive) {
          return;
        }

        setOverrides(response.data.overrides || []);
        setErrorMessage('');
      } catch {
        if (isActive) {
          setOverrides([]);
          setErrorMessage('Unable to load override requests.');
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
  }, [user?.id]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter]);

  useEffect(() => {
    if (!isStatusFilterMenuOpen && !viewOverride && !editingOverride && !cancelOverride) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (isStatusFilterMenuOpen && !statusFilterMenuRef.current?.contains(event.target)) {
        setIsStatusFilterMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key !== 'Escape') {
        return;
      }

      setIsStatusFilterMenuOpen(false);

      if (!isEditSubmitting && !isCancelSubmitting) {
        setViewOverride(null);
        setEditingOverride(null);
        setCancelOverride(null);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    cancelOverride,
    editingOverride,
    isCancelSubmitting,
    isEditSubmitting,
    isStatusFilterMenuOpen,
    viewOverride,
  ]);

  const statusCounts = useMemo(() => {
    const counts = { all: overrides.length };
    statusFilterOptions.forEach((option) => {
      if (option.value === 'all') {
        return;
      }
      counts[option.value] = overrides.filter((item) => item.state === option.value).length;
    });
    return counts;
  }, [overrides]);

  const visibleOverrides = useMemo(() => {
    if (statusFilter === 'all') {
      return overrides;
    }

    return overrides.filter((item) => item.state === statusFilter);
  }, [overrides, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(visibleOverrides.length / rowsPerPage));
  const pageRows = visibleOverrides.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage,
  );

  const activeStatusFilter =
    statusFilterOptions.find((option) => option.value === statusFilter) || statusFilterOptions[0];

  const isSubmitReady = useMemo(() => {
    const scheduleDate = String(form.scheduleDate || '').trim();
    const timeStart = String(form.timeStart || '').trim();
    const timeEnd = String(form.timeEnd || '').trim();
    const reason = String(form.reason || '').trim();

    return Boolean(
      scheduleDate &&
        timeStart &&
        timeEnd &&
        reason &&
        timeEnd > timeStart,
    );
  }, [form.reason, form.scheduleDate, form.timeEnd, form.timeStart]);

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
    setFormError('');
  }

  function updateEditField(field, value) {
    setEditForm((current) => ({
      ...current,
      [field]: value,
    }));
    setEditError('');
  }

  function handleView(override) {
    setViewOverride(override);
  }

  function handleEdit(override) {
    setEditingOverride(override);
    setEditForm({
      scheduleDate: override.scheduleDate || override.dateValue || '',
      timeStart: String(override.timeStart || '08:00').slice(0, 5),
      timeEnd: String(override.timeEnd || '17:00').slice(0, 5),
      reason: override.reason === 'No reason provided' ? '' : override.reason || '',
    });
    setEditError('');
  }

  function handleCancel(override) {
    setCancelOverride(override);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!user?.id || isSubmitting) {
      return;
    }

    const scheduleDate = String(form.scheduleDate || '').trim();
    const timeStart = String(form.timeStart || '').trim();
    const timeEnd = String(form.timeEnd || '').trim();
    const reason = String(form.reason || '').trim();
    const validationError = validateOverrideWindow({
      scheduleDate,
      timeStart,
      timeEnd,
      reason,
    });

    if (validationError) {
      setFormError(validationError);
      return;
    }

    const confirmed = await confirmAction({
      title: 'Submit override request',
      message: 'Are you sure you want to submit this override request for review?',
    });

    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setFormError('');

    try {
      const response = await axiosClient.post('/api/user_portal.php', {
        action: 'request_override',
        user_id: user.id,
        scheduleDate,
        timeStart,
        timeEnd,
        reason,
      });

      setOverrides(response.data.overrides || []);
      setToast({
        type: 'success',
        title: 'Override Notice',
        message: response.data.message || 'Override request submitted and is pending review.',
      });
      setForm((current) => ({
        ...current,
        reason: '',
      }));
      setStatusFilter('all');
      setCurrentPage(1);
    } catch (error) {
      setErrorMessage(error?.response?.data?.message || 'Unable to submit override request.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEditSubmit(event) {
    event.preventDefault();

    if (!user?.id || !editingOverride || isEditSubmitting) {
      return;
    }

    const scheduleDate = String(editForm.scheduleDate || '').trim();
    const timeStart = String(editForm.timeStart || '').trim();
    const timeEnd = String(editForm.timeEnd || '').trim();
    const reason = String(editForm.reason || '').trim();
    const validationError = validateOverrideWindow({
      scheduleDate,
      timeStart,
      timeEnd,
      reason,
    });

    if (validationError) {
      setEditError(validationError);
      return;
    }

    const confirmed = await confirmAction({
      title: 'Save override changes',
      message: 'Are you sure you want to save these changes to your override request?',
    });

    if (!confirmed) {
      return;
    }

    setIsEditSubmitting(true);
    setEditError('');

    try {
      const response = await axiosClient.post('/api/user_portal.php', {
        action: 'update_override',
        user_id: user.id,
        overrideId: editingOverride.id,
        scheduleDate,
        timeStart,
        timeEnd,
        reason,
      });

      setOverrides(response.data.overrides || []);
      setToast({
        type: 'success',
        title: 'Override Notice',
        message: response.data.message || 'Override request updated.',
      });
      setEditingOverride(null);
    } catch (error) {
      setEditError(error?.response?.data?.message || 'Unable to update override request.');
    } finally {
      setIsEditSubmitting(false);
    }
  }

  async function confirmCancelOverride() {
    if (!user?.id || !cancelOverride || isCancelSubmitting) {
      return;
    }

    const confirmed = await confirmAction({
      title: 'Cancel override request',
      message: 'Are you sure you want to cancel this override request? This cannot be undone.',
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    setIsCancelSubmitting(true);

    try {
      const response = await axiosClient.post('/api/user_portal.php', {
        action: 'cancel_override',
        user_id: user.id,
        overrideId: cancelOverride.id,
      });

      setOverrides(response.data.overrides || []);
      setToast({
        type: 'success',
        title: 'Override Notice',
        message: response.data.message || 'Override request cancelled.',
      });
      setCancelOverride(null);

      if (viewOverride?.id === cancelOverride.id) {
        setViewOverride(null);
      }
    } catch (error) {
      setErrorMessage(error?.response?.data?.message || 'Unable to cancel override request.');
      setCancelOverride(null);
    } finally {
      setIsCancelSubmitting(false);
    }
  }

  return (
    <main
      className="admin-dashboard schedules-page user-portal-page user-override-page"
      aria-label="Request override"
    >
      {toast ? (
        <PortalToast
          title={toast.title || 'Notice'}
          message={toast.message}
          type={toast.type || 'success'}
          onClose={() => setToast(null)}
        />
      ) : null}
      {errorMessage ? <p className="user-portal-error">{errorMessage}</p> : null}

      <div className="user-override-page-layout">
        <section className="dashboard-recent-card schedules-card user-override-history-card">
          <div className="dashboard-panel-header">
            <div>
              <h2>Your override requests</h2>
              <p>Track pending, active, and completed requests.</p>
            </div>
          </div>

          <div className="schedules-table-filters user-override-toolbar">
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
                aria-controls="user-override-status-filter-menu"
                aria-label={`Status filter: ${activeStatusFilter.label}`}
                disabled={isLoading}
                onClick={() => setIsStatusFilterMenuOpen((open) => !open)}
              >
                <span className="schedules-table-tab-trigger-label">
                  {activeStatusFilter.label}
                </span>
                <span className="schedules-table-tab-count">
                  {isLoading ? '--' : statusCounts[statusFilter] || 0}
                </span>
                <ChevronDown
                  className="schedules-table-tab-chevron"
                  size={14}
                  aria-hidden="true"
                />
              </button>

              {isStatusFilterMenuOpen ? (
                <div
                  id="user-override-status-filter-menu"
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
                        setIsStatusFilterMenuOpen(false);
                      }}
                    >
                      <Check className="schedules-table-tab-check" size={15} aria-hidden="true" />
                      <span className="schedules-table-tab-option-label">{option.label}</span>
                      <span className="schedules-table-tab-count">
                        {isLoading ? '--' : statusCounts[option.value] || 0}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="dashboard-recent-table-wrap">
            {isLoading || pageRows.length ? (
              <table className="dashboard-recent-table user-override-table">
                <thead>
                  <tr>
                    <th>Reason</th>
                    <th>Access window</th>
                    <th>Requested</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={5}>Loading override requests…</td>
                    </tr>
                  ) : (
                    pageRows.map((override) => {
                      const accessParts = getOverrideAccessParts(override);
                      const requestedParts = getOverrideRequestedParts(override);

                      return (
                      <tr key={override.id}>
                        <td>
                          <strong className="user-override-reason">{override.reason}</strong>
                        </td>
                        <td>
                          <div className="schedules-window-cell">
                            <strong>{accessParts.dateLabel}</strong>
                            <span>{accessParts.timeLabel}</span>
                          </div>
                        </td>
                        <td>
                          <div className="schedules-window-cell">
                            <strong>{requestedParts.dateLabel}</strong>
                            {requestedParts.timeLabel ? (
                              <span>{requestedParts.timeLabel}</span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`dashboard-log-status dashboard-log-status-${override.state || 'pending'}`}
                          >
                            {override.stateLabel || 'Pending'}
                          </span>
                        </td>
                        <td>
                          <RowActionMenu
                            label={`Actions for override ${override.id}`}
                            items={[
                              {
                                label: 'View',
                                icon: Eye,
                                onClick: () => handleView(override),
                              },
                              {
                                label: 'Edit',
                                icon: Pencil,
                                disabled: !override.canEdit,
                                onClick: () => handleEdit(override),
                              },
                              {
                                label: 'Cancel',
                                icon: XCircle,
                                danger: true,
                                disabled: !override.canCancel,
                                onClick: () => handleCancel(override),
                              },
                            ]}
                          />
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            ) : (
              <div className="user-override-empty-state">
                <table className="dashboard-recent-table user-override-table">
                  <thead>
                    <tr>
                      <th>Reason</th>
                      <th>Access window</th>
                      <th>Requested</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                </table>
                <p className="user-override-empty">No override requests found.</p>
              </div>
            )}
          </div>

          {!isLoading && visibleOverrides.length > 0 ? (
            <div className="activity-logs-pagination" aria-label="Override requests pagination">
              <p>
                Showing {(currentPage - 1) * rowsPerPage + 1}-
                {Math.min(currentPage * rowsPerPage, visibleOverrides.length)} of{' '}
                {visibleOverrides.length}
              </p>
              <div className="activity-logs-pagination-controls">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                >
                  Previous
                </button>
                <span>
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="dashboard-recent-card schedules-card user-override-form-card">
          <div className="dashboard-panel-header">
            <div>
              <h2>Request Override</h2>
              <p>Request a single-day access window outside your normal schedule.</p>
            </div>
            <span className="user-override-form-icon" aria-hidden="true">
              <ShieldAlert size={18} />
            </span>
          </div>

          <form className="user-override-form" onSubmit={handleSubmit}>
            <div className="schedules-form-grid">
              <div className="schedules-form-row">
                <div className="schedules-field">
                  <label htmlFor="override-page-type">Schedule Type</label>
                  <input
                    id="override-page-type"
                    type="text"
                    value="Single"
                    readOnly
                    disabled
                  />
                </div>
                <div className="schedules-field">
                  <label htmlFor="override-page-date">Schedule Date</label>
                  <input
                    id="override-page-date"
                    type="date"
                    value={form.scheduleDate}
                    onChange={(event) => updateField('scheduleDate', event.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="schedules-form-row">
                <div className="schedules-field">
                  <label htmlFor="override-page-time-start">Time Start</label>
                  <input
                    id="override-page-time-start"
                    type="time"
                    value={form.timeStart}
                    onChange={(event) => updateField('timeStart', event.target.value)}
                    required
                  />
                </div>
                <div className="schedules-field">
                  <label htmlFor="override-page-time-end">Time End</label>
                  <input
                    id="override-page-time-end"
                    type="time"
                    value={form.timeEnd}
                    onChange={(event) => updateField('timeEnd', event.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="schedules-field">
                <label htmlFor="override-page-reason">Reason</label>
                <textarea
                  id="override-page-reason"
                  rows={4}
                  value={form.reason}
                  onChange={(event) => updateField('reason', event.target.value)}
                  placeholder="Explain why you need temporary access..."
                  required
                />
              </div>
            </div>

            {formError ? <p className="schedules-form-error">{formError}</p> : null}

            <div className="schedules-form-actions">
              <button
                type="submit"
                className="schedules-primary-button"
                disabled={isSubmitting || !isSubmitReady}
              >
                <Send size={15} aria-hidden="true" />
                {isSubmitting ? 'Submitting…' : 'Submit for review'}
              </button>
            </div>
          </form>
        </section>
      </div>

      {viewOverride ? (
        <div
          className="pending-registration-review-backdrop schedules-view-backdrop"
          role="presentation"
          onClick={() => setViewOverride(null)}
        >
          <section
            className="pending-registration-review schedules-view-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="override-view-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="override-view-title">Override Details</h2>
                <p>Override #{viewOverride.id}</p>
              </div>
              <button
                type="button"
                aria-label="Close override details"
                onClick={() => setViewOverride(null)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <div className="pending-registration-review-body">
              <section className="pending-registration-review-card">
                <h3>Request</h3>
                <dl>
                  <div>
                    <dt>Reason</dt>
                    <dd>{viewOverride.reason || '—'}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <span
                        className={`dashboard-log-status dashboard-log-status-${viewOverride.state || 'pending'}`}
                      >
                        {viewOverride.stateLabel || 'Pending'}
                      </span>
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="pending-registration-review-card">
                <h3>Access window</h3>
                <dl>
                  <div>
                    <dt>Schedule date</dt>
                    <dd>{viewOverride.scheduleDate || viewOverride.dateValue || '—'}</dd>
                  </div>
                  <div>
                    <dt>Time range</dt>
                    <dd>
                      {viewOverride.start} – {viewOverride.end}
                    </dd>
                  </div>
                  <div>
                    <dt>Requested</dt>
                    <dd>{viewOverride.createdAt || '—'}</dd>
                  </div>
                </dl>
              </section>
            </div>

            <footer>
              <button
                type="button"
                className="pending-registration-reject"
                onClick={() => setViewOverride(null)}
              >
                Close
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {editingOverride ? (
        <div
          className="schedules-modal-overlay"
          role="presentation"
          onClick={() => {
            if (!isEditSubmitting) {
              setEditingOverride(null);
            }
          }}
        >
          <div
            className="schedules-modal user-override-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="override-edit-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="schedules-modal-header">
              <div>
                <strong id="override-edit-title">Edit Override</strong>
                <p>Update this pending single-day override request.</p>
              </div>
              <button
                type="button"
                className="schedules-modal-close"
                aria-label="Close edit override"
                onClick={() => setEditingOverride(null)}
                disabled={isEditSubmitting}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit}>
              <div className="schedules-form-grid">
                <div className="schedules-form-row">
                  <div className="schedules-field">
                    <label htmlFor="override-edit-type">Schedule Type</label>
                    <input id="override-edit-type" type="text" value="Single" readOnly disabled />
                  </div>
                  <div className="schedules-field">
                    <label htmlFor="override-edit-date">Schedule Date</label>
                    <input
                      id="override-edit-date"
                      type="date"
                      value={editForm.scheduleDate}
                      onChange={(event) => updateEditField('scheduleDate', event.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="schedules-form-row">
                  <div className="schedules-field">
                    <label htmlFor="override-edit-time-start">Time Start</label>
                    <input
                      id="override-edit-time-start"
                      type="time"
                      value={editForm.timeStart}
                      onChange={(event) => updateEditField('timeStart', event.target.value)}
                      required
                    />
                  </div>
                  <div className="schedules-field">
                    <label htmlFor="override-edit-time-end">Time End</label>
                    <input
                      id="override-edit-time-end"
                      type="time"
                      value={editForm.timeEnd}
                      onChange={(event) => updateEditField('timeEnd', event.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="schedules-field">
                  <label htmlFor="override-edit-reason">Reason</label>
                  <textarea
                    id="override-edit-reason"
                    rows={3}
                    value={editForm.reason}
                    onChange={(event) => updateEditField('reason', event.target.value)}
                    placeholder="Explain why you need temporary access..."
                    required
                  />
                </div>
              </div>

              {editError ? <p className="schedules-form-error">{editError}</p> : null}

              <div className="schedules-form-actions">
                <button
                  type="button"
                  className="schedules-secondary-button"
                  onClick={() => setEditingOverride(null)}
                  disabled={isEditSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="schedules-primary-button"
                  disabled={isEditSubmitting}
                >
                  {isEditSubmitting ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {cancelOverride ? (
        <div
          className="schedules-modal-overlay"
          role="presentation"
          onClick={() => {
            if (!isCancelSubmitting) {
              setCancelOverride(null);
            }
          }}
        >
          <div
            className="schedules-modal user-override-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="override-cancel-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="schedules-modal-header">
              <div>
                <strong id="override-cancel-title">Cancel Override</strong>
                <p>This will permanently remove override #{cancelOverride.id}.</p>
              </div>
              <button
                type="button"
                className="schedules-modal-close"
                aria-label="Close cancel override"
                onClick={() => setCancelOverride(null)}
                disabled={isCancelSubmitting}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <p className="user-override-cancel-copy">
              <strong>{cancelOverride.reason}</strong>
              <span>
                {cancelOverride.start} – {cancelOverride.end}
              </span>
            </p>

            <div className="schedules-form-actions">
              <button
                type="button"
                className="schedules-secondary-button"
                onClick={() => setCancelOverride(null)}
                disabled={isCancelSubmitting}
              >
                Keep request
              </button>
              <button
                type="button"
                className="schedules-primary-button user-override-cancel-button"
                onClick={confirmCancelOverride}
                disabled={isCancelSubmitting}
              >
                {isCancelSubmitting ? 'Cancelling…' : 'Cancel request'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
