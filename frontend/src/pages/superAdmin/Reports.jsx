import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download, Info, RefreshCw, Search, ShieldAlert, XCircle } from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import ErrorNoticeModal from '../../components/ErrorNoticeModal';
import ExportFormatModal from '../../components/ExportFormatModal';
import TableEmptyState from '../../components/TableEmptyState';
import { getManilaDateStamp } from '../../utils/dateTime';
import { buildExportNote, exportTable } from '../../utils/exportFiles';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/activityLogs.css';
import '../../styles/superAdmin/reports.css';

const roleOptions = [
  { value: 'all', label: 'All roles' },
  { value: 'student', label: 'Student' },
  { value: 'faculty', label: 'Instructor' },
  { value: 'staff', label: 'Staff' },
  { value: 'admin', label: 'Admin' },
];

const reportOptions = [
  { value: 'activity', label: 'Access Activity' },
  { value: 'late', label: 'Late Access' },
  { value: 'extended', label: 'Extended Access' },
  { value: 'denied', label: 'Denied Access' },
];

const reportTabs = [{ value: 'overview', label: 'Overview' }, ...reportOptions];

function FilterMenu({ id, label, value, options, isOpen, onToggle, onSelect, menuClassName = '' }) {
  const active = options.find((option) => option.value === value) || options[0];

  return (
    <div className="manage-users-role-tabs manage-users-status-filter">
      <button
        type="button"
        className={`manage-users-role-tab-trigger${isOpen ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={id}
        aria-label={label}
        onClick={onToggle}
      >
        <span className="manage-users-role-tab-trigger-label">{active?.label}</span>
        {active?.count != null ? (
          <span className="manage-users-role-tab-count">{active.count}</span>
        ) : null}
        <ChevronDown className="manage-users-role-tab-chevron" size={14} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div id={id} className={`manage-users-role-tab-menu ${menuClassName}`.trim()} role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.value || 'all'}
              type="button"
              role="option"
              className={`manage-users-role-tab-option${option.value === value ? ' is-active' : ''}`}
              aria-selected={option.value === value}
              onClick={() => onSelect(option.value)}
            >
              <Check className="manage-users-role-tab-check" size={15} aria-hidden="true" />
              <span className="manage-users-role-tab-option-label">{option.label}</span>
              {option.count != null ? <span className="manage-users-role-tab-count">{option.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const methodOrder = ['Fingerprint', 'RFID', 'Override'];
const methodColors = { Fingerprint: '#0d4632', RFID: '#427956', Override: '#f0c423' };
const roleOrder = ['Student', 'Instructor', 'Staff', 'Admin', 'Super Admin'];
const roleColors = ['#216c48', '#0d4632', '#427956', '#f0c423', '#b7cec0'];

function activityDay(dateTime) {
  const match = String(dateTime || '').match(/^([A-Za-z]+ \d{1,2}, \d{4})/);
  return match ? match[1] : '';
}

function shortDayLabel(label) {
  return String(label).replace(/, \d{4}$/, '');
}

function chartAxisMax(value) {
  const safe = Math.max(1, Number(value) || 0);
  if (safe <= 4) {
    return 4;
  }
  const magnitude = 10 ** Math.floor(Math.log10(safe));
  return Math.ceil(safe / magnitude) * magnitude;
}

function AccessTrendChart({ rows }) {
  const points = useMemo(() => {
    const buckets = new Map();
    rows.forEach((row) => {
      const label = activityDay(row.dateTime);
      const sort = new Date(label).getTime();
      if (!label || Number.isNaN(sort)) {
        return;
      }
      if (!buckets.has(sort)) {
        buckets.set(sort, { label, granted: 0, denied: 0, sort });
      }
      const bucket = buckets.get(sort);
      if (row.result === 'Granted') {
        bucket.granted += 1;
      } else {
        bucket.denied += 1;
      }
    });
    return [...buckets.values()].sort((left, right) => left.sort - right.sort);
  }, [rows]);

  if (points.length === 0) {
    return <p className="reports-chart-empty">No access attempts in this view.</p>;
  }

  const width = 640;
  const height = 220;
  const pad = { top: 12, right: 8, bottom: 28, left: 28 };
  const max = chartAxisMax(Math.max(...points.flatMap((point) => [point.granted, point.denied])));
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const xAt = (index) => pad.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yAt = (value) => pad.top + plotHeight - (value / max) * plotHeight;
  const line = (key) => points.map((point, index) => `${xAt(index)},${yAt(point[key])}`).join(' ');
  const labelStep = Math.max(1, Math.ceil(points.length / 6));
  const ticks = [0, max / 2, max];

  return (
    <svg className="reports-trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Granted and denied access by day">
      {ticks.map((tick) => {
        const y = yAt(tick);
        return (
          <g key={tick}>
            <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} className="reports-chart-grid" />
            <text x={pad.left - 6} y={y + 3} className="reports-chart-axis">
              {Math.round(tick)}
            </text>
          </g>
        );
      })}
      <polyline points={line('granted')} className="reports-trend-granted" />
      <polyline points={line('denied')} className="reports-trend-denied" />
      {points.map((point, index) => (
        index % labelStep === 0 || index === points.length - 1 ? (
          <text key={point.sort} x={xAt(index)} y={height - 8} className="reports-chart-label">
            {shortDayLabel(point.label)}
          </text>
        ) : null
      ))}
    </svg>
  );
}

function AccessMethodChart({ rows }) {
  const methods = methodOrder.map((name) => ({
    name,
    count: rows.filter((row) => row.method === name).length,
  }));
  const max = Math.max(...methods.map((method) => method.count), 1);
  const hasRows = rows.length > 0;

  if (!hasRows) {
    return <p className="reports-chart-empty">No access attempts in this view.</p>;
  }

  return (
    <div className="reports-method-chart" aria-label="Access attempts by method">
      {methods.map((method) => (
        <div key={method.name}>
          <strong>{method.count}</strong>
          <span className="reports-method-track">
            <span style={{ background: methodColors[method.name], height: method.count === 0 ? '0%' : `${Math.max(8, (method.count / max) * 100)}%` }} />
          </span>
          <small>{method.name}</small>
        </div>
      ))}
    </div>
  );
}

function AccessRoleChart({ rows }) {
  const slices = roleOrder
    .map((name, index) => ({
      name,
      count: rows.filter((row) => row.role === name).length,
      color: roleColors[index],
    }))
    .filter((slice) => slice.count > 0);
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);

  if (total === 0) {
    return <p className="reports-chart-empty">No access attempts in this view.</p>;
  }

  const size = 160;
  const center = size / 2;
  const radius = center - 2;
  const pointAt = (angle, distance) => [
    center + Math.sin(angle) * distance,
    center - Math.cos(angle) * distance,
  ];
  let angle = 0;
  const pieces = slices.map((slice) => {
    const sweep = (slice.count / total) * Math.PI * 2;
    const start = angle;
    angle += sweep;
    const [startX, startY] = pointAt(start, radius);
    const [endX, endY] = pointAt(angle, radius);
    const [labelX, labelY] = slices.length === 1 ? [center, center] : pointAt(start + sweep / 2, radius * 0.62);
    return {
      ...slice,
      percent: Math.round((slice.count / total) * 100),
      path: `M ${center} ${center} L ${startX} ${startY} A ${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${endX} ${endY} Z`,
      labelX,
      labelY,
      showLabel: sweep >= 0.35,
      darkText: slice.color === roleColors[3] || slice.color === roleColors[4],
    };
  });

  return (
    <div className="reports-role-chart">
      <svg
        className="reports-role-pie"
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${total} access attempts by role`}
      >
        {pieces.length === 1 ? (
          <circle cx={center} cy={center} r={radius} fill={pieces[0].color} />
        ) : (
          pieces.map((piece) => <path key={piece.name} d={piece.path} fill={piece.color} />)
        )}
        {pieces.filter((piece) => piece.showLabel).map((piece) => (
          <text
            key={piece.name}
            x={piece.labelX}
            y={piece.labelY}
            className={piece.darkText ? 'is-dark' : ''}
          >
            {piece.percent}%
          </text>
        ))}
      </svg>
      <ul>
        {pieces.map((piece) => (
          <li key={piece.name}>
            <i style={{ background: piece.color }} />
            <span>
              {piece.name}
              <strong>
                {piece.count} ({piece.percent}%)
              </strong>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExtendedAccessPanel({ rows, onViewAll }) {
  const rowsPerPage = 8;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const pageRows = rows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [rows]);

  return (
    <article className="reports-extended-panel">
      <header>
        <h3>Extended Access</h3>
        <button type="button" onClick={onViewAll}>
          View All →
        </button>
      </header>
      {rows.length === 0 ? (
        <TableEmptyState description="Scheduled access records matching the selected filters will appear here.">
          No scheduled entries in this view.
        </TableEmptyState>
      ) : (
        <div className="reports-extended-table-wrap">
          <table>
            <colgroup>
              <col className="reports-extended-col-user" />
              <col className="reports-extended-col-end" />
              <col className="reports-extended-col-exit" />
              <col className="reports-extended-col-by" />
              <col className="reports-extended-col-status" />
            </colgroup>
            <thead>
              <tr>
                <th>User</th>
                <th title="Scheduled End">Sched End</th>
                <th title="Actual Exit">Exit</th>
                <th title="Extended By">Ext. By</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const tone = String(row.status || '').toLowerCase().replace(/\s+/g, '-');
                return (
                  <tr key={row.id}>
                    <td>
                      <span className="reports-person">
                        <span>
                          <strong>{row.user || '—'}</strong>
                          <small>{row.role}</small>
                        </span>
                      </span>
                    </td>
                    <td>{row.scheduledEnd}</td>
                    <td>{row.actualExit}</td>
                    <td>{row.extendedBy}</td>
                    <td>
                      <span className={`reports-pill is-${tone}`} title={row.status}>
                        {row.status === 'Exit not recorded' ? 'No exit' : row.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > rowsPerPage ? (
        <div className="reports-extended-pages">
          <button type="button" aria-label="Previous page" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1}>
            <ChevronLeft size={14} />
          </button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, index) => {
            const start = Math.min(Math.max(1, currentPage - 2), Math.max(1, totalPages - 4));
            return start + index;
          }).map((page) => (
            <button key={page} type="button" className={page === currentPage ? 'is-active' : ''} onClick={() => setCurrentPage(page)}>
              {page}
            </button>
          ))}
          <button type="button" aria-label="Next page" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage === totalPages}>
            <ChevronRight size={14} />
          </button>
        </div>
      ) : null}
    </article>
  );
}

function statusTone(value) {
  const key = String(value || '').toLowerCase();
  if (key === 'granted' || key === 'on time') {
    return 'is-granted';
  }
  if (key === 'denied' || key === 'late' || key === 'extended') {
    return 'is-alert';
  }
  if (key === 'still inside') {
    return 'is-pending';
  }
  return '';
}

function ReportTable({ columns, columnWidths, rows, emptyMessage, isLoading, footnote }) {
  const rowsPerPage = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const pageRows = rows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [rows]);

  return (
    <>
      <div className="dashboard-recent-table-wrap reports-table-wrap">
        <table className="dashboard-recent-table reports-table">
          {columnWidths ? (
            <colgroup>
              {columns.map((column, index) => (
                <col key={column.key} style={{ width: `${columnWidths[index]}%` }} />
              ))}
            </colgroup>
          ) : null}
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="dashboard-recent-empty" colSpan={columns.length}>
                  Loading report...
                </td>
              </tr>
            ) : null}
            {!isLoading && rows.length === 0 ? (
              <tr>
                <td className="dashboard-recent-empty" colSpan={columns.length}>
                  <TableEmptyState description="Try adjusting the report filters or date range.">
                    {emptyMessage}
                  </TableEmptyState>
                </td>
              </tr>
            ) : null}
            {!isLoading &&
              pageRows.map((row) => (
                <tr key={row.id}>
                  {columns.map((column) => (
                    <td key={column.key}>
                      {column.status ? (
                        <span className={`reports-status ${statusTone(row[column.key])}`.trim()}>
                          {row[column.key]}
                        </span>
                      ) : (
                        row[column.key]
                      )}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {footnote ? (
        <p className="reports-note reports-table-footnote">
          <Info size={13} aria-hidden="true" />
          <span>{footnote}</span>
        </p>
      ) : null}
      {!isLoading && rows.length > 0 ? (
        <div className="reports-pagination">
          <p>
            Showing {(currentPage - 1) * rowsPerPage + 1}–
            {Math.min(currentPage * rowsPerPage, rows.length)} of {rows.length}
          </p>
          <div>
            <button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1}>
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
      ) : null}
    </>
  );
}

export default function Reports() {
  const initialFilters = {
    dateFrom: '',
    dateTo: '',
    role: 'all',
    report: 'activity',
  };
  const [filters, setFilters] = useState(initialFilters);
  const [activeReport, setActiveReport] = useState('overview');
  const [report, setReport] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [openFilter, setOpenFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const filterBarRef = useRef(null);

  useEffect(() => {
    let isActive = true;

    async function loadReport() {
      setIsLoading(true);
      try {
        const response = await axiosClient.get('/api/reports.php', {
          params: {
            date_from: filters.dateFrom,
            date_to: filters.dateTo,
            role: filters.role,
            search: appliedSearch || undefined,
          },
        });
        if (!isActive) {
          return;
        }
        setReport(response.data.report);
        setErrorMessage('');
      } catch (error) {
        if (isActive) {
          setReport(null);
          setErrorMessage(error.response?.data?.message || 'Unable to load reports right now.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadReport();
    return () => {
      isActive = false;
    };
  }, [filters, appliedSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppliedSearch(searchQuery.trim());
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!openFilter) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!filterBarRef.current?.contains(event.target)) {
        setOpenFilter('');
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpenFilter('');
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openFilter]);

  const users = report?.users || [];

  const roleCounts = useMemo(() => {
    const counts = { all: users.length, student: 0, faculty: 0, staff: 0, admin: 0 };
    users.forEach((user) => {
      if (user.role in counts) {
        counts[user.role] += 1;
      }
    });
    return counts;
  }, [users]);
  const roleMenuOptions = roleOptions.map((option) => ({
    ...option,
    count: isLoading ? '--' : roleCounts[option.value] || 0,
  }));
  const appliedRole = roleOptions.find((option) => option.value === filters.role)?.label || 'All roles';
  const periodLabel = report?.period?.label || '';

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
    if (field === 'report') {
      setActiveReport(value);
    }
  }

  function clearFilters() {
    setFilters((current) => ({
      ...initialFilters,
      report: current.report,
    }));
    setSearchQuery('');
    setAppliedSearch('');
    setOpenFilter('');
  }

  const activity = report?.accessActivity;
  const lateAccess = report?.lateAccess;
  const extendedAccess = report?.extendedAccess;
  const deniedAccess = report?.deniedAccess;

  const views = {
    activity: {
      title: 'Access Activity Report',
      purpose: 'Overall classroom access recorded by Entrivo.',
      summary: [
        { label: 'Total Access Attempts', value: activity?.summary.total ?? '—' },
        { label: 'Granted', value: activity?.summary.granted ?? '—' },
        { label: 'Denied', value: activity?.summary.denied ?? '—' },
        { label: 'Overrides', value: activity?.summary.overrides ?? '—', detail: 'Included in the totals' },
      ],
      columns: [
        { key: 'dateTime', label: 'Date & Time' },
        { key: 'user', label: 'User' },
        { key: 'role', label: 'Role' },
        { key: 'method', label: 'Access Method' },
        { key: 'result', label: 'Status', status: true },
        { key: 'scheduleStatus', label: 'Schedule Status' },
        { key: 'remarks', label: 'Remarks' },
      ],
      widths: [110, 120, 70, 80, 60, 90, 140],
      columnWidths: [15, 16, 9, 11, 8, 15, 26],
      rows: activity?.rows || [],
      empty: 'No access attempts match these filters.',
    },
    late: {
      title: 'Late Access Report',
      purpose: 'Users who entered after the scheduled start time plus the grace period.',
      summary: [
        { label: 'Total Scheduled Users', value: lateAccess?.summary.scheduled ?? '—', detail: 'Schedule sessions in this period' },
        { label: 'On-Time Access', value: lateAccess?.summary.onTime ?? '—' },
        { label: 'Late Access', value: lateAccess?.summary.late ?? '—' },
        { label: 'Average Late Time', value: lateAccess?.summary.averageLate ?? '—' },
      ],
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'user', label: 'User' },
        { key: 'role', label: 'Role' },
        { key: 'scheduledStart', label: 'Scheduled Start' },
        { key: 'gracePeriod', label: 'Grace Period' },
        { key: 'actualAccess', label: 'Actual Access' },
        { key: 'lateBy', label: 'Late By' },
        { key: 'status', label: 'Status', status: true },
      ],
      widths: [80, 120, 70, 80, 70, 80, 70, 60],
      columnWidths: [11, 19, 10, 13, 11, 12, 11, 13],
      rows: lateAccess?.rows || [],
      empty: 'No granted entries match a schedule in this period.',
    },
    extended: {
      title: 'Extended Access Report',
      purpose: 'Users whose recorded exit is later than their scheduled end time.',
      summary: [
        { label: 'Total Users', value: extendedAccess?.summary.total ?? '—', detail: 'Sessions with a granted entry' },
        {
          label: 'Users Still Inside',
          value: extendedAccess?.summary.stillInside ?? 'Not tracked',
          detail: report?.exitTracking ? 'No exit scan after the scheduled end' : 'No exit scans in this period',
        },
        { label: 'Extended Access', value: extendedAccess?.summary.extended ?? '—' },
        { label: 'Total Extended Time', value: extendedAccess?.summary.totalExtended ?? '—' },
        { label: 'Average Extended Time', value: extendedAccess?.summary.averageExtended ?? '—' },
      ],
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'user', label: 'User' },
        { key: 'role', label: 'Role' },
        { key: 'scheduledStart', label: 'Scheduled Start' },
        { key: 'scheduledEnd', label: 'Scheduled End' },
        { key: 'actualExit', label: 'Actual Exit' },
        { key: 'extendedBy', label: 'Extended By' },
        { key: 'status', label: 'Status', status: true },
      ],
      widths: [80, 110, 70, 75, 75, 75, 80, 90],
      columnWidths: [11, 18, 10, 12, 12, 11, 11, 15],
      rows: extendedAccess?.rows || [],
      empty: 'No granted entries match a schedule in this period.',
    },
    denied: {
      title: 'Denied Access Report',
      purpose: 'Access attempts Entrivo denied.',
      summary: [
        { label: 'Total Denied Attempts', value: deniedAccess?.summary.total ?? '—' },
        { label: 'No Active Schedule', value: deniedAccess?.summary.noSchedule ?? '—' },
        { label: 'Expired Access', value: deniedAccess?.summary.expired ?? '—' },
        { label: 'Invalid Authentication', value: deniedAccess?.summary.invalidAuth ?? '—' },
        { label: 'Other', value: deniedAccess?.summary.other ?? '—' },
      ],
      columns: [
        { key: 'dateTime', label: 'Date & Time' },
        { key: 'user', label: 'User' },
        { key: 'role', label: 'Role' },
        { key: 'method', label: 'Access Method' },
        { key: 'scheduledTime', label: 'Scheduled Time' },
        { key: 'result', label: 'Status', status: true },
        { key: 'reason', label: 'Denial Reason' },
      ],
      widths: [110, 120, 70, 80, 120, 60, 130],
      columnWidths: [15, 16, 9, 11, 17, 8, 24],
      rows: deniedAccess?.rows || [],
      empty: 'No denied attempts match these filters.',
    },
  };

  const currentView = views[activeReport];

  function handleExport(format) {
    setIsExportOpen(false);
    if (!currentView) {
      return;
    }
    const summaryNote = currentView.summary
      .map((item) => `${item.label}: ${item.value}`)
      .join(', ');
    exportTable(format, {
      headers: currentView.columns.map((column) => column.label),
      rows: currentView.rows.map((row) => currentView.columns.map((column) => row[column.key])),
      fileBaseName: `${activeReport}_report_${getManilaDateStamp()}`,
      pdf: {
        title: currentView.title,
        note: buildExportNote(currentView.rows.length, 'record', [
          periodLabel,
          `Role: ${appliedRole}`,
          appliedSearch ? `Search: "${appliedSearch}"` : '',
          summaryNote,
        ]),
        widths: currentView.widths,
        emphasizeColumn: currentView.columns.findIndex((column) => column.key === 'user'),
        emptyMessage: currentView.empty,
      },
    });
  }

  const overviewCards = [
    { key: 'activity', label: 'Access Activity', detail: 'Granted, denied, and override attempts', value: activity?.summary.total ?? '—', icon: Activity },
    { key: 'late', label: 'Late Access', detail: 'After the grace period', value: lateAccess?.summary.late ?? '—', icon: Clock3 },
    { key: 'extended', label: 'Extended Access', detail: 'Past the scheduled end', value: extendedAccess?.summary.extended ?? '—', icon: ShieldAlert },
    { key: 'denied', label: 'Denied Access', detail: 'Attempts Entrivo refused', value: deniedAccess?.summary.total ?? '—', icon: XCircle },
  ];

  const summaryCards = activeReport === 'overview'
    ? overviewCards
    : currentView.summary.map((item, index) => ({
        key: item.label,
        label: item.label,
        detail: item.detail || '',
        value: item.value,
        icon: [Activity, CheckCircle2, XCircle, Clock3, ShieldAlert][index] || Activity,
      }));

  return (
    <main className="admin-dashboard reports-page" aria-label="Reports">
      <section className="reports-summary-grid" aria-label="Report summary">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          const openReport = () => {
            if (!card.key || activeReport !== 'overview') {
              return;
            }
            setActiveReport(card.key);
            setFilters((current) => ({ ...current, report: card.key }));
          };

          const copy = (
            <div className="dashboard-summary-copy">
              <span className="dashboard-summary-label">{card.label}</span>
              <strong>{isLoading ? '--' : card.value}</strong>
              {card.detail ? <small>{card.detail}</small> : null}
            </div>
          );

          return (
            <article className="dashboard-summary-card" key={card.key}>
              <div className="dashboard-summary-icon" aria-hidden="true">
                <Icon size={28} strokeWidth={2.4} />
              </div>
              {activeReport === 'overview' ? (
                <button type="button" className="reports-summary-button" onClick={openReport}>
                  {copy}
                </button>
              ) : (
                copy
              )}
            </article>
          );
        })}
      </section>

      <div className="reports-tabs" role="tablist" aria-label="Reports">
        {reportTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={activeReport === tab.value}
            className={activeReport === tab.value ? 'is-active' : ''}
            onClick={() => {
              setActiveReport(tab.value);
              if (tab.value === 'overview') {
                clearFilters();
              } else {
                setFilters((current) => ({ ...current, report: tab.value }));
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeReport === 'overview' ? null : (
      <section className="dashboard-recent-card reports-card">
        <div className="dashboard-panel-header reports-header">
          <div>
            <span>{currentView.title}</span>
            <p>{`${currentView.purpose}${periodLabel ? ` ${periodLabel}.` : ''}`}</p>
          </div>
          <button
            type="button"
            className="reports-export"
            onClick={() => setIsExportOpen(true)}
            disabled={isLoading || !currentView || currentView.rows.length === 0}
          >
            <Download size={15} aria-hidden="true" />
            Export
          </button>
        </div>

        <div className="activity-logs-toolbar reports-toolbar" ref={filterBarRef}>
          <div className="activity-logs-toolbar-filters">
            <FilterMenu
              id="reports-role-filter"
              label="Role filter"
              value={filters.role}
              options={roleMenuOptions}
              isOpen={openFilter === 'role'}
              onToggle={() => setOpenFilter((current) => (current === 'role' ? '' : 'role'))}
              onSelect={(value) => {
                updateFilter('role', value);
                setOpenFilter('');
              }}
            />
            <FilterMenu
              id="reports-type-filter"
              label="Report type"
              value={filters.report}
              options={reportOptions}
              isOpen={openFilter === 'report'}
              onToggle={() => setOpenFilter((current) => (current === 'report' ? '' : 'report'))}
              onSelect={(value) => {
                updateFilter('report', value);
                setOpenFilter('');
              }}
            />
            <div className="activity-logs-dates">
              <label>
                <span>From</span>
                <input type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} />
              </label>
              <span className="activity-logs-dates-divider" aria-hidden="true" />
              <label>
                <span>To</span>
                <input type="date" value={filters.dateTo} onChange={(event) => updateFilter('dateTo', event.target.value)} />
              </label>
            </div>
            <button type="button" className="reports-reset" aria-label="Clear filters" onClick={clearFilters}>
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          </div>
          <label className="activity-logs-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search name, user ID, or employee ID"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        </div>

        <ReportTable
          columns={currentView.columns}
          columnWidths={currentView.columnWidths}
          rows={isLoading ? [] : currentView.rows}
          emptyMessage={currentView.empty}
          isLoading={isLoading}
          footnote={
            activeReport === 'late'
              ? "A user is late only when the entry time is later than the scheduled start plus that schedule's grace period."
              : activeReport === 'extended'
                ? extendedAccess?.note || ''
                : ''
          }
        />
      </section>
      )}

      {activeReport === 'overview' ? (
        <div className="reports-overview-layout">
          <div className="reports-overview-charts">
            <article className="reports-visual-card reports-visual-trend">
              <header>
                <h3>Access Trend</h3>
                <div className="reports-visual-legend" aria-label="Trend legend">
                  <span><i className="is-granted" />Granted</span>
                  <span><i className="is-denied" />Denied</span>
                </div>
              </header>
              <AccessTrendChart rows={isLoading ? [] : activity?.rows || []} />
            </article>
            <div className="reports-overview-bottom">
              <article className="reports-visual-card reports-visual-methods">
                <header>
                  <h3>Access Methods</h3>
                </header>
                <AccessMethodChart rows={isLoading ? [] : activity?.rows || []} />
              </article>
              <article className="reports-visual-card reports-visual-role">
                <header>
                  <h3>Access by Role</h3>
                </header>
                <AccessRoleChart rows={isLoading ? [] : activity?.rows || []} />
              </article>
            </div>
          </div>
          <ExtendedAccessPanel
            rows={isLoading ? [] : extendedAccess?.rows || []}
            onViewAll={() => {
              setActiveReport('extended');
              setFilters((current) => ({ ...current, report: 'extended' }));
            }}
          />
        </div>
      ) : null}

      <ExportFormatModal
        open={isExportOpen}
        title={currentView ? `Export ${currentView.title}` : 'Export Report'}
        subtitle={periodLabel ? `${periodLabel} · ${appliedRole}` : ''}
        prompt="The file includes the report title, date range, filters, summary, and the records in the current view."
        pdfHint="Printable report"
        csvHint="Spreadsheet for Excel"
        onSelect={handleExport}
        onClose={() => setIsExportOpen(false)}
      />
      <ErrorNoticeModal
        open={Boolean(errorMessage)}
        message={errorMessage}
        onClose={() => setErrorMessage('')}
      />
    </main>
  );
}
