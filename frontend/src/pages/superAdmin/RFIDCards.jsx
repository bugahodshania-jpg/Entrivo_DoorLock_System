import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  CheckCircle2,
  ChevronDown,
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
import ExportFormatModal from '../../components/ExportFormatModal';
import RowActionMenu from '../../components/RowActionMenu';
import { getManilaDateStamp } from '../../utils/dateTime';
import { buildExportNote, exportTable } from '../../utils/exportFiles';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/rfid.css';

const rfidStatusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'lost', label: 'Lost' },
];

function latestScansByUid(scans) {
  const latestByUid = new Map();

  scans.forEach((scan) => {
    const uid = String(scan.rfidUid || '').replace(/\s+/g, '').toUpperCase();

    if (!uid) {
      return;
    }

    const current = latestByUid.get(uid);

    if (!current || Number(scan.id) > Number(current.id)) {
      latestByUid.set(uid, scan);
    }
  });

  return [...latestByUid.values()].sort((left, right) => Number(right.id) - Number(left.id));
}

function splitRegisteredAt(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(.*\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)$/i);

  if (!match) {
    return { date: text || '—', time: '' };
  }

  return { date: match[1], time: match[2] };
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

function shortOptionLabel(value) {
  const match = String(value || '').match(/^\(([^)]+)\)\s*(?:-\s*(.+))?/);
  if (!match) {
    return value;
  }
  return match[2] ? `${match[1]} - ${match[2]}` : match[1];
}

