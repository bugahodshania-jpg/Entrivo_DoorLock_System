import { HardDrive } from 'lucide-react';
import '../styles/shared/tableEmptyState.css';

export default function TableEmptyState({ children, description }) {
  return (
    <div className="table-empty-state">
      <HardDrive size={28} aria-hidden="true" />
      <p className="table-empty-state-message">{children}</p>
      {description ? <p className="table-empty-state-description">{description}</p> : null}
    </div>
  );
}
