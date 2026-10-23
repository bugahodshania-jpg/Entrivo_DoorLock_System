import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as dateTime from '../src/utils/dateTime.js';
import * as registrationSession from '../src/utils/registrationSession.js';
import * as registrationValidation from '../src/utils/registrationValidation.js';
import * as schoolProfileOptions from '../src/utils/schoolProfileOptions.js';

// Execute the actual component with deterministic hooks, timers and network calls.
// This exercises the event/effect wiring without a browser or extra dependencies.
const components = Object.fromEntries(['Register', 'FirstLoginSetup', 'Home'].map((name) => [name, transformSync(
  readFileSync(new URL(`../src/pages/${name === 'Home' ? 'shared' : 'auth'}/${name}.jsx`, import.meta.url), 'utf8'),
  { loader: 'jsx', format: 'cjs', jsx: 'automatic', jsxImportSource: 'test-runtime' },
).code]));

async function registrationHarness({ component = 'Register', step = 3, form = {}, questions, autoApproveUid = true, verifiedUid = 'TEST12345', initialSearch = '' } = {}) {
  const slots = [];
  const timers = new Map();
  const requests = [];
  const uidRequests = [];
  const navigations = [];
  const listeners = new Map();
  const storage = new Map([
    [registrationSession.verifiedRfidKey, verifiedUid],
    [registrationSession.registrationDraftKey, JSON.stringify({
      step,
      form: { first_name: 'Shania Mae Ann', last_name: 'Bugahod', rfid_uid: 'TEST12345', ...form },
      questions,
    })],
  ]);
  let hookIndex = 0;
  let dirty = false;
  let tree;
  let pendingEffects = [];
  let now = 0;
  let timerId = 0;
  let videoElement = null;
  let mountedVideoRef = null;
  let stoppedCameraTracks = 0;
  const cameraStream = { getTracks: () => [{ stop: () => { stoppedCameraTracks += 1; } }] };
  const sameDependencies = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial) {
      const index = hookIndex++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => {
        const next = typeof value === 'function' ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) {
          slots[index] = next;
          dirty = true;
        }
      }];
    },
    useRef(initial) {
      const index = hookIndex++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo(callback, dependencies) {
      const index = hookIndex++;
      if (!sameDependencies(slots[index]?.dependencies, dependencies)) {
        slots[index] = { dependencies, value: callback() };
      }
      return slots[index].value;
    },
    useEffect(callback, dependencies) {
      const index = hookIndex++;
      if (!sameDependencies(slots[index]?.dependencies, dependencies)) {
        const previous = slots[index];
        slots[index] = { dependencies };
        pendingEffects.push(() => {
          previous?.cleanup?.();
          slots[index].cleanup = callback();
        });
      }
    },
  };
  const network = {
    post(url, values, options = {}) {
      const isUidCheck = url === '/api/verify_rfid_uid.php';
      if (isUidCheck && component === 'Register' && autoApproveUid) {
        return Promise.resolve({ data: { verified: true, rfid_uid: values.rfid_uid } });
      }
      return new Promise((resolve, reject) => (isUidCheck ? uidRequests : requests).push({ url, values, options, resolve, reject, transport: 'axios' }));
    },
  };
  const module = { exports: {} };
  const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' };
  vm.runInNewContext(components[component], {
    module,
    exports: module.exports,
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'test-runtime/jsx-runtime') return runtime;
      if (name === 'lucide-react') return new Proxy({}, { get: (object, key) => String(key) });
      if (name.endsWith('/axiosClient')) return network;
      if (name.endsWith('/dateTime')) return dateTime;
      if (name.endsWith('/registrationSession')) return registrationSession;
      if (name.endsWith('/registrationValidation')) return registrationValidation;
      if (name.endsWith('/schoolProfileOptions')) return schoolProfileOptions;
      if (name.endsWith('/PublicFooter')) return () => null;
      if (/\.(css|png|jpg)$/.test(name)) return name;
      throw new Error(`Unexpected component import: ${name}`);
    },
    AbortController,
    TextEncoder,
    URLSearchParams,
    navigator: { mediaDevices: { getUserMedia: async () => cameraStream } },
    document: { querySelectorAll: () => [], getElementById: () => null, body: { style: {} } },
    fetch(url, options) {
      return new Promise((resolve, reject) => requests.push({
        url, values: JSON.parse(options.body), options, resolve, reject, transport: 'fetch',
      }));
    },
    window: {
      sessionStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      },
      location: {
        search: initialSearch, pathname: component === 'Home' ? '/' : '/register', hash: '',
        replace: (url) => navigations.push({ method: 'replace', url }),
        assign: (url) => navigations.push({ method: 'assign', url }),
        reload: () => navigations.push({ method: 'reload' }),
      },
      history: { replaceState() {} },
      addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(callback);
      },
      removeEventListener: (name, callback) => listeners.get(name)?.delete(callback),
      setTimeout(callback, delay) {
        const id = ++timerId;
        timers.set(id, { callback, deadline: now + delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  });

  function render() {
    let attempts = 0;
    do {
      assert.ok(++attempts <= 10, 'Component renders settle.');
      dirty = false;
      hookIndex = 0;
      pendingEffects = [];
      tree = module.exports.default(component === 'FirstLoginSetup' ? {
        challengeId: 'active-test-challenge',
        maskedEmail: 's***@csucc.edu.ph',
        initialStep: 'profile',
        setup: { role: 'staff' },
        onClose() {},
        onComplete() {},
      } : undefined);
      // Apply the video host ref before effects, and replace it when the gated
      // form unmounts/remounts, as a browser React commit would.
      const video = find((element) => element.type === 'video', tree);
      if (video) {
        videoElement ??= { srcObject: null };
        mountedVideoRef = video.props.ref;
        mountedVideoRef.current = videoElement;
      } else {
        if (mountedVideoRef) mountedVideoRef.current = null;
        mountedVideoRef = null;
        videoElement = null;
      }
      for (const effect of pendingEffects) effect();
    } while (dirty);
  }

  function find(predicate, element) {
    if (!element || typeof element !== 'object') return undefined;
    if (Array.isArray(element)) {
      for (const item of element) {
        const found = find(predicate, item);
        if (found) return found;
      }
      return undefined;
    }
    return predicate(element) ? element : find(predicate, element.props?.children);
  }

  render();
  if (autoApproveUid) {
    await setImmediate();
    render();
  }
  return {
    requests,
    uidRequests,
    navigations,
    storage,
    cameraStream,
    video: () => videoElement,
    stoppedCameraTracks: () => stoppedCameraTracks,
    async flush() {
      await setImmediate();
      render();
    },
    find: (predicate) => find(predicate, tree),
    hasForm: () => Boolean(find((element) => element.type === 'form', tree)),
    text() {
      function collect(element) {
        if (element == null || typeof element === 'boolean') return '';
        if (typeof element === 'string' || typeof element === 'number') return String(element);
        if (Array.isArray(element)) return element.map(collect).join(' ');
        return collect(element.props?.children);
      }
      return collect(tree);
    },
    dispatch(name, details = {}) {
      for (const callback of listeners.get(name) ?? []) callback(details);
      render();
    },
    clickButton(label) {
      const button = find((element) => element.type === 'button' && element.props.children === label, tree);
      assert.ok(button, `Button is available: ${label}`);
      button.props.onClick();
      render();
    },
    changeUid(value) {
      find((element) => element.type === 'input' && element.props.placeholder === 'Enter RFID UID', tree)
        .props.onChange({ target: { value } });
      render();
    },
    async resolveUid(index, data) {
      uidRequests[index].resolve({ data });
      await setImmediate();
      render();
    },
    async rejectUid(index, data, status = 409) {
      uidRequests[index].reject(data ? { response: { data, status } } : new Error('Network unavailable'));
      await setImmediate();
      render();
    },
    field: (field) => find((element) => ['input', 'select'].includes(element.type)
      && element.props['aria-describedby']?.endsWith(`-${field}-error`), tree),
    fieldError(field) {
      const error = find((element) => typeof element.type === 'function' && element.props?.field === field, tree);
      return error?.type(error.props).props.children.trim() ?? '';
    },
    change(field, value) {
      this.field(field).props.onChange({ target: { value } });
      render();
    },
    clickNext() {
      const button = find((element) => element.type === 'button' && element.props.className === 'public-register-submit', tree);
      const pending = button.props.onClick();
      render();
      return pending;
    },
    submit() {
      const pending = find((element) => element.type === 'form', tree).props.onSubmit({ preventDefault() {} });
      render();
      return pending;
    },
    email: () => find((element) => element.type === 'input' && element.props.type === 'email', tree),
    username: () => find((element) => element.type === 'input' && element.props.placeholder === 'firstname.lastname', tree),
    emailError() {
      const error = find((element) => typeof element.type === 'function' && element.props?.field === 'email', tree);
      return error.type(error.props).props.children.trim();
    },
    changeEmail(value) {
      this.email().props.onChange({ target: { value } });
      render();
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of timers) {
        if (timer.deadline <= now) {
          timers.delete(id);
          timer.callback();
          render();
        }
      }
    },
    async resolve(index, errors = {}) {
      const request = requests[index];
      const data = {
        errors,
        ...(request.values.action === 'first_login_contact_availability' ? { available: !errors.contact_number } : {}),
      };
      request.resolve(request.transport === 'fetch' ? { ok: true, json: async () => data } : { data });
      await setImmediate();
      render();
    },
    async rejectSave(index, errors, status = 409) {
      const request = requests[index];
      if (request.transport === 'fetch') request.resolve({ ok: false, status, json: async () => ({ errors }) });
      else request.reject({ response: { status, data: { errors } } });
      await setImmediate();
      render();
    },
  };
}

