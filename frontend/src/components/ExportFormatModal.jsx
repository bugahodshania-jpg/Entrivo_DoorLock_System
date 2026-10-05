import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FileSpreadsheet, FileText, X } from 'lucide-react';
import '../styles/shared/exportFormatModal.css';

export default function ExportFormatModal({
  open,
  title = 'Export',
  subtitle,
  prompt = 'Choose the file format to export.',
  pdfHint = 'Printable table document',
  csvHint = 'Spreadsheet rows for Excel or Google Sheets',
  onSelect,
  onClose,
}) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="export-format-overlay" onClick={onClose}>
      <div
        className="export-format-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-format-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="export-format-header">
          <div>
            <strong id="export-format-title">{title}</strong>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="export-format-close" aria-label="Close export options" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="export-format-prompt">{prompt}</p>
        <div className="export-format-options">
          <button type="button" className="export-format-option" onClick={() => onSelect('pdf')}>
            <FileText size={22} aria-hidden="true" />
            <span>
              <strong>PDF</strong>
              <small>{pdfHint}</small>
            </span>
          </button>
          <button type="button" className="export-format-option" onClick={() => onSelect('csv')}>
            <FileSpreadsheet size={22} aria-hidden="true" />
            <span>
              <strong>CSV</strong>
              <small>{csvHint}</small>
            </span>
          </button>
        </div>
        <div className="export-format-actions">
          <button type="button" className="export-format-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
