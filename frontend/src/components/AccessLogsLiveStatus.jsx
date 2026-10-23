import { formatDateInManila } from '../utils/dateTime';

export default function AccessLogsLiveStatus({ isLoading, isLive, errorMessage, lastUpdated }) {
  const label = isLoading ? 'Connecting…' : errorMessage ? 'Reconnecting…' : isLive ? 'Live' : 'Paused';
  const updatedTime = lastUpdated ? formatDateInManila(lastUpdated, {
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  }) : '';

  return (
    <div className={`access-logs-live-status${isLive ? ' is-live' : ''}${errorMessage ? ' is-reconnecting' : ''}`}>
      <small className="access-logs-live-label" role="status" title={errorMessage || 'Access logs update automatically.'}>
        <i aria-hidden="true" />
        {label}
      </small>
      {updatedTime ? <time dateTime={new Date(lastUpdated).toISOString()}>Updated {updatedTime} PHT</time> : null}
      {errorMessage ? <small className="access-logs-live-error">{errorMessage}</small> : null}
    </div>
  );
}
