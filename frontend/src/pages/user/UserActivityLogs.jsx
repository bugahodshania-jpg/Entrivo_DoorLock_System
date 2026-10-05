import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Download, Eye, Search, X } from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import ExportFormatModal from '../../components/ExportFormatModal';
import RowActionMenu from '../../components/RowActionMenu';
import { getManilaDateStamp } from '../../utils/dateTime';
import { buildExportNote, exportTable } from '../../utils/exportFiles';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/activityLogs.css';
import '../../styles/superAdmin/schedules.css';
import '../../styles/superAdmin/rfid.css';
import '../../styles/user/userPortal.css';

const activityFilterOptions = [
  { value: 'all', label: 'All categories' },
  { value: 'login', label: 'Login' },
  { value: 'logout', label: 'Logout' },
  { value: 'access', label: 'Access' },
  { value: 'password', label: 'Password' },
  { value: 'recovery', label: 'Recovery' },
  { value: 'account', label: 'Account' },
  { value: 'security', label: 'Security' },
  { value: 'registration', label: 'Registration' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'override', label: 'Override' },
  { value: 'job', label: 'Job' },
  { value: 'enroll', label: 'Enroll' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'sync', label: 'Sync' },
  { value: 'rfid', label: 'RFID' },
  { value: 'user', label: 'User' },
];

const statusFilterOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
];

