import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SensorMemory from '../src/pages/superAdmin/SensorMemory';
import axiosClient from '../src/api/axiosClient';

// In-memory browser QA fixture. This adapter never contacts a backend or sensor.
const now = () => new Date().toISOString();
const bytes = Uint8Array.from({ length: 512 }, (_, index) => (index * 17 + 29) % 256);
const base64 = btoa(Array.from(bytes, (value) => String.fromCharCode(value)).join(''));
const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
const fixtureHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) => value.toString(16).padStart(2, '0')).join('');
let idCounter = 100;
let getCount = 0;
let postCount = 0;
let showAlternate = false;
let failNext = false;
let listeners = new Set();
const deviceState = new Map([[1, { inventory: null, active: null, jobs: new Map(), templates: new Map() }], [2, { inventory: null, active: null, jobs: new Map(), templates: new Map() }]]);
const notify = () => listeners.forEach((listener) => listener());
const record = (fingerprintId, userId, name, slotFinger = 'Right Index') => ({ fingerprint_id: fingerprintId, user_id: userId, full_name: name, employee_id: `EMP-${userId}`, finger_name: slotFinger, status: 'active', template_bytes: 512, template_hash: fixtureHash, backup_valid: true });
const devices = () => [{ device_id: 1, device_name: 'Sensor A', device_type: 'enrollment', status: 'active' }, ...(showAlternate ? [{ device_id: 2, device_name: 'Sensor B (fixture)', device_type: 'enrollment', status: 'active' }] : [])];

function rowsFor(deviceId) {
  const state = deviceState.get(deviceId);
  const records = deviceId === 1 ? new Map([[7, [record(7, 57, 'Maria Santos')]], [9, [record(9, 59, 'Luis Reyes', 'Left Thumb')]], [11, [record(11, 61, 'Ana Cruz'), record(12, 62, 'Paolo Lim', 'Right Middle')]]]) : new Map([[7, [record(21, 77, 'Alternate Sensor User')]]]);
  const occupied = state.inventory?.occupied_slots || [];
  const ids = [...new Set([...records.keys(), ...occupied])].sort((a, b) => a - b);
  return ids.map((slot) => {
    const database = records.get(slot) || [];
    const present = state.inventory ? occupied.includes(slot) : null;
    const sensorTemplate = state.templates.get(slot) || null;
    const mapping = database.length > 1 ? 'conflict' : present === null ? 'not_scanned' : present ? database.length ? 'mapped' : 'sensor_only' : 'database_only';
    const templateStatus = present === null ? 'not_scanned' : !present ? 'not_on_sensor' : sensorTemplate ? database.length > 1 ? 'conflict' : database.length ? 'match' : 'no_backup' : 'not_read';
    const templateJob = [...state.jobs.values()].filter((job) => job.kind === 'template' && job.target_slot === slot).at(-1) || null;
    return { slot_id: slot, sensor_present: present, database_records: database, mapping_status: mapping, template_status: templateStatus, sensor_template: sensorTemplate ? { ...sensorTemplate, template_data_base64: undefined, template_data_hex: undefined } : null, template_job: templateJob };
  });
}