test('public registration generates the requested username and debounces email availability until typing pauses', async () => {
  const page = await registrationHarness();
  assert.equal(page.username().props.value, 'shaniamae.bugahod');
  page.changeEmail('shania@csucc.edu.ph');
  page.advance(399);
  assert.equal(page.requests.length, 0);
  page.changeEmail('shania.mae@csucc.edu.ph');
  page.advance(399);
  assert.equal(page.requests.length, 0);
  page.advance(1);
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].values.email, 'shania.mae@csucc.edu.ph');
  await page.resolve(0, { email: 'Email already exists. Use a different school email.' });
  assert.equal(page.emailError(), 'Email already exists. Use a different school email.');
  assert.equal(page.email().props['aria-invalid'], true);
});

test('changing email cancels the old lookup and ignores its response even if the server finishes it', async () => {
  const page = await registrationHarness();
  page.changeEmail('used@csucc.edu.ph');
  page.advance(400);
  page.changeEmail('available@csucc.edu.ph');
  assert.equal(page.requests[0].options.signal.aborted, true);
  page.advance(400);
  await page.resolve(1);
  await page.resolve(0, { email: 'Email already exists. Use a different school email.' });
  assert.equal(page.emailError(), '');
  assert.equal(page.email().props['aria-invalid'], false);
});