export default function UserActivityLogs({ user }) {
  const activityFilterMenuRef = useRef(null);
  const statusFilterMenuRef = useRef(null);
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [activityFilter, setActivityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isActivityFilterMenuOpen, setIsActivityFilterMenuOpen] = useState(false);
  const [isStatusFilterMenuOpen, setIsStatusFilterMenuOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [viewLog, setViewLog] = useState(null);
  const rowsPerPage = 10;

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    let isActive = true;

    async function loadLogs() {
      try {
        const response = await axiosClient.get('/api/user_portal.php', {
          params: { action: 'activity_logs', user_id: user.id },
        });

        if (!isActive) {
          return;
        }

        setLogs(response.data.logs || []);
        setErrorMessage('');
      } catch {
        if (isActive) {
          setLogs([]);
          setErrorMessage('Unable to load activity logs right now.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadLogs();

    return () => {
      isActive = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!isActivityFilterMenuOpen && !isStatusFilterMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (isActivityFilterMenuOpen && !activityFilterMenuRef.current?.contains(event.target)) {
        setIsActivityFilterMenuOpen(false);
      }

      if (isStatusFilterMenuOpen && !statusFilterMenuRef.current?.contains(event.target)) {
        setIsStatusFilterMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsActivityFilterMenuOpen(false);
        setIsStatusFilterMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActivityFilterMenuOpen, isStatusFilterMenuOpen]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activityFilter, statusFilter, dateFrom, dateTo, searchQuery]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleLogs = useMemo(() => {
    return logs.filter((log) => {
      if (activityFilter !== 'all' && String(log.activity).toLowerCase() !== activityFilter) {
        return false;
      }

      if (statusFilter !== 'all' && String(log.status).toLowerCase() !== statusFilter) {
        return false;
      }

      if (dateFrom && log.dateValue < dateFrom) {
        return false;
      }

      if (dateTo && log.dateValue > dateTo) {
        return false;
      }

      if (!normalizedSearchQuery) {
        return true;
      }

      return [log.activity, log.description, log.status, log.device, log.deviceDetail, log.date, log.time]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearchQuery));
    });
  }, [activityFilter, dateFrom, dateTo, logs, normalizedSearchQuery, statusFilter]);

  const activityFilterCounts = useMemo(() => {
    const counts = { all: logs.length };
    activityFilterOptions.forEach((option) => {
      if (option.value === 'all') {
        return;
      }
      counts[option.value] = logs.filter(
        (log) => String(log.activity || '').toLowerCase() === option.value,
      ).length;
    });
    return counts;
  }, [logs]);

  const statusFilterCounts = useMemo(() => {
    const scoped =
      activityFilter === 'all'
        ? logs
        : logs.filter((log) => String(log.activity).toLowerCase() === activityFilter);
    const counts = { all: scoped.length, success: 0, failed: 0 };
    scoped.forEach((log) => {
      const key = String(log.status || '').toLowerCase();
      if (key in counts) {
        counts[key] += 1;
      }
    });
    return counts;
  }, [activityFilter, logs]);

  const totalPages = Math.max(1, Math.ceil(visibleLogs.length / rowsPerPage));
  const pageRows = visibleLogs.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  const activeActivityFilter = activityFilterOptions.find((item) => item.value === activityFilter);
  const activeStatusFilter = statusFilterOptions.find((item) => item.value === statusFilter);

  function handleExport(format) {
    setIsExportModalOpen(false);
    exportTable(format, {
      headers: ['Date', 'Time', 'Activity', 'Action', 'Description', 'Status', 'Device', 'Detail'],
      rows: visibleLogs.map((log) => [
        log.date,
        log.time,
        log.activity,
        log.activityType || log.activity,
        log.description,
        log.status,
        log.device,
        log.deviceDetail,
      ]),
      fileBaseName: `my_activity_logs_${getManilaDateStamp()}`,
      pdf: {
        title: 'My Activity Logs',
        note: buildExportNote(visibleLogs.length, 'record', [
          activityFilter !== 'all' ? `Category: ${activeActivityFilter?.label}` : '',
          statusFilter !== 'all' ? `Status: ${activeStatusFilter?.label}` : '',
          dateFrom ? `From ${dateFrom}` : '',
          dateTo ? `To ${dateTo}` : '',
          searchQuery.trim() ? `Search: "${searchQuery.trim()}"` : '',
        ]),
        widths: [65, 55, 65, 65, 240, 55, 70, 120],
        emphasizeColumn: 2,
        emptyMessage: 'No activity logs match the selected filters.',
      },
    });
  }

  function handleView(log) {
    setViewLog(log);
  }

  function closeViewModal() {
    setViewLog(null);
  }

  return (
    <main className="admin-dashboard activity-logs-page user-portal-page" aria-label="Activity logs">
      <section className="dashboard-recent-card activity-logs-card">
        <div className="dashboard-panel-header activity-logs-header">
          <div>
            <span>Activity Logs</span>
            <p>
              Your sign-in, door access, password changes, account recovery, schedules, and other
              transactions recorded for your account.
            </p>
          </div>
          <button
            type="button"
            className="activity-logs-export"
            onClick={() => setIsExportModalOpen(true)}
            disabled={isLoading || Boolean(errorMessage) || visibleLogs.length === 0}
          >
            <Download size={15} aria-hidden="true" />
            Export
          </button>
        </div>

        <div className="activity-logs-toolbar">
          <div className="activity-logs-toolbar-filters">
            <div
              className="manage-users-role-tabs manage-users-status-filter"
              ref={activityFilterMenuRef}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setIsActivityFilterMenuOpen(false);
                }
              }}
            >
              <button
                type="button"
                className={`manage-users-role-tab-trigger${isActivityFilterMenuOpen ? ' is-open' : ''}`}
                aria-haspopup="listbox"
                aria-expanded={isActivityFilterMenuOpen}
                aria-controls="user-activity-logs-activity-filter-menu"
                aria-label={`Activity filter: ${activeActivityFilter.label}`}
                disabled={isLoading}
                onClick={() => {
                  setIsActivityFilterMenuOpen((open) => !open);
                  setIsStatusFilterMenuOpen(false);
                }}
              >
                <span className="manage-users-role-tab-trigger-label">{activeActivityFilter.label}</span>
                <span className="manage-users-role-tab-count">
                  {isLoading ? '--' : activityFilterCounts[activityFilter] || 0}
                </span>
                <ChevronDown className="manage-users-role-tab-chevron" size={14} aria-hidden="true" />
              </button>

              {isActivityFilterMenuOpen ? (
                <div
                  id="user-activity-logs-activity-filter-menu"
                  className="manage-users-role-tab-menu"
                  role="listbox"
                  aria-label="Filter by activity"
                >
                  {activityFilterOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      className={`manage-users-role-tab-option${
                        activityFilter === option.value ? ' is-active' : ''
                      }`}
                      aria-selected={activityFilter === option.value}
                      onClick={() => {
                        setActivityFilter(option.value);
                        setIsActivityFilterMenuOpen(false);
                      }}
                    >
                      <Check className="manage-users-role-tab-check" size={15} aria-hidden="true" />
                      <span className="manage-users-role-tab-option-label">{option.label}</span>
                      <span className="manage-users-role-tab-count">
                        {isLoading ? '--' : activityFilterCounts[option.value] || 0}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div
              className="manage-users-role-tabs manage-users-status-filter"
              ref={statusFilterMenuRef}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setIsStatusFilterMenuOpen(false);
                }
              }}
            >
              <button
                type="button"
                className={`manage-users-role-tab-trigger${isStatusFilterMenuOpen ? ' is-open' : ''}`}
                aria-haspopup="listbox"
                aria-expanded={isStatusFilterMenuOpen}
                aria-controls="user-activity-logs-status-filter-menu"
                aria-label={`Status filter: ${activeStatusFilter.label}`}
                disabled={isLoading}
                onClick={() => {
                  setIsStatusFilterMenuOpen((open) => !open);
                  setIsActivityFilterMenuOpen(false);
                }}
              >
                <span className="manage-users-role-tab-trigger-label">{activeStatusFilter.label}</span>
                <span className="manage-users-role-tab-count">
                  {isLoading ? '--' : statusFilterCounts[statusFilter] || 0}
                </span>
                <ChevronDown className="manage-users-role-tab-chevron" size={14} aria-hidden="true" />
              </button>

              {isStatusFilterMenuOpen ? (
                <div
                  id="user-activity-logs-status-filter-menu"
                  className="manage-users-role-tab-menu"
                  role="listbox"
                  aria-label="Filter by status"
                >
                  {statusFilterOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      className={`manage-users-role-tab-option${
                        statusFilter === option.value ? ' is-active' : ''
                      }`}
                      aria-selected={statusFilter === option.value}
                      onClick={() => {
                        setStatusFilter(option.value);
                        setIsStatusFilterMenuOpen(false);
                      }}
                    >
                      <Check className="manage-users-role-tab-check" size={15} aria-hidden="true" />
                      <span className="manage-users-role-tab-option-label">{option.label}</span>
                      <span className="manage-users-role-tab-count">
                        {isLoading ? '--' : statusFilterCounts[option.value] || 0}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="activity-logs-dates">
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
                  aria-label="Clear dates"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>

          <label className="activity-logs-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search activity or device"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        </div>

        <div className="dashboard-recent-table-wrap user-activity-logs-table-wrap">
          <table className="dashboard-recent-table activity-logs-table user-activity-logs-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Activity</th>
                <th>Description</th>
                <th>Status</th>
                <th>Device</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="dashboard-recent-empty" colSpan="7">
                    Loading activity logs…
                  </td>
                </tr>
              ) : errorMessage ? (
                <tr>
                  <td className="dashboard-recent-empty" colSpan="7">
                    {errorMessage}
                  </td>
                </tr>
              ) : pageRows.length ? (
                pageRows.map((log) => (
                  <tr key={log.id}>
                    <td>{log.date}</td>
                    <td>{log.time}</td>
                    <td>
                      <span
                        className={`dashboard-log-status activity-logs-status-${String(log.activity || '')
                          .toLowerCase()
                          .replace(/\s+/g, '-')}`}
                      >
                        {log.activity}
                      </span>
                    </td>
                    <td>
                      <span className="user-activity-logs-description" title={log.description || ''}>
                        {log.description}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`dashboard-log-status activity-logs-status-${String(log.status || '')
                          .toLowerCase()
                          .replace(/\s+/g, '-')}`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td>
                      <strong title={log.device || ''}>{log.device}</strong>
                      <span title={log.deviceDetail || ''}>{log.deviceDetail}</span>
                    </td>
                    <td>
                      <RowActionMenu
                        label={`Actions for activity on ${log.date} ${log.time}`}
                        items={[
                          {
                            label: 'View',
                            icon: Eye,
                            onClick: () => handleView(log),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="dashboard-recent-empty" colSpan="7">
                    No activity logs match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="activity-logs-pagination">
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
      </section>

      {viewLog ? (
        <div
          className="pending-registration-review-backdrop schedules-view-backdrop"
          role="presentation"
          onClick={closeViewModal}
        >
          <section
            className="pending-registration-review schedules-view-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-activity-view-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="user-activity-view-title">Activity Details</h2>
                <p>
                  {viewLog.date} · {viewLog.time}
                </p>
              </div>
              <button type="button" aria-label="Close activity details" onClick={closeViewModal}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <div className="pending-registration-review-body">
              <section className="pending-registration-review-card">
                <h3>Activity</h3>
                <dl>
                  <div>
                    <dt>Category</dt>
                    <dd>
                      <span
                        className={`dashboard-log-status activity-logs-status-${String(viewLog.activity || '')
                          .toLowerCase()
                          .replace(/\s+/g, '-')}`}
                      >
                        {viewLog.activity || '—'}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Action</dt>
                    <dd>{viewLog.activityType || viewLog.activity || '—'}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <span
                        className={`dashboard-log-status activity-logs-status-${String(viewLog.status || '')
                          .toLowerCase()
                          .replace(/\s+/g, '-')}`}
                      >
                        {viewLog.status || '—'}
                      </span>
                    </dd>
                  </div>
                  <div className="is-wide">
                    <dt>Description</dt>
                    <dd>{viewLog.description || '—'}</dd>
                  </div>
                </dl>
              </section>

              <section className="pending-registration-review-card">
                <h3>When & device</h3>
                <dl>
                  <div>
                    <dt>Date</dt>
                    <dd>{viewLog.date || '—'}</dd>
                  </div>
                  <div>
                    <dt>Time</dt>
                    <dd>{viewLog.time || '—'}</dd>
                  </div>
                  <div>
                    <dt>Device</dt>
                    <dd>{viewLog.device || '—'}</dd>
                  </div>
                  <div>
                    <dt>Detail</dt>
                    <dd>{viewLog.deviceDetail || '—'}</dd>
                  </div>
                </dl>
              </section>
            </div>

            <footer>
              <button type="button" className="pending-registration-reject" onClick={closeViewModal}>
                Close
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      <ExportFormatModal
        open={isExportModalOpen}
        title="Export Activity Logs"
        subtitle={`${visibleLogs.length} log${visibleLogs.length === 1 ? '' : 's'} in the current view`}
        prompt="Only the activity logs matching the current filters will be exported. Choose the file format."
        pdfHint="Printable activity log table"
        onSelect={handleExport}
        onClose={() => setIsExportModalOpen(false)}
      />
    </main>
  );
}
