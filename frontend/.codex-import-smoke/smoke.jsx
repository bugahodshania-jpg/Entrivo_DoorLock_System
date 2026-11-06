import React from 'react';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import { ActionConfirmProvider } from '../src/components/ActionConfirm.jsx';
import DirectFingerprint from '../src/pages/superAdmin/DirectFingerprint.jsx';
import DirectFingerprintImportModal from '../src/components/DirectFingerprintImportModal.jsx';
import DirectFingerprintImportProgressModal from '../src/components/DirectFingerprintImportProgressModal.jsx';

const progressOverlay = '<div class="fingerprint-modal-overlay fingerprint-import-progress-overlay">';

function verifyProgressInFront(markup) {
  const layers = markup.split(progressOverlay);
  assert.equal(layers.length, 2, 'Exactly one progress overlay must follow the import form.');
  const [form, progress] = layers;
  assert.match(form, /class="fingerprint-modal-overlay" inert="" aria-hidden="true"/);
  assert.match(form, /aria-labelledby="direct-import-title"/);
  assert.doesNotMatch(form, /aria-modal="true"|Sensor A import progress|Cancel Import/);
  assert.match(form, /<\/section><\/div>$/);
  assert.match(progress, /role="dialog" aria-modal="true" aria-labelledby="direct-import-progress-title"/);
  assert.match(progress, /aria-label="Sensor A import progress"/);
  assert.match(progress, /role="progressbar"/);
  assert.equal((markup.match(/role="dialog"/g) || []).length, 2);
  assert.equal((markup.match(/aria-modal="true"/g) || []).length, 1);
}

const user = { id: 9001, role: 'super_admin', username: 'Preview Admin' };
globalThis.document = { body: {} };
for (const large of [true, false]) {
  globalThis.window = {
    matchMedia: () => ({ matches: large }), sessionStorage: { getItem: () => null },
    location: { pathname: '/super-admin/fingerprint-direct', search: '', origin: 'http://preview.invalid' },
  };
  const page = renderToString(<ActionConfirmProvider user={user}><DirectFingerprint user={user} /></ActionConfirmProvider>);
  assert.match(page, /Fingerprints \(Direct\)/);
  assert.equal(page.includes('Import from database'), large);
  assert.doesNotMatch(page, /Sensor B|Sync Jobs|Upload Raw Template/);
  const modal = renderToString(<ActionConfirmProvider user={user}><DirectFingerprintImportModal open currentUser={user} canImport isLargeScreen={large} /></ActionConfirmProvider>);
  assert.match(modal, /Import from database/);
  assert.match(modal, /Employee ID/);
  assert.match(modal, /Close import dialog/);
  assert.match(modal, /Import to Sensor A/);
  assert.doesNotMatch(modal, /type="file"|template_data_base64/);
  assert.doesNotMatch(modal, /Cancel Import/);
  assert.doesNotMatch(modal, /fingerprint-import-progress-overlay/);
  assert.equal((modal.match(/role="dialog"/g) || []).length, 1);

  window.sessionStorage.getItem = key => key === `entrivo_direct_import_job:${user.id}`
    ? JSON.stringify({ job_id: 42, employee_id: '000001-000001' }) : null;
  const running = renderToString(<ActionConfirmProvider user={user}><DirectFingerprintImportModal open currentUser={user} canImport isLargeScreen={large} /></ActionConfirmProvider>);
  assert.match(running, /Job #(?:<!-- -->)?42/);
  assert.doesNotMatch(running, /Import in progress|Import to Sensor A/);
  assert.match(running, /<button[^>]*class="fingerprint-secondary-action fingerprint-danger-action"[^>]*>.*Cancel Import<\/button>/);
  const cancelButton = running.match(/<button[^>]*class="fingerprint-secondary-action fingerprint-danger-action"[^>]*>/)?.[0];
  assert.doesNotMatch(cancelButton, /disabled/);
  verifyProgressInFront(running);

  const readOnly = renderToString(<ActionConfirmProvider user={user}><DirectFingerprintImportModal open currentUser={user} canImport={false} isLargeScreen={large} /></ActionConfirmProvider>);
  assert.match(readOnly, /Job #(?:<!-- -->)?42/);
  assert.doesNotMatch(readOnly, /Cancel Import/);
  assert.doesNotMatch(readOnly, /Import in progress|Import to Sensor A/);
  verifyProgressInFront(readOnly);
  const closed = renderToString(<ActionConfirmProvider user={user}><DirectFingerprintImportModal open={false} currentUser={user} canImport isLargeScreen={large} /></ActionConfirmProvider>);
  assert.doesNotMatch(closed, /Cancel Import/);
  assert.doesNotMatch(closed, /fingerprint-import-progress-overlay|role="dialog"/);
}

const job = { job_id: 42, status: 'pending', progress: 66, employee_id: '000001-000001', user_name: 'Preview Admin', finger_name: 'Left Thumb', assigned_slot: 31 };
const handlers = { onCancel() {}, onRetry() {}, onClose() {}, onStartOver() {} };
function renderProgress(changes = {}, props = {}) {
  return renderToString(<DirectFingerprintImportProgressModal job={{ ...job, ...changes }} canImport isRetryDisabled={false} isQueueing={false} isCancelling={false} {...handlers} {...props} />);
}

for (const [status, title] of [['pending', 'Waiting for Sensor A'], ['processing', 'Writing to Sensor A'], ['cancelled', 'Import cancelled'], ['completed', 'Import complete'], ['failed', 'Import failed']]) {
  const progress = renderProgress({ status });
  assert.match(progress, new RegExp(`<strong role="status">${title}</strong>`));
  assert.match(progress, /role="progressbar"/);
  assert.match(progress, new RegExp(`aria-valuenow="${status === 'completed' ? 100 : 66}"`));
  assert.equal(progress.includes('Cancel Import'), ['pending', 'processing'].includes(status));
  assert.equal(progress.includes('Retry</button>'), status === 'cancelled');
  assert.equal(progress.includes('Back to search'), ['completed', 'failed'].includes(status));
  assert.doesNotMatch(progress, /Import in progress|Import to Sensor A/);
}

assert.doesNotMatch(renderProgress({}, { canImport: false }), /Cancel Import/);
for (const props of [{ canImport: false }, { isRetryDisabled: true }, { isCancelling: true }, { isQueueing: true }]) {
  const progress = renderProgress({ status: 'cancelled' }, props);
  assert.match(progress, /class="fingerprint-primary-action" disabled=""/);
}
assert.match(renderProgress({ status: 'cancelled' }, { isQueueing: true }), /Retrying\.\.\./);
const errors = renderProgress({}, { pollError: 'Preview poll failed.', actionError: 'Preview cancellation failed.' });
assert.match(errors, /role="dialog"/);
assert.match(errors, /role="alert"[^>]*>.*Preview poll failed\./);
assert.match(errors, /role="alert"[^>]*>.*Preview cancellation failed\./);
console.log('Import form and separate front progress modal render on desktop/mobile; dialog layering, status actions, permissions, busy states, progress, and errors pass.');
