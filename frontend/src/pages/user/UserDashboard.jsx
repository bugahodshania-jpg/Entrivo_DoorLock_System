import {
  CalendarCheck,
  CheckCircle2,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import axiosClient from '../../api/axiosClient';
import AccessTrendChart from '../../components/AccessTrendChart';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/user/userPortal.css';

const initialSummary = {
  grantedAccess: 0,
  deniedToday: 0,
  activeSchedulesToday: 0,
  totalToday: 0,
};

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value) || 0);
}

export default function UserDashboard({ user }) {
  const [summary, setSummary] = useState(initialSummary);
  const [accessTrend, setAccessTrend] = useState([]);
  const [todayAccessTrend, setTodayAccessTrend] = useState([]);
  const [todaySchedules, setTodaySchedules] = useState([]);
  const [pendingOverrides, setPendingOverrides] = useState([]);
  const [recentAccessLogs, setRecentAccessLogs] = useState([]);
  const [chartRange, setChartRange] = useState('week');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    let isActive = true;
    let requestVersion = 0;
    let hasLoaded = false;

    async function loadDashboard() {
      const version = ++requestVersion;
      try {
        const response = await axiosClient.get('/api/user_portal.php', {
          params: { action: 'dashboard', user_id: user.id },
          timeout: 10000,
        });

        if (!isActive || version !== requestVersion) {
          return;
        }

        setSummary({
          ...initialSummary,
          ...response.data.summary,
        });
        setAccessTrend(response.data.accessTrend || []);
        setTodayAccessTrend(response.data.todayAccessTrend || []);
        setTodaySchedules(response.data.todaySchedules || []);
        setPendingOverrides(response.data.pendingOverrides || []);
        setRecentAccessLogs((response.data.recentAccessLogs || []).slice(0, 5));
        hasLoaded = true;
      } catch {
        // A failed background refresh keeps the last data on screen.
        if (isActive && version === requestVersion && !hasLoaded) {
          setSummary(initialSummary);
          setAccessTrend([]);
          setTodayAccessTrend([]);
          setTodaySchedules([]);
          setPendingOverrides([]);
          setRecentAccessLogs([]);
        }
      } finally {
        if (isActive && version === requestVersion) {
          setIsLoading(false);
        }
      }
    }

    loadDashboard();
    window.addEventListener('entrivo:override-notifications', loadDashboard);
    // Refresh each minute so "Active Schedule Today" follows the clock.
    const refreshTimer = window.setInterval(loadDashboard, 60000);

    return () => {
      isActive = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener('entrivo:override-notifications', loadDashboard);
    };
  }, [user?.id]);

  const activeSchedulesNow = todaySchedules.filter((schedule) => schedule.state === 'active');

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
      ? 'Your granted and denied access by time today'
      : 'Your granted and denied access over the last 7 days';

  return (
    <main className="admin-dashboard user-portal-page" aria-label="Faculty and staff dashboard">
      <section className="dashboard-summary-grid" aria-label="Access summary">
        <div className="dashboard-summary-compact">
          <article className="dashboard-summary-card dashboard-summary-card-featured">
            <div className="dashboard-summary-icon" aria-hidden="true">
              <CalendarCheck size={36} strokeWidth={2.5} />
            </div>
            <div className="dashboard-summary-copy">
              <span className="dashboard-summary-label">Active Schedule Today</span>
              <strong>{isLoading ? '--' : formatNumber(summary.activeSchedulesToday)}</strong>
              <small>Approved schedules for today</small>
            </div>
          </article>

          {summaryCards.map(({ label, value, detail, icon: Icon }) => (
            <article className="dashboard-summary-card" key={label}>
              <div className="dashboard-summary-icon" aria-hidden="true">
                <Icon size={32} strokeWidth={2.4} />
              </div>
              <div className="dashboard-summary-copy">
                <span className="dashboard-summary-label">{label}</span>
                <strong>{isLoading ? '--' : formatNumber(value)}</strong>
                <small>{detail}</small>
              </div>
            </article>
          ))}
        </div>

        <article className="dashboard-summary-card dashboard-summary-card-wide">
          <div className="dashboard-summary-icon" aria-hidden="true">
            <ShieldAlert size={32} strokeWidth={2.4} />
          </div>
          <div className="dashboard-summary-copy">
            <span className="dashboard-summary-label">Pending Overrides</span>
            <strong>{isLoading ? '--' : formatNumber(pendingOverrides.length)}</strong>
            <small>Awaiting admin review</small>
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

              <AccessTrendChart data={chartData} />
            </article>

            <aside className="dashboard-schedule-card" aria-label="Active schedule today">
              <div className="dashboard-panel-header">
                <div>
                  <h2>Active Schedule Today</h2>
                  <p>Your approved schedule in progress right now. Updates every minute.</p>
                </div>
              </div>

              <div className="dashboard-schedule-list">
                {activeSchedulesNow.length ? (
                  activeSchedulesNow.map((schedule) => (
                    <div
                      className={`dashboard-schedule-item dashboard-schedule-item-${schedule.state || 'upcoming'}`}
                      key={schedule.id}
                    >
                      <div className="dashboard-schedule-copy">
                        <span>Door access window</span>
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
                  <p>No schedule is active right now.</p>
                )}
              </div>

              <a className="dashboard-schedule-button" href="/user/my-schedule">
                View My Schedule
              </a>
            </aside>
          </div>

          <div className="dashboard-insights-bottom">
            <article className="dashboard-recent-card">
              <div className="dashboard-panel-header">
                <div>
                  <h2>Today's Access Logs</h2>
                </div>
                <a className="dashboard-text-link" href="/user/access-logs">
                  View All
                </a>
              </div>

              <div className="dashboard-recent-table-wrap">
                <table className="dashboard-recent-table dashboard-access-recent-table user-dashboard-access-table">
                  <thead>
                    <tr>
                      <th>Time</th>
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
                        <td className="dashboard-recent-empty" colSpan="4">
                          No access logs today.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <aside className="dashboard-schedule-card dashboard-override-card" aria-label="Pending override requests">
              <div className="dashboard-panel-header">
                <div>
                  <h2>My Override Requests</h2>
                  <p>Override requests you sent, waiting for review.</p>
                </div>
              </div>

              <div className="dashboard-schedule-list">
                {pendingOverrides.length ? (
                  pendingOverrides.map((override) => (
                    <div
                      className={`dashboard-schedule-item dashboard-schedule-item-${override.state || 'pending'}`}
                      key={override.id}
                    >
                      <div className="dashboard-schedule-copy">
                        <span>{override.reason}</span>
                        <strong>{override.time}</strong>
                      </div>
                      <small
                        className={`dashboard-schedule-badge dashboard-schedule-badge-${override.state || 'pending'}`}
                      >
                        {override.stateLabel || 'Pending'}
                      </small>
                    </div>
                  ))
                ) : (
                  <p>No pending override requests.</p>
                )}
              </div>

              <a className="dashboard-schedule-button" href="/user/request-override?new=1">
                Request Override
              </a>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
