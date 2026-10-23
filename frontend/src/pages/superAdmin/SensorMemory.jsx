import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, CheckCircle2, ChevronDown, Clock3, Database, Download, Eye, Fingerprint, HardDrive, RefreshCw, Search, Trash2, X } from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import { useActionConfirm } from '../../components/ActionConfirm';
import RowActionMenu from '../../components/RowActionMenu';
import { useDoorStatus } from '../../hooks/useDoorStatus';
import { formatDateTimeInManila } from '../../utils/dateTime';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/rfid.css';
import '../../styles/superAdmin/sensorMemory.css';

const endpoint = '/api/fingerprint/sensor_memory.php';
const pageSize = 10;
const mappingLabels = { sensor_only: 'Sensor only', database_only: 'Database only', mapped: 'Mapped', conflict: 'Conflict' };
const templateLabels = { not_scanned: 'Read sensor first', not_read: 'Not read', match: 'Matches backup', different: 'Different from backup', no_backup: 'No database backup', conflict: 'Multiple database records', not_on_sensor: 'Not on sensor', invalid_sensor_template: 'Invalid sensor template' };
const isActive = (job) => job && ['pending', 'processing'].includes(job.status);
const errorText = (error, fallback) => error?.response?.data?.message || (error?.code === 'ECONNABORTED' ? 'The server took too long to respond. Retrying automatically.' : fallback);