test('a malformed or external email shows an inline error immediately and never triggers a lookup', async () => {
  const page = await registrationHarness();
  for (const email of ['shania@gmail.com', 'shania..mae@csucc.edu.ph', 'shania mae@csucc.edu.ph']) {
    page.changeEmail(email);
    assert.ok(page.emailError(), email);
    assert.equal(page.email().props['aria-invalid'], true);
    page.advance(400);
    assert.equal(page.requests.length, 0);
  }
});

const duplicateContact = 'Contact number already exists. Use a different contact number.';
const validPersonalInformation = {
  first_name: 'Shania Mae Ann',
  last_name: 'Bugahod',
  sex: 'Female',
  contact_number: '09123456789',
  date_of_birth: '2000-01-01',
  street_address: '12 Main St.',
  barangay: 'Barangay 1',
  city_municipality: 'Cabadbaran',
  province: 'Agusan Del Norte',
  zip_code: '8605',
};

test('public registration checks valid contacts after typing pauses and displays duplicates inline', async () => {
  const page = await registrationHarness({ step: 1 });
  for (const contact of ['08123456789', '0912345678']) {
    page.change('contact_number', contact);
    assert.ok(page.fieldError('contact_number'));
    page.advance(400);
    assert.equal(page.requests.length, 0);
  }
  page.change('contact_number', '09123456789');
  page.advance(399);
  assert.equal(page.requests.length, 0);
  page.change('contact_number', '09987654321');
  page.advance(399);
  assert.equal(page.requests.length, 0);
  page.advance(1);
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].values.contact_number, '09987654321');
  await page.resolve(0, { contact_number: duplicateContact });
  assert.equal(page.fieldError('contact_number'), duplicateContact);
  assert.equal(page.field('contact_number').props['aria-invalid'], true);
  page.change('contact_number', '09123456789');
  assert.equal(page.fieldError('contact_number'), '');
  assert.equal(page.field('contact_number').props['aria-invalid'], false);
});

