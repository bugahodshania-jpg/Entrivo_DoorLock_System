import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Download, RefreshCw, Search, X } from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import ExportFormatModal from '../../components/ExportFormatModal';
import { getManilaDateStamp } from '../../utils/dateTime';
import { buildExportNote, exportTable } from '../../utils/exportFiles';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/activityLogs.css';

const activityFilterOptions = [
  { value: 'all', label: 'All categories' },
  { value: 'login', label: 'Login' },
  { value: 'logout', label: 'Logout' },
  { value: 'access', label: 'Access' },
  { value: 'password', label: 'Password' },
  { value: 'recovery', label: 'Recovery' },
  { value: 'account', label: 'Account' },
  { value: 'security', label: 'Security' },
  { value: 'user', label: 'User' },
  { value: 'registration', label: 'Registration' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'override', label: 'Override' },
  { value: 'job', label: 'Job' },
  { value: 'enroll', label: 'Enroll' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'sync', label: 'Sync' },
  { value: 'rfid', label: 'RFID' },
];

const statusFilterOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
];

export default function ActivityLogs() {
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
  const rowsPerPage = 10;

  useEffect(() => {
    let isActive = true;

    async function loadLogs() {
      try {
        const response = await axiosClient.get('/api/activity_logs.php');

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
  }, []);

  useEffect(() => {
    if (!isActivityFilterMenuOpen && !isStatusFilterMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (
        isActivityFilterMenuOpen &&
        !activityFilterMenuRef.current?.contains(event.target)
      ) {
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

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleLogs = useMemo(() => {
    return logs.filter((log) => {
      if (activityFilter !== 'all' && String(log.activity || '').toLowerCase() !== activityFilter) {
        return false;
      }

      if (statusFilter !== 'all' && String(log.status || '').toLowerCase() !== statusFilter) {
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

      return [log.name, log.username, log.userId, log.description, log.role, log.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearchQuery));
    });
  }, [activityFilter, statusFilter, dateFrom, dateTo, logs, normalizedSearchQuery]);

  const statusFilterCounts = useMemo(() => {
    const activityLogs =
      activityFilter === 'all'
        ? logs
        : logs.filter((log) => log.activity.toLowerCase() === activityFilter);

    return {
      all: activityLogs.length,
      success: activityLogs.filter((log) => log.status.toLowerCase() === 'success').length,
      failed: activityLogs.filter((log) => log.status.toLowerCase() === 'failed').length,
    };
  }, [activityFilter, logs]);

  const activityFilterCounts = useMemo(() => {
    const statusLogs =
      statusFilter === 'all'
        ? logs
        : logs.filter((log) => log.status.toLowerCase() === statusFilter);

    const counts = { all: statusLogs.length };

    activityFilterOptions.forEach((option) => {
      if (option.value === 'all') {
        return;
      }

      counts[option.value] = statusLogs.filter(
        (log) => String(log.activity || '').toLowerCase() === option.value,
      ).length;
    });

    return counts;
  }, [logs, statusFilter]);

  const activeActivityFilterConfig =
    activityFilterOptions.find((option) => option.value === activityFilter) ||
    activityFilterOptions[0];
  const activeStatusFilterConfig =
    statusFilterOptions.find((option) => option.value === statusFilter) || statusFilterOptions[0];

  const totalPages = Math.max(1, Math.ceil(visibleLogs.length / rowsPerPage));
  const paginatedLogs = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return visibleLogs.slice(startIndex, startIndex + rowsPerPage);
  }, [currentPage, rowsPerPage, visibleLogs]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activityFilter, statusFilter, dateFrom, dateTo, searchQuery]);

  const columns = ['User ID', 'User', 'Activity', 'Description', 'Status', 'Device', 'Timestamp'];

  const exportFilters = [
    activityFilter !== 'all' ? `Category: ${activeActivityFilterConfig.label}` : '',
    statusFilter !== 'all' ? `Status: ${activeStatusFilterConfig.label}` : '',
    dateFrom ? `From ${dateFrom}` : '',
    dateTo ? `To ${dateTo}` : '',
    searchQuery.trim() ? `Search: "${searchQuery.trim()}"` : '',
  ];

  function handleExport(format) {
    setIsExportModalOpen(false);
    exportTable(format, {
      headers: ['User ID', 'Name', 'Username', 'Role', 'Activity', 'Description', 'Status', 'Device', 'Device detail', 'Date', 'Time'],
      rows: visibleLogs.map((log) => [
        log.userId,
        log.name,
        log.username,
        log.role,
        log.activity,
        log.description,
        log.status,
        log.device,
        log.deviceDetail,
        log.date,
        log.time,
      ]),
      fileBaseName: `activity_logs_${getManilaDateStamp()}`,
      pdf: {
        title: 'Activity Logs',
        note: buildExportNote(visibleLogs.length, 'record', exportFilters),
        widths: [55, 90, 70, 55, 55, 170, 45, 50, 75, 60, 50],
        emphasizeColumn: 1,
        emptyMessage: 'No activity logs match the selected filters.',
      },
    });
  }

  return (
    <main className="admin-dashboard activity-logs-page" aria-label="Activity logs">
      <section className="dashboard-recent-card activity-logs-card">
        <div className="dashboard-panel-header activity-logs-header">
          <div>
            <span>Activity Logs</span>
            <p>
              Sign-in, door access, password and account recovery, user changes, schedules,
              credentials, and the other transactions recorded in the system.
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
                className={`manage-users-role-tab-trigger${
                  isActivityFilterMenuOpen ? ' is-open' : ''
                }`}
                aria-haspopup="listbox"
                aria-expanded={isActivityFilterMenuOpen}
                aria-controls="activity-logs-activity-filter-menu"
                aria-label={`Activity filter: ${activeActivityFilterConfig.label}`}
                disabled={isLoading}
                onClick={() => {
                  setIsActivityFilterMenuOpen((open) => !open);
                  setIsStatusFilterMenuOpen(false);
                }}
              >
                <span className="manage-users-role-tab-trigger-label">
                  {activeActivityFilterConfig.label}
                </span>
                <span className="manage-users-role-tab-count">
                  {isLoading ? '--' : activityFilterCounts[activeActivityFilterConfig.value] || 0}
                </span>
                <ChevronDown className="manage-users-role-tab-chevron" size={14} aria-hidden="true" />
              </button>

              {isActivityFilterMenuOpen ? (
                <div
                  id="activity-logs-activity-filter-menu"
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
                aria-controls="activity-logs-status-filter-menu"
                aria-label={`Status filter: ${activeStatusFilterConfig.label}`}
                disabled={isLoading}
                onClick={() => {
                  setIsStatusFilterMenuOpen((open) => !open);
                  setIsActivityFilterMenuOpen(false);
                }}
              >
                <span className="manage-users-role-tab-trigger-label">
                  {activeStatusFilterConfig.label}
                </span>
                <span className="manage-users-role-tab-count">
                  {isLoading ? '--' : statusFilterCounts[activeStatusFilterConfig.value] || 0}
                </span>
                <ChevronDown className="manage-users-role-tab-chevron" size={14} aria-hidden="true" />
              </button>

              {isStatusFilterMenuOpen ? (
                <div
                  id="activity-logs-status-filter-menu"
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
                <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              </label>
              <span className="activity-logs-dates-divider" aria-hidden="true" />
              <label>
                <span>To</span>
                <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
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
            <button
              type="button"
              className="activity-logs-reset"
              aria-label="Reset filters"
              title="Reset filters"
              onClick={() => {
                setActivityFilter('all');
                setStatusFilter('all');
                setDateFrom('');
                setDateTo('');
                setSearchQuery('');
                setIsActivityFilterMenuOpen(false);
                setIsStatusFilterMenuOpen(false);
              }}
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          </div>

          <label className="activity-logs-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search username or user ID"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        </div>

        {errorMessage ? <p className="activity-logs-error" role="alert">{errorMessage}</p> : null}

        <div className="dashboard-recent-table-wrap activity-logs-table-wrap">
          <table className="dashboard-recent-table activity-logs-table">
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
                    Loading activity logs...
                  </td>
                </tr>
              )}

              {!isLoading && !errorMessage && visibleLogs.length === 0 && (
                <tr>
                  <td className="dashboard-recent-empty" colSpan={columns.length}>
                    {logs.length === 0
                      ? 'No activity has been recorded yet.'
                      : 'No activity matches these filters.'}
                  </td>
                </tr>
              )}

              {!isLoading &&
                !errorMessage &&
                paginatedLogs.map((log) => (
                  <tr key={log.id}>
                    <td>{log.userId}</td>
                    <td>
                      <div className="activity-logs-user">
                        <span className="activity-logs-avatar" aria-hidden="true">{log.initial}</span>
                        <div>
                          <strong>{log.name}</strong>
                          <span>@{log.username}</span>
                          <small>{log.role}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`dashboard-log-status activity-logs-status-${String(log.activity || '')
                          .toLowerCase()
                          .replace(/\s+/g, '-')}`}
                      >
                        {log.activity}
                      </span>
                    </td>
                    <td className="activity-logs-description">{log.description}</td>
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
                      <strong>{log.device}</strong>
                      <span>{log.deviceDetail}</span>
                    </td>
                    <td>
                      <strong>{log.date}</strong>
                      <span>{log.time}</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {!isLoading && !errorMessage && visibleLogs.length > 0 && (
          <div className="activity-logs-pagination" aria-label="Activity logs pagination">
            <p>
              Showing {(currentPage - 1) * rowsPerPage + 1}-
              {Math.min(currentPage * rowsPerPage, visibleLogs.length)} of {visibleLogs.length}
            </p>
            <div className="activity-logs-pagination-controls">
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span>
                Page {currentPage} of {totalPages}
              </span>
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
