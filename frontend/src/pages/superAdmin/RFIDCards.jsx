import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  Download,
  Expand,
  Eye,
  Pencil,
  Search,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import { useActionConfirm } from '../../components/ActionConfirm';
import RowActionMenu from '../../components/RowActionMenu';
import { getManilaDateStamp } from '../../utils/dateTime';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/rfid.css';

const rfidStatusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'lost', label: 'Lost' },
];

function escapeCsvValue(value) {
  const text = value == null ? '' : String(value);
  const escaped = text.replace(/"/g, '""');

  if (/[",\n\r]/.test(escaped)) {
    return `"${escaped}"`;
  }

  return escaped;
}

function toCsv(rows) {
  return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n');
}

function formatStatusLabel(status) {
  if (status === 'blocked') {
    return 'Blocked';
  }

  if (status === 'inactive') {
    return 'Inactive';
  }

  if (status === 'active') {
    return 'Active';
  }

  const normalizedStatus = String(status || '').trim();

  if (!normalizedStatus) {
    return 'Unknown';
  }

  return normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1);
}

function resolveUserPhotoSrc(photoValue) {
  const normalizedPhotoValue = String(photoValue || '').trim();

  if (!normalizedPhotoValue) {
    return '';
  }

  if (
    /^data:image\//i.test(normalizedPhotoValue) ||
    /^blob:/i.test(normalizedPhotoValue) ||
    /^https?:\/\//i.test(normalizedPhotoValue)
  ) {
    return normalizedPhotoValue;
  }

  if (!/^[./]|^\//.test(normalizedPhotoValue)) {
    return '';
  }

  try {
    return new URL(normalizedPhotoValue, axiosClient.defaults.baseURL || window.location.origin).toString();
  } catch {
    return '';
  }
}

function EditField({ label, wide = false, children }) {
  return (
    <div className={wide ? 'is-wide manage-users-edit-field' : 'manage-users-edit-field'}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function RFIDCards() {
  const confirmAction = useActionConfirm();
  const [rfidCards, setRfidCards] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewCard, setViewCard] = useState(null);
  const [isViewPhotoExpanded, setIsViewPhotoExpanded] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState('');
  const [isEditSaving, setIsEditSaving] = useState(false);

  const loadRfidCards = useCallback(async () => {
    try {
      const response = await axiosClient.get('/api/rfid.php');
      setRfidCards(response.data.rfidCards || []);
      setErrorMessage('');
    } catch {
      setRfidCards([]);
      setErrorMessage('Unable to load RFID cards right now.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    async function load() {
      try {
        const response = await axiosClient.get('/api/rfid.php');

        if (!isActive) {
          return;
        }

        setRfidCards(response.data.rfidCards || []);
        setErrorMessage('');
      } catch {
        if (isActive) {
          setRfidCards([]);
          setErrorMessage('Unable to load RFID cards right now.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      isActive = false;
    };
  }, []);

  const columns = ['User', 'Student ID', 'College', 'Year Level', 'RFID UID', 'RFID Status', 'Registered at', 'Action'];
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleRfidCards = useMemo(() => {
    if (!normalizedSearchQuery) {
      return rfidCards;
    }

    return rfidCards.filter((card) =>
      [card.name, card.studentId, card.college, card.yearLevel, card.rfidUid, card.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearchQuery)),
    );
  }, [rfidCards, normalizedSearchQuery]);
  const totalStudents = useMemo(() => {
    return new Set(rfidCards.map((card) => card.userId)).size;
  }, [rfidCards]);
  const totalActiveRfid = useMemo(
    () => rfidCards.filter((card) => card.status === 'active').length,
    [rfidCards],
  );
  const totalInactiveRfid = useMemo(
    () => rfidCards.filter((card) => card.status === 'inactive').length,
    [rfidCards],
  );
  const summaryCards = [
    {
      label: 'Total Students',
      value: totalStudents,
      detail: 'With issued RFID card',
      icon: Users,
    },
    {
      label: 'Active RFID',
      value: totalActiveRfid,
      detail: 'Cards usable for access',
      icon: CheckCircle2,
    },
    {
      label: 'Inactive RFID',
      value: totalInactiveRfid,
      detail: 'Disabled cards',
      icon: XCircle,
    },
  ];

  const viewCardGroups = useMemo(() => {
    if (!viewCard) {
      return [];
    }

    return [
      {
        title: 'Student',
        fields: [
          ['Full name', viewCard.name, true],
          ['Email', viewCard.email],
          ['Student ID', viewCard.studentId],
          ['Account status', formatStatusLabel(viewCard.userStatus)],
          ['College', viewCard.college],
          ['Program', viewCard.programDepartment],
          ['Year level', viewCard.yearLevel],
          ['Section', viewCard.section || 'No section'],
        ],
      },
      {
        title: 'RFID Card',
        fields: [
          ['RFID UID', viewCard.rfidUid],
          ['RFID status', formatStatusLabel(viewCard.status)],
          ['Registered at', viewCard.issuedAt],
        ],
      },
    ];
  }, [viewCard]);

  const viewCardPhotoSrc = useMemo(() => {
    if (!viewCard?.userPhoto) {
      return '';
    }

    return resolveUserPhotoSrc(viewCard.userPhoto);
  }, [viewCard]);

  function handleDownloadCsv() {
    const csvRows = [
      [
        'User',
        'Email',
        'Student ID',
        'College',
        'Program Department',
        'Year Level',
        'RFID UID',
        'RFID Status',
        'Registered at',
      ],
      ...rfidCards.map((card) => [
        card.name,
        card.email,
        card.studentId,
        card.college,
        card.programDepartment,
        card.yearLevel,
        card.rfidUid,
        card.status,
        card.issuedAt,
      ]),
    ];
    const csv = toCsv(csvRows);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `student_rfid_cards_${getManilaDateStamp()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function openCardView(card) {
    setViewCard(card);
    setIsViewPhotoExpanded(false);
  }

  function closeCardView() {
    setViewCard(null);
    setIsViewPhotoExpanded(false);
  }

  function openCardEdit(card) {
    setEditForm({
      id: card.id,
      name: card.name,
      email: card.email,
      studentId: card.studentId,
      college: card.college,
      programDepartment: card.programDepartment,
      yearLevel: card.yearLevel,
      rfidUid: String(card.rfidUid || '').trim(),
      status: String(card.status || 'active').toLowerCase(),
      issuedAt: card.issuedAt,
    });
    setEditError('');
  }

  function closeCardEdit() {
    if (isEditSaving) {
      return;
    }

    setEditForm(null);
    setEditError('');
  }

  function updateEditField(field, value) {
    setEditForm((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        [field]: value,
      };
    });
  }

  async function handleSaveEdit(event) {
    event.preventDefault();

    if (!editForm || isEditSaving) {
      return;
    }

    const confirmed = await confirmAction({
      title: 'Update RFID card',
      message: `Are you sure you want to update the RFID card for ${editForm.name || 'this student'}?`,
    });

    if (!confirmed) {
      return;
    }

    setIsEditSaving(true);
    setEditError('');

    try {
      await axiosClient.put('/api/rfid.php', {
        id: editForm.id,
        rfidUid: editForm.rfidUid,
        status: editForm.status,
      });
      await loadRfidCards();
      setEditForm(null);
    } catch (error) {
      setEditError(error.response?.data?.message || 'Unable to save RFID card changes right now.');
    } finally {
      setIsEditSaving(false);
    }
  }

  return (
    <>
      <main className="admin-dashboard rfid-page" aria-label="Student RFID cards">
        <section className="manage-users-summary-grid rfid-summary-grid" aria-label="RFID summary">
          {summaryCards.map(({ label, value, detail, icon: Icon }) => (
            <article className="dashboard-summary-card rfid-summary-card" key={label}>
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

        <section className="dashboard-recent-card rfid-card">
          <div className="dashboard-panel-header">
            <div>
              <span>Student RFID Cards</span>
              <p>Issued RFID cards linked to student profiles.</p>
            </div>
            <div className="rfid-header-actions">
              <div className="rfid-search-stack">
                <button
                  type="button"
                  className="dashboard-text-link rfid-download-button"
                  onClick={handleDownloadCsv}
                  disabled={isLoading || Boolean(errorMessage) || rfidCards.length === 0}
                >
                  <Download size={16} aria-hidden="true" />
                  Download CSV
                </button>
                <label className="rfid-search" aria-label="Search student RFID cards">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    placeholder="Search user or RFID UID"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="dashboard-recent-table-wrap rfid-table-wrap">
            <table className="dashboard-recent-table rfid-table">
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
                      Loading student RFID cards...
                    </td>
                  </tr>
                )}

                {!isLoading && errorMessage && (
                  <tr>
                    <td className="dashboard-recent-empty" colSpan={columns.length}>
                      {errorMessage}
                    </td>
                  </tr>
                )}

                {!isLoading && !errorMessage && visibleRfidCards.length === 0 && (
                  <tr>
                    <td className="dashboard-recent-empty" colSpan={columns.length}>
                      {normalizedSearchQuery
                        ? 'No student RFID cards match your search.'
                        : 'No RFID cards found.'}
                    </td>
                  </tr>
                )}

                {!isLoading &&
                  !errorMessage &&
                  visibleRfidCards.map((card) => (
                    <tr key={card.id}>
                      <td>
                        <strong>{card.name}</strong>
                        <span>{card.email}</span>
                      </td>
                      <td>
                        <strong>{card.studentId}</strong>
                        <span className={`dashboard-log-status manage-users-status-${card.userStatus}`}>
                          {formatStatusLabel(card.userStatus)}
                        </span>
                      </td>
                      <td>
                        <strong>{card.college}</strong>
                        <span>{card.programDepartment}</span>
                      </td>
                      <td>{card.yearLevel}</td>
                      <td className="rfid-uid">{card.rfidUid}</td>
                      <td>
                        <span className={`dashboard-log-status rfid-status rfid-status-${card.status}`}>
                          {card.status}
                        </span>
                      </td>
                      <td>{card.issuedAt}</td>
                      <td>
                        <RowActionMenu
                          label={`Actions for ${card.name}`}
                          items={[
                            {
                              label: 'View',
                              icon: Eye,
                              onClick: () => openCardView(card),
                            },
                            {
                              label: 'Edit',
                              icon: Pencil,
                              onClick: () => openCardEdit(card),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {viewCard
        ? createPortal(
            <div
              className="pending-registration-review-backdrop"
              role="presentation"
              onClick={closeCardView}
            >
              <section
                className="pending-registration-review"
                role="dialog"
                aria-modal="true"
                aria-labelledby="rfid-card-view-title"
                onClick={(event) => event.stopPropagation()}
              >
                <header>
                  <div>
                    <h2 id="rfid-card-view-title">View RFID Card</h2>
                    <p>Review this student RFID card and linked profile details.</p>
                  </div>
                  <button type="button" aria-label="Close RFID card view" onClick={closeCardView}>
                    <X size={16} aria-hidden="true" />
                  </button>
                </header>

                <div className="pending-registration-review-body">
                  <div className="pending-registration-review-identity">
                    <div className="pending-registration-review-photo">
                      {viewCardPhotoSrc ? (
                        <>
                          <img src={viewCardPhotoSrc} alt={`${viewCard.name} photo`} />
                          <button
                            type="button"
                            className="pending-registration-photo-expand"
                            aria-label="Expand photo"
                            onClick={() => setIsViewPhotoExpanded(true)}
                          >
                            <Expand size={14} aria-hidden="true" />
                          </button>
                        </>
                      ) : (
                        <p className="pending-registration-review-photo-empty">No photo</p>
                      )}
                    </div>
                    {viewCardGroups[0] ? (
                      <section className="pending-registration-review-card">
                        <h3>{viewCardGroups[0].title}</h3>
                        <dl>
                          {viewCardGroups[0].fields.map(([label, value, isWide]) => (
                            <div key={label} className={isWide ? 'is-wide' : undefined}>
                              <dt>{label}</dt>
                              <dd>{value || '—'}</dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    ) : null}
                  </div>
                  {viewCardGroups.slice(1).map((group) => (
                    <section className="pending-registration-review-card" key={group.title}>
                      <h3>{group.title}</h3>
                      <dl>
                        {group.fields.map(([label, value, isWide]) => (
                          <div key={label} className={isWide ? 'is-wide' : undefined}>
                            <dt>{label}</dt>
                            <dd>{value || '—'}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                </div>

                <footer>
                  <button type="button" className="pending-registration-reject" onClick={closeCardView}>
                    Close
                  </button>
                </footer>
              </section>
            </div>,
            document.body,
          )
        : null}

      {isViewPhotoExpanded && viewCardPhotoSrc
        ? createPortal(
            <div
              className="pending-registration-photo-lightbox"
              role="presentation"
              onClick={() => setIsViewPhotoExpanded(false)}
            >
              <button
                type="button"
                aria-label="Close expanded photo"
                onClick={() => setIsViewPhotoExpanded(false)}
              >
                <X size={16} aria-hidden="true" />
              </button>
              <img
                src={viewCardPhotoSrc}
                alt={`${viewCard?.name || 'Student'} photo`}
                onClick={(event) => event.stopPropagation()}
              />
            </div>,
            document.body,
          )
        : null}

      {editForm
        ? createPortal(
            <div
              className="pending-registration-review-backdrop"
              role="presentation"
              onClick={closeCardEdit}
            >
              <form
                className="pending-registration-review manage-users-edit-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="rfid-card-edit-title"
                onClick={(event) => event.stopPropagation()}
                onSubmit={handleSaveEdit}
              >
                <header>
                  <div>
                    <h2 id="rfid-card-edit-title">Edit RFID Card</h2>
                    <p>Update this student RFID UID and card status.</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close RFID card edit"
                    onClick={closeCardEdit}
                    disabled={isEditSaving}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </header>

                {editError ? <p className="pending-registration-error" role="alert">{editError}</p> : null}

                <div className="pending-registration-review-body">
                  <section className="pending-registration-review-card">
                    <h3>Student</h3>
                    <dl>
                      <EditField label="Full name">
                        <input type="text" value={editForm.name || ''} readOnly />
                      </EditField>
                      <EditField label="Email">
                        <input type="text" value={editForm.email || ''} readOnly />
                      </EditField>
                      <EditField label="Student ID">
                        <input type="text" value={editForm.studentId || ''} readOnly />
                      </EditField>
                      <EditField label="College">
                        <input type="text" value={editForm.college || ''} readOnly />
                      </EditField>
                      <EditField label="Program">
                        <input type="text" value={editForm.programDepartment || ''} readOnly />
                      </EditField>
                      <EditField label="Year level">
                        <input type="text" value={editForm.yearLevel || ''} readOnly />
                      </EditField>
                    </dl>
                  </section>

                  <section className="pending-registration-review-card">
                    <h3>RFID Card</h3>
                    <dl>
                      <EditField label="RFID UID">
                        <input
                          type="text"
                          value={editForm.rfidUid}
                          onChange={(event) =>
                            updateEditField(
                              'rfidUid',
                              event.target.value.replace(/\s+/g, '').toUpperCase(),
                            )
                          }
                          placeholder="Enter RFID UID"
                          maxLength={30}
                          autoComplete="off"
                          required
                        />
                      </EditField>
                      <EditField label="RFID status">
                        <select
                          value={editForm.status}
                          onChange={(event) => updateEditField('status', event.target.value)}
                        >
                          {rfidStatusOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </EditField>
                      <EditField label="Registered at">
                        <input type="text" value={editForm.issuedAt || '—'} readOnly />
                      </EditField>
                    </dl>
                  </section>
                </div>

                <footer>
                  <button
                    type="button"
                    className="pending-registration-reject"
                    onClick={closeCardEdit}
                    disabled={isEditSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="pending-registration-approve"
                    disabled={isEditSaving}
                  >
                    {isEditSaving ? 'Saving...' : 'Save changes'}
                  </button>
                </footer>
              </form>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
