import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, ChevronDown, Download, Search, X, XCircle } from 'lucide-react';
import ExportFormatModal from '../../components/ExportFormatModal';
import AccessLogsLiveStatus from '../../components/AccessLogsLiveStatus';
import useLiveAccessLogs from '../../hooks/useLiveAccessLogs';
import { getManilaDateStamp } from '../../utils/dateTime';
import { buildExportNote, exportTable } from '../../utils/exportFiles';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/accessLogs.css';
import '../../styles/user/userPortal.css';

const statusFilterOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'granted', label: 'Granted' },
  { value: 'denied', label: 'Denied' },
];

export default function UserAccessLogs({ user }) {
  const rowsPerPage = 10;
  const todayDateStamp = getManilaDateStamp();
  const statusFilterMenuRef = useRef(null);
  const liveLogs = useLiveAccessLogs({ personal: true, userId: user?.id });
  const { accessLogs, isLoading, errorMessage } = liveLogs;
  const [currentPage, setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('all');
  const [isStatusFilterMenuOpen, setIsStatusFilterMenuOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  useEffect(() => {
    if (!isStatusFilterMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!statusFilterMenuRef.current?.contains(event.target)) {
        setIsStatusFilterMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsStatusFilterMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isStatusFilterMenuOpen]);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, dateFrom, dateTo, searchQuery]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleLogs = useMemo(() => {
    return accessLogs.filter((log) => {
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

      return [log.method, log.accessType, log.status, log.scheduleKindLabel, log.scheduleWindow, log.time, log.date]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearchQuery));
    });
  }, [accessLogs, dateFrom, dateTo, normalizedSearchQuery, statusFilter]);

  const statusFilterCounts = useMemo(() => {
    const counts = { all: accessLogs.length, granted: 0, denied: 0 };
    accessLogs.forEach((log) => {
      const key = String(log.status || '').toLowerCase();
      if (key in counts) {
        counts[key] += 1;
      }
    });
    return counts;
  }, [accessLogs]);

  const summary = useMemo(() => {
    return {
      total: visibleLogs.length,
      granted: visibleLogs.filter((log) => log.status === 'granted').length,
      denied: visibleLogs.filter((log) => log.status === 'denied').length,
      today: accessLogs.filter((log) => log.dateValue === todayDateStamp).length,
    };
  }, [accessLogs, todayDateStamp, visibleLogs]);

  const totalPages = Math.max(1, Math.ceil(visibleLogs.length / rowsPerPage));
  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);
  const pageRows = visibleLogs.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  const activeStatusFilter =
    statusFilterOptions.find((item) => item.value === statusFilter) || statusFilterOptions[0];

  function handleExport(format) {
    setIsExportModalOpen(false);
    exportTable(format, {
      headers: ['Date', 'Time', 'Method', 'Access Type', 'Schedule Type', 'Schedule', 'Status'],
      rows: visibleLogs.map((log) => [
        log.date,
        log.time,
        log.method,
        log.accessType,
        log.scheduleKindLabel || '—',
        log.scheduleWindow || '—',
        log.status,
      ]),
      fileBaseName: `my_access_logs_${getManilaDateStamp()}`,
      pdf: {
        title: 'My Access Logs',
        note: buildExportNote(visibleLogs.length, 'access attempt', [
          statusFilter !== 'all' ? `Status: ${activeStatusFilter.label}` : '',
          dateFrom ? `From ${dateFrom}` : '',
          dateTo ? `To ${dateTo}` : '',
          searchQuery.trim() ? `Search: "${searchQuery.trim()}"` : '',
        ]),
        widths: [80, 70, 90, 100, 100, 150, 70],
        emptyMessage: 'No access logs match the selected filters.',
      },
    });
  }

  return (
    <main className="admin-dashboard access-logs-page user-portal-page" aria-label="Access logs">
      <section className="access-logs-summary-grid" aria-label="Access log summary">
        <article className="dashboard-summary-card">
          <div className="dashboard-summary-icon" aria-hidden="true">
            <CheckCircle2 size={18} strokeWidth={2.3} />
          </div>
          <div className="dashboard-summary-copy">
            <span className="dashboard-summary-label">Granted</span>
            <strong>{isLoading ? '--' : summary.granted}</strong>
            <small>In current filter</small>
          </div>
        </article>
        <article className="dashboard-summary-card">
          <div className="dashboard-summary-icon" aria-hidden="true">
            <XCircle size={18} strokeWidth={2.3} />
          </div>
          <div className="dashboard-summary-copy">
            <span className="dashboard-summary-label">Denied</span>
            <strong>{isLoading ? '--' : summary.denied}</strong>
            <small>In current filter</small>
          </div>
        </article>
        <article className="dashboard-summary-card">
          <div className="dashboard-summary-copy">
            <span className="dashboard-summary-label">Today</span>
            <strong>{isLoading ? '--' : summary.today}</strong>
            <small>Access attempts today</small>
          </div>
        </article>
      </section>

      <section className="dashboard-recent-card access-logs-card">
        <div className="dashboard-panel-header access-logs-header">
          <div>
            <span>Access Logs</span>
            <p>Your door access history. Use date and status filters to narrow results.</p>
            <AccessLogsLiveStatus {...liveLogs} />
          </div>
          <button
            type="button"
            className="access-logs-export"
            onClick={() => setIsExportModalOpen(true)}
            disabled={isLoading || Boolean(errorMessage) || visibleLogs.length === 0}
          >
            <Download size={15} aria-hidden="true" />
            Export
          </button>
        </div>

        <div className="access-logs-toolbar">
          <div className="access-logs-toolbar-filters">
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
                aria-controls="user-access-logs-status-filter-menu"
                aria-label={`Status filter: ${activeStatusFilter.label}`}
                disabled={isLoading}
                onClick={() => setIsStatusFilterMenuOpen((open) => !open)}
              >
                <span className="manage-users-role-tab-trigger-label">{activeStatusFilter.label}</span>
                <span className="manage-users-role-tab-count">
                  {isLoading ? '--' : statusFilterCounts[statusFilter] || 0}
                </span>
                <ChevronDown className="manage-users-role-tab-chevron" size={14} aria-hidden="true" />
              </button>

              {isStatusFilterMenuOpen ? (
                <div
                  id="user-access-logs-status-filter-menu"
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

            <div className="access-logs-dates">
              <label>
                <span>From</span>
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </label>
              <span className="access-logs-dates-divider" aria-hidden="true" />
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
                  className="access-logs-clear"
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

          <label className="access-logs-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search method, type, or status"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        </div>

        <div className="dashboard-recent-table-wrap user-access-logs-table-wrap">
          <table className="dashboard-recent-table user-access-logs-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Method</th>
                <th>Access Type</th>
                <th>Type</th>
                <th>Schedule</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="dashboard-recent-empty" colSpan="7">
                    Loading access logs…
                  </td>
                </tr>
              ) : pageRows.length ? (
                pageRows.map((log) => (
                  <tr key={log.id}>
                    <td>{log.date}</td>
                    <td>{log.time}</td>
                    <td>{log.method}</td>
                    <td>{log.accessType || '—'}</td>
                    <td>
                      {log.scheduleKindLabel ? (
                        <span
                          className={`dashboard-log-status dashboard-log-status-kind-${log.scheduleKind || 'regular'}`}
                        >
                          {log.scheduleKindLabel}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{log.scheduleWindow || '—'}</td>
                    <td>
                      <span className={`dashboard-log-status dashboard-log-status-${log.status}`}>
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="dashboard-recent-empty" colSpan="7">
                    {errorMessage
                      ? 'Unable to load access logs. Retrying automatically.'
                      : 'No access logs match the current filters.'}
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
      <ExportFormatModal
        open={isExportModalOpen}
        title="Export Access Logs"
        subtitle={`${visibleLogs.length} access attempt${visibleLogs.length === 1 ? '' : 's'} in the current view`}
        prompt="Only the access logs matching the current filters will be exported. Choose the file format."
        pdfHint="Printable access log table"
        onSelect={handleExport}
        onClose={() => setIsExportModalOpen(false)}
      />
    </main>
  );
}