test('public registration cancels changed contact lookups and ignores stale responses even after the old value is reentered', async () => {
  const page = await registrationHarness({ step: 1 });
  page.change('contact_number', '09123456789');
  page.advance(400);
  page.change('contact_number', '09987654321');
  assert.equal(page.requests[0].options.signal.aborted, true);
  page.advance(400);
  page.change('contact_number', '09123456789');
  assert.equal(page.requests[1].options.signal.aborted, true);
  page.advance(400);
  await page.resolve(2);
  await page.resolve(0, { contact_number: duplicateContact });
  await page.resolve(1, { contact_number: duplicateContact });
  assert.equal(page.fieldError('contact_number'), '');
});

test('public registration checks contact before leaving personal information, including before the live timer runs', async () => {
  const page = await registrationHarness({ step: 1, form: validPersonalInformation });
  const pending = page.clickNext();
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].values.contact_number, '09123456789');
  await page.resolve(0, { contact_number: duplicateContact });
  await pending;
  assert.equal(page.fieldError('contact_number'), duplicateContact);
  assert.ok(page.field('contact_number'), 'A duplicate keeps the personal-information step open.');
  page.advance(400);
  assert.equal(page.requests.length, 1, 'Next cancels the pending live lookup.');
});

test('an older public live response cannot erase the duplicate found by Next', async () => {
  const page = await registrationHarness({ step: 1, form: validPersonalInformation });
  page.advance(400);
  const pending = page.clickNext();
  assert.equal(page.requests[0].options.signal.aborted, true);
  await page.resolve(1, { contact_number: duplicateContact });
  await pending;
  await page.resolve(0);
  assert.equal(page.fieldError('contact_number'), duplicateContact);
});

async function completedRegistrationHarness() {
  return registrationHarness({
    step: 4,
    form: {
      ...validPersonalInformation,
      school_id: '2026-1234',
      college: schoolProfileOptions.departmentOptions[0],
      program_department: schoolProfileOptions.programsForCollege(schoolProfileOptions.departmentOptions[0])[0],
      year_level: schoolProfileOptions.yearLevelOptions[0],
      school_id_photo: 'data:image/jpeg;base64,TEST',
      email: 'shania@csucc.edu.ph',
      username: 'shaniamae.bugahod',
      password: 'SchoolPass123!',
      confirm_password: 'SchoolPass123!',
    },
    questions: schoolProfileOptions.securityQuestionOptions.slice(0, 3).map((question) => ({ question, answer: 'Example' })),
  });
}

test('public registration rechecks contact on final submission and returns duplicates to the personal step', async () => {
  const page = await completedRegistrationHarness();
  const pending = page.submit();
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].url, '/api/registration_availability.php');
  assert.equal(page.requests[0].values.contact_number, '09123456789');
  await page.resolve(0, { contact_number: duplicateContact });
  await pending;
  assert.equal(page.requests.length, 1, 'No account save is sent with a duplicate contact.');
  assert.equal(page.fieldError('contact_number'), duplicateContact);
});

test('a duplicate discovered during public account save is also shown inline on personal information', async () => {
  const page = await completedRegistrationHarness();
  const pending = page.submit();
  await page.resolve(0);
  assert.equal(page.requests[1].url, '/api/public_register.php');
  await page.rejectSave(1, { contact_number: duplicateContact });
  await pending;
  assert.equal(page.fieldError('contact_number'), duplicateContact);
});

test('account completion debounces valid contacts, includes the active challenge, and displays duplicate errors inline', async () => {
  const page = await registrationHarness({ component: 'FirstLoginSetup' });
  for (const contact of ['08123456789', '0912345678']) {
    page.change('contact_number', contact);
    assert.ok(page.fieldError('contact_number'));
    page.advance(400);
    assert.equal(page.requests.length, 0);
  }
  page.change('contact_number', '09123456789');
  page.advance(399);
  assert.equal(page.requests.length, 0);
  page.advance(1);
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].values.action, 'first_login_contact_availability');
  assert.equal(page.requests[0].values.challenge_id, 'active-test-challenge');
  assert.equal(page.requests[0].values.contact_number, '09123456789');
  await page.resolve(0, { contact_number: duplicateContact });
  assert.equal(page.fieldError('contact_number'), duplicateContact);
  assert.equal(page.field('contact_number').props['aria-invalid'], true);
  page.change('contact_number', '08123456789');
  assert.equal(page.fieldError('contact_number'), 'Contact number must start with 09.');
  page.advance(400);
  assert.equal(page.requests.length, 1);
  page.change('contact_number', '09987654321');
  assert.equal(page.fieldError('contact_number'), '');
});

