import { LockKeyhole, LockKeyholeOpen, WifiOff } from 'lucide-react';
import { useDoorStatus } from '../hooks/useDoorStatus';
import '../styles/shared/doorStatus.css';

export default function DoorStatusCard() {
  const door = useDoorStatus();
  const Icon = door.state === 'locked' ? LockKeyhole : door.state === 'unlocked' ? LockKeyholeOpen : WifiOff;
  return <div className={`door-status-card is-${door.state}`} role="status"
    aria-label={`Door status: ${door.label}. ${door.deviceName}`} title={`${door.deviceName} · Door ${door.label.toLowerCase()}`}>
    <Icon size={17} aria-hidden="true" />
    <div><strong>Door {door.label.toLowerCase()}</strong><small>{door.deviceName}</small></div>
    <span className="door-status-dot" aria-hidden="true" />
  </div>;
}
