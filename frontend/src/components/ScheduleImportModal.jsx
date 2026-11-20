import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Eye, FileSpreadsheet, TriangleAlert, Upload, X } from 'lucide-react';
import axiosClient from '../api/axiosClient';
import { downloadFile } from '../utils/exportFiles';
import { createXlsx, readSpreadsheet } from '../utils/spreadsheet';
import { IMPORT_COLUMNS, IMPORT_MAX_ROWS, IMPORT_TEMPLATE_ROWS, buildScheduleImport } from '../utils/scheduleImport';
import { getDefaultGracePeriodMinutes } from '../utils/systemSettings';

/**
 * Import regular schedules from an Excel (.xlsx) or CSV file. The first modal
 * explains the file layout; choosing a file opens a second modal on top that
 * lists every row it read. Valid rows are created one by one through the same
 * endpoint as Add Schedule, so the server's account and conflict checks apply.
 */
export default function ScheduleImportModal({ users, actor, onClose, onImported }) {
  const inputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null);
  const [readError, setReadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || busy) return;
      if (isPreviewOpen) setIsPreviewOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, isPreviewOpen, onClose]);

  async function chooseFile(file) {
    if (!file) return;
    setFileName(file.name);
    setParsed(null);
    setResults(null);
    setReadError('');
    setIsPreviewOpen(false);
    try {
      const sheetRows = await readSpreadsheet(file);
      const built = buildScheduleImport(sheetRows, users, { defaultGrace: getDefaultGracePeriodMinutes(), actor });
      if (built.error) {
        setReadError(built.error);
      } else {
        setParsed(built.rows);
        setIsPreviewOpen(true);
      }
    } catch (error) {
      setReadError(error.message || 'This file could not be read.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function openFilePicker() {
    inputRef.current?.click();
  }

  function downloadTemplate() {
    const blob = createXlsx(IMPORT_TEMPLATE_ROWS, { sheetName: 'Schedules', columnWidths: [18, 14, 14, 18, 12, 12, 13, 11] });
    downloadFile(blob, blob.type, 'entrivo-schedule-import-template.xlsx');
  }

  function openReview() {
    if (!parsed) {
      setReadError(readError || 'Choose an Excel or CSV file first. Nothing is imported until a file is chosen.');
      return;
    }
    setIsPreviewOpen(true);
  }

  async function runImport() {
    const valid = (parsed || []).filter((row) => row.payload);
    if (!valid.length) return;
    setBusy(true);
    setResults(null);
    const outcome = [];
    for (let index = 0; index < valid.length; index += 1) {
      const row = valid[index];
      setProgress({ done: index, total: valid.length });
      try {
        const response = await axiosClient.post('/api/schedules.php', row.payload);
        const data = response.data || {};
        if (data.hasConflicts) {
          outcome.push({ row, ok: false, message: `Not added: ${data.message || 'it overlaps another schedule.'}${data.conflicts?.length ? ` (${data.conflicts.slice(0, 3).join(', ')}${data.conflicts.length > 3 ? '…' : ''})` : ''}` });
        } else {
          const count = data.isBatch ? (data.schedules || []).length : 1;
          outcome.push({ row, ok: true, message: count > 1 ? `Added ${count} schedules.` : 'Added.' });
        }
      } catch (error) {
        outcome.push({ row, ok: false, message: `Not added: ${error.response?.data?.message || 'the server refused this row.'}` });
      }
    }
    setProgress(null);
    setResults(outcome);
    setBusy(false);
    if (outcome.some((item) => item.ok)) onImported?.();
  }

  const validCount = parsed ? parsed.filter((row) => row.payload).length : 0;
  const invalidCount = parsed ? parsed.length - validCount : 0;
  const added = results ? results.filter((item) => item.ok).length : 0;
  const resultByLine = new Map((results || []).map((item) => [item.row.line, item]));

  return (
    <>
      <div className="schedules-modal-overlay" onClick={() => { if (!busy && !isPreviewOpen) onClose(); }}>
        <div className="schedules-modal schedules-import-modal" role="dialog" aria-modal={!isPreviewOpen}
          aria-labelledby="schedules-import-title" onClick={(event) => event.stopPropagation()}>
          <div className="schedules-modal-header">
            <div>
              <strong id="schedules-import-title">Import schedules from Excel</strong>
              <p>Add many regular schedules at once. Every row is checked before anything is saved.</p>
            </div>
            <button type="button" className="schedules-modal-close" onClick={onClose} disabled={busy} aria-label="Close">
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <section className="schedules-import-guide" aria-labelledby="schedules-import-guide-title">
            <div className="schedules-import-guide-head">
              <h3 id="schedules-import-guide-title">What the Excel file must contain</h3>
              <button type="button" className="dashboard-export-button" onClick={downloadTemplate}>
                <Download size={15} aria-hidden="true" />
                Download template
              </button>
            </div>
            <ul className="schedules-import-rules">
              <li>An Excel workbook (<b>.xlsx</b>) or a <b>.csv</b> file. Only the first sheet is read.</li>
              <li>The first row holds the column headers below, spelled as shown, in any order. Each row after it is one schedule.</li>
              <li>Up to {IMPORT_MAX_ROWS} rows per file. Empty rows are skipped.</li>
              <li>Only regular schedules can be imported. Create overrides with Add Schedule.</li>
            </ul>
            <div className="schedules-import-columns-wrap">
              <table className="schedules-import-columns">
                <thead><tr><th>Column</th><th>Required</th><th>What to put in it</th><th>Example</th></tr></thead>
                <tbody>
                  {IMPORT_COLUMNS.map((column) => (
                    <tr key={column.key}>
                      <td><b>{column.header}</b></td>
                      <td>{column.required ? <span className="schedules-import-required">Required</span> : 'Optional'}</td>
                      <td>{column.help}</td>
                      <td>{column.example || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="schedules-import-note">
              A row is not added when the account is not fully active, or when the time overlaps another regular schedule on that date.
            </p>
          </section>

          <div className="schedules-import-file">
            <input ref={inputRef} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={(event) => chooseFile(event.target.files?.[0])} hidden />
            <button type="button" className="dashboard-schedule-button" onClick={openFilePicker} disabled={busy}>
              <FileSpreadsheet size={16} aria-hidden="true" />
              {fileName ? 'Choose another file' : 'Choose Excel file'}
            </button>
            <span>
              {fileName || 'No file chosen'}
              {parsed ? ` · ${parsed.length} ${parsed.length === 1 ? 'row' : 'rows'} read` : ''}
            </span>
          </div>

          {readError ? <p className="schedules-import-error" role="alert"><TriangleAlert size={15} aria-hidden="true" />{readError}</p> : null}

          <footer className="schedules-import-actions">
            <button type="button" className="dashboard-export-button" onClick={onClose} disabled={busy}>
              {results ? 'Done' : 'Cancel'}
            </button>
            <button type="button" className={`dashboard-schedule-button schedules-import-run${parsed ? '' : ' is-blocked'}`}
              onClick={openReview} aria-disabled={!parsed} title={parsed ? undefined : 'Choose an Excel file first'}>
              <Eye size={16} aria-hidden="true" />
              {results ? 'View results' : 'Review rows'}
            </button>
          </footer>
        </div>
      </div>

      {isPreviewOpen && parsed ? (
        <div className="schedules-modal-overlay schedules-import-review-overlay" onClick={() => { if (!busy) setIsPreviewOpen(false); }}>
          <div className="schedules-modal schedules-import-review" role="dialog" aria-modal="true"
            aria-labelledby="schedules-import-review-title" onClick={(event) => event.stopPropagation()}>
            <div className="schedules-modal-header">
              <div>
                <strong id="schedules-import-review-title">{results ? 'Import results' : 'Review rows'}</strong>
                <p><FileSpreadsheet size={13} aria-hidden="true" /> {fileName}</p>
              </div>
              <button type="button" className="schedules-modal-close" onClick={() => setIsPreviewOpen(false)} disabled={busy} aria-label="Back">
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="schedules-import-counts" role="status">
              {results ? (
                <>
                  <span className="is-ok"><b>{added}</b> added</span>
                  {results.length - added ? <span className="is-error"><b>{results.length - added}</b> not added</span> : null}
                  {invalidCount ? <span className="is-error"><b>{invalidCount}</b> skipped (errors)</span> : null}
                </>
              ) : (
                <>
                  <span><b>{parsed.length}</b> {parsed.length === 1 ? 'row' : 'rows'} read</span>
                  <span className="is-ok"><b>{validCount}</b> ready</span>
                  {invalidCount ? <span className="is-error"><b>{invalidCount}</b> with errors, will be skipped</span> : null}
                </>
              )}
            </div>

            <div className="schedules-import-table-wrap">
              <table className="schedules-import-table">
                <thead><tr><th>Row</th><th>Person</th><th>Date</th><th>Time</th><th>Status</th><th>Check</th></tr></thead>
                <tbody>
                  {parsed.map((row) => {
                    const result = resultByLine.get(row.line);
                    const failed = row.errors.length > 0 || (result && !result.ok);
                    return (
                      <tr key={row.line} className={failed ? 'is-error' : result?.ok ? 'is-done' : ''}>
                        <td>{row.line}</td>
                        <td><b>{row.user}</b><small>{row.identifier}</small></td>
                        <td>{row.dateLabel || '—'}</td>
                        <td className="is-nowrap">{row.timeLabel}</td>
                        <td><span className={`schedules-import-status is-${row.status.toLowerCase()}`}>{row.status}</span></td>
                        <td>
                          {row.errors.length ? row.errors.join(' ')
                            : result ? result.message
                              : <span className="schedules-import-ok"><CheckCircle2 size={13} aria-hidden="true" /> Ready</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <footer className="schedules-import-actions">
              {results ? (
                <button type="button" className="dashboard-schedule-button" onClick={onClose}>Done</button>
              ) : (
                <>
                  <button type="button" className="dashboard-export-button schedules-import-another" onClick={openFilePicker} disabled={busy}>
                    <FileSpreadsheet size={15} aria-hidden="true" />
                    Choose another file
                  </button>
                  <button type="button" className="dashboard-export-button" onClick={() => setIsPreviewOpen(false)} disabled={busy}>
                    Back
                  </button>
                  <button type="button" className={`dashboard-schedule-button schedules-import-run${validCount === 0 ? ' is-blocked' : ''}`}
                    onClick={runImport} disabled={busy || validCount === 0} title={validCount === 0 ? 'No valid rows to import' : undefined}>
                    <Upload size={16} aria-hidden="true" />
                    {progress ? `Importing ${progress.done + 1} of ${progress.total}…` : `Import ${validCount} ${validCount === 1 ? 'row' : 'rows'}`}
                  </button>
                </>
              )}
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
