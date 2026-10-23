import { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, Check, ChevronDown, Eye, Search, X } from 'lucide-react';
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

const columns = ['Request', 'Record', 'Reason', 'Requested', 'Status', 'Action'];
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

export default function MyDeleteRequests({ user }) {
  const confirmAction = useActionConfirm();
  const cancelLock = useRef(false);
  const [status, setStatus] = useState('pending');
  const [notice, setNotice] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [selected, setSelected] = useState(null);
  const [proofFailed, setProofFailed] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    let active = true;

    async function load() {
      setIsLoading(true);
      try {
        const response = await axiosClient.get('/api/delete_requests.php', {
          params: { actor_id: user?.id, status: 'all', scope: 'mine' },
        });
        if (active) {
          setRequests(response.data.requests || []);
          setErrorMessage('');
        }
      } catch (error) {
        if (active) {
          setRequests([]);
          setErrorMessage(error?.response?.data?.message || 'Unable to load your delete requests.');
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
      request.targetTypeLabel,
      request.targetLabel,
      request.reason,
      request.status,
      request.reviewNote,
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

  async function cancelRequest(request) {
    if (!request || request.status !== 'pending' || cancelLock.current) {
      return;
    }
    if (!confirmAction) {
      setErrorMessage('Sign in again before continuing.');
      return;
    }
    const password = await confirmAction({
      title: 'Cancel delete request',
      message: 'Are you sure you want to cancel this delete request? The record stays, and a Super Admin will no longer review it.',
      confirmLabel: 'Continue',
      danger: true,
      returnPassword: true,
    });
    if (!password) {
      return;
    }
    cancelLock.current = true;
    setErrorMessage('');
    try {
      const response = await axiosClient.post('/api/delete_requests.php', {
        action: 'cancel',
        actorId: user?.id,
        requestId: request.id,
        password,
      });
      const updated = response.data?.request;
      setNotice(response.data?.message || 'Delete request cancelled. The record was kept.');
      if (updated) {
        setRequests((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        setSelected((current) => (current?.id === updated.id ? updated : current));
      }
    } catch (error) {
      setErrorMessage(error?.response?.data?.message || 'Unable to cancel this delete request.');
    } finally {
      cancelLock.current = false;
    }
  }

  function proofUrl(requestId) {
    const base = axiosClient.defaults.baseURL || '';
    return `${base}/api/delete_requests.php?proof=${requestId}&actor_id=${encodeURIComponent(user?.id || '')}`;
  }

  return (
    <main className="admin-dashboard delete-requests-page" aria-label="My delete requests">
      <section className="dashboard-recent-card">
        <div className="dashboard-panel-header">
          <div>
            <span>My Delete Requests</span>
            <p>Requests you sent to a Super Admin. A record stays until one is approved.</p>
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
              aria-controls="my-delete-requests-status-filter"
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
                id="my-delete-requests-status-filter"
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
            <label className="manage-users-search" aria-label="Search your delete requests">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search record or reason"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
          </div>
        </div>

        {errorMessage ? <p className="delete-request-error">{errorMessage}</p> : null}

        <div className="dashboard-recent-table-wrap">
          <table className="dashboard-recent-table delete-requests-table delete-requests-table-mine">
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
                    <TableEmptyState description={normalizedSearchQuery || status !== 'pending' ? 'Try another status or search.' : 'Requests you send for deletion will appear here.'}>
                      {normalizedSearchQuery
                        ? 'No delete requests match your search.'
                        : status === 'all'
                          ? 'You have not sent a delete request yet.'
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
                        items={[
                          {
                            label: 'View',
                            icon: Eye,
                            onClick: () => {
                              setSelected(request);
                              setProofFailed(false);
                            },
                          },
                          {
                            label: 'Cancel',
                            icon: Ban,
                            danger: true,
                            hidden: request.status !== 'pending',
                            onClick: () => cancelRequest(request),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!isLoading && visibleRequests.length > 0 ? (
          <div className="manage-users-pagination" aria-label="My delete requests pagination">
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

      {selected ? (
        <div className="delete-requests-review-backdrop" role="presentation" onClick={() => setSelected(null)}>
          <section
            className="delete-requests-review"
            role="dialog"
            aria-modal="true"
            aria-labelledby="my-delete-request-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="my-delete-request-title">Delete request #{selected.id}</h2>
                <p>Sent {formatWhen(selected.createdAt)}.</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setSelected(null)}>
                <X size={16} />
              </button>
            </header>
            <div className="delete-request-subject">
              <strong>{selected.targetTypeLabel}</strong>
              <span>{selected.targetLabel}</span>
            </div>
            <div className="delete-requests-review-copy">
              <strong>Reason</strong>
              <p>{selected.reason}</p>
            </div>
            {proofFailed ? (
              <p className="delete-request-error">The proof screenshot could not be loaded.</p>
            ) : (
              <img
                className="delete-requests-proof"
                src={proofUrl(selected.id)}
                alt="Proof screenshot"
                onError={() => setProofFailed(true)}
              />
            )}
            <div className="delete-requests-review-copy">
              <strong>
                {selected.status === 'pending'
                  ? 'Waiting for a Super Admin'
                  : selected.status === 'approved'
                    ? 'Approved'
                    : selected.status === 'cancelled'
                      ? 'Cancelled'
                      : 'Rejected'}
                {selected.reviewedByName ? ` by ${selected.reviewedByName}` : ''}
              </strong>
              <p>
                {selected.status === 'pending'
                  ? 'This record stays in place until a Super Admin approves the request.'
                  : selected.status === 'approved'
                    ? `Removed ${formatWhen(selected.reviewedAt)}.`
                    : selected.status === 'cancelled'
                      ? `You cancelled this request ${formatWhen(selected.reviewedAt)}. The record was kept.`
                      : `Kept ${formatWhen(selected.reviewedAt)}.`}
              </p>
              {selected.reviewNote ? <p>{selected.reviewNote}</p> : null}
            </div>
          </section>
        </div>
      ) : null}
      <DeleteRequestToast message={notice} title="My Delete Requests" onClose={() => setNotice('')} />
    </main>
  );
}
