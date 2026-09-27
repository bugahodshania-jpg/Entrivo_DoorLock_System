import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import { getManilaDateStamp } from '../../utils/dateTime';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/accessLogs.css';

function escapeCsvValue(value) {
  const text = value == null ? '' : String(value);
  const escaped = text.replace(/"/g, '""');

  if (/[",\n\r]/.test(escaped)) {
    return `"${escaped}"`;
  }

  return escaped;
}

function toCsv(rows) {
  return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n');
}

const initialSummary = {
  totalToday: 0,
  grantedToday: 0,
  deniedToday: 0,
};

const viewFilterOptions = [
  { value: 'today', label: "Today's access logs" },
  { value: 'all', label: 'All access logs' },
];

const statusFilterOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'granted', label: 'Granted' },
  { value: 'denied', label: 'Denied' },
];

// TEMP: sample rows for layout preview — remove when real access logs are enough.
function buildSampleAccessLogs(todayDateStamp) {
  return [
    {
      id: 'sample-1',
      dateValue: todayDateStamp,
      date: 'Sep 27, 2026',
      time: '08:15 AM',
      userName: 'Shania Gultiano Bugahod',
      userEmail: 'shania.bugahod@csucc.edu.ph',
      userIdentifier: '2023-0471',
      userRole: 'student',
      method: 'RFID',
      accessType: 'IN',
      scheduleId: 12,
      scheduleWindow: '08:00 AM - 12:00 PM',
      status: 'granted',
    },
    {
      id: 'sample-2',
      dateValue: todayDateStamp,
      date: 'Sep 27, 2026',
      time: '08:42 AM',
      userName: 'Juan dela Cruz',
      userEmail: 'juan.delacruz@csucc.edu.ph',
      userIdentifier: 'FAC-0004',
      userRole: 'faculty',
      method: 'Fingerprint',
      accessType: 'IN',
      scheduleId: 18,
      scheduleWindow: '08:00 AM - 05:00 PM',
      status: 'granted',
    },
    {
      id: 'sample-3',
      dateValue: todayDateStamp,
      date: 'Sep 27, 2026',
      time: '09:05 AM',
      userName: 'Maria Santos',
      userEmail: 'maria.santos@csucc.edu.ph',
      userIdentifier: '2022-1188',
      userRole: 'student',
      method: 'RFID',
      accessType: 'OUT',
      scheduleId: null,
      scheduleWindow: null,
      status: 'denied',
    },
    {
      id: 'sample-4',
      dateValue: todayDateStamp,
      date: 'Sep 27, 2026',
      time: '10:18 AM',
      userName: 'Admin Portal Account',
      userEmail: 'admin@csucc.edu.ph',
      userIdentifier: 'ADM-0001',
      userRole: 'admin',
      method: 'Fingerprint',
      accessType: 'IN',
      scheduleId: 7,
      scheduleWindow: 'Mon-Fri 07:30 AM - 06:00 PM',
      status: 'granted',
    },
    {
      id: 'sample-5',
      dateValue: todayDateStamp,
      date: 'Sep 27, 2026',
      time: '11:03 AM',
      userName: 'Unknown User',
      userEmail: 'No email',
      userIdentifier: 'No ID',
      userRole: '',
      method: 'RFID',
      accessType: 'IN',
      scheduleId: null,
      scheduleWindow: null,
      status: 'denied',
    },
    {
      id: 'sample-6',
      dateValue: '2026-09-26',
      date: 'Sep 26, 2026',
      time: '04:55 PM',
      userName: 'Ana Reyes',
      userEmail: 'ana.reyes@csucc.edu.ph',
      userIdentifier: 'STF-0012',
      userRole: 'staff',
      method: 'Fingerprint',
      accessType: 'OUT',
      scheduleId: 21,
      scheduleWindow: 'Sep 26, 2026 01:00 PM - 05:00 PM',
      status: 'granted',
    },
  ];
}

