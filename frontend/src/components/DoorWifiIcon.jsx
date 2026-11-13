import { Wifi, WifiLow, WifiOff } from 'lucide-react';
import { useDoorStatus } from '../hooks/useDoorStatus';
import '../styles/shared/doorStatus.css';

const LABELS = {
  connected: 'Connected',
  weak: 'Weak signal',
  offline: 'Not connected',
};

/** The door controller's WiFi, as one header icon: connected, weak signal or not connected. */
export default function DoorWifiIcon() {
  const door = useDoorStatus();
  const Icon = door.wifi === 'connected' ? Wifi : door.wifi === 'weak' ? WifiLow : WifiOff;
  const label = `Door controller WiFi: ${LABELS[door.wifi]}${door.wifiRssi !== null ? ` (${door.wifiRssi} dBm)` : ''}`;
  return (
    <span className={`door-wifi-icon is-${door.wifi}`} role="img" aria-label={label} title={label}>
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}
