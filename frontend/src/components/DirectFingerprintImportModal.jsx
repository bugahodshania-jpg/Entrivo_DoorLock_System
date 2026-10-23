import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, Database, Search, X } from 'lucide-react';
import axiosClient from '../api/axiosClient';
import { useActionConfirm } from './ActionConfirm';
import DirectFingerprintImportProgressModal from './DirectFingerprintImportProgressModal';
import { formatDateTimeInManila } from '../utils/dateTime';
import {
  getDirectImportBlockReason,
  getDirectImportFormResetDelay,
  getDirectImportJobPresentation,
  getDirectImportRetryTarget,
  isDirectImportJobActive,
} from '../utils/directFingerprintImport';
import '../styles/superAdmin/directFingerprintImport.css';

const importEndpoint = '/api/fingerprint/direct_import.php';

function savedImportJob(storageKey) {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(storageKey) || 'null');
    if (Number.isInteger(Number(saved?.job_id)) && Number(saved.job_id) > 0) {
      return {
        job_id: Number(saved.job_id),
        employee_id: String(saved.employee_id || ''),
        status: 'pending',
        current_step: 'Loading the saved import status...',
      };
    }
  } catch {
    // The modal still tracks imports in memory when browser storage is unavailable.
  }
  return null;
}

function label(value) {
  return String(value || '').split('_').filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export default function DirectFingerprintImportModal({
  open,
  onClose,
  currentUser,
  canImport,
  isLargeScreen,
  onCompleted,
  onNotice,
}) {
  const confirmAction = useActionConfirm();
  const storageKey = `entrivo_direct_import_job:${currentUser?.id || 'session'}`;
  const [job, setJob] = useState(() => savedImportJob(storageKey));
  const [jobStorageKey, setJobStorageKey] = useState(storageKey);
  const [employeeId, setEmployeeId] = useState(() => savedImportJob(storageKey)?.employee_id || '');
  const [lookup, setLookup] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isQueueing, setIsQueueing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pollError, setPollError] = useState('');
  const searchSequenceRef = useRef(0);
  const searchControllerRef = useRef(null);
  const inputRef = useRef(null);
  const storageKeyRef = useRef(storageKey);
  const notifiedJobsRef = useRef(new Set());
  const jobActionSequenceRef = useRef(0);
  const callbacksRef = useRef({ onCompleted, onNotice });
  const mountedRef = useRef(true);
  const activeJob = isDirectImportJobActive(job);
  const jobId = Number(job?.job_id) || null;
  const jobStatus = String(job?.status || '').toLowerCase();
  const jobFinishedAt = job?.finished_at;
  const backups = lookup?.backups || [];
  const selectedBackup = backups.find(backup => String(backup.fingerprint_id) === selectedId) || null;
  const blockReason = getDirectImportBlockReason(lookup?.user, selectedBackup);
  const isRetry = jobStatus === 'cancelled';
  const retryTarget = getDirectImportRetryTarget(job);
  const queueBlockReason = isRetry
    ? (retryTarget ? '' : 'Search for the employee and select the saved fingerprint again before retrying.')
    : blockReason;
  const resetImportForm = useCallback(() => {
    searchSequenceRef.current += 1;
    jobActionSequenceRef.current += 1;
    searchControllerRef.current?.abort();
    setJob(null);
    setEmployeeId('');
    setLookup(null);
    setSelectedId('');
    setIsSearching(false);
    setSearchError('');
    setActionError('');
    setPollError('');
    notifiedJobsRef.current.clear();
  }, []);

  useEffect(() => {
    callbacksRef.current = { onCompleted, onNotice };
  }, [onCompleted, onNotice]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      searchSequenceRef.current += 1;
      searchControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (storageKeyRef.current !== storageKey) {
      storageKeyRef.current = storageKey;
      const saved = savedImportJob(storageKey);
      setJob(saved);
      setJobStorageKey(storageKey);
      setEmployeeId(saved?.employee_id || '');
      setLookup(null);
      setSelectedId('');
      setSearchError('');
      setActionError('');
      setPollError('');
      searchSequenceRef.current += 1;
      searchControllerRef.current?.abort();
      notifiedJobsRef.current.clear();
    }
  }, [storageKey]);

  useEffect(() => {
    if (jobStorageKey !== storageKey) return;
    try {
      if (jobId) {
        window.sessionStorage.setItem(storageKey, JSON.stringify({
          job_id: jobId,
          employee_id: job?.employee_id || employeeId.trim(),
        }));
      } else {
        window.sessionStorage.removeItem(storageKey);
      }
    } catch {
      // Closing and reopening this modal still works without session storage.
    }
  }, [employeeId, job?.employee_id, jobId, jobStorageKey, storageKey]);

  useEffect(() => {
    if (open && !jobId) {
      inputRef.current?.focus();
    }
  }, [jobId, open]);

  useEffect(() => {
    if (!jobId || jobStorageKey !== storageKey || isQueueing || isCancelling) return undefined;
    const delay = getDirectImportFormResetDelay({ status: jobStatus, finished_at: jobFinishedAt });
    if (delay === null) return undefined;

    let stopped = false;
    const actionSequence = jobActionSequenceRef.current;
    const searchSequence = searchSequenceRef.current;
    const timeoutId = window.setTimeout(() => {
      if (stopped || storageKeyRef.current !== storageKey || actionSequence !== jobActionSequenceRef.current || searchSequence !== searchSequenceRef.current) return;
      resetImportForm();
    }, delay);

    return () => {
      stopped = true;
      window.clearTimeout(timeoutId);
    };
  }, [isCancelling, isQueueing, jobFinishedAt, jobId, jobStatus, jobStorageKey, resetImportForm, storageKey]);

  useEffect(() => {
    if (!jobId || !activeJob || isCancelling || jobStorageKey !== storageKey) {
      return undefined;
    }

    let stopped = false;
    let timeoutId;
    const controller = new AbortController();

    async function refresh() {
      const actionSequence = jobActionSequenceRef.current;
      try {
        const response = await axiosClient.get(importEndpoint, {
          params: { job_id: jobId, actor_id: currentUser?.id },
          signal: controller.signal,
          timeout: 10000,
        });
        if (stopped || actionSequence !== jobActionSequenceRef.current) return;
        const nextJob = response.data?.job;
        if (Number(nextJob?.job_id) !== jobId) {
          setPollError('Unable to read the import status. Checking again shortly.');
          return;
        }
        setJob(current => Number(current?.job_id) === jobId ? { ...current, ...nextJob } : current);
        setPollError('');

        if (!isDirectImportJobActive(nextJob)) {
          const notificationKey = `${jobId}:${nextJob.queued_at || ''}:${nextJob.status}`;
          if (!notifiedJobsRef.current.has(notificationKey)) {
            notifiedJobsRef.current.add(notificationKey);
            const result = getDirectImportJobPresentation(nextJob);
            callbacksRef.current.onNotice?.(result.detail, nextJob.status === 'completed' ? 'success' : 'error');
            if (nextJob.status === 'completed') {
              callbacksRef.current.onCompleted?.(nextJob);
            }
          }
        }
      } catch (error) {
        if (stopped || actionSequence !== jobActionSequenceRef.current || error.code === 'ERR_CANCELED') return;
        const message = error.response?.data?.message;
        if ([403, 404].includes(error.response?.status)) {
          setJob(null);
          setActionError(message || 'The saved import job is no longer available. Search for the employee again.');
        } else {
          setPollError(message || 'The import status cannot be reached right now. Checking again shortly; completion has not been confirmed.');
        }
      } finally {
        if (!stopped) timeoutId = window.setTimeout(refresh, 2000);
      }
    }

    refresh();
    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [activeJob, currentUser?.id, isCancelling, jobId, jobStorageKey, storageKey]);

  function changeEmployeeId(value) {
    searchSequenceRef.current += 1;
    searchControllerRef.current?.abort();
    setEmployeeId(value);
    setLookup(null);
    setSelectedId('');
    setIsSearching(false);
    setSearchError('');
    setActionError('');
    setPollError('');
    if (!activeJob) setJob(null);
  }

  async function searchEmployee(event) {
    event.preventDefault();
    const identifier = employeeId.trim();
    if (!identifier) {
      setSearchError('Enter an employee ID first.');
      return;
    }
    const requestId = ++searchSequenceRef.current;
    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    if (!activeJob) setJob(null);
    setLookup(null);
    setSelectedId('');
    setSearchError('');
    setActionError('');
    setIsSearching(true);

    try {
      const response = await axiosClient.get(importEndpoint, {
        params: { employee_id: identifier, actor_id: currentUser?.id },
        signal: controller.signal,
      });
      if (searchSequenceRef.current !== requestId || !mountedRef.current) return;
      if (!response.data?.success || !response.data?.user) {
        setSearchError(response.data?.message || 'No matching employee was found. Check the employee ID and try again.');
        return;
      }
      setLookup({
        user: response.data.user,
        backups: Array.isArray(response.data.backups) ? response.data.backups : [],
        employeeId: identifier,
      });
    } catch (error) {
      if (searchSequenceRef.current !== requestId || !mountedRef.current || error.code === 'ERR_CANCELED') return;
      setSearchError(error.response?.data?.message || 'Unable to search the database right now. Please try again.');
    } finally {
      if (searchSequenceRef.current === requestId && mountedRef.current) setIsSearching(false);
    }
  }

  async function queueImport() {
    if (!canImport || !isLargeScreen || !currentUser?.id || activeJob || isQueueing || isCancelling) return;
    if (queueBlockReason) {
      setActionError(queueBlockReason);
      return;
    }
    const requestId = searchSequenceRef.current;
    jobActionSequenceRef.current += 1;
    const owner = isRetry ? { full_name: job.user_name, employee_id: retryTarget.employee_id } : lookup.user;
    const fingerprint = isRetry ? { fingerprint_id: retryTarget.fingerprint_id, finger_name: job.finger_name } : selectedBackup;
    const identifier = isRetry ? retryTarget.employee_id : lookup.employeeId;
    const deviceId = isRetry ? retryTarget.enrollment_device_id : 1;
    setIsQueueing(true);
    setActionError('');

    try {
      const confirmed = await confirmAction({
        title: isRetry ? 'Retry fingerprint import to Sensor A' : 'Import fingerprint to Sensor A',
        message: `${isRetry ? 'Retry importing' : 'Import'} ${fingerprint.finger_name} for ${owner.full_name} (${owner.employee_id}) to Sensor A?`,
        confirmLabel: isRetry ? 'Retry' : 'Import',
      });
      if (!confirmed || !mountedRef.current || requestId !== searchSequenceRef.current) return;
      const response = await axiosClient.post(importEndpoint, {
        action: 'queue',
        employee_id: identifier,
        fingerprint_id: fingerprint.fingerprint_id,
        enrollment_device_id: deviceId,
        actor_id: currentUser.id,
      });
      if (!mountedRef.current || requestId !== searchSequenceRef.current) return;
      if (!response.data?.success || !response.data?.job?.job_id) {
        setActionError(response.data?.message || 'The import could not be queued. Please try again.');
        return;
      }
      setPollError('');
      // Retrying a failed import may reuse its job ID and local slot.
      notifiedJobsRef.current.clear();
      setJob({
        ...response.data.job,
        employee_id: response.data.job.employee_id || identifier,
        user_name: response.data.job.user_name || owner.full_name,
        finger_name: response.data.job.finger_name || fingerprint.finger_name,
      });
    } catch (error) {
      if (mountedRef.current && requestId === searchSequenceRef.current) {
        setActionError(error.response?.data?.message || 'Unable to queue this import. Check Sensor A and try again.');
      }
    } finally {
      if (mountedRef.current) setIsQueueing(false);
    }
  }

  async function cancelImport() {
    if (!canImport || !currentUser?.id || !activeJob || !jobId || isQueueing || isCancelling) return;
    const actionSequence = ++jobActionSequenceRef.current;
    const requestStorageKey = storageKey;
    setIsCancelling(true);
    setActionError('');

    try {
      const response = await axiosClient.post(importEndpoint, {
        action: 'cancel',
        job_id: jobId,
        actor_id: currentUser.id,
      }, { timeout: 10000 });
      if (!mountedRef.current || storageKeyRef.current !== requestStorageKey || actionSequence !== jobActionSequenceRef.current) return;
      const nextJob = response.data?.job;
      if (!response.data?.success || Number(nextJob?.job_id) !== jobId || isDirectImportJobActive(nextJob)) {
        setActionError(response.data?.message || 'Cancellation has not been confirmed. Check the import status and try again.');
        return;
      }
      setJob(current => Number(current?.job_id) === jobId ? { ...current, ...nextJob } : current);
      setPollError('');
      const notificationKey = `${jobId}:${nextJob.queued_at || ''}:${nextJob.status}`;
      if (!notifiedJobsRef.current.has(notificationKey)) {
        notifiedJobsRef.current.add(notificationKey);
        const result = getDirectImportJobPresentation(nextJob);
        callbacksRef.current.onNotice?.(result.detail, ['completed', 'cancelled'].includes(nextJob.status) ? 'success' : 'error');
        if (nextJob.status === 'completed') callbacksRef.current.onCompleted?.(nextJob);
      }
    } catch (error) {
      if (mountedRef.current && storageKeyRef.current === requestStorageKey && actionSequence === jobActionSequenceRef.current) {
        setActionError(error.response?.data?.message || 'Unable to confirm cancellation. Checking the import status; try again if it is still running.');
      }
    } finally {
      if (mountedRef.current) setIsCancelling(false);
    }
  }

  if (!open) return null;

  const userFields = lookup ? [
    ['Employee ID', lookup.user.employee_id],
    ['Role', label(lookup.user.role)],
    ['Email', lookup.user.email],
    ['Department', lookup.user.office_department],
    ['Position', lookup.user.work_position],
    ['Approval', label(lookup.user.approval_status)],
  ] : [];

  return createPortal(
    <>
    <div className="fingerprint-modal-overlay" inert={Boolean(job)} aria-hidden={job ? true : undefined}>
      <section className="fingerprint-modal fingerprint-import-modal" role="dialog" aria-modal={job ? undefined : true} aria-labelledby="direct-import-title">
        <div className="fingerprint-modal-header">
          <div>
            <h3 id="direct-import-title">Import from database</h3>
            <p>Find an employee and import one of their saved fingerprints to Sensor A.</p>
          </div>
          <button type="button" className="fingerprint-modal-close" onClick={onClose} disabled={isQueueing || isCancelling} aria-label="Close import dialog">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form className="fingerprint-import-search" onSubmit={searchEmployee}>
          <label className="fingerprint-modal-field">
            <span>Employee ID</span>
            <input ref={inputRef} value={employeeId} onChange={event => changeEmployeeId(event.target.value)} placeholder="Enter employee ID" autoComplete="off" maxLength={80} disabled={activeJob || isQueueing || isCancelling} />
          </label>
          <button type="submit" className="fingerprint-secondary-action" disabled={isSearching || isQueueing || isCancelling || !employeeId.trim()}>
            <Search size={15} aria-hidden="true" />
            {isSearching ? 'Searching...' : 'Search'}
          </button>
        </form>

        {searchError && <p className="fingerprint-import-notice fingerprint-import-notice-error" role="alert"><CircleAlert size={17} aria-hidden="true" />{searchError}</p>}

        {lookup && <>
          <section className="fingerprint-import-user" aria-label="Matched employee">
            <div className="fingerprint-import-user-header">
              <h4>{lookup.user.full_name}</h4>
              <span className={`dashboard-log-status manage-users-status-${lookup.user.status}`}>{label(lookup.user.status)}</span>
            </div>
            <dl>{userFields.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value || 'Not provided'}</dd></div>)}</dl>
          </section>

          {backups.length === 0 ? <p className="fingerprint-import-empty"><Database size={18} aria-hidden="true" />No saved fingerprint backups were found for this employee. Enroll the fingerprint on Sensor A to create one.</p> : <fieldset className="fingerprint-import-backups" disabled={activeJob || isQueueing || isCancelling}>
            <legend className="fingerprint-import-section-title">Saved fingerprints</legend>
            {backups.map(backup => {
              const unavailable = getDirectImportBlockReason(lookup.user, backup);
              const selected = selectedId === String(backup.fingerprint_id);
              return <label className={`fingerprint-import-backup${selected ? ' is-selected' : ''}${unavailable ? ' is-disabled' : ''}`} key={backup.fingerprint_id}>
                <input type="radio" name="direct-import-backup" value={backup.fingerprint_id} checked={selected} onChange={() => { setSelectedId(String(backup.fingerprint_id)); setActionError(''); setJob(null); }} disabled={Boolean(unavailable)} />
                <span className="fingerprint-import-backup-copy">
                  <strong>{backup.finger_name || 'Unnamed finger'}</strong>
                  <small>Saved {backup.template_updated_at ? formatDateTimeInManila(backup.template_updated_at) : 'date not recorded'} · {Number(backup.template_bytes) || 0} bytes</small>
                  <small>Device {backup.enrollment_device_id || 'not assigned'} · Slot {backup.enrollment_slot || 'not assigned'} · {label(backup.status) || 'Status not recorded'}</small>
                  {unavailable && <small>{unavailable}</small>}
                </span>
              </label>;
            })}
          </fieldset>}
        </>}

        {!job && actionError && <p className="fingerprint-import-notice fingerprint-import-notice-error" role="alert"><CircleAlert size={17} aria-hidden="true" />{actionError}</p>}
        {!canImport && <p className="fingerprint-import-notice">Update Fingerprints permission is required to import a saved fingerprint.</p>}
        {!isLargeScreen && <p className="fingerprint-import-notice">Continue on a desktop or laptop to import a fingerprint to Sensor A.</p>}

        {!job && <div className="fingerprint-modal-actions">
          <button type="button" className="fingerprint-primary-action" onClick={queueImport} disabled={!canImport || !isLargeScreen || Boolean(queueBlockReason) || isQueueing || isCancelling || isSearching}>
            <Database size={15} aria-hidden="true" />
            {isQueueing ? 'Queueing import...' : 'Import to Sensor A'}
          </button>
        </div>}
      </section>
    </div>
    {job && <DirectFingerprintImportProgressModal
      job={job}
      canImport={canImport}
      isRetryDisabled={!canImport || !isLargeScreen || Boolean(queueBlockReason) || isSearching}
      isQueueing={isQueueing}
      isCancelling={isCancelling}
      actionError={actionError}
      pollError={pollError}
      onCancel={cancelImport}
      onRetry={queueImport}
      onClose={onClose}
      onStartOver={resetImportForm}
    />}
    </>,
    document.body,
  );
}