axiosClient.defaults.adapter = async (config) => {
  await new Promise((resolve) => setTimeout(resolve, 70));
  if (config.signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ERR_CANCELED' });
  if (config.url !== '/api/fingerprint/sensor_memory.php') throw new Error('The fixture blocks all other requests.');
  const params = config.params || {};
  let result;
  if (config.method === 'get') {
    getCount += 1;
    const deviceId = Number(params.device_id || 1);
    const state = deviceState.get(deviceId);
    const rows = rowsFor(deviceId);
    const summary = { sensor_only: 0, database_only: 0, mapped: 0, conflict: 0, matches: 0, different: 0, not_read: 0, not_scanned: 0 };
    rows.forEach((row) => { summary[row.mapping_status] = (summary[row.mapping_status] || 0) + 1; if (row.template_status === 'match') summary.matches += 1; if (row.template_status === 'not_read') summary.not_read += 1; });
    result = { success: true, devices: devices(), device: devices().find((device) => device.device_id === deviceId), inventory: state.inventory, rows, summary, active_job: state.active && ['pending', 'processing'].includes(state.active.status) ? { ...state.active } : null, ...(params.job_id ? { job: { ...state.jobs.get(Number(params.job_id)) } } : {}), database_compared_at: now() };
    if (params.template_job_id) result.template = [...state.templates.values()].find((template) => template.job_id === Number(params.template_job_id));
  } else {
    postCount += 1;
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    const state = deviceState.get(Number(body.device_id));
    if (body.action === 'cancel') {
      const job = state.jobs.get(Number(body.job_id));
      job.status = 'cancelled'; job.error_message = 'Read cancelled from the Test fixture.'; job.finished_at = now();
      state.active = null;
      result = { success: true, job: { ...job } };
    } else {
      const job = { job_id: ++idCounter, kind: body.action === 'scan' ? 'inventory' : 'template', device_id: Number(body.device_id), inventory_id: body.inventory_id || null, target_slot: body.slot_id ?? null, status: 'pending', queued_at: now(), error_message: null };
      state.jobs.set(job.job_id, job); state.active = job;
      result = { success: true, job: { ...job } };
      if (failNext) {
        failNext = false;
        setTimeout(() => { job.status = 'failed'; job.error_message = 'Fixture: controller could not read the sensor. The previous completed inventory is preserved.'; job.finished_at = now(); if (state.active === job) state.active = null; notify(); }, 900);
      }
    }
  }
  notify();
  return { data: result, status: 200, statusText: 'OK', headers: {}, config };
};

function activeStates() { return [...deviceState.values()].filter((state) => state.active && ['pending', 'processing'].includes(state.active.status)); }
function completeInventory() {
  activeStates().forEach((state) => {
    const job = state.active;
    if (job.kind !== 'inventory') return;
    job.status = 'completed'; job.finished_at = now();
    state.inventory = { job_id: job.job_id, device_id: job.device_id, capacity: 1000, template_count: job.device_id === 1 ? 3 : 1, occupied_slots: job.device_id === 1 ? [0, 7, 11] : [7], captured_at: now(), received_at: now(), source: 'r307s' };
    state.templates.clear(); state.active = null;
  });
  notify();
}
function completeTemplate() {
  activeStates().forEach((state) => {
    const job = state.active;
    if (job.kind !== 'template') return;
    job.status = 'completed'; job.finished_at = now();
    state.templates.set(job.target_slot, { job_id: job.job_id, inventory_id: job.inventory_id, slot_id: job.target_slot, template_bytes: 512, template_hash: fixtureHash, template_valid: true, captured_at: now(), received_at: now(), source: 'r307s', template_data_base64: base64, template_data_hex: hex });
    state.active = null;
  });
  notify();
}

function Fixture() {
  const [, update] = useState(0);
  useEffect(() => { const listener = () => update((value) => value + 1); listeners.add(listener); return () => listeners.delete(listener); }, []);
  return <>
    <style>{`*{box-sizing:border-box}body{margin:0;background:#f2f5f3;font-family:Arial,sans-serif;color:#233b2e}.fixture-controls{padding:14px 24px;background:#fff9e6;border-bottom:1px solid #e6d69e;font-size:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.fixture-controls strong{color:#785a16}.fixture-controls button{padding:6px 9px;border:1px solid #cbbd8f;background:white;border-radius:4px;cursor:pointer;color:#5a4b24}.fixture-controls span{padding:0 6px}.fixture-note{padding:0 24px 10px;background:#fff9e6;font-size:11px;color:#7a6a41}@media(max-width:700px){.sensor-memory-page{padding:16px}.fixture-controls{padding:10px 16px}.fixture-note{padding:0 16px 10px}}`}</style>
    <div className="fixture-controls"><strong>Test fixture — simulated data only</strong><span>GET count: {getCount} · POST count: {postCount}</span><button onClick={() => { activeStates().forEach((state) => { state.active.status = 'processing'; state.active.processing_at = now(); }); notify(); }}>Mark processing</button><button onClick={completeInventory}>Complete inventory</button><button onClick={completeTemplate}>Complete template (match)</button><button onClick={() => { failNext = !failNext; notify(); }}>Fail next read{failNext ? ' (armed)' : ''}</button><button onClick={() => { showAlternate = !showAlternate; notify(); document.dispatchEvent(new Event('visibilitychange')); }}>Toggle alternate device{showAlternate ? ' (shown)' : ''}</button><button onClick={() => document.dispatchEvent(new Event('visibilitychange'))}>Refresh fixture data</button></div>
    <div className="fixture-note">No network or physical sensor requests. Use the module’s Read sensor / Read template buttons first, then the fixture completion controls. Pending reads poll every 2 seconds; idle comparisons every 10 seconds.</div>
    <SensorMemory user={{ id: 1, role: 'super_admin', username: 'Fixture Admin' }} />
  </>;
}

createRoot(document.getElementById('root')).render(<Fixture />);