function SensorMemoryFilter({ label, value, options, disabled = false, onChange }) {
  const menuId = useId();
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex] || options[0];

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOutside = (event) => {
      if (!containerRef.current?.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) document.getElementById(`${menuId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen, menuId]);

  useEffect(() => {
    if (disabled) setIsOpen(false);
    setActiveIndex((index) => Math.min(index, Math.max(0, options.length - 1)));
  }, [disabled, options.length]);

  function openMenu() {
    setActiveIndex(Math.max(0, selectedIndex));
    setIsOpen(true);
  }

  function choose(index) {
    if (!options[index]) return;
    onChange(options[index].value);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) openMenu();
      else setActiveIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if ((event.key === 'Home' || event.key === 'End') && isOpen) {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isOpen) choose(activeIndex);
      else openMenu();
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
    } else if (event.key === 'Tab') setIsOpen(false);
  }

  return (
    <div className="manage-users-role-tabs manage-users-status-filter sensor-memory-filter" ref={containerRef} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}>
      <button ref={triggerRef} type="button" role="combobox" className={`manage-users-role-tab-trigger${isOpen && !disabled ? ' is-open' : ''}`} aria-label={label} aria-haspopup="listbox" aria-expanded={isOpen && !disabled} aria-controls={menuId} aria-activedescendant={isOpen && !disabled ? `${menuId}-${activeIndex}` : undefined} disabled={disabled} onKeyDown={handleKeyDown} onClick={() => (isOpen ? setIsOpen(false) : openMenu())}>
        <span className="manage-users-role-tab-trigger-label">{selected?.label}</span>
        {selected?.count != null ? <span className="manage-users-role-tab-count">{selected.count}</span> : null}
        <ChevronDown className="manage-users-role-tab-chevron" size={14} aria-hidden="true" />
      </button>
      {isOpen && !disabled ? (
        <div id={menuId} className="manage-users-role-tab-menu" role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <button key={option.value} id={`${menuId}-${index}`} type="button" role="option" tabIndex={-1} className={`manage-users-role-tab-option${option.value === value ? ' is-active' : ''}${activeIndex === index ? ' is-focused' : ''}`} aria-selected={option.value === value} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(index)}>
              <Check className="manage-users-role-tab-check" size={15} aria-hidden="true" />
              <span className="manage-users-role-tab-option-label">{option.label}</span>
              {option.count != null ? <span className="manage-users-role-tab-count">{option.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function downloadTemplate(template, deviceId, format) {
  const filename = `r307s-device-${deviceId}-slot-${template.slot_id}`;
  let blob;
  if (format === 'bin') {
    const bytes = Uint8Array.from(atob(template.template_data_base64), (character) => character.charCodeAt(0));
    blob = new Blob([bytes], { type: 'application/octet-stream' });
  } else {
    blob = new Blob([JSON.stringify({ ...template, device_id: Number(deviceId), source: 'r307s' }, null, 2)], { type: 'application/json' });
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filename}.${format}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DetailField({ label, children, wide = false }) {
  return <div className={wide ? 'is-wide' : undefined}><dt>{label}</dt><dd>{children ?? '—'}</dd></div>;
}

function SlotModal({ row, inventory, deviceId, template, loadingTemplate, templateError, activeJob, onReadTemplate, onClose, busy, door }) {
  const modalRef = useRef(null);
  const closeRef = useRef(null);
  const [rawFormat, setRawFormat] = useState('hex');
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const fields = [...(modalRef.current?.querySelectorAll('button:not(:disabled), select, textarea, [tabindex="0"]') || [])];
      const first = fields[0];
      const last = fields.at(-1);
      if (event.shiftKey && (document.activeElement === first || !modalRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !modalRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      if (trigger?.isConnected) trigger.focus();
    };
  }, [onClose]);

  const readingThisSlot = isActive(activeJob) && activeJob.kind === 'template' && Number(activeJob.target_slot) === Number(row.slot_id);
  const actualTemplate = row.sensor_template;
  return createPortal(
    <div className="pending-registration-review-backdrop" role="presentation" onClick={onClose}>
      <section className="pending-registration-review sensor-memory-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="sensor-slot-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><h2 id="sensor-slot-title">View Sensor Slot {row.slot_id}</h2><p>Physical sensor contents and the corresponding database records.</p></div>
          <button ref={closeRef} type="button" aria-label="Close sensor slot view" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="pending-registration-review-body">
          <section className="pending-registration-review-card">
            <h3>R307S Sensor</h3>
            <dl>
              <DetailField label="Slot ID">{row.slot_id}</DetailField>
              <DetailField label="Sensor presence">{inventory ? (row.sensor_present ? 'Occupied at last sensor read' : 'Not found at last sensor read') : 'Not read yet'}</DetailField>
              <DetailField label="Device">Device {deviceId}</DetailField>
              <DetailField label={inventory?.captured_at ? 'Sensor read (Asia/Manila)' : 'Result received (Asia/Manila)'}>{formatDateTimeInManila(inventory?.captured_at || inventory?.received_at)}</DetailField>
              <DetailField label="Database mapping" wide><span className={`sensor-memory-badge is-${row.mapping_status}`}>{mappingLabels[row.mapping_status] || 'Read sensor first'}</span></DetailField>
            </dl>
          </section>
          <section className="pending-registration-review-card">
            <h3>Database Records</h3>
            {row.database_records?.length ? row.database_records.map((record) => (
              <dl key={record.fingerprint_id} className="sensor-memory-db-record">
                <DetailField label="User">{record.full_name || 'Unknown user'}</DetailField>
                <DetailField label="Employee ID">{record.employee_id || '—'}</DetailField>
                <DetailField label="Finger name">{record.finger_name || '—'}</DetailField>
                <DetailField label="Record status">{record.status || '—'}</DetailField>
                <DetailField label="Fingerprint record ID">{record.fingerprint_id}</DetailField>
                <DetailField label="Backup size">{record.backup_valid ? `${record.template_bytes} bytes` : 'No valid backup'}</DetailField>
                <DetailField label="Database template SHA-256" wide><code>{record.template_hash || 'No valid backup'}</code></DetailField>
              </dl>
            )) : <p className="sensor-memory-card-note">No database record is mapped to this sensor slot.</p>}
          </section>
          <section className="pending-registration-review-card">
            <h3>Actual Sensor Template</h3>
            <dl>
              <DetailField label="Template comparison" wide><span className={`sensor-memory-badge is-${row.template_status}`}>{inventory ? (templateLabels[row.template_status] || 'Not read') : 'Read sensor first'}</span></DetailField>
              <DetailField label="Actual template size">{actualTemplate ? `${actualTemplate.template_bytes} bytes` : 'Not read yet'}</DetailField>
              <DetailField label={actualTemplate?.captured_at ? 'Template read (Asia/Manila)' : 'Result received (Asia/Manila)'}>{formatDateTimeInManila(actualTemplate?.captured_at || actualTemplate?.received_at)}</DetailField>
              <DetailField label="Actual sensor template SHA-256" wide><code>{actualTemplate?.template_hash || 'Not read yet'}</code></DetailField>
            </dl>
            <div className="sensor-memory-template-actions">
              <p>Read this slot directly from the R307S to compare its template bytes with the database backup. The sensor holds binary fingerprint features, not a fingerprint image.</p>
              {actualTemplate?.template_valid === false ? <span className="sensor-memory-inline-error">The sensor returned uniform or invalid template data. The original bytes are preserved below for inspection.</span> : null}
              <button type="button" className="sensor-memory-button is-primary" disabled={!inventory || !row.sensor_present || busy || isActive(activeJob) || !door.canReadSensor} title={door.readBlockedReason || undefined} onClick={() => onReadTemplate(row.slot_id)}><Fingerprint size={15} />{readingThisSlot ? 'Reading template…' : actualTemplate ? 'Read template again' : 'Read template'}</button>
              {door.readBlockedReason ? <span className="sensor-memory-help" role="status">{door.readBlockedReason}</span> : null}
              {readingThisSlot ? <span className="sensor-memory-help" role="status">{activeJob.status === 'pending' ? 'Waiting for the controller…' : 'Reading this slot from the sensor…'}</span> : null}
              {!inventory ? <span className="sensor-memory-help">Read the sensor first to confirm which slots are occupied.</span> : !row.sensor_present ? <span className="sensor-memory-help">This slot was not occupied in the last sensor read.</span> : null}
              {templateError ? <span className="sensor-memory-inline-error" role="alert">{templateError}</span> : null}
              {loadingTemplate ? <span className="sensor-memory-help" role="status">Loading the recorded sensor template…</span> : null}
              {template?.template_data_base64 ? (
                <div className="sensor-memory-raw-controls">
                  <div className="sensor-memory-actions">
                    <button type="button" className="sensor-memory-button" onClick={() => setShowRaw((value) => !value)}><Eye size={14} />{showRaw ? 'Hide template data' : 'View template data'}</button>
                    <button type="button" className="sensor-memory-button" onClick={() => downloadTemplate(template, deviceId, 'bin')}><Download size={14} />Download binary</button>
                    <button type="button" className="sensor-memory-button" onClick={() => downloadTemplate(template, deviceId, 'json')}><Download size={14} />Download JSON</button>
                  </div>
                  {showRaw ? <div className="sensor-memory-raw"><label htmlFor="sensor-template-format">Template format<select id="sensor-template-format" value={rawFormat} onChange={(event) => setRawFormat(event.target.value)}><option value="hex">Hex</option><option value="base64">Base64</option></select></label><textarea aria-label={`Actual R307S template in ${rawFormat}`} value={rawFormat === 'hex' ? template.template_data_hex || '' : template.template_data_base64} readOnly rows={6} spellCheck={false} /></div> : null}
                  <small>Source: physical R307S sensor · {template.captured_at ? 'Read' : 'Received'} {formatDateTimeInManila(template.captured_at || template.received_at)}</small>
                </div>
              ) : null}
            </div>
          </section>
        </div>
        <footer><span className="sensor-memory-help">Read-only sensor inspection</span><button type="button" className="sensor-memory-button" onClick={onClose}>Close</button></footer>
      </section>
    </div>, document.body,
  );
}

export default function SensorMemory({ user: currentUser } = {}) {
  const confirmAction = useActionConfirm();
  const actorId = currentUser?.id;
  const [deviceId, setDeviceId] = useState('');
  const door = useDoorStatus(deviceId);
  const selectDoor = door.selectDoor;
  useEffect(() => { if (deviceId) selectDoor?.(deviceId); }, [deviceId, selectDoor]);
  const [data, setData] = useState(null);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [template, setTemplate] = useState(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const scopeRef = useRef(0);
  const jobRef = useRef(null);
  const refreshRef = useRef(null);
  const mutationControllerRef = useRef(null);
  const closeModal = useCallback(() => setSelectedSlot(null), []);

  useEffect(() => {
    const scope = ++scopeRef.current;
    let disposed = false;
    let timer;
    let controller;
    let inflight = false;
    let rerun = false;
    let requestVersion = 0;
    jobRef.current = null;
    setData(null); setJob(null); setError(''); setLoading(true); setBusy(false);
    setSelectedSlot(null); setTemplate(null); setLastUpdated(null);
    mutationControllerRef.current?.abort();

    async function refresh() {
      if (disposed || document.visibilityState === 'hidden') return;
      if (inflight) { rerun = true; return; }
      clearTimeout(timer);
      inflight = true;
      const version = requestVersion;
      controller = new AbortController();
      try {
        const response = await axiosClient.get(endpoint, {
          params: { actor_id: actorId, ...(deviceId ? { device_id: deviceId } : {}), ...(jobRef.current?.job_id ? { job_id: jobRef.current.job_id } : {}) },
          signal: controller.signal, timeout: 10000,
        });
        if (disposed || scope !== scopeRef.current || version !== requestVersion) return;
        if (!response.data?.success) throw new Error(response.data?.message || 'Unable to load sensor memory.');
        setData(response.data);
        const nextJob = response.data.active_job || response.data.job || null;
        jobRef.current = nextJob;
        setJob(nextJob);
        setLastUpdated(response.data.database_compared_at || new Date());
        setError('');
        const devices = response.data.devices || [];
        if (devices.length && !devices.some((device) => String(device.device_id) === deviceId)) setDeviceId(String((devices.find((device) => Number(device.device_id) === 1) || devices[0]).device_id));
      } catch (requestError) {
        if (!disposed && scope === scopeRef.current && version === requestVersion && requestError.code !== 'ERR_CANCELED') setError(errorText(requestError, requestError.isAxiosError ? 'Unable to load sensor memory. Retrying automatically.' : requestError.message || 'Unable to load sensor memory. Retrying automatically.'));
      } finally {
        inflight = false;
        if (!disposed) {
          setLoading(false);
          timer = setTimeout(refresh, rerun ? 0 : isActive(jobRef.current) ? 2000 : 10000);
          rerun = false;
        }
      }
    }

    refreshRef.current = ({ invalidate = false } = {}) => {
      if (invalidate) requestVersion += 1;
      refresh();
    };
    const onVisible = () => { if (document.visibilityState !== 'hidden') refresh(); else { clearTimeout(timer); controller?.abort(); } };
    document.addEventListener('visibilitychange', onVisible);
    refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      mutationControllerRef.current?.abort();
      document.removeEventListener('visibilitychange', onVisible);
      refreshRef.current = null;
    };
  }, [actorId, deviceId]);

  const inventory = data?.inventory;
  const rows = data?.rows || [];
  const selectedRow = selectedSlot == null ? null : rows.find((row) => Number(row.slot_id) === Number(selectedSlot));
  const templateJobId = selectedRow?.sensor_template?.job_id;
  useEffect(() => {
    setTemplate(null); setTemplateError(''); setLoadingTemplate(false);
    if (selectedSlot == null || !templateJobId) return undefined;
    const controller = new AbortController();
    let disposed = false;
    setLoadingTemplate(true);
    axiosClient.get(endpoint, { params: { actor_id: actorId, device_id: deviceId, template_job_id: templateJobId }, signal: controller.signal, timeout: 10000 })
      .then((response) => {
        if (disposed) return;
        if (!response.data?.success || !response.data.template) throw new Error(response.data?.message || 'Unable to load template data.');
        setTemplate(response.data.template);
      })
      .catch((requestError) => { if (!disposed && requestError.code !== 'ERR_CANCELED') setTemplateError(errorText(requestError, 'Unable to load template data. Close and reopen this slot to retry.')); })
      .finally(() => { if (!disposed) setLoadingTemplate(false); });
    return () => { disposed = true; controller.abort(); };
  }, [actorId, deviceId, selectedSlot, templateJobId]);

  async function eraseSensorTemplates() {
    if (busy || isActive(job) || !door.canReadSensor) {
      if (!door.canReadSensor) setError(door.readBlockedReason);
      return;
    }
    const confirmed = await confirmAction({
      title: 'Erase all R307S fingerprints',
      message: 'This deletes every fingerprint template and slot ID stored in the selected R307S. Keep the door locked until the controller finishes. Your account password is required.',
      confirmLabel: 'Erase sensor',
      danger: true,
    });
    if (!confirmed) return;
    await performAction('empty_sensor');
  }

  async function performAction(action, slotId) {
    if (busy || (action !== 'cancel' && isActive(job))) return;
    if (action !== 'cancel' && !door.canReadSensor) { setError(door.readBlockedReason); return; }
    const scope = scopeRef.current;
    const controller = new AbortController();
    mutationControllerRef.current = controller;
    setBusy(true); setError('');
    try {
      const response = await axiosClient.post(endpoint, {
        action, actor_id: actorId, device_id: Number(deviceId),
        ...(action === 'read_template' ? { inventory_id: inventory?.job_id, slot_id: Number(slotId) } : {}),
        ...(action === 'cancel' ? { job_id: job?.job_id } : {}),
      }, { signal: controller.signal, timeout: 10000 });
      if (scope !== scopeRef.current) return;
      if (!response.data?.success) throw new Error(response.data?.message || 'Unable to request a sensor read.');
      if (response.data.job) { jobRef.current = response.data.job; setJob(response.data.job); }
      refreshRef.current?.({ invalidate: true });
    } catch (requestError) {
      if (scope === scopeRef.current && requestError.code !== 'ERR_CANCELED') {
        setError(errorText(requestError, requestError.message || 'Unable to request a sensor read.'));
        refreshRef.current?.({ invalidate: true });
      }
    } finally { if (scope === scopeRef.current) setBusy(false); }
  }

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => (filter === 'all' || row.mapping_status === filter) && (!query || [row.slot_id, mappingLabels[row.mapping_status], ...(row.database_records || []).flatMap((record) => [record.full_name, record.employee_id, record.finger_name])].some((value) => String(value ?? '').toLowerCase().includes(query))));
  }, [rows, filter, search]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => setPage(1), [search, filter, deviceId]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  const active = isActive(job);
  const terminalError = job && ['failed', 'cancelled'].includes(job.status);
  const deviceName = data?.device?.device_name || (deviceId ? `Device ${deviceId}` : 'Fingerprint sensor');
  const missingCount = Number(data?.summary?.sensor_only || 0) + Number(data?.summary?.database_only || 0) + Number(data?.summary?.conflict || 0);
  const summaryCards = [
    { label: 'Occupied Sensor Slots', value: inventory?.template_count ?? '—', detail: inventory ? `Capacity: ${inventory.capacity} slots` : 'Read the physical sensor first', icon: HardDrive },
    { label: 'Database Mappings', value: data ? rows.filter((row) => row.database_records?.length).length : '—', detail: 'Slots linked to database records', icon: Database },
    { label: 'Mapping Differences', value: inventory ? missingCount : '—', detail: 'Sensor only, database only or conflict', icon: AlertCircle },
  ];

  return (
    <main className="admin-dashboard sensor-memory-page" aria-label="Sensor memory">
      <section className="sensor-memory-summary" aria-label="Sensor memory summary">
        {summaryCards.map(({ label, value, detail, icon: Icon }) => <article className="dashboard-summary-card" key={label}><div className="dashboard-summary-icon"><Icon size={26} aria-hidden="true" /></div><div className="dashboard-summary-copy"><span className="dashboard-summary-label">{label}</span><strong>{loading ? '—' : value}</strong><small>{detail}</small></div></article>)}
      </section>
      <section className="dashboard-recent-card sensor-memory-card">
        <div className="dashboard-panel-header sensor-memory-header">
          <div><h1>Sensor Memory</h1><p>See the actual occupied slots on the R307S and compare them with the database.</p></div>
          <div className="sensor-memory-actions">
            <button className="sensor-memory-button is-danger" type="button" onClick={eraseSensorTemplates} title={door.readBlockedReason || 'Delete every fingerprint template and slot ID on this R307S'} disabled={loading || busy || active || !actorId || !deviceId || !data?.device || !door.canReadSensor}><Trash2 size={15} />{active && job.kind === 'empty' ? 'Erasing sensor…' : 'Erase sensor templates'}</button>
            <button className="sensor-memory-button is-primary" type="button" onClick={() => performAction('scan')} title={door.readBlockedReason || undefined} disabled={loading || busy || active || !actorId || !deviceId || !data?.device || !door.canReadSensor}><RefreshCw size={15} className={active && job.kind === 'inventory' ? 'sensor-memory-spin' : undefined} />{active && job.kind === 'inventory' ? 'Reading sensor…' : 'Read sensor'}</button>
          </div>
        </div>

        {door.readBlockedReason ? <div className="sensor-memory-notice" role="status"><AlertCircle size={17} /><span>{door.readBlockedReason}</span></div> : null}
        {error ? <div className="sensor-memory-notice is-error" role="alert"><AlertCircle size={17} /><span>{error}</span></div> : null}
        {active ? <div className="sensor-memory-notice" role="status" aria-live="polite"><Clock3 size={18} /><div><strong>{job.status === 'pending' ? 'Waiting for the controller' : job.kind === 'empty' ? 'Erasing every R307S fingerprint' : job.kind === 'template' ? `Reading template from slot ${job.target_slot}` : 'Reading the R307S sensor'}</strong><p>{job.kind === 'empty' ? 'The controller is deleting every fingerprint template and slot ID. Keep the door locked and the controller powered on.' : job.status === 'pending' ? `${deviceName} will read the sensor when its controller connects. Keep the controller powered on with the updated firmware.` : 'Results appear here automatically when the sensor read finishes.'}{inventory && job.kind !== 'empty' ? ' The previous sensor read remains visible below.' : ''}</p></div><button className="sensor-memory-button" type="button" disabled={busy} onClick={() => performAction('cancel')}>{job.kind === 'empty' ? 'Cancel erase' : 'Cancel read'}</button></div> : terminalError ? <div className="sensor-memory-notice is-warning" role="status"><AlertCircle size={18} /><div><strong>{job.status === 'cancelled' ? (job.kind === 'empty' ? 'Sensor erase cancelled' : 'Sensor read cancelled') : (job.kind === 'empty' ? 'Sensor erase could not finish' : 'Sensor read could not finish')}</strong><p>{job.error_message || 'Try again when the controller is connected.'}{inventory ? ' The last completed sensor read is still shown.' : ''}</p></div></div> : null}

        <div className={`sensor-memory-snapshot ${inventory ? '' : 'is-empty'}`}>
          {inventory ? <><CheckCircle2 size={17} /><div><strong>{inventory.captured_at ? 'Last sensor read' : 'Last sensor result received'}: {formatDateTimeInManila(inventory.captured_at || inventory.received_at)}</strong><p>Physical R307S · {deviceName} · Asia/Manila. This is a saved reading; use Read sensor to check for changes.</p></div></> : <><Fingerprint size={22} /><div><strong>{loading ? 'Loading sensor memory…' : data && !data.devices?.length ? 'No fingerprint sensor configured' : 'No completed sensor read yet'}</strong><p>Connect the ESP32 with the updated firmware, then select Read sensor. Database records alone cannot confirm what is stored on the R307S.</p></div></>}
        </div>

        <div className="sensor-memory-toolbar">
          <SensorMemoryFilter label="Filter mapping status" value={filter} options={[{ value: 'all', label: 'All mappings', count: loading ? '—' : rows.length }, ...Object.entries(mappingLabels).map(([value, label]) => ({ value, label, count: loading ? '—' : rows.filter((row) => row.mapping_status === value).length }))]} onChange={setFilter} />
          <label className="manage-users-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search sensor slots" placeholder="Search slot, user or finger…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        </div>
        <div className="sensor-memory-table-scroll">
          <table className="sensor-memory-table">
            <thead><tr>{['Slot ID', 'R307S Sensor', 'Database User', 'Finger Name', 'Mapping', 'Template', 'Action'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{pageRows.length ? pageRows.map((row) => <tr key={row.slot_id}><td><strong className="sensor-memory-slot">{row.slot_id}</strong></td><td><span className={`sensor-memory-presence ${inventory && row.sensor_present ? 'is-present' : ''}`}><i />{inventory ? (row.sensor_present ? 'Occupied' : 'Not found') : 'Not read'}</span></td><td>{row.database_records?.length ? row.database_records.map((record) => <div className="sensor-memory-user" key={record.fingerprint_id}><strong>{record.full_name || 'Unknown user'}</strong><small>{record.employee_id || `User #${record.user_id}`}</small></div>) : <span className="sensor-memory-muted">No database record</span>}</td><td>{row.database_records?.length ? row.database_records.map((record) => <div className="sensor-memory-finger" key={record.fingerprint_id}>{record.finger_name || '—'}</div>) : '—'}</td><td>{inventory ? <span className={`sensor-memory-badge is-${row.mapping_status}`}>{mappingLabels[row.mapping_status] || 'Not checked'}</span> : <span className="sensor-memory-muted">Read sensor first</span>}</td><td><span className={`sensor-memory-badge is-${row.template_status}`}>{inventory ? (templateLabels[row.template_status] || 'Not read') : 'Not checked'}</span></td><td><RowActionMenu label={`Actions for sensor slot ${row.slot_id}`} items={[{ label: 'View', icon: Eye, onClick: () => setSelectedSlot(row.slot_id) }]} /></td></tr>) : <tr><td colSpan={7}><div className="sensor-memory-empty"><HardDrive size={28} /><strong>{loading ? 'Loading sensor memory…' : search || filter !== 'all' ? 'No slots match your filters.' : inventory ? 'No occupied or database-mapped slots.' : 'Read the sensor to view its occupied slots.'}</strong><p>{inventory && !search && filter === 'all' ? 'This sensor read contains no occupied slots and there are no mapped database records.' : 'Slot IDs include templates with no registered database user.'}</p></div></td></tr>}</tbody>
          </table>
        </div>
        <div className="manage-users-pagination sensor-memory-pagination"><p>{filteredRows.length ? `Showing ${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filteredRows.length)} of ${filteredRows.length} slots` : '0 slots'}{lastUpdated ? <small>Comparison updated {formatDateTimeInManila(lastUpdated)}</small> : null}</p><div className="manage-users-pagination-controls"><button type="button" disabled={safePage === 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {safePage} of {pageCount}</span><button type="button" disabled={safePage === pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
        <p className="sensor-memory-footnote">Mapped means a database record uses this slot ID. A template matches only after its actual sensor bytes have been read and compared with a valid database backup.</p>
      </section>
      {selectedRow ? <SlotModal key={`${deviceId}:${selectedRow.slot_id}`} row={selectedRow} inventory={inventory} deviceId={deviceId} template={template?.job_id === templateJobId ? template : null} loadingTemplate={loadingTemplate} templateError={templateError} activeJob={job} onReadTemplate={(slotId) => performAction('read_template', slotId)} onClose={closeModal} busy={busy} door={door} /> : null}
    </main>
  );
}