test('account completion ignores canceled contact responses even when the earlier value is reentered', async () => {
  const page = await registrationHarness({ component: 'FirstLoginSetup' });
  page.change('contact_number', '09123456789');
  page.advance(400);
  page.change('contact_number', '09987654321');
  assert.equal(page.requests[0].options.signal.aborted, true);
  page.advance(400);
  page.change('contact_number', '09123456789');
  assert.equal(page.requests[1].options.signal.aborted, true);
  page.advance(400);
  await page.resolve(2);
  await page.resolve(0, { contact_number: duplicateContact });
  await page.resolve(1, { contact_number: duplicateContact });
  assert.equal(page.fieldError('contact_number'), '');
});

test('account completion preserves profile-save duplicates over old lookups, blocks retry, and clears errors when edited', async () => {
  const page = await registrationHarness({ component: 'FirstLoginSetup' });
  const profile = {
    sex: 'Female',
    contact_number: '09123456789',
    date_of_birth: '2000-01-01',
    barangay: 'Barangay 1',
    city_municipality: 'Cabadbaran',
    province: 'Agusan Del Norte',
    office_department: 'Library',
    work_position: 'Librarian',
  };
  for (const [field, value] of Object.entries(profile)) page.change(field, value);
  page.advance(400);
  page.submit();
  assert.equal(page.requests.length, 2);
  assert.equal(page.requests[0].options.signal.aborted, true);
  assert.equal(page.requests[1].values.action, 'first_login_profile');
  assert.equal(page.requests[1].values.challenge_id, 'active-test-challenge');
  await page.rejectSave(1, { contact_number: duplicateContact });
  await page.resolve(0);
  assert.equal(page.fieldError('contact_number'), duplicateContact);
  page.submit();
  assert.equal(page.requests.length, 2, 'A known duplicate blocks a second profile save.');
  page.change('contact_number', '09987654321');
  assert.equal(page.fieldError('contact_number'), '');
});

const registeredUidMessage = 'This school ID UID is already registered. Please visit the admin office for assistance with your account.';

async function schoolIdVerificationHarness() {
  const page = await registrationHarness({ component: 'Home', initialSearch: '?signup=1' });
  assert.equal(page.storage.has(registrationSession.verifiedRfidKey), false, 'Opening sign up clears prior UID verification.');
  assert.equal(page.storage.has(registrationSession.registrationDraftKey), false, 'Opening sign up clears a stale registration draft.');
  page.clickButton('Continue');
  return page;
}

test('school ID verification keeps registered UIDs out of registration and shows inline admin-office guidance', async () => {
  const page = await schoolIdVerificationHarness();
  page.changeUid('test12345');
  const pending = page.submit();
  assert.equal(page.uidRequests.length, 1);
  assert.equal(page.uidRequests[0].values.rfid_uid, 'TEST12345');
  page.storage.set(registrationSession.verifiedRfidKey, 'STALE1234');
  page.storage.set(registrationSession.registrationDraftKey, '{}');
  await page.rejectUid(0, { code: 'rfid_uid_registered', errors: { rfid_uid: registeredUidMessage } });
  await pending;
  const error = page.find((element) => element.props?.id === 'school-id-error');
  assert.equal(error.props.role, 'alert');
  assert.equal(error.props.children, 'This School ID UID is already registered.');
  const input = page.find((element) => element.type === 'input' && element.props.placeholder === 'Enter RFID UID');
  assert.equal(input.props['aria-invalid'], true);
  assert.match(input.props['aria-describedby'], /school-id-error/);
  assert.match(page.text(), /admin office/i);
  assert.equal((page.text().match(/admin office/gi) || []).length, 1);
  assert.equal(page.storage.has(registrationSession.verifiedRfidKey), false);
  assert.equal(page.storage.has(registrationSession.registrationDraftKey), false);
  assert.deepEqual(page.navigations, []);
});

