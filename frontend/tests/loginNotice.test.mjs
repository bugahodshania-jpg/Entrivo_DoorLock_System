import test from 'node:test';
import assert from 'node:assert/strict';
import { saveLoginNotice } from '../src/utils/loginNotice.js';

function fixture() {
  const data = new Map([['entrivo_login_notice', 'old notice']]);
  return { data, setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key) };
}

test('a logout click event is never stored as a login notice', () => {
  const storage = fixture();
  saveLoginNotice(storage, { type: 'click', nativeEvent: {} });
  assert.equal(storage.data.has('entrivo_login_notice'), false);
});

test('normal logout clears any previous login notice', () => {
  const storage = fixture();
  saveLoginNotice(storage);
  assert.equal(storage.data.has('entrivo_login_notice'), false);
});

test('forced logout preserves its explanatory message', () => {
  const storage = fixture();
  saveLoginNotice(storage, ' Another Super Admin is currently active. ');
  assert.equal(storage.data.get('entrivo_login_notice'), 'Another Super Admin is currently active.');
});