export default function AccessLogs() {
  const rowsPerPage = 10;
  const todayDateStamp = getManilaDateStamp();
  const viewFilterMenuRef = useRef(null);
  const statusFilterMenuRef = useRef(null);
  const [accessLogs, setAccessLogs] = useState([]);
  const [summary, setSummary] = useState(initialSummary);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [viewFilter, setViewFilter] = useState('today');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isViewFilterMenuOpen, setIsViewFilterMenuOpen] = useState(false);
  const [isStatusFilterMenuOpen, setIsStatusFilterMenuOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let isActive = true;
    const sampleDateStamp = getManilaDateStamp();

    async function loadAccessLogs() {
      try {
        const response = await axiosClient.get('/api/access_logs.php');

        if (!isActive) {
          return;
        }

        const loadedLogs = response.data.accessLogs || [];
        const sampleLogs = buildSampleAccessLogs(sampleDateStamp);
        // TEMP: always show sample rows for layout preview.
        setAccessLogs([...sampleLogs, ...loadedLogs]);
        setSummary({
          ...initialSummary,
          ...response.data.summary,
          totalToday: Math.max(
            Number(response.data.summary?.totalToday) || 0,
            sampleLogs.filter((log) => log.dateValue === sampleDateStamp).length,
          ),
          grantedToday: Math.max(
            Number(response.data.summary?.grantedToday) || 0,
            sampleLogs.filter(
              (log) => log.dateValue === sampleDateStamp && log.status === 'granted',
            ).length,
          ),
          deniedToday: Math.max(
            Number(response.data.summary?.deniedToday) || 0,
            sampleLogs.filter(
              (log) => log.dateValue === sampleDateStamp && log.status === 'denied',
            ).length,
          ),
        });
        setErrorMessage('');
      } catch {
        if (isActive) {
          // TEMP: fall back to sample rows so layout can still be reviewed.
          setAccessLogs(buildSampleAccessLogs(sampleDateStamp));
          setSummary({
            totalToday: 5,
            grantedToday: 3,
            deniedToday: 2,
          });
          setErrorMessage('');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadAccessLogs();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!isViewFilterMenuOpen && !isStatusFilterMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (isViewFilterMenuOpen && !viewFilterMenuRef.current?.contains(event.target)) {
        setIsViewFilterMenuOpen(false);
      }

      if (isStatusFilterMenuOpen && !statusFilterMenuRef.current?.contains(event.target)) {
        setIsStatusFilterMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsViewFilterMenuOpen(false);
        setIsStatusFilterMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isViewFilterMenuOpen, isStatusFilterMenuOpen]);

  const summaryCards = useMemo(
    () => [
      {
        label: 'Total Access Today',
        value: summary.totalToday,
        detail: 'All access attempts today',
        icon: Activity,
      },
      {
        label: 'Access Granted',
        value: summary.grantedToday,
        detail: 'Granted attempts today',
        icon: CheckCircle2,
      },
      {
        label: 'Access Denied',
        value: summary.deniedToday,
        detail: 'Denied attempts today',
        icon: XCircle,
      },
    ],
    [summary.deniedToday, summary.grantedToday, summary.totalToday],
  );

  const columns = ['Date & Time', 'User', 'Identifier', 'Related Data', 'Schedule', 'Status'];
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const viewScopedLogs = useMemo(() => {
    if (viewFilter === 'today') {
      return accessLogs.filter((log) => log.dateValue === todayDateStamp);
    }

    return accessLogs;
  }, [accessLogs, todayDateStamp, viewFilter]);

  const visibleAccessLogs = useMemo(() => {
    return viewScopedLogs.filter((log) => {
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

      return [
        log.userName,
        log.userEmail,
        log.userIdentifier,
        log.userRole,
        log.method,
        log.accessType,
        log.scheduleId,
        log.scheduleWindow,
        log.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearchQuery));
    });
  }, [dateFrom, dateTo, normalizedSearchQuery, statusFilter, viewScopedLogs]);

  const viewFilterCounts = useMemo(() => {
    const statusLogs =
      statusFilter === 'all'
        ? accessLogs
        : accessLogs.filter((log) => String(log.status || '').toLowerCase() === statusFilter);

    return {
      today: statusLogs.filter((log) => log.dateValue === todayDateStamp).length,
      all: statusLogs.length,
    };
  }, [accessLogs, statusFilter, todayDateStamp]);

  const statusFilterCounts = useMemo(() => {
    return {
      all: viewScopedLogs.length,
      granted: viewScopedLogs.filter((log) => String(log.status || '').toLowerCase() === 'granted')
        .length,
      denied: viewScopedLogs.filter((log) => String(log.status || '').toLowerCase() === 'denied')
        .length,
    };
  }, [viewScopedLogs]);

  const activeViewFilterConfig =
    viewFilterOptions.find((option) => option.value === viewFilter) || viewFilterOptions[0];
  const activeStatusFilterConfig =
    statusFilterOptions.find((option) => option.value === statusFilter) || statusFilterOptions[0];

  const totalPages = Math.max(1, Math.ceil(visibleAccessLogs.length / rowsPerPage));
  const paginatedAccessLogs = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return visibleAccessLogs.slice(startIndex, startIndex + rowsPerPage);
  }, [currentPage, rowsPerPage, visibleAccessLogs]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [viewFilter, statusFilter, dateFrom, dateTo, searchQuery]);

  function handleDownloadCsv() {
    const csvRows = [
      [
        'Access Date',
        'Access Time',
        'User',
        'Email',
        'Identifier',
        'Role',
        'Method',
        'Access Type',
        'Schedule',
        'Status',
      ],
      ...visibleAccessLogs.map((log) => [
        log.date,
        log.time,
        log.userName,
        log.userEmail,
        log.userIdentifier,
        log.userRole,
        log.method,
        log.accessType,
        `${log.scheduleId ?? 'N/A'} | ${log.scheduleWindow ?? 'N/A'}`,
        log.status,
      ]),
    ];
    const csv = toCsv(csvRows);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download =
      viewFilter === 'today'
        ? `access_logs_today_${todayDateStamp}.csv`
        : `access_logs_all_${todayDateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="admin-dashboard access-logs-page" aria-label="Access logs">
      <section className="access-logs-summary-grid" aria-label="Access logs summary">
        {summaryCards.map(({ label, value, detail, icon: Icon }) => (
          <article className="dashboard-summary-card" key={label}>
            <div className="dashboard-summary-icon" aria-hidden="true">
              <Icon size={28} strokeWidth={2.4} />
            </div>
            <div className="dashboard-summary-copy">
              <span className="dashboard-summary-label">{label}</span>
              <strong>{isLoading ? '--' : value}</strong>
              <small>{detail}</small>
            </div>
          </article>
        ))}
      </section>

      <section className="dashboard-recent-card access-logs-card">
        <div className="dashboard-panel-header access-logs-header">
          <div>
            <span>Access Logs</span>
            <p>
              {viewFilter === 'today'
                ? "Recorded access attempts from RFID and biometrics for today."
                : 'Recorded access attempts from RFID and biometrics.'}
            </p>
          </div>
          <button
            type="button"
            className="access-logs-export"
            onClick={handleDownloadCsv}
            disabled={isLoading || Boolean(errorMessage) || visibleAccessLogs.length === 0}
          >
            <Download size={15} aria-hidden="true" />
            Export
          </button>
        </div>

        <div className="access-logs-toolbar">
          <div className="access-logs-toolbar-filters">
            <div
              className="manage-users-role-tabs manage-users-status-filter"
              ref={viewFilterMenuRef}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setIsViewFilterMenuOpen(false);
                }
              }}
            >
              <button
                type="button"
                className={`manage-users-role-tab-trigger${isViewFilterMenuOpen ? ' is-open' : ''}`}
                aria-haspopup="listbox"
                aria-expanded={isViewFilterMenuOpen}
                aria-controls="access-logs-view-filter-menu"
                aria-label={`View filter: ${activeViewFilterConfig.label}`}
                disabled={isLoading}
                onClick={() => {
                  setIsViewFilterMenuOpen((open) => !open);
                  setIsStatusFilterMenuOpen(false);
                }}
              >
                <span className="manage-users-role-tab-trigger-label">
                  {activeViewFilterConfig.label}
                </span>
                <span className="manage-users-role-tab-count">
                  {isLoading ? '--' : viewFilterCounts[activeViewFilterConfig.value] || 0}
                </span>
                <ChevronDown className="manage-users-role-tab-chevron" size={14} aria-hidden="true" />
              </button>

              {isViewFilterMenuOpen ? (
                <div
                  id="access-logs-view-filter-menu"
                  className="manage-users-role-tab-menu"
                  role="listbox"
                  aria-label="Filter by view"
                >
                  {viewFilterOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      className={`manage-users-role-tab-option${
                        viewFilter === option.value ? ' is-active' : ''
                      }`}
                      aria-selected={viewFilter === option.value}
                      onClick={() => {
                        setViewFilter(option.value);
                        setIsViewFilterMenuOpen(false);
                      }}
                    >
                      <Check className="manage-users-role-tab-check" size={15} aria-hidden="true" />
                      <span className="manage-users-role-tab-option-label">{option.label}</span>
                      <span className="manage-users-role-tab-count">
                        {isLoading ? '--' : viewFilterCounts[option.value] || 0}
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
                aria-controls="access-logs-status-filter-menu"
                aria-label={`Status filter: ${activeStatusFilterConfig.label}`}
                disabled={isLoading}
                onClick={() => {
                  setIsStatusFilterMenuOpen((open) => !open);
                  setIsViewFilterMenuOpen(false);
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
                  id="access-logs-status-filter-menu"
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
              placeholder="Search user, ID, or method"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        </div>

        {errorMessage ? <p className="access-logs-error" role="alert">{errorMessage}</p> : null}

        <div className="dashboard-recent-table-wrap access-logs-table-wrap">
          <table className="dashboard-recent-table access-logs-table">
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
                    Loading access logs...
                  </td>
                </tr>
              )}

              {!isLoading && errorMessage && (
                <tr>
                  <td className="dashboard-recent-empty" colSpan={columns.length}>
                    {errorMessage}
                  </td>
                </tr>
              )}

              {!isLoading && !errorMessage && visibleAccessLogs.length === 0 && (
                <tr>
                  <td className="dashboard-recent-empty" colSpan={columns.length}>
                    {normalizedSearchQuery
                      ? 'No access logs match your search.'
                      : viewFilter === 'today'
                        ? "No access logs found for today's activity."
                        : 'No access logs found.'}
                  </td>
                </tr>
              )}

              {!isLoading &&
                !errorMessage &&
                paginatedAccessLogs.map((log) => (
                  <tr key={log.id}>
                    <td>
                      <strong>{log.date}</strong>
                      <span>{log.time}</span>
                    </td>
                    <td>
                      <strong>{log.userName}</strong>
                      <span>{log.userEmail || 'No email'}</span>
                    </td>
                    <td>
                      <strong>{log.userIdentifier}</strong>
                      <span>{log.userRole ? log.userRole.replace('_', ' ') : 'No role'}</span>
                    </td>
                    <td>
                      <strong>{log.method}</strong>
                      <span>{log.accessType}</span>
                    </td>
                    <td>
                      <strong>{log.scheduleId ?? 'N/A'}</strong>
                      <span>| {log.scheduleWindow ?? 'N/A'}</span>
                    </td>
                    <td>
                      <span
                        className={`dashboard-log-status access-logs-status-${String(log.status || '')
                          .toLowerCase()
                          .replace(/\s+/g, '-')}`}
                      >
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {!isLoading && !errorMessage && visibleAccessLogs.length > 0 && (
          <div className="access-logs-pagination" aria-label="Access logs pagination">
            <p>
              Showing {(currentPage - 1) * rowsPerPage + 1}-
              {Math.min(currentPage * rowsPerPage, visibleAccessLogs.length)} of{' '}
              {visibleAccessLogs.length}
            </p>
            <div className="access-logs-pagination-controls">
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
    </main>
  );
}
