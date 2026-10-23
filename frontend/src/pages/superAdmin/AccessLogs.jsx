import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  RefreshCw,
  Trash2,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import { useActionConfirm } from '../../components/ActionConfirm';
import DeleteRequestModal from '../../components/DeleteRequestModal';
import DeleteRequestToast from '../../components/DeleteRequestToast';
import ErrorNoticeModal from '../../components/ErrorNoticeModal';
import ExportFormatModal from '../../components/ExportFormatModal';
import AccessLogViewModal from '../../components/AccessLogViewModal';
import AccessLogsLiveStatus from '../../components/AccessLogsLiveStatus';
import RowActionMenu from '../../components/RowActionMenu';
import TableEmptyState from '../../components/TableEmptyState';
import useLiveAccessLogs from '../../hooks/useLiveAccessLogs';
import { getManilaDateStamp } from '../../utils/dateTime';
import { buildExportNote, exportTable } from '../../utils/exportFiles';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/accessLogs.css';

const viewFilterOptions = [
  { value: 'today', label: "Today's access logs" },
  { value: 'all', label: 'All access logs' },
];

const statusFilterOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'granted', label: 'Granted' },
  { value: 'denied', label: 'Denied' },
];

function getRfidUid(log) {
  return String(log.method || '').toLowerCase() === 'rfid' ? log.rfidUid || '' : '';
}

