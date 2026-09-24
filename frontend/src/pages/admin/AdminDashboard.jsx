import { Activity, ClipboardList, Fingerprint, IdCard, Users } from 'lucide-react';
import '../../styles/admin/dashboard.css';

export default function AdminDashboard({ user, onLogout }) {
  return (
    <main className="standard-admin-dashboard" aria-label="Admin dashboard">
      <section className="standard-admin-hero">
        <div>
          <p>Admin workspace</p>
          <h1>Admin Dashboard</h1>
          <span>
            Signed in as {user?.username || 'admin'} with regular admin privileges.
          </span>
        </div>
        <button type="button" onClick={onLogout}>
          Logout
        </button>
      </section>

      <section className="standard-admin-identity" aria-label="Logged in admin">
        <div>
          <span>User ID</span>
          <strong>{user?.id || 'N/A'}</strong>
        </div>
        <div>
          <span>Email</span>
          <strong>{user?.email || 'No email available'}</strong>
        </div>
        <div>
          <span>Role</span>
          <strong>{user?.role?.replace(/_/g, ' ') || 'admin'}</strong>
        </div>
      </section>

      <section className="standard-admin-grid" aria-label="Admin privileges">
        <article>
          <Users size={22} aria-hidden="true" />
          <h2>Manage Users</h2>
          <p>Create and update student, faculty, and staff records.</p>
        </article>
        <article>
          <IdCard size={22} aria-hidden="true" />
          <h2>RFID Cards</h2>
          <p>Issue, replace, and monitor assigned RFID credentials.</p>
        </article>
        <article>
          <Fingerprint size={22} aria-hidden="true" />
          <h2>Biometrics</h2>
          <p>Register and maintain fingerprint access records.</p>
        </article>
        <article>
          <ClipboardList size={22} aria-hidden="true" />
          <h2>Schedules</h2>
          <p>Manage door access schedules and assigned permissions.</p>
        </article>
        <article>
          <Activity size={22} aria-hidden="true" />
          <h2>Access Logs</h2>
          <p>Review entry history and operational access activity.</p>
        </article>
      </section>
    </main>
  );
}
