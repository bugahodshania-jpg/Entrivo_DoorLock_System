import {
  CalendarCheck,
  CalendarPlus,
  CheckCircle2,
  Download,
  FileText,
  ShieldAlert,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import axiosClient from '../../api/axiosClient';
import '../../styles/superAdmin/dashboard.css';

const initialDashboardSummary = {
  totalUsers: 0,
  students: 0,
  faculty: 0,
  activeSchedules: 0,
  grantedAccess: 0,
  deniedToday: 0,
};

const chartWidth = 640;
const chartHeight = 220;
const chartPadding = 28;

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value) || 0);
}

function getChartPoints(data, key, maxValue) {
  if (!data.length) {
    return '';
  }

  return data
    .map((item, index) => {
      const x =
        chartPadding +
        (index * (chartWidth - chartPadding * 2)) / Math.max(data.length - 1, 1);
      const y =
        chartHeight -
        chartPadding -
        ((Number(item[key]) || 0) / maxValue) * (chartHeight - chartPadding * 2);

      return `${x},${y}`;
    })
    .join(' ');
}

function getChartPoint(data, key, maxValue, index) {
  const x =
    chartPadding +
    (index * (chartWidth - chartPadding * 2)) / Math.max(data.length - 1, 1);
  const y =
    chartHeight -
    chartPadding -
    ((Number(data[index]?.[key]) || 0) / maxValue) * (chartHeight - chartPadding * 2);

  return { x, y };
}

