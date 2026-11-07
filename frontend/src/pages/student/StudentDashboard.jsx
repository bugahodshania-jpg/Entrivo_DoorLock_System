import { CalendarCheck, CheckCircle2, IdCard, LogIn, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import axiosClient from '../../api/axiosClient';
import AccessTrendChart from '../../components/AccessTrendChart';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/user/userPortal.css';

const initialSummary = {
  grantedTotal: 0,
  deniedTotal: 0,
  todayTotal: 0,
  lastLogin: null,
  failedLogins30d: 0,
};

const rfidStatusLabels = {
  active: 'Active',
  inactive: 'Inactive',
  lost: 'Reported lost',
};

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value) || 0);
}

export default function StudentDashboard({ user }) {
  const [summary, setSummary] = useState(initialSummary);
  const [accessTrend, setAccessTrend] = useState([]);
  const [todayAccessTrend, setTodayAccessTrend] = useState([]);
  const [recentAccessLogs, setRecentAccessLogs] = useState([]);
  const [recentLogins, setRecentLogins] = useState([]);
  const [rfidCard, setRfidCard] = useState(null);
  const [chartRange, setChartRange] = useState('week');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    let isActive = true;

    async function loadDashboard() {
      try {
        const response = await axiosClient.get('/api/user_portal.php', {
          params: { action: 'dashboard', user_id: user.id },
          timeout: 10000,
        });

        if (!isActive) {
          return;
        }

        setSummary({ ...initialSummary, ...response.data.summary });
        setAccessTrend(response.data.accessTrend || []);
        setTodayAccessTrend(response.data.todayAccessTrend || []);
        setRecentAccessLogs(response.data.recentAccessLogs || []);
        setRecentLogins(response.data.recentLogins || []);
        setRfidCard(response.data.rfidCard || null);
        setErrorMessage('');
      } catch (error) {
        if (isActive) {
          setErrorMessage(error?.response?.data?.message || 'Unable to load your dashboard right now.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      isActive = false;
    };
  }, [user?.id]);

  const chartData = chartRange === 'today' ? todayAccessTrend : accessTrend;
  const chartSubtitle =
    chartRange === 'today'
      ? 'Your granted and denied door access by time today'
      : 'Your granted and denied door access over the last 7 days';
  const display = (value) => (isLoading ? '--' : formatNumber(value));
  const rfidStatus = rfidCard ? rfidStatusLabels[rfidCard.status] || rfidCard.status : '';

  return (
    <main className="admin-dashboard user-portal-page" aria-label="Student dashboard">
      {errorMessage ? <p className="settings-admin-error">{errorMessage}</p> : null}

      <section className="dashboard-summary-grid" aria-label="Access summary">
        <div className="dashboard-summary-compact">
          <article className="dashboard-summary-card dashboard-summary-card-featured">
            <div className="dashboard-summary-icon" aria-hidden="true">
              <CalendarCheck size={36} strokeWidth={2.5} />
            </div>
            <div className="dashboard-summary-copy">
              <span className="dashboard-summary-label">Access Today</span>
              <strong>{display(summary.todayTotal)}</strong>
              <small>Door access attempts today</small>
            </div>
          </article>

          <article className="dashboard-summary-card">
            <div className="dashboard-summary-icon" aria-hidden="true">
              <CheckCircle2 size={32} strokeWidth={2.4} />
            </div>
            <div className="dashboard-summary-copy">
              <span className="dashboard-summary-label">Access Granted</span>
              <strong>{display(summary.grantedTotal)}</strong>
              <small>All successful door access</small>
            </div>
          </article>

          <article className="dashboard-summary-card">
            <div className="dashboard-summary-icon" aria-hidden="true">
              <XCircle size={32} strokeWidth={2.4} />
            </div>
            <div className="dashboard-summary-copy">
              <span className="dashboard-summary-label">Access Denied</span>
              <strong>{display(summary.deniedTotal)}</strong>
              <small>All denied door access</small>
            </div>
          </article>
        </div>

        <article className="dashboard-summary-card dashboard-summary-card-wide">
          <div className="dashboard-summary-icon" aria-hidden="true">
            <LogIn size={32} strokeWidth={2.4} />
          </div>
          <div className="dashboard-summary-copy">
            <span className="dashboard-summary-label">Last Login</span>
            <strong className="student-dashboard-last-login">
              {isLoading ? '--' : summary.lastLogin || 'No login yet'}
            </strong>
            <small>
              {isLoading
                ? 'Failed logins in the last 30 days'
                : `${formatNumber(summary.failedLogins30d)} failed login${summary.failedLogins30d === 1 ? '' : 's'} in the last 30 days`}
            </small>
          </div>
        </article>
      </section>

      <section className="dashboard-insights-grid" aria-label="Access and login summary">
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

            <aside className="dashboard-schedule-card" aria-label="My RFID card">
              <div className="dashboard-panel-header">
                <div>
                  <h2>My RFID Card</h2>
                  <p>The card registered to your account for door access.</p>
                </div>
              </div>

              <div className="dashboard-schedule-list">
                {isLoading ? (
                  <p>Loading…</p>
                ) : rfidCard ? (
                  <>
                    <div className="dashboard-schedule-item dashboard-schedule-item-active">
                      <div className="dashboard-schedule-copy">
                        <span>RFID UID</span>
                        <strong className="student-rfid-uid">{rfidCard.uid}</strong>
                      </div>
                      <IdCard size={20} aria-hidden="true" />
                    </div>
                    <div
                      className={`dashboard-schedule-item dashboard-schedule-item-${rfidCard.status === 'active' ? 'active' : 'done'}`}
                    >
                      <div className="dashboard-schedule-copy">
                        <span>Status</span>
                        <strong>{rfidStatus}</strong>
                      </div>
                      <small
                        className={`dashboard-schedule-badge dashboard-schedule-badge-${rfidCard.status === 'active' ? 'active' : 'done'}`}
                      >
                        {rfidStatus}
                      </small>
                    </div>
                    {rfidCard.issuedAt ? (
                      <div className="dashboard-schedule-item dashboard-schedule-item-done">
                        <div className="dashboard-schedule-copy">
                          <span>Issued</span>
                          <strong>{rfidCard.issuedAt}</strong>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p>No RFID card is registered to your account yet.</p>
                )}
              </div>

              <a className="dashboard-schedule-button" href="/student/profile">
                View My Profile
              </a>
            </aside>
          </div>

          <div className="dashboard-insights-bottom">
            <article className="dashboard-recent-card">
              <div className="dashboard-panel-header">
                <div>
                  <h2>Recent Access Logs</h2>
                </div>
                <a className="dashboard-text-link" href="/student/access-logs">
                  View All
                </a>
              </div>

              <div className="dashboard-recent-table-wrap">
                <table className="dashboard-recent-table dashboard-access-recent-table user-dashboard-access-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Method</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentAccessLogs.length ? (
                      recentAccessLogs.map((log) => (
                        <tr key={log.id}>
                          <td>{log.date}</td>
                          <td>{log.time}</td>
                          <td>{log.method}</td>
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
                          {isLoading ? 'Loading…' : 'No access logs yet.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <aside className="dashboard-schedule-card dashboard-override-card" aria-label="Recent logins">
              <div className="dashboard-panel-header">
                <div>
                  <h2>Recent Logins</h2>
                  <p>Your latest sign-in and sign-out activity.</p>
                </div>
              </div>

              <div className="dashboard-schedule-list">
                {recentLogins.length ? (
                  recentLogins.map((login) => (
                    <div
                      className={`dashboard-schedule-item dashboard-schedule-item-${login.status === 'Failed' ? 'pending' : 'done'}`}
                      key={login.id}
                    >
                      <div className="dashboard-schedule-copy">
                        <span>{`${login.activity} · ${login.device}`}</span>
                        <strong>{`${login.date}, ${login.time}`}</strong>
                      </div>
                      <span className={`dashboard-log-status dashboard-log-status-${String(login.status).toLowerCase()}`}>
                        {login.status}
                      </span>
                    </div>
                  ))
                ) : (
                  <p>{isLoading ? 'Loading…' : 'No login activity yet.'}</p>
                )}
              </div>

              <a className="dashboard-schedule-button" href="/student/login-logs">
                View Login Logs
              </a>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