function RfidFilterMenu({ id, label, allLabel, value, options, isOpen, onToggle, onClose, onSelect, disabled }) {
  const active = options.find((option) => option.value === value);
  const total = options.reduce((sum, option) => sum + option.count, 0);
  const menuOptions = [{ value: 'all', label: allLabel, count: total }, ...options];

  return (
    <div
      className="manage-users-role-tabs manage-users-status-filter rfid-filter"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onClose();
        }
      }}
    >
      <button
        type="button"
        className={`manage-users-role-tab-trigger${isOpen ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={id}
        aria-label={`${label}: ${active ? active.label : allLabel}`}
        title={active ? active.label : allLabel}
        disabled={disabled}
        onClick={onToggle}
      >
        <span className="manage-users-role-tab-trigger-label">
          {active ? shortOptionLabel(active.label) : allLabel}
        </span>
        <span className="manage-users-role-tab-count">{active ? active.count : total}</span>
        <ChevronDown className="manage-users-role-tab-chevron" size={14} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div id={id} className="manage-users-role-tab-menu rfid-filter-menu" role="listbox" aria-label={label}>
          {menuOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              className={`manage-users-role-tab-option${option.value === value ? ' is-active' : ''}`}
              aria-selected={option.value === value}
              onClick={() => onSelect(option.value)}
            >
              <Check className="manage-users-role-tab-check" size={15} aria-hidden="true" />
              <span className="manage-users-role-tab-option-label">{option.label}</span>
              <span className="manage-users-role-tab-count">{option.count}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function countBy(cards, field) {
  const counts = new Map();
  cards.forEach((card) => {
    const key = String(card[field] || '').trim();
    if (key) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  });
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => ({ value: key, label: key, count }));
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
  const [currentPage, setCurrentPage] = useState(1);
  const [collegeFilter, setCollegeFilter] = useState('all');
  const [programFilter, setProgramFilter] = useState('all');
  const [openFilter, setOpenFilter] = useState('');
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [showEnrollmentScans, setShowEnrollmentScans] = useState(false);
  const [enrollmentScans, setEnrollmentScans] = useState([]);
  const [isScanLoading, setIsScanLoading] = useState(false);
  const [scanErrorMessage, setScanErrorMessage] = useState('');
  const [scanDateFrom, setScanDateFrom] = useState('');
  const [scanDateTo, setScanDateTo] = useState('');
  const [viewCard, setViewCard] = useState(null);
  const [isViewPhotoExpanded, setIsViewPhotoExpanded] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState('');
  const [isEditSaving, setIsEditSaving] = useState(false);

  const loadEnrollmentScans = useCallback(async () => {
    setIsScanLoading(true);

    try {
      const response = await axiosClient.get('/api/rfid_enrollment_scans.php');
      setEnrollmentScans(response.data.scans || []);
      setScanErrorMessage('');
    } catch {
      setEnrollmentScans([]);
      setScanErrorMessage('Unable to load enrollment scans right now.');
    } finally {
      setIsScanLoading(false);
    }
  }, []);

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

  useEffect(() => {
    if (showEnrollmentScans) {
      loadEnrollmentScans();
    }
  }, [showEnrollmentScans, loadEnrollmentScans]);

  const columns = ['User', 'Student ID', 'College', 'Year Level', 'RFID UID', 'RFID Status', 'Registered at', 'Action'];
  const scanColumns = ['RFID UID', 'Scanned at', 'Scanner', 'Status'];
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const collegeOptions = useMemo(() => countBy(rfidCards, 'college'), [rfidCards]);
  const collegeScopedCards = useMemo(
    () =>
      collegeFilter === 'all'
        ? rfidCards
        : rfidCards.filter((card) => String(card.college || '').trim() === collegeFilter),
    [rfidCards, collegeFilter],
  );
  const programOptions = useMemo(
    () => countBy(collegeScopedCards, 'programDepartment'),
    [collegeScopedCards],
  );
  const visibleRfidCards = useMemo(() => {
    return collegeScopedCards.filter((card) => {
      if (programFilter !== 'all' && String(card.programDepartment || '').trim() !== programFilter) {
        return false;
      }

      if (!normalizedSearchQuery) {
        return true;
      }

      return [card.name, card.studentId, card.college, card.programDepartment, card.yearLevel, card.rfidUid, card.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearchQuery));
    });
  }, [collegeScopedCards, programFilter, normalizedSearchQuery]);
  const visibleEnrollmentScans = useMemo(() => {
    const datedScans = enrollmentScans.filter((scan) => {
      if (scanDateFrom && String(scan.scannedOn || '') < scanDateFrom) {
        return false;
      }

      if (scanDateTo && String(scan.scannedOn || '') > scanDateTo) {
        return false;
      }

      return true;
    });
    const uniqueScans = latestScansByUid(datedScans);

    if (!normalizedSearchQuery) {
      return uniqueScans;
    }

    return uniqueScans.filter((scan) =>
      [scan.rfidUid, scan.scannedAt, scan.deviceLabel, scan.registrationStatus]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearchQuery)),
    );
  }, [enrollmentScans, normalizedSearchQuery, scanDateFrom, scanDateTo]);
  const rowsPerPage = 6;
  const listLength = showEnrollmentScans ? visibleEnrollmentScans.length : visibleRfidCards.length;
  const totalPages = Math.max(1, Math.ceil(listLength / rowsPerPage));
  const paginatedRfidCards = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return visibleRfidCards.slice(startIndex, startIndex + rowsPerPage);
  }, [currentPage, rowsPerPage, visibleRfidCards]);
  const paginatedEnrollmentScans = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return visibleEnrollmentScans.slice(startIndex, startIndex + rowsPerPage);
  }, [currentPage, rowsPerPage, visibleEnrollmentScans]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [collegeFilter, programFilter, normalizedSearchQuery, scanDateFrom, scanDateTo, showEnrollmentScans]);

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
  const uniqueEnrollmentScans = useMemo(() => latestScansByUid(enrollmentScans), [enrollmentScans]);
  const registeredUidCount = uniqueEnrollmentScans.filter((scan) => scan.registrationStatus === 'registered').length;
  const summaryCards = showEnrollmentScans
    ? [
        {
          label: 'Total UID Scanned',
          value: uniqueEnrollmentScans.length,
          detail: 'Unique UIDs in the scan list',
          icon: Users,
        },
        {
          label: 'Registered UID Now',
          value: registeredUidCount,
          detail: 'Already linked to a student card',
          icon: CheckCircle2,
        },
        {
          label: 'Unknown',
          value: uniqueEnrollmentScans.length - registeredUidCount,
          detail: 'Not registered yet',
          icon: XCircle,
        },
      ]
    : [
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

  function handleExport(format) {
    setIsExportModalOpen(false);
    exportTable(format, {
      headers: [
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
      rows: visibleRfidCards.map((card) => [
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
      fileBaseName: `student_rfid_cards_${getManilaDateStamp()}`,
      pdf: {
        title: 'Student RFID Cards',
        note: buildExportNote(visibleRfidCards.length, 'card', [
          collegeFilter !== 'all' ? `College: ${collegeFilter}` : '',
          programFilter !== 'all' ? `Program: ${programFilter}` : '',
          searchQuery.trim() ? `Search: "${searchQuery.trim()}"` : '',
        ]),
        widths: [100, 130, 70, 100, 110, 50, 85, 55, 85],
        emphasizeColumn: 0,
        emptyMessage: 'No RFID cards match the current filters.',
      },
    });
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
        <section className="manage-users-summary-grid rfid-summary-grid" aria-label={showEnrollmentScans ? 'Enrollment scan summary' : 'RFID summary'}>
          {summaryCards.map(({ label, value, detail, icon: Icon }) => (
            <article className="dashboard-summary-card rfid-summary-card" key={label}>
              <div className="dashboard-summary-icon" aria-hidden="true">
                <Icon size={28} strokeWidth={2.4} />
              </div>
              <div className="dashboard-summary-copy">
                <span className="dashboard-summary-label">{label}</span>
                <strong>{(showEnrollmentScans ? isScanLoading : isLoading) ? '--' : value}</strong>
                <small>{detail}</small>
              </div>
            </article>
          ))}
        </section>

        <section className="dashboard-recent-card rfid-card rfid-cards-card">
          <div className="dashboard-panel-header">
            <div>
              <span>{showEnrollmentScans ? 'Scanned UID for Enrollment' : 'Student RFID Cards'}</span>
              <p>
                {showEnrollmentScans
                  ? 'UIDs read by the enrollment scanner. These are not issued student cards.'
                  : 'Issued RFID cards linked to student profiles.'}
              </p>
            </div>
            <div className="rfid-header-actions">
              <div className="rfid-header-links">
                <button
                  type="button"
                  className="dashboard-text-link rfid-download-button"
                  onClick={() => setIsExportModalOpen(true)}
                  disabled={showEnrollmentScans || isLoading || Boolean(errorMessage) || visibleRfidCards.length === 0}
                >
                  <Download size={16} aria-hidden="true" />
                  Download
                </button>
              </div>
            </div>
          </div>

          <div className="manage-users-role-filter rfid-filter-row">
            {showEnrollmentScans && (
              <div className="rfid-scan-dates">
                <label>
                  <span>From</span>
                  <input
                    type="date"
                    value={scanDateFrom}
                    max={scanDateTo || undefined}
                    onChange={(event) => setScanDateFrom(event.target.value)}
                  />
                </label>
                <span className="rfid-scan-dates-divider" aria-hidden="true" />
                <label>
                  <span>To</span>
                  <input
                    type="date"
                    value={scanDateTo}
                    min={scanDateFrom || undefined}
                    onChange={(event) => setScanDateTo(event.target.value)}
                  />
                </label>
                {scanDateFrom || scanDateTo ? (
                  <button
                    type="button"
                    className="rfid-scan-dates-clear"
                    aria-label="Clear dates"
                    onClick={() => {
                      setScanDateFrom('');
                      setScanDateTo('');
                    }}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            )}
            {!showEnrollmentScans && (
            <>
            <RfidFilterMenu
              id="rfid-college-filter"
              label="College filter"
              allLabel="All colleges"
              value={collegeFilter}
              options={collegeOptions}
              isOpen={openFilter === 'college'}
              disabled={isLoading}
              onToggle={() => setOpenFilter((current) => (current === 'college' ? '' : 'college'))}
              onClose={() => setOpenFilter((current) => (current === 'college' ? '' : current))}
              onSelect={(value) => {
                setCollegeFilter(value);
                setProgramFilter('all');
                setOpenFilter('');
              }}
            />
            <RfidFilterMenu
              id="rfid-program-filter"
              label="Program filter"
              allLabel="All programs"
              value={programFilter}
              options={programOptions}
              isOpen={openFilter === 'program'}
              disabled={isLoading || programOptions.length === 0}
              onToggle={() => setOpenFilter((current) => (current === 'program' ? '' : 'program'))}
              onClose={() => setOpenFilter((current) => (current === 'program' ? '' : current))}
              onSelect={(value) => {
                setProgramFilter(value);
                setOpenFilter('');
              }}
            />
            </>
            )}
            <div className="rfid-filter-tools">
              <button
                type="button"
                className="dashboard-text-link rfid-scan-button"
                onClick={() => setShowEnrollmentScans((current) => !current)}
              >
                {showEnrollmentScans ? 'Registered RFID' : 'Scanned UID for Enrollment'}
              </button>
              <label className="rfid-search" aria-label={showEnrollmentScans ? 'Search enrollment scans' : 'Search student RFID cards'}>
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  placeholder={showEnrollmentScans ? 'Search scanned UID' : 'Search user or RFID UID'}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </label>
            </div>
          </div>

          <div className="dashboard-recent-table-wrap rfid-table-wrap">
            <table className={`dashboard-recent-table rfid-table${showEnrollmentScans ? ' rfid-scan-table' : ''}`}>
              <thead>
                <tr>
                  {(showEnrollmentScans ? scanColumns : columns).map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {showEnrollmentScans && isScanLoading && (
                  <tr>
                    <td className="dashboard-recent-empty" colSpan={scanColumns.length}>
                      Loading enrollment scans...
                    </td>
                  </tr>
                )}

                {showEnrollmentScans && !isScanLoading && scanErrorMessage && (
                  <tr>
                    <td className="dashboard-recent-empty" colSpan={scanColumns.length}>
                      {scanErrorMessage}
                    </td>
                  </tr>
                )}

                {showEnrollmentScans && !isScanLoading && !scanErrorMessage && visibleEnrollmentScans.length === 0 && (
                  <tr>
                    <td className="dashboard-recent-empty" colSpan={scanColumns.length}>
                      {normalizedSearchQuery || scanDateFrom || scanDateTo
                        ? 'No enrollment scans match these filters.'
                        : 'No enrollment scans yet.'}
                    </td>
                  </tr>
                )}

                {showEnrollmentScans &&
                  !isScanLoading &&
                  !scanErrorMessage &&
                  paginatedEnrollmentScans.map((scan) => (
                    <tr key={scan.id}>
                      <td className="rfid-uid">{scan.rfidUid}</td>
                      <td>{scan.scannedAt}</td>
                      <td>{scan.deviceLabel}</td>
                      <td>
                        <span className={`dashboard-log-status rfid-status rfid-status-${scan.registrationStatus === 'registered' ? 'registered' : 'unknown'}`}>
                          {scan.registrationStatus === 'registered' ? 'registered' : 'unknown'}
                        </span>
                      </td>
                    </tr>
                  ))}

                {!showEnrollmentScans && isLoading && (
                  <tr>
                    <td className="dashboard-recent-empty" colSpan={columns.length}>
                      Loading student RFID cards...
                    </td>
                  </tr>
                )}

                {!showEnrollmentScans && !isLoading && errorMessage && (
                  <tr>
                    <td className="dashboard-recent-empty" colSpan={columns.length}>
                      {errorMessage}
                    </td>
                  </tr>
                )}

                {!showEnrollmentScans && !isLoading && !errorMessage && visibleRfidCards.length === 0 && (
                  <tr>
                    <td className="dashboard-recent-empty" colSpan={columns.length}>
                      {normalizedSearchQuery || collegeFilter !== 'all' || programFilter !== 'all'
                        ? 'No student RFID cards match these filters.'
                        : 'No RFID cards found.'}
                    </td>
                  </tr>
                )}

                {!showEnrollmentScans &&
                  !isLoading &&
                  !errorMessage &&
                  paginatedRfidCards.map((card) => {
                    const registeredAt = splitRegisteredAt(card.issuedAt);

                    return (
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
                      <td>
                        <strong>{registeredAt.date}</strong>
                        {registeredAt.time ? <span>{registeredAt.time}</span> : null}
                      </td>
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
                    );
                  })}
              </tbody>
            </table>
          </div>

          {((showEnrollmentScans && !isScanLoading && !scanErrorMessage && visibleEnrollmentScans.length > 0) ||
            (!showEnrollmentScans && !isLoading && !errorMessage && visibleRfidCards.length > 0)) && (
            <div className="manage-users-pagination" aria-label={showEnrollmentScans ? 'Enrollment scans pagination' : 'RFID cards pagination'}>
              <p>
                Showing {(currentPage - 1) * rowsPerPage + 1}-
                {Math.min(currentPage * rowsPerPage, listLength)} of {listLength}
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

      <ExportFormatModal
        open={isExportModalOpen}
        title="Export Student RFID Cards"
        subtitle={`${visibleRfidCards.length} card${visibleRfidCards.length === 1 ? '' : 's'} in the current view`}
        prompt="Only the RFID cards matching the current college, program, and search will be exported. Choose the file format."
        pdfHint="Printable RFID card table"
        onSelect={handleExport}
        onClose={() => setIsExportModalOpen(false)}
      />

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
