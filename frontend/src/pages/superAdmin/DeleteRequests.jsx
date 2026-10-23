import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Eye, Search, Undo2, X } from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import { useActionConfirm } from '../../components/ActionConfirm';
import DeleteRequestToast from '../../components/DeleteRequestToast';
import RowActionMenu from '../../components/RowActionMenu';
import TableEmptyState from '../../components/TableEmptyState';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/deleteRequests.css';

const filters = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

const columns = ['Request', 'Requester', 'Record', 'Reason', 'Requested', 'Status', 'Action'];
const rowsPerPage = 8;

function formatWhenParts(value) {
  if (!value) {
    return { date: '—', time: '' };
  }
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) {
    return { date: value, time: '' };
  }
  return {
    date: date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    time: date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }),
  };
}

function formatWhen(value) {
  const parts = formatWhenParts(value);
  return parts.time ? `${parts.date}, ${parts.time}` : parts.date;
}

function openReview(request, setReview, setNote, setProofFailed, setReviewError) {
  setReview(request);
  setNote('');
  setProofFailed(false);
  setReviewError('');
}

export default function DeleteRequests({ user }) {
  const confirmAction = useActionConfirm();
  const [status, setStatus] = useState('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [reviewError, setReviewError] = useState('');
  const reviewLock = useRef(false);
  const [notice, setNotice] = useState('');
  const [review, setReview] = useState(null);
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [proofFailed, setProofFailed] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    let active = true;

    async function load() {
      setIsLoading(true);
      try {
        const response = await axiosClient.get('/api/delete_requests.php', {
          params: { actor_id: user?.id, status: 'all' },
        });
        if (active) {
          setRequests(response.data.requests || []);
          setErrorMessage('');
        }
      } catch (error) {
        if (active) {
          setRequests([]);
          setErrorMessage(error?.response?.data?.message || 'Unable to load delete requests.');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const statusCounts = useMemo(() => ({
    all: requests.length,
    pending: requests.filter((request) => request.status === 'pending').length,
    approved: requests.filter((request) => request.status === 'approved').length,
    rejected: requests.filter((request) => request.status === 'rejected').length,
    cancelled: requests.filter((request) => request.status === 'cancelled').length,
  }), [requests]);
  const activeFilter = filters.find((filter) => filter.value === status) || filters[0];
  const visibleRequests = useMemo(() => requests.filter((request) => {
    if (status !== 'all' && request.status !== status) {
      return false;
    }
    if (!normalizedSearchQuery) {
      return true;
    }
    return [
      request.id,
      request.requestedByName,
      request.targetTypeLabel,
      request.targetLabel,
      request.reason,
      request.status,
    ].join(' ').toLowerCase().includes(normalizedSearchQuery);
  }), [normalizedSearchQuery, requests, status]);
  const totalPages = Math.max(1, Math.ceil(visibleRequests.length / rowsPerPage));
  const paginatedRequests = visibleRequests.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [status, normalizedSearchQuery]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  function proofUrl(requestId) {
    const base = axiosClient.defaults.baseURL || '';
    return `${base}/api/delete_requests.php?proof=${requestId}&actor_id=${encodeURIComponent(user?.id || '')}`;
  }

  async function reviewRequest(action) {
    if (!review || reviewLock.current) {
      return;
    }
    let password = '';
    if (action === 'approve') {
      if (!confirmAction) {
        setReviewError('Sign in again before continuing.');
        return;
      }
      const confirmed = await confirmAction({
        step: 'password',
        title: 'Security Verification',
        message: 'Enter your password to approve this deletion.',
        danger: true,
        returnPassword: true,
      });
      if (!confirmed) {
        return;
      }
      password = confirmed;
    }
    reviewLock.current = true;
    setIsSaving(true);
    setReviewError('');
    try {
      const response = await axiosClient.post('/api/delete_requests.php', {
        action,
        actorId: user?.id,
        requestId: review.id,
        note,
        password,
      });
      setNotice(response.data?.message || 'Request reviewed.');
      setRequests((current) => current.map((item) => (
        item.id === response.data?.request?.id ? response.data.request : item
      )));
      setReview(null);
      setNote('');
    } catch (error) {
      const message = error?.response?.data?.message || 'Unable to review this request.';
      setReviewError(message);
      if (message === 'This delete request has already been reviewed.') {
        try {
          const response = await axiosClient.get('/api/delete_requests.php', {
            params: { actor_id: user?.id, status: 'all' },
          });
          const latest = response.data.requests || [];
          setRequests(latest);
          const fresh = latest.find((item) => item.id === review.id);
          if (fresh) {
            setReview(fresh);
          }
        } catch {
          // Keep the open review window and show the message in front of it.
        }
      }
    } finally {
      reviewLock.current = false;
      setIsSaving(false);
    }
  }

  async function revertRequest(request) {
    if (!request || reviewLock.current) {
      return;
    }
    reviewLock.current = true;
    setReviewError('');
    try {
      const response = await axiosClient.post('/api/delete_requests.php', {
        action: 'revert',
        actorId: user?.id,
        requestId: request.id,
      });
      const updated = response.data?.request;
      setNotice(response.data?.message || 'Delete request returned to review.');
      setRequests((current) => current.map((item) => (
        item.id === updated?.id ? updated : item
      )));
      setStatus('pending');
      if (updated) {
        openReview(updated, setReview, setNote, setProofFailed, setReviewError);
      }
    } catch (error) {
      setReviewError(error?.response?.data?.message || 'Unable to revert this request.');
    } finally {
      reviewLock.current = false;
    }
  }

  return (
    <main className="admin-dashboard delete-requests-page" aria-label="Delete requests">
      <section className="dashboard-recent-card">
        <div className="dashboard-panel-header">
          <div>
            <span>Delete Requests</span>
            <p>Review admin requests. Approving one permanently removes the record.</p>
          </div>
        </div>

        <div className="manage-users-role-filter">
          <div
            className="manage-users-role-tabs manage-users-status-filter"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setIsStatusMenuOpen(false);
              }
            }}
          >
            <button
              type="button"
              className={`manage-users-role-tab-trigger${isStatusMenuOpen ? ' is-open' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={isStatusMenuOpen}
              aria-controls="delete-requests-status-filter"
              aria-label={`Status filter: ${activeFilter.label}`}
              disabled={isLoading}
              onClick={() => setIsStatusMenuOpen((open) => !open)}
            >
              <span className="manage-users-role-tab-trigger-label">{activeFilter.label}</span>
              <span className="manage-users-role-tab-count">
                {isLoading ? '--' : statusCounts[activeFilter.value] || 0}
              </span>
              <ChevronDown className="manage-users-role-tab-chevron" size={14} aria-hidden="true" />
            </button>
            {isStatusMenuOpen ? (
              <div
                id="delete-requests-status-filter"
                className="manage-users-role-tab-menu"
                role="listbox"
                aria-label="Filter by status"
              >
                {filters.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    role="option"
                    className={`manage-users-role-tab-option${status === filter.value ? ' is-active' : ''}`}
                    aria-selected={status === filter.value}
                    onClick={() => {
                      setStatus(filter.value);
                      setIsStatusMenuOpen(false);
                    }}
                  >
                    <Check className="manage-users-role-tab-check" size={15} aria-hidden="true" />
                    <span className="manage-users-role-tab-option-label">{filter.label}</span>
                    <span className="manage-users-role-tab-count">
                      {isLoading ? '--' : statusCounts[filter.value] || 0}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="manage-users-filter-actions">
            <label className="manage-users-search" aria-label="Search delete requests">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search request, record, or reason"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
          </div>
        </div>

        {errorMessage ? <p className="delete-request-error">{errorMessage}</p> : null}

        <div className="dashboard-recent-table-wrap">
          <table className="dashboard-recent-table delete-requests-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="dashboard-recent-empty" colSpan={columns.length}>
                    Loading delete requests...
                  </td>
                </tr>
              ) : visibleRequests.length === 0 ? (
                <tr>
                  <td className="dashboard-recent-empty" colSpan={columns.length}>
                    <TableEmptyState description={normalizedSearchQuery || status !== 'pending' ? 'Try another status or search.' : 'Admin deletion requests will appear here.'}>
                      {normalizedSearchQuery
                        ? 'No delete requests match your search.'
                        : status === 'all'
                          ? 'No delete requests yet.'
                          : `No ${activeFilter.label.toLowerCase()} delete requests.`}
                    </TableEmptyState>
                  </td>
                </tr>
              ) : paginatedRequests.map((request) => {
                const requested = formatWhenParts(request.createdAt);
                return (
                  <tr key={request.id}>
                    <td>
                      <strong>#{request.id}</strong>
                    </td>
                    <td>
                      <strong title={request.requestedByName}>{request.requestedByName}</strong>
                    </td>
                    <td>
                      <strong title={request.targetTypeLabel}>{request.targetTypeLabel}</strong>
                      <span title={request.targetLabel}>{request.targetLabel}</span>
                    </td>
                    <td>
                      <div className="delete-requests-reason" title={request.reason}>{request.reason}</div>
                    </td>
                    <td>
                      <strong>{requested.date}</strong>
                      {requested.time ? <span>{requested.time}</span> : null}
                    </td>
                    <td>
                      <span className={`dashboard-log-status dashboard-log-status-${request.status}`}>
                        {request.status}
                      </span>
                    </td>
                    <td>
                      <RowActionMenu
                        label={`Actions for delete request #${request.id}`}
                        items={request.status === 'rejected' && request.canRevert
                          ? [{
                            label: 'Revert',
                            icon: Undo2,
                            title: 'Return this request to review. Available for 1 day after rejection.',
                            onClick: () => revertRequest(request),
                          }]
                          : [{
                            label: 'Review',
                            icon: Eye,
                            onClick: () => openReview(request, setReview, setNote, setProofFailed, setReviewError),
                          }]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!isLoading && visibleRequests.length > 0 ? (
          <div className="manage-users-pagination" aria-label="Delete requests pagination">
            <p>
              Showing {(currentPage - 1) * rowsPerPage + 1}-
              {Math.min(currentPage * rowsPerPage, visibleRequests.length)} of {visibleRequests.length}
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
        ) : null}
      </section>
      <DeleteRequestToast message={notice} title="Delete request" onClose={() => setNotice('')} />

      {review ? (
        <div className="delete-requests-review-backdrop" role="presentation" onClick={() => !isSaving && setReview(null)}>
          <section
            className="delete-requests-review"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-request-review-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="delete-request-review-title">Review request #{review.id}</h2>
                <p>{review.requestedByName} asked for this on {formatWhen(review.createdAt)}.</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setReview(null)} disabled={isSaving}>
                <X size={16} />
              </button>
            </header>
            <div className="delete-request-subject">
              <strong>{review.targetTypeLabel}</strong>
              <span>{review.targetLabel}</span>
            </div>
            <div className="delete-requests-review-copy">
              <strong>Reason</strong>
              <p>{review.reason}</p>
            </div>
            {proofFailed ? (
              <p className="delete-request-error">The proof screenshot could not be loaded.</p>
            ) : (
              <img
                className="delete-requests-proof"
                src={proofUrl(review.id)}
                alt="Proof screenshot"
                onError={() => setProofFailed(true)}
              />
            )}
            {review.status === 'pending' ? (
              <label className="delete-request-field">
                <span>Review note</span>
                <textarea
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Optional note, especially if you reject this request."
                />
              </label>
            ) : (
              <div className="delete-requests-review-copy">
                <strong>{review.status === 'approved' ? 'Approved' : 'Rejected'}{review.reviewedByName ? ` by ${review.reviewedByName}` : ''}</strong>
                {review.reviewNote ? <p>{review.reviewNote}</p> : null}
              </div>
            )}
            {review.status === 'pending' ? (
              <footer>
                <button type="button" className="delete-request-cancel" onClick={() => reviewRequest('reject')} disabled={isSaving}>
                  <X size={14} /> Reject
                </button>
                <button type="button" className="delete-requests-approve" onClick={() => reviewRequest('approve')} disabled={isSaving}>
                  <Check size={14} /> {isSaving ? 'Saving...' : 'Approve and delete'}
                </button>
              </footer>
            ) : null}
          </section>
        </div>
      ) : null}

      {reviewError ? (
        <div className="delete-requests-alert-backdrop" role="presentation">
          <section
            className="delete-requests-alert"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-request-alert-title"
            aria-describedby="delete-request-alert-message"
          >
            <h2 id="delete-request-alert-title">Could not review request</h2>
            <p id="delete-request-alert-message">{reviewError}</p>
            <footer>
              <button type="button" className="delete-requests-alert-ok" onClick={() => setReviewError('')}>
                OK
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}
