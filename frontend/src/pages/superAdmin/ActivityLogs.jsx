import { useEffect, useMemo, useState } from 'react';
import { Download, Search, X } from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import { getManilaDateStamp } from '../../utils/dateTime';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/activityLogs.css';

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

export default function ActivityLogs() {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [activityFilter, setActivityFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
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

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleLogs = useMemo(() => {
    return logs.filter((log) => {
      if (activityFilter !== 'all' && log.activity.toLowerCase() !== activityFilter) {
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

      return [log.name, log.username, log.userId, log.description, log.role]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearchQuery));
    });
  }, [activityFilter, dateFrom, dateTo, logs, normalizedSearchQuery]);

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
  }, [activityFilter, dateFrom, dateTo, searchQuery]);

  const columns = ['User ID', 'User', 'Activity', 'Description', 'Status', 'Device', 'Timestamp'];

  function handleExport() {
    const csvRows = [
      ['User ID', 'Name', 'Username', 'Role', 'Activity', 'Description', 'Status', 'Device', 'Device detail', 'Date', 'Time'],
      ...visibleLogs.map((log) => [
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
    ];
    const csv = toCsv(csvRows);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `activity_logs_${getManilaDateStamp()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="admin-dashboard activity-logs-page" aria-label="Activity logs">
      <section className="dashboard-recent-card activity-logs-card">
        <div className="dashboard-panel-header activity-logs-header">
          <div>
            <span>Activity Logs</span>
            <p>Recent activity performed by Super Admins, Admins, and Users. The latest 300 records are shown.</p>
          </div>
          <button
            type="button"
            className="activity-logs-export"
            onClick={handleExport}
            disabled={isLoading || Boolean(errorMessage) || visibleLogs.length === 0}
          >
            <Download size={15} aria-hidden="true" />
            Export
          </button>
        </div>

        <div className="activity-logs-toolbar">
          <div className="activity-logs-toolbar-filters">
            <label className="activity-logs-filter">
              <span className="activity-logs-sr">Activity</span>
              <select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}>
                <option value="all">All activities ({logs.length})</option>
                <option value="login">Login</option>
                <option value="logout">Logout</option>
              </select>
            </label>

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
                      <span className={`activity-logs-pill activity-logs-pill-${log.activity.toLowerCase()}`}>
                        {log.activity}
                      </span>
                    </td>
                    <td className="activity-logs-description">{log.description}</td>
                    <td>
                      <span className={`activity-logs-pill activity-logs-pill-${log.status.toLowerCase()}`}>
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
    </main>
  );
}