export default function AccessLogs({ user }) {
  const rowsPerPage = 10;
  const todayDateStamp = getManilaDateStamp();
  const viewFilterMenuRef = useRef(null);
  const statusFilterMenuRef = useRef(null);
  const liveLogs = useLiveAccessLogs();
  const { accessLogs, summary, isLoading, errorMessage } = liveLogs;
  const [currentPage, setCurrentPage] = useState(1);
  const [viewFilter, setViewFilter] = useState('today');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isViewFilterMenuOpen, setIsViewFilterMenuOpen] = useState(false);
  const [isStatusFilterMenuOpen, setIsStatusFilterMenuOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [viewLog, setViewLog] = useState(null);
  const [deleteRequest, setDeleteRequest] = useState(null);
  const [deleteNotice, setDeleteNotice] = useState('');
  const [removedLogIds, setRemovedLogIds] = useState([]);
  const [actionError, setActionError] = useState('');
  const confirmAction = useActionConfirm();
  const closeLogView = useCallback(() => setViewLog(null), []);

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

  const columns = ['Date & Time', 'User', 'Identifier', 'Method', 'Access Type', 'Schedule', 'Status', 'Action'];
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const viewScopedLogs = useMemo(() => {
    if (viewFilter === 'today') {
      return accessLogs.filter((log) => log.dateValue === todayDateStamp);
    }

    return accessLogs;
  }, [accessLogs, todayDateStamp, viewFilter]);

  const visibleAccessLogs = useMemo(() => {
    return viewScopedLogs.filter((log) => {
      if (removedLogIds.includes(log.id)) {
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

      return [
        log.userName,
        log.userEmail,
        log.userIdentifier,
        log.userRole,
        log.method,
        getRfidUid(log),
        log.accessType,
        log.scheduleId,
        log.scheduleWindow,
        log.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearchQuery));
    });
  }, [dateFrom, dateTo, normalizedSearchQuery, removedLogIds, statusFilter, viewScopedLogs]);

  async function deleteAccessLog(log) {
    if (user?.role === 'admin') {
      setDeleteRequest({
        targetType: 'access_log',
        targetId: log.id,
        targetLabel: `Access log #${log.id} · ${log.userName || 'Unknown user'}`,
        detail: [log.date, log.time, log.status].filter(Boolean).join(' · '),
      });
      return;
    }

    const confirmed = await confirmAction({
      title: 'Delete access log',
      danger: true,
      message: `Permanently delete access log #${log.id} for ${log.userName || 'this user'}? This cannot be undone.`,
    });
    if (!confirmed) {
      return;
    }

    try {
      await axiosClient.post('/api/delete_requests.php', {
        action: 'delete_now',
        actorId: user?.id,
        targetType: 'access_log',
        targetId: log.id,
      });
      setRemovedLogIds((current) => [...current, log.id]);
      if (viewLog?.id === log.id) {
        setViewLog(null);
      }
      setDeleteNotice('Access log deleted.');
      window.setTimeout(() => setDeleteNotice(''), 4000);
    } catch (error) {
      setActionError(error.response?.data?.message || 'Unable to delete that access log.');
    }
  }

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

  function handleExport(format) {
    setIsExportModalOpen(false);
    exportTable(format, {
      headers: [
        'Access Date',
        'Access Time',
        'User',
        'Email',
        'Identifier',
        'Role',
        'Method',
        'RFID UID',
        'Access Type',
        'Schedule',
        'Status',
      ],
      rows: visibleAccessLogs.map((log) => [
        log.date,
        log.time,
        log.userName,
        log.userEmail,
        log.userIdentifier,
        log.userRole,
        log.method,
        getRfidUid(log),
        log.accessType,
        `${log.scheduleId ?? 'N/A'} | ${log.scheduleWindow ?? 'N/A'}`,
        log.status,
      ]),
      fileBaseName:
        viewFilter === 'today'
          ? `access_logs_today_${todayDateStamp}`
          : `access_logs_all_${todayDateStamp}`,
      pdf: {
        title: viewFilter === 'today' ? "Today's Access Logs" : 'Access Logs',
        note: buildExportNote(visibleAccessLogs.length, 'access attempt', [
          statusFilter !== 'all' ? `Status: ${activeStatusFilterConfig.label}` : '',
          dateFrom ? `From ${dateFrom}` : '',
          dateTo ? `To ${dateTo}` : '',
          searchQuery.trim() ? `Search: "${searchQuery.trim()}"` : '',
        ]),
        widths: [62, 55, 90, 110, 65, 45, 50, 85, 65, 130, 50],
        emphasizeColumn: 2,
        emptyMessage: 'No access logs match the selected filters.',
      },
    });
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
            <AccessLogsLiveStatus {...liveLogs} />
          </div>
          <button
            type="button"
            className="access-logs-export"
            onClick={() => setIsExportModalOpen(true)}
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
            <button
              type="button"
              className="access-logs-reset"
              aria-label="Reset filters"
              title="Reset filters"
              onClick={() => {
                setViewFilter('today');
                setStatusFilter('all');
                setDateFrom('');
                setDateTo('');
                setSearchQuery('');
                setIsViewFilterMenuOpen(false);
                setIsStatusFilterMenuOpen(false);
              }}
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          </div>

          <label className="access-logs-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search user, ID, UID, or method"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        </div>

        <div className="dashboard-recent-table-wrap access-logs-table-wrap">
          <table className="dashboard-recent-table access-logs-table access-logs-table-with-actions">
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

              {!isLoading && visibleAccessLogs.length === 0 && (
                <tr>
                  <td className="dashboard-recent-empty" colSpan={columns.length}>
                    {errorMessage
                      ? 'Unable to load access logs. Retrying automatically.'
                      : <TableEmptyState description="Recorded access attempts will appear here. Try adjusting your search or filters.">
                          {normalizedSearchQuery
                            ? 'No access logs match your search.'
                            : viewFilter === 'today'
                              ? "No access logs found for today's activity."
                              : 'No access logs found.'}
                        </TableEmptyState>}
                  </td>
                </tr>
              )}

              {!isLoading &&
                paginatedAccessLogs.map((log) => (
                  <tr key={log.id} data-access-log-id={log.id}>
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
                      <strong>{log.method || 'N/A'}</strong>
                      {getRfidUid(log) ? <span>UID: {getRfidUid(log)}</span> : null}
                    </td>
                    <td>
                      <strong>{log.accessType || 'N/A'}</strong>
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
                    <td>
                      <RowActionMenu
                        label={`Actions for access log #${log.id}`}
                        items={[
                          { label: 'View', icon: Eye, onClick: () => setViewLog(log) },
                          { label: 'Delete', icon: Trash2, danger: true, onClick: () => deleteAccessLog(log) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {!isLoading && visibleAccessLogs.length > 0 && (
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
      <AccessLogViewModal log={viewLog} onClose={closeLogView} />
      <DeleteRequestModal
        open={Boolean(deleteRequest)}
        actorId={user?.id}
        targetType={deleteRequest?.targetType}
        targetId={deleteRequest?.targetId}
        targetLabel={deleteRequest?.targetLabel || ''}
        detail={deleteRequest?.detail || ''}
        onClose={() => setDeleteRequest(null)}
        onSubmitted={(message) => {
          setDeleteNotice(message);
          window.setTimeout(() => setDeleteNotice(''), 4000);
        }}
      />
      <DeleteRequestToast message={deleteNotice} title="Delete request" onClose={() => setDeleteNotice('')} />
      <ErrorNoticeModal open={Boolean(actionError)} message={actionError} onClose={() => setActionError('')} />
      <ExportFormatModal
        open={isExportModalOpen}
        title="Export Access Logs"
        subtitle={`${visibleAccessLogs.length} access attempt${visibleAccessLogs.length === 1 ? '' : 's'} in the current view`}
        prompt="Only the access logs matching the current filters will be exported. Choose the file format."
        pdfHint="Printable access log table"
        onSelect={handleExport}
        onClose={() => setIsExportModalOpen(false)}
      />
    </main>
  );
}
