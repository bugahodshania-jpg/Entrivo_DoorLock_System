import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Clock, Expand, Eye, MoreVertical, Search, Trash2, X } from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import { useActionConfirm } from '../../components/ActionConfirm';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/rfid.css';

export default function PendingRegistrations() {
  const confirmAction = useActionConfirm();
  const [registrations, setRegistrations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [toast, setToast] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [approvingId, setApprovingId] = useState(null);
  const [menuState, setMenuState] = useState(null);
  const [review, setReview] = useState(null);
  const [reviewError, setReviewError] = useState('');
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const [isPhotoExpanded, setIsPhotoExpanded] = useState(false);
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
  const rowsPerPage = 6;
  const totalPages = Math.max(1, Math.ceil(visibleRegistrations.length / rowsPerPage));
  const paginatedRegistrations = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return visibleRegistrations.slice(startIndex, startIndex + rowsPerPage);
  }, [currentPage, rowsPerPage, visibleRegistrations]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [normalizedSearchQuery]);

  async function updateRegistration(registration, action) {
    const confirmed = await confirmAction({
      title: action === 'approve' ? 'Approve registration' : 'Reject registration',
      danger: action === 'reject',
      message:
        action === 'approve'
          ? `Are you sure you want to approve ${registration.name} and activate this account?`
          : `Are you sure you want to reject ${registration.name}? This account will stay inactive.`,
    });

    if (!confirmed) {
      return;
    }

    setMenuState(null);
    setApprovingId(registration.id);
    setToast(null);
    setErrorMessage('');

    try {
      const response = await axiosClient.post('/api/pending_registrations.php', {
        user_id: registration.id,
        action,
        actor_id: (() => {
          try {
            const raw =
              window.localStorage.getItem('entrivo_user') ||
              window.sessionStorage.getItem('entrivo_user');
            return raw ? JSON.parse(raw)?.id : undefined;
          } catch {
            return undefined;
          }
        })(),
      });
      setRegistrations(response.data.registrations || []);
      const message = response.data.message || 'Student registration updated.';
      const toastId = Date.now();
      setToast({ id: toastId, message });
      window.setTimeout(() => {
        setToast((current) => (current?.id === toastId ? null : current));
      }, 20000);
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

  const reviewGroups = review
    ? [
        {
          title: 'Personal Information',
          fields: [
            ['Full name', review.name, true],
            ['Sex', review.sex],
            ['Birthdate', review.birthdate],
            ['Age', review.age],
            ['Contact number', review.contactNumber],
            ['Address', review.address, true],
          ],
        },
        {
          title: 'Account Information',
          fields: [
            ['Username', review.username],
            ['Email', review.email],
            ['School ID', review.schoolId],
            ['RFID UID', review.rfidUid],
          ],
        },
        {
          title: 'School Information',
          fields: [
            ['College', review.college],
            ['Year level', review.yearLevel],
            ['Program', review.program],
            ['Section', review.section],
          ],
        },
        {
          title: 'Submission',
          fields: [
            ['Submitted', review.submittedAt],
            ['Follow up by', review.approvalDueAt],
          ],
        },
      ]
        .map((group) => ({
          ...group,
          fields: group.fields.filter(([, value]) => value),
        }))
        .filter((group) => group.fields.length > 0)
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
                paginatedRegistrations.map((registration) => (
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

        {!isLoading && !errorMessage && visibleRegistrations.length > 0 && (
          <div className="manage-users-pagination" aria-label="Pending registrations pagination">
            <p>
              Showing {(currentPage - 1) * rowsPerPage + 1}-
              {Math.min(currentPage * rowsPerPage, visibleRegistrations.length)} of {visibleRegistrations.length}
            </p>
            <div className="manage-users-pagination-controls">
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
                  <h2 id="pending-registration-review-title">Review Registration</h2>
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
                  <div className="pending-registration-review-identity">
                    <div className="pending-registration-review-photo">
                      {review.schoolIdPhoto ? (
                        <>
                          <img src={review.schoolIdPhoto} alt={`${review.name} school ID`} />
                          <button
                            type="button"
                            className="pending-registration-photo-expand"
                            aria-label="Expand school ID photo"
                            onClick={() => setIsPhotoExpanded(true)}
                          >
                            <Expand size={14} aria-hidden="true" />
                          </button>
                        </>
                      ) : (
                        <p className="pending-registration-review-photo-empty">No school ID photo</p>
                      )}
                    </div>
                    {reviewGroups[0] ? (
                      <section className="pending-registration-review-card">
                        <h3>{reviewGroups[0].title}</h3>
                        <dl>
                          {reviewGroups[0].fields.map(([label, value, isWide]) => (
                            <div key={label} className={isWide ? 'is-wide' : undefined}>
                              <dt>{label}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    ) : null}
                  </div>
                  {reviewGroups.slice(1).map((group) => (
                    <section className="pending-registration-review-card" key={group.title}>
                      <h3>{group.title}</h3>
                      <dl>
                        {group.fields.map(([label, value, isWide]) => (
                          <div key={label} className={isWide ? 'is-wide' : undefined}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
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
    {toast ? (
      <div className="fingerprint-toast-stack" aria-live="polite" aria-atomic="true">
        <div className="fingerprint-toast fingerprint-toast-success" role="status">
          <div className="fingerprint-toast-copy">
            <strong>Registration Notice</strong>
            <p>{toast.message}</p>
          </div>
          <button
            type="button"
            className="fingerprint-toast-close"
            aria-label="Dismiss notice"
            onClick={() => setToast(null)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    ) : null}
    {isPhotoExpanded && review?.schoolIdPhoto
      ? createPortal(
          <div
            className="pending-registration-photo-lightbox"
            role="presentation"
            onClick={() => setIsPhotoExpanded(false)}
          >
            <button type="button" aria-label="Close expanded photo" onClick={() => setIsPhotoExpanded(false)}>
              <X size={16} aria-hidden="true" />
            </button>
            <img src={review.schoolIdPhoto} alt={`${review.name} school ID`} onClick={(event) => event.stopPropagation()} />
          </div>,
          document.body,
        )
      : null}
    </>
  );
}
