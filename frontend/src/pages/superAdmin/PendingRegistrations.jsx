import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Clock, Eye, MoreVertical, Search, Trash2, X } from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/rfid.css';

export default function PendingRegistrations() {
  const [registrations, setRegistrations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [approvingId, setApprovingId] = useState(null);
  const [menuState, setMenuState] = useState(null);
  const [review, setReview] = useState(null);
  const [reviewError, setReviewError] = useState('');
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const columns = ['User', 'School ID', 'Program', 'Year / Section', 'RFID UID', 'Submitted', 'Follow up by', 'Action'];

  useEffect(() => {
    let isActive = true;

    async function loadRegistrations() {
      try {
        const response = await axiosClient.get('/api/pending_registrations.php');

        if (!isActive) {
          return;
        }

        setRegistrations(response.data.registrations || []);
        setErrorMessage('');
      } catch {
        if (isActive) {
          setRegistrations([]);
          setErrorMessage('Unable to load pending registrations right now.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadRegistrations();

    return () => {
      isActive = false;
    };
  }, []);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleRegistrations = useMemo(() => {
    if (!normalizedSearchQuery) {
      return registrations;
    }

    return registrations.filter((registration) =>
      [
        registration.name,
        registration.username,
        registration.email,
        registration.schoolId,
        registration.program,
        registration.yearLevel,
        registration.section,
        registration.rfidUid,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearchQuery)),
    );
  }, [normalizedSearchQuery, registrations]);

  async function updateRegistration(registration, action) {
    const confirmed = window.confirm(
      action === 'approve'
        ? `Approve ${registration.name} and activate this account?`
        : `Reject ${registration.name}? This account will stay inactive.`,
    );

    if (!confirmed) {
      return;
    }

    setMenuState(null);
    setApprovingId(registration.id);
    setStatusMessage('');
    setErrorMessage('');

    try {
      const response = await axiosClient.post('/api/pending_registrations.php', {
        user_id: registration.id,
        action,
      });
      setRegistrations(response.data.registrations || []);
      setStatusMessage(response.data.message || 'Student registration updated.');
      if (review?.id === registration.id) {
        setReview(null);
      }
    } catch (error) {
      setErrorMessage(error.response?.data?.message || 'Unable to update that registration right now.');
    } finally {
      setApprovingId(null);
    }
  }

  function toggleMenu(event, registration) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();

    if (menuState?.id === registration.id) {
      setMenuState(null);
      return;
    }

    const width = 188;
    const height = 156;
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    const top = rect.bottom + 6 + height < window.innerHeight
      ? rect.bottom + 6
      : Math.max(8, rect.top - height - 6);

    setMenuState({
      id: registration.id,
      top,
      left,
      registration,
    });
  }

  async function openReview(registration) {
    setMenuState(null);
    setReview(registration);
    setReviewError('');
    setIsReviewLoading(true);

    try {
      const response = await axiosClient.get('/api/pending_registrations.php', {
        params: { id: registration.id },
      });
      setReview(response.data.registration || registration);
    } catch (error) {
      setReviewError(error.response?.data?.message || 'Unable to load this registration right now.');
    } finally {
      setIsReviewLoading(false);
    }
  }

  useEffect(() => {
    if (!menuState) {
      return undefined;
    }

    function closeMenu() {
      setMenuState(null);
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setMenuState(null);
      }
    }

    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);

    return () => {
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [menuState]);

  const reviewFields = review
    ? [
        ['Username', review.username],
        ['Email', review.email],
        ['School ID', review.schoolId],
        ['College', review.college],
        ['Program', review.program],
        ['Year level', review.yearLevel],
        ['Section', review.section],
        ['Sex', review.sex],
        ['Birthdate', review.birthdate],
        ['Age', review.age],
        ['Contact number', review.contactNumber],
        ['Address', review.address],
        ['RFID UID', review.rfidUid],
        ['Submitted', review.submittedAt],
        ['Follow up by', review.approvalDueAt],
      ].filter(([, value]) => value)
    : [];

  return (
    <>
    <main className="admin-dashboard rfid-page pending-registrations-page" aria-label="Pending registration">
      <section className="manage-users-summary-grid rfid-summary-grid" aria-label="Pending registration summary">
        <article className="dashboard-summary-card rfid-summary-card">
          <div className="dashboard-summary-icon" aria-hidden="true">
            <Clock size={28} strokeWidth={2.4} />
          </div>
          <div className="dashboard-summary-copy">
            <span className="dashboard-summary-label">Waiting for approval</span>
            <strong>{isLoading ? '--' : registrations.length}</strong>
            <small>Student accounts that are not active yet</small>
          </div>
        </article>
      </section>

      <section className="dashboard-recent-card rfid-card">
        <div className="dashboard-panel-header pending-registrations-header">
          <div>
            <span>Pending registration</span>
            <p>Approve a student registration to make the account active.</p>
          </div>
          <label className="rfid-search pending-registrations-search" aria-label="Search pending registrations">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search name or school ID"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        </div>

        {statusMessage ? <p className="pending-registration-status" role="status">{statusMessage}</p> : null}
        {errorMessage && !isLoading ? <p className="pending-registration-error" role="alert">{errorMessage}</p> : null}

        <div className="dashboard-recent-table-wrap pending-registrations-table-wrap">
          <table className="dashboard-recent-table pending-registrations-table">
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
                    Loading pending registrations...
                  </td>
                </tr>
              )}

              {!isLoading && !errorMessage && visibleRegistrations.length === 0 && (
                <tr>
                  <td className="dashboard-recent-empty" colSpan={columns.length}>
                    {normalizedSearchQuery
                      ? 'No pending registrations match your search.'
                      : 'No student registrations are waiting for approval.'}
                  </td>
                </tr>
              )}

              {!isLoading &&
                visibleRegistrations.map((registration) => (
                  <tr key={registration.id}>
                    <td>
                      <strong>{registration.name}</strong>
                      <span>{registration.email}</span>
                    </td>
                    <td>{registration.schoolId}</td>
                    <td>{registration.program}</td>
                    <td>
                      <strong>{registration.yearLevel}</strong>
                      <span>{registration.section}</span>
                    </td>
                    <td className="rfid-uid">{registration.rfidUid}</td>
                    <td>{registration.submittedAt}</td>
                    <td>{registration.approvalDueAt}</td>
                    <td>
                      <button
                        type="button"
                        className="pending-registration-menu-button"
                        aria-label={`Actions for ${registration.name}`}
                        aria-haspopup="menu"
                        aria-expanded={menuState?.id === registration.id}
                        onClick={(event) => toggleMenu(event, registration)}
                        disabled={approvingId === registration.id}
                      >
                        <MoreVertical size={16} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
    {menuState
      ? createPortal(
          <div
            className="pending-registration-menu"
            role="menu"
            style={{ top: menuState.top, left: menuState.left }}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" role="menuitem" onClick={() => openReview(menuState.registration)}>
              <Eye size={16} strokeWidth={1.75} aria-hidden="true" />
              Review
            </button>
            <button type="button" role="menuitem" onClick={() => updateRegistration(menuState.registration, 'approve')}>
              <Check size={16} strokeWidth={1.75} aria-hidden="true" />
              Approve
            </button>
            <div className="pending-registration-menu-divider" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              onClick={() => updateRegistration(menuState.registration, 'reject')}
            >
              <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
              Reject
            </button>
          </div>,
          document.body,
        )
      : null}
    {review
      ? createPortal(
          <div className="pending-registration-review-backdrop" role="presentation" onClick={() => setReview(null)}>
            <section
              className="pending-registration-review"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pending-registration-review-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header>
                <div>
                  <h2 id="pending-registration-review-title">{review.name}</h2>
                  <p>Review this student registration before approving or rejecting it.</p>
                </div>
                <button type="button" aria-label="Close review" onClick={() => setReview(null)}>
                  <X size={16} aria-hidden="true" />
                </button>
              </header>
              {isReviewLoading ? <p className="pending-registration-review-note">Loading registration...</p> : null}
              {reviewError ? <p className="pending-registration-error" role="alert">{reviewError}</p> : null}
              {!isReviewLoading && !reviewError ? (
                <div className="pending-registration-review-body">
                  {review.schoolIdPhoto ? (
                    <img src={review.schoolIdPhoto} alt={`${review.name} school ID`} />
                  ) : (
                    <p className="pending-registration-review-photo-empty">No school ID photo</p>
                  )}
                  <dl>
                    {reviewFields.map(([label, value]) => (
                      <div key={label} className={label === 'Program' || label === 'Address' ? 'is-wide' : undefined}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
              <footer>
                <button
                  type="button"
                  className="pending-registration-reject"
                  onClick={() => updateRegistration(review, 'reject')}
                  disabled={approvingId === review.id || isReviewLoading}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="pending-registration-approve"
                  onClick={() => updateRegistration(review, 'approve')}
                  disabled={approvingId === review.id || isReviewLoading}
                >
                  {approvingId === review.id ? 'Saving...' : 'Approve'}
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )
      : null}
    </>
  );
}
