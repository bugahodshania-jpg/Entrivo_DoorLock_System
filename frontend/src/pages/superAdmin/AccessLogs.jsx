import { Activity, CalendarDays, CheckCircle2, Download, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import axiosClient from '../../api/axiosClient';
import { getManilaDateStamp } from '../../utils/dateTime';
import '../../styles/superAdmin/accessLogs.css';
import '../../styles/superAdmin/dashboard.css';

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

export default function AccessLogs() {
  const rowsPerPage = 10;
  const todayDateStamp = getManilaDateStamp();
  const [accessLogs, setAccessLogs] = useState([]);
  const [summary, setSummary] = useState(initialSummary);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [activeTab, setActiveTab] = useState('today');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    let isActive = true;

    async function loadAccessLogs() {
      try {
        const response = await axiosClient.get('/api/access_logs.php');

        if (!isActive) {
          return;
        }

        setAccessLogs(response.data.accessLogs || []);
        setSummary({
          ...initialSummary,
          ...response.data.summary,
        });
        setErrorMessage('');
      } catch {
        if (isActive) {
          setAccessLogs([]);
          setSummary(initialSummary);
          setErrorMessage('Unable to load access logs right now.');
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
  const visibleAccessLogs = useMemo(() => {
    const tabLogs =
      activeTab === 'today'
        ? accessLogs.filter((log) => log.dateValue === todayDateStamp)
        : accessLogs;

    return tabLogs.filter((log) => {
      if (dateFrom && log.dateValue < dateFrom) {
        return false;
      }

      if (dateTo && log.dateValue > dateTo) {
        return false;
      }

      return true;
    });
  }, [accessLogs, activeTab, dateFrom, dateTo, todayDateStamp]);
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
  }, [activeTab, dateFrom, dateTo]);

  function handleDownloadCsv() {
    const csvRows = [
      ['Access Date', 'Access Time', 'User', 'Email', 'Identifier', 'Role', 'Method', 'Access Type', 'Schedule', 'Status'],
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
      activeTab === 'today'
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
        <div className="dashboard-panel-header">
          <div>
            <span>Access Logs</span>
            <p>
              {activeTab === 'today'
                ? "Recorded access attempts from RFID and biometrics for today."
                : 'Recorded access attempts from RFID and biometrics.'}
            </p>
          </div>
          <div className="access-logs-header-actions">
            <button
              type="button"
              className="dashboard-text-link access-logs-download-button"
              onClick={handleDownloadCsv}
              disabled={isLoading || Boolean(errorMessage) || visibleAccessLogs.length === 0}
            >
              <Download size={16} aria-hidden="true" />
              Download CSV
            </button>
            <div className="access-logs-date-filter" aria-label="Filter access logs by date">
              <CalendarDays size={16} aria-hidden="true" />
              <label>
                <span>From</span>
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </label>
            </div>
          </div>
        </div>

        <nav className="access-logs-tabs" role="tablist" aria-label="Access log views">
          <button
            type="button"
            role="tab"
            className={`access-logs-tab${activeTab === 'all' ? ' is-active' : ''}`}
            aria-selected={activeTab === 'all'}
            onClick={() => setActiveTab('all')}
          >
            All Access Logs
          </button>
          <button
            type="button"
            role="tab"
            className={`access-logs-tab${activeTab === 'today' ? ' is-active' : ''}`}
            aria-selected={activeTab === 'today'}
            onClick={() => setActiveTab('today')}
          >
            Today&apos;s Access Logs
          </button>
        </nav>

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
                    {activeTab === 'today'
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
                      <span className={`dashboard-log-status dashboard-log-status-${log.status}`}>
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
              {Math.min(currentPage * rowsPerPage, visibleAccessLogs.length)} of {visibleAccessLogs.length}
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
