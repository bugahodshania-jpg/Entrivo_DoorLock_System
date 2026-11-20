import { WifiOff } from 'lucide-react';

/**
 * Marks an access log the door saved while it had no connection and uploaded
 * later. The log's time is when it happened; offlineSyncedAt is when it arrived.
 */
export default function OfflineLogTag({ log }) {
  if (!log?.offline) return null;
  const synced = log.offlineSyncedAt ? ` Synced ${log.offlineSyncedAt}.` : '';
  return (
    <span className="access-log-offline-tag" title={`Saved by the door while it was offline.${synced}`}>
      <WifiOff size={11} aria-hidden="true" />
      Offline
    </span>
  );
}