test('school ID verification admits only a verified response for the exact normalized submitted UID', async () => {
  for (const data of [
    {},
    { verified: false, rfid_uid: 'TEST12345' },
    { verified: true, rfid_uid: 'OTHER1234' },
  ]) {
    const page = await schoolIdVerificationHarness();
    page.changeUid('test 12345');
    const pending = page.submit();
    await page.resolveUid(0, data);
    await pending;
    assert.equal(page.storage.has(registrationSession.verifiedRfidKey), false);
    assert.deepEqual(page.navigations, []);
    assert.match(page.text(), /Unable to verify/);
  }

  const page = await schoolIdVerificationHarness();
  page.changeUid(' test 12345 ');
  const pending = page.submit();
  await page.resolveUid(0, { verified: true, rfid_uid: 'TEST12345' });
  await pending;
  assert.equal(page.storage.get(registrationSession.verifiedRfidKey), 'TEST12345');
  assert.deepEqual(page.navigations, [{ method: 'assign', url: '/register' }]);
});

test('the registration form stays hidden until the stored UID is verified against the database', async () => {
  const page = await registrationHarness({ autoApproveUid: false });
  assert.equal(page.uidRequests.length, 1);
  assert.equal(page.uidRequests[0].values.rfid_uid, 'TEST12345');
  assert.equal(page.hasForm(), false);
  assert.equal(page.username(), undefined);
  assert.match(page.text(), /Checking your School ID UID/);
  page.advance(400);
  assert.equal(page.requests.length, 0, 'Account availability requests cannot start before UID verification.');
  await page.resolveUid(0, { verified: true, rfid_uid: 'TEST12345' });
  assert.equal(page.hasForm(), true);
  assert.equal(page.username().props.value, 'shaniamae.bugahod');
  assert.equal(page.storage.get(registrationSession.verifiedRfidKey), 'TEST12345');
});

test('a saved UID that is already registered cannot reopen the form after refresh', async () => {
  const page = await registrationHarness({ autoApproveUid: false });
  await page.rejectUid(0, { code: 'rfid_uid_registered', message: registeredUidMessage });
  assert.equal(page.hasForm(), false);
  assert.equal(page.username(), undefined);
  assert.match(page.text(), /already registered/i);
  assert.match(page.text(), /admin office/i);
  assert.equal(page.storage.has(registrationSession.verifiedRfidKey), false);
  assert.equal(page.storage.has(registrationSession.registrationDraftKey), false);
  page.advance(400);
  assert.equal(page.requests.length, 0);
});

test('returning to registration rechecks the database and removes access if the UID became registered', async () => {
  for (const [eventName, details] of [['pageshow', { persisted: true }], ['focus', {}]]) {
    const page = await registrationHarness({ autoApproveUid: false });
    await page.resolveUid(0, { verified: true, rfid_uid: 'TEST12345' });
    assert.equal(page.hasForm(), true);
    page.dispatch(eventName, details);
    assert.equal(page.uidRequests.length, 2, `${eventName} rechecks the UID.`);
    assert.equal(page.hasForm(), false, `${eventName} hides the form during its database check.`);
    await page.rejectUid(1, { message: registeredUidMessage });
    assert.equal(page.hasForm(), false);
    assert.match(page.text(), /admin office/i);
    assert.equal(page.storage.has(registrationSession.verifiedRfidKey), false);
    assert.equal(page.storage.has(registrationSession.registrationDraftKey), false);
  }
});

test('an old successful verification cannot restore registration access after a newer registered-UID response', async () => {
  const page = await registrationHarness({ autoApproveUid: false });
  page.dispatch('focus');
  assert.equal(page.uidRequests[0].options.signal.aborted, true);
  await page.rejectUid(1, { code: 'rfid_uid_registered', message: registeredUidMessage });
  await page.resolveUid(0, { verified: true, rfid_uid: 'TEST12345' });
  assert.equal(page.hasForm(), false);
  assert.match(page.text(), /already registered/i);
  assert.equal(page.storage.has(registrationSession.verifiedRfidKey), false);
});

test('a temporary verification error keeps the form hidden and allows retrying the UID check', async () => {
  const page = await registrationHarness({ autoApproveUid: false });
  await page.rejectUid(0);
  assert.equal(page.hasForm(), false);
  assert.match(page.text(), /Unable to verify/);
  assert.equal(page.storage.get(registrationSession.verifiedRfidKey), 'TEST12345');
  page.clickButton('Try again');
  assert.equal(page.uidRequests.length, 2);
  assert.equal(page.hasForm(), false);
  await page.resolveUid(1, { verified: true, rfid_uid: 'TEST12345' });
  assert.equal(page.hasForm(), true);
});

