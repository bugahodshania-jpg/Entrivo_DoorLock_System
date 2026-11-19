import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, TriangleAlert, Upload, X } from 'lucide-react';
import axiosClient from '../api/axiosClient';
import { downloadFile } from '../utils/exportFiles';
import { createXlsx, readSpreadsheet } from '../utils/spreadsheet';
import { IMPORT_COLUMNS, IMPORT_MAX_ROWS, IMPORT_TEMPLATE_ROWS, buildScheduleImport } from '../utils/scheduleImport';
import { getDefaultGracePeriodMinutes } from '../utils/systemSettings';

/**
 * Import regular schedules from an Excel (.xlsx) or CSV file. Every row is
 * checked first; valid rows are then created one by one through the same
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

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  async function chooseFile(file) {
    if (!file) return;
    setFileName(file.name);
    setParsed(null);
    setResults(null);
    setReadError('');
    try {
      const sheetRows = await readSpreadsheet(file);
      const built = buildScheduleImport(sheetRows, users, { defaultGrace: getDefaultGracePeriodMinutes(), actor });
      if (built.error) setReadError(built.error);
      else setParsed(built.rows);
    } catch (error) {
      setReadError(error.message || 'This file could not be read.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function downloadTemplate() {
    const blob = createXlsx(IMPORT_TEMPLATE_ROWS, { sheetName: 'Schedules', columnWidths: [18, 14, 14, 18, 12, 12, 13, 11] });
    downloadFile(blob, blob.type, 'entrivo-schedule-import-template.xlsx');
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
    <div className="schedules-modal-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div className="schedules-modal schedules-import-modal" role="dialog" aria-modal="true"
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
          <button type="button" className="dashboard-schedule-button" onClick={() => inputRef.current?.click()} disabled={busy}>
            <FileSpreadsheet size={16} aria-hidden="true" />
            {fileName ? 'Choose another file' : 'Choose Excel file'}
          </button>
          <span>{fileName || 'No file chosen'}</span>
        </div>

        {readError ? <p className="schedules-import-error" role="alert"><TriangleAlert size={15} aria-hidden="true" />{readError}</p> : null}

        {parsed ? (
          <section className="schedules-import-preview" aria-label="Rows to import">
            <p className="schedules-import-summary" role="status">
              {results
                ? <><b>{added}</b> of {results.length} rows added{results.length - added ? `, ${results.length - added} not added` : ''}.{invalidCount ? ` ${invalidCount} rows had errors and were skipped.` : ''}</>
                : <><b>{validCount}</b> {validCount === 1 ? 'row is' : 'rows are'} ready to import{invalidCount ? <>, <b className="is-error">{invalidCount}</b> {invalidCount === 1 ? 'has' : 'have'} errors and will be skipped</> : null}.</>}
            </p>
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
                        <td>{row.timeLabel}</td>
                        <td>{row.status}</td>
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
          </section>
        ) : null}

        <footer className="schedules-import-actions">
          <button type="button" className="dashboard-export-button" onClick={onClose} disabled={busy}>
            {results ? 'Done' : 'Cancel'}
          </button>
          {!results ? (
            <button type="button" className="dashboard-schedule-button" onClick={runImport} disabled={busy || validCount === 0}>
              <Upload size={16} aria-hidden="true" />
              {progress ? `Importing ${progress.done + 1} of ${progress.total}…` : `Import ${validCount || ''} ${validCount === 1 ? 'row' : 'rows'}`.replace('  ', ' ')}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