export default function SuperAdminDashboard() {
  const [summary, setSummary] = useState(initialDashboardSummary);
  const [accessTrend, setAccessTrend] = useState([]);
  const [todayAccessTrend, setTodayAccessTrend] = useState([]);
  const [todaySchedules, setTodaySchedules] = useState([]);
  const [recentAccessLogs, setRecentAccessLogs] = useState([]);
  const [pendingOverrides, setPendingOverrides] = useState([]);
  const [chartRange, setChartRange] = useState('week');
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    async function loadDashboardSummary() {
      try {
        const response = await axiosClient.get('/api/dashboard_stats.php');

        if (!isActive) {
          return;
        }

        setSummary({
          ...initialDashboardSummary,
          ...response.data.summary,
        });
        setAccessTrend(response.data.accessTrend || []);
        setTodayAccessTrend(response.data.todayAccessTrend || []);
        setTodaySchedules(response.data.todaySchedules || []);
        setRecentAccessLogs(response.data.recentAccessLogs || []);
        setPendingOverrides(response.data.pendingOverrides || []);
      } catch {
        if (isActive) {
          setSummary(initialDashboardSummary);
          setAccessTrend([]);
          setTodayAccessTrend([]);
          setTodaySchedules([]);
          setRecentAccessLogs([]);
          setPendingOverrides([]);
        }
      } finally {
        if (isActive) {
          setIsSummaryLoading(false);
        }
      }
    }

    loadDashboardSummary();

    return () => {
      isActive = false;
    };
  }, []);

  const summaryCards = useMemo(
    () => [
      {
        label: 'Access Granted',
        value: summary.grantedAccess,
        detail: 'Successful access attempts',
        icon: CheckCircle2,
      },
      {
        label: 'Access Denied',
        value: summary.deniedToday,
        detail: (
          <>
            Denied attempts
            <span className="dashboard-summary-online">
              <span aria-hidden="true" />
              Today
            </span>
          </>
        ),
        icon: XCircle,
      },
    ],
    [summary.deniedToday, summary.grantedAccess],
  );
  const chartData = chartRange === 'today' ? todayAccessTrend : accessTrend;
  const chartSubtitle =
    chartRange === 'today'
      ? 'Granted and denied access by time today'
      : 'Granted and denied access over the last 7 days';
  const maxChartValue = Math.max(
    1,
    ...chartData.flatMap((item) => [Number(item.granted) || 0, Number(item.denied) || 0]),
  );
  const hasGrantedData = chartData.some((item) => Number(item.granted) > 0);
  const hasDeniedData = chartData.some((item) => Number(item.denied) > 0);
  const grantedPoints = getChartPoints(chartData, 'granted', maxChartValue);
  const deniedPoints = getChartPoints(chartData, 'denied', maxChartValue);
  const quickActions = [
    {
      label: 'Add Schedule',
      href: '/super-admin/schedules',
      icon: CalendarPlus,
    },
    {
      label: 'Register User',
      href: '/super-admin/manage-users',
      icon: UserPlus,
    },
    {
      label: 'Download All User',
      href: '/super-admin/manage-users',
      icon: Download,
    },
    {
      label: 'Generate Report',
      href: '/super-admin/reports',
      icon: FileText,
    },
  ];

  return (
    <main className="admin-dashboard" aria-label="Super admin dashboard">
      <section className="dashboard-summary-grid" aria-label="System summary">
        <div className="dashboard-summary-compact">
          <article className="dashboard-summary-card dashboard-summary-card-featured">
            <div className="dashboard-summary-icon" aria-hidden="true">
              <Users size={36} strokeWidth={2.5} />
            </div>
            <div className="dashboard-summary-copy">
              <span className="dashboard-summary-label">Total Users</span>
              <strong>{isSummaryLoading ? '--' : formatNumber(summary.totalUsers)}</strong>
              <small>
                {formatNumber(summary.students)} Students
                <b aria-hidden="true">&middot;</b>
                {formatNumber(summary.faculty)} Faculty
              </small>
            </div>
          </article>

          {summaryCards.map(({ label, value, detail, icon: Icon }) => (
            <article className="dashboard-summary-card" key={label}>
              <div className="dashboard-summary-icon" aria-hidden="true">
                <Icon size={32} strokeWidth={2.4} />
              </div>
              <div className="dashboard-summary-copy">
                <span className="dashboard-summary-label">{label}</span>
                <strong>{isSummaryLoading ? '--' : formatNumber(value)}</strong>
                <small>{detail}</small>
              </div>
            </article>
          ))}
        </div>

        <article className="dashboard-summary-card dashboard-summary-card-wide">
          <div className="dashboard-summary-icon" aria-hidden="true">
            <CalendarCheck size={32} strokeWidth={2.4} />
          </div>
          <div className="dashboard-summary-copy">
            <span className="dashboard-summary-label">Active Schedules</span>
            <strong>{isSummaryLoading ? '--' : formatNumber(summary.activeSchedules)}</strong>
            <small>Approved schedules</small>
          </div>
        </article>
      </section>

      <section className="dashboard-insights-grid" aria-label="Access and schedule summary">
        <div className="dashboard-insights-main">
          <div className="dashboard-top-row">
            <article className="dashboard-chart-card">
              <div className="dashboard-panel-header">
                <div>
                  <span>Access Summary</span>
                  <p>{chartSubtitle}</p>
                </div>
                <div className="dashboard-chart-tools">
                  <div className="dashboard-chart-legend" aria-label="Chart legend">
                    <span>
                      <b className="dashboard-legend-granted" />
                      Granted
                    </span>
                    <span>
                      <b className="dashboard-legend-denied" />
                      Denied
                    </span>
                  </div>
                  <div className="dashboard-chart-actions" aria-label="Chart filters">
                    <button
                      type="button"
                      className={chartRange === 'week' ? 'is-active' : ''}
                      onClick={() => setChartRange('week')}
                    >
                      7 Days
                    </button>
                    <button
                      type="button"
                      className={chartRange === 'today' ? 'is-active' : ''}
                      onClick={() => setChartRange('today')}
                    >
                      Today
                    </button>
                  </div>
                </div>
              </div>

              <div className="dashboard-line-chart" role="img" aria-label="Line chart for granted and denied access">
                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
                  <line
                    x1={chartPadding}
                    y1={chartHeight - chartPadding}
                    x2={chartWidth - chartPadding}
                    y2={chartHeight - chartPadding}
                    className="dashboard-chart-axis"
                  />
                  {[0.25, 0.5, 0.75].map((ratio) => (
                    <line
                      key={ratio}
                      x1={chartPadding}
                      y1={chartPadding + ratio * (chartHeight - chartPadding * 2)}
                      x2={chartWidth - chartPadding}
                      y2={chartPadding + ratio * (chartHeight - chartPadding * 2)}
                      className="dashboard-chart-grid-line"
                    />
                  ))}
                  <polyline
                    className={`dashboard-chart-line ${
                      hasGrantedData ? 'dashboard-chart-line-granted' : 'dashboard-chart-line-neutral'
                    }`}
                    points={grantedPoints}
                  />
                  <polyline
                    className={`dashboard-chart-line ${
                      hasDeniedData ? 'dashboard-chart-line-denied' : 'dashboard-chart-line-neutral'
                    }`}
                    points={deniedPoints}
                  />
                  {chartData.map((item, index) => {
                    const grantedPoint = getChartPoint(chartData, 'granted', maxChartValue, index);
                    const deniedPoint = getChartPoint(chartData, 'denied', maxChartValue, index);

                    return (
                      <g key={item.date}>
                        <circle
                          className={`dashboard-chart-dot ${
                            hasGrantedData ? 'dashboard-chart-dot-granted' : 'dashboard-chart-dot-neutral'
                          }`}
                          cx={grantedPoint.x}
                          cy={grantedPoint.y}
                          r="3.5"
                        />
                        <circle
                          className={`dashboard-chart-dot ${
                            hasDeniedData ? 'dashboard-chart-dot-denied' : 'dashboard-chart-dot-neutral'
                          }`}
                          cx={deniedPoint.x}
                          cy={deniedPoint.y}
                          r="3.5"
                        />
                        <text
                          x={grantedPoint.x}
                          y={chartHeight - 8}
                          className="dashboard-chart-label"
                          textAnchor="middle"
                        >
                          {item.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </article>

            <aside className="dashboard-actions-card" aria-label="Quick actions and override approvals">
              <div className="dashboard-panel-header">
                <div>
                  <h2>Quick Actions</h2>
                </div>
              </div>

              <div className="dashboard-quick-actions">
                {quickActions.map(({ label, href, icon: Icon }) => (
                  <a href={href} key={label}>
                    <Icon size={18} aria-hidden="true" />
                    <span>{label}</span>
                  </a>
                ))}
              </div>

              <div className="dashboard-override-panel">
                <div className="dashboard-override-header">
                  <div className="dashboard-override-title">
                    <ShieldAlert size={16} aria-hidden="true" />
                    <span>Request Override</span>
                  </div>
                  {pendingOverrides.length > 0 && (
                    <a className="dashboard-text-link" href="/super-admin/access-logs">
                      View
                    </a>
                  )}
                </div>

                <div className="dashboard-override-list">
                  {pendingOverrides.length ? (
                    pendingOverrides.map((override) => (
                      <div className="dashboard-override-item" key={override.id}>
                        <div>
                          <strong>{override.owner}</strong>
                          <span>{override.reason}</span>
                        </div>
                        <small>{override.time}</small>
                      </div>
                    ))
                  ) : (
                    <p>No override requests to approve.</p>
                  )}
                </div>
              </div>
            </aside>
          </div>

          <div className="dashboard-insights-bottom">
            <article className="dashboard-recent-card">
            <div className="dashboard-panel-header">
              <div>
                <h2>Recent Access Logs</h2>
              </div>
              <a className="dashboard-text-link" href="/super-admin/access-logs">
                View All
              </a>
            </div>

            <div className="dashboard-recent-table-wrap">
              <table className="dashboard-recent-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>User</th>
                    <th>Method</th>
                    <th>Access Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentAccessLogs.length ? (
                    recentAccessLogs.map((log) => (
                      <tr key={log.id}>
                        <td>{log.time}</td>
                        <td>
                          <strong>{log.userName}</strong>
                          <span>{log.userIdentifier}</span>
                        </td>
                        <td>{log.method}</td>
                        <td>{log.accessType}</td>
                        <td>
                          <span className={`dashboard-log-status dashboard-log-status-${log.status}`}>
                            {log.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="dashboard-recent-empty" colSpan="5">
                        No recent access logs.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            </article>

            <aside className="dashboard-schedule-card" aria-label="Active schedule today">
              <div className="dashboard-panel-header">
                <div>
                  <h2>Active Schedule Today</h2>
                  <p>Shows all of today's approved schedules, including completed and incoming.</p>
                </div>
              </div>

              <div className="dashboard-schedule-list">
                {todaySchedules.length ? (
                  todaySchedules.map((schedule) => (
                    <div
                      className={`dashboard-schedule-item dashboard-schedule-item-${schedule.state || 'upcoming'}`}
                      key={schedule.id}
                    >
                      <div className="dashboard-schedule-copy">
                        <span>{schedule.owner}</span>
                        <strong>{schedule.time}</strong>
                      </div>
                      <small
                        className={`dashboard-schedule-badge dashboard-schedule-badge-${schedule.state || 'upcoming'}`}
                      >
                        {schedule.stateLabel || 'Incoming'}
                      </small>
                    </div>
                  ))
                ) : (
                  <p>No active schedules today.</p>
                )}
              </div>

              <a className="dashboard-schedule-button" href="/super-admin/schedules">
                View All Schedule
              </a>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
