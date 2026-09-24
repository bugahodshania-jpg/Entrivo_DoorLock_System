import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, Search, Users, XCircle } from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import { getManilaDateStamp } from '../../utils/dateTime';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/rfid.css';

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

export default function RFIDCards() {
  const [rfidCards, setRfidCards] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let isActive = true;

    async function loadRfidCards() {
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

    loadRfidCards();

    return () => {
      isActive = false;
    };
  }, []);

  const columns = ['User', 'Student ID', 'College', 'Year Level', 'RFID UID', 'Status', 'Registered at'];
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleRfidCards = useMemo(() => {
    if (!normalizedSearchQuery) {
      return rfidCards;
    }

    return rfidCards.filter((card) =>
      [card.name, card.studentId, card.college, card.yearLevel, card.rfidUid]
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

  return (
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
                    {normalizedSearchQuery ? 'No student RFID cards match your search.' : 'No RFID cards found.'}
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
                        {card.userStatus}
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
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