test('unconfirmed, mismatched and invalid UIDs cannot open registration', async () => {
  for (const data of [{}, { verified: false, rfid_uid: 'TEST12345' }, { verified: true, rfid_uid: 'OTHER1234' }]) {
    const page = await registrationHarness({ autoApproveUid: false });
    await page.resolveUid(0, data);
    assert.equal(page.hasForm(), false);
    assert.match(page.text(), /Unable to verify/);
  }
  const page = await registrationHarness({ autoApproveUid: false });
  await page.rejectUid(0, { message: 'Verify your School ID at the scanner first.' }, 422);
  assert.equal(page.hasForm(), false);
  assert.equal(page.storage.has(registrationSession.verifiedRfidKey), false);
  assert.equal(page.storage.has(registrationSession.registrationDraftKey), false);
});

test('opening registration without a verified UID redirects to school ID verification and clears the draft', async () => {
  const page = await registrationHarness({ autoApproveUid: false, verifiedUid: null });
  assert.equal(page.hasForm(), false);
  assert.equal(page.uidRequests.length, 0);
  assert.deepEqual(page.navigations, [{ method: 'replace', url: '/?signup=1' }]);
  assert.equal(page.storage.has(registrationSession.registrationDraftKey), false);
});

test('a UID registered during enrollment blocks the form when detected at final preflight or save', async () => {
  for (const duplicateAtSave of [false, true]) {
    const page = await completedRegistrationHarness();
    const pending = page.submit();
    if (duplicateAtSave) {
      await page.resolve(0);
      await page.rejectSave(1, { rfid_uid: registeredUidMessage });
    } else {
      await page.resolve(0, { rfid_uid: registeredUidMessage });
    }
    await pending;
    assert.equal(page.hasForm(), false);
    assert.match(page.text(), /already registered/i);
    assert.match(page.text(), /admin office/i);
    assert.equal(page.storage.has(registrationSession.verifiedRfidKey), false);
    assert.equal(page.storage.has(registrationSession.registrationDraftKey), false);
    assert.equal(page.requests.length, duplicateAtSave ? 2 : 1);
  }
});

test('an invalid UID rejected during account save preserves its actual error instead of claiming it is registered', async () => {
  const page = await completedRegistrationHarness();
  const pending = page.submit();
  await page.resolve(0);
  const invalidUidMessage = 'This School ID UID has not been scanned. Scan your School ID before continuing.';
  await page.rejectSave(1, { rfid_uid: invalidUidMessage }, 422);
  await pending;
  assert.equal(page.hasForm(), false);
  assert.ok(page.text().includes(invalidUidMessage));
  assert.doesNotMatch(page.text(), /already registered/i);
  assert.equal(page.storage.has(registrationSession.verifiedRfidKey), false);
  assert.equal(page.storage.has(registrationSession.registrationDraftKey), false);
});

test('camera preview reattaches after focus verification and stops when the UID is permanently blocked', async () => {
  const page = await registrationHarness({ step: 2, autoApproveUid: false });
  await page.resolveUid(0, { verified: true, rfid_uid: 'TEST12345' });
  page.clickButton('Open Camera');
  page.clickButton('Continue');
  await page.flush();
  const originalVideo = page.video();
  assert.equal(originalVideo.srcObject, page.cameraStream);

  page.dispatch('focus');
  assert.equal(page.video(), null, 'UID verification hides the camera along with the form.');
  assert.equal(page.stoppedCameraTracks(), 0, 'Temporary verification preserves the live stream.');
  await page.resolveUid(1, { verified: true, rfid_uid: 'TEST12345' });
  assert.notEqual(page.video(), originalVideo, 'The preview uses a newly mounted video element.');
  assert.equal(page.video().srcObject, page.cameraStream, 'The new video element receives the existing stream.');

  page.dispatch('focus');
  await page.rejectUid(2, { code: 'rfid_uid_registered', message: registeredUidMessage });
  assert.equal(page.video(), null);
  assert.equal(page.stoppedCameraTracks(), 1, 'Permanent UID rejection closes the camera and stops its stream.');
});
