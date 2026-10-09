import test from 'node:test';
import assert from 'node:assert/strict';
import { clearRegistrationOutsidePage, registrationResumeAction, registrationDraftKey, verifiedRfidKey } from '../src/utils/registrationSession.js';

function fixture() {
  const data = new Map([
    [registrationDraftKey, JSON.stringify({ step: 2, form: { rfid_uid: 'ABCD12345', first_name: 'Student' } })],
    [verifiedRfidKey, 'ABCD12345'],
    ['entrivo_user', 'existing-login'],
  ]);
  return { getItem: (key) => data.get(key) ?? null, removeItem: (key) => data.delete(key), setItem: (key, value) => data.set(key, value) };
}

test('staying on registration, including a refresh, preserves the draft and UID', () => {
  const storage = fixture();
  clearRegistrationOutsidePage('/register', storage);
  assert.ok(storage.getItem(registrationDraftKey));
  assert.equal(storage.getItem(verifiedRfidKey), 'ABCD12345');
  assert.equal(registrationResumeAction(storage, 'ABCD12345'), null);
});

test('Home and Login clear registration data and require UID verification on Back', () => {
  for (const path of ['/', '/login']) {
    const storage = fixture();
    clearRegistrationOutsidePage(path, storage);
    assert.equal(storage.getItem(registrationDraftKey), null);
    assert.equal(storage.getItem(verifiedRfidKey), null);
    assert.equal(storage.getItem('entrivo_user'), 'existing-login');
    assert.equal(registrationResumeAction(storage, 'ABCD12345'), 'verify');
  }
});

test('a cached registration page resets after another UID is verified', () => {
  const storage = fixture();
  clearRegistrationOutsidePage('/', storage);
  storage.setItem(verifiedRfidKey, 'NEW12345');
  assert.equal(registrationResumeAction(storage, 'ABCD12345'), 'reload');
});
