import test from 'node:test';
import assert from 'node:assert/strict';
import { getManilaDateStamp } from '../src/utils/dateTime.js';
import {
  buildUsername,
  calculateAge,
  normalizeContactNumber,
  normalizeSchoolEmail,
  toTitleCase,
  validateName,
  validatePersonalInformation,
  validateSchoolEmail,
} from '../src/utils/registrationValidation.js';

function validPersonalInformation(overrides = {}) {
  return {
    first_name: 'Shania Mae',
    middle_name: 'Garcia',
    last_name: 'Bugahod',
    sex: 'Female',
    date_of_birth: '2000-02-29',
    contact_number: '09123456789',
    street_address: '12-A J. Luna St., Block 3',
    barangay: 'Barangay 12-A',
    city_municipality: 'Cabadbaran City',
    province: 'Agusan Del Norte',
    zip_code: '8605',
    country: 'Philippines',
    ...overrides,
  };
}

test('names allow letters, Ñ and a single space with an optional middle name', () => {
  for (const value of ['Shania Mae', 'Peña', 'Ñina', 'De La Cruz']) {
    assert.equal(validateName(value, 'First name'), '', value);
  }
  assert.equal(validateName('', 'Middle name', { required: false }), '');
  assert.ok(validateName('', 'First name'));

  for (const value of ['Shania1', 'Shania-Mae', 'O\'Neil', 'G.', 'Shania  Mae', 'Shania\tMae', 'Shania\nMae', 'Shania\u00a0Mae']) {
    assert.ok(validateName(value, 'First name'), JSON.stringify(value));
  }
});

test('title casing handles each word and Ñ without removing invalid input before validation', () => {
  assert.equal(toTitleCase('ñaño barangay'), 'Ñaño Barangay');
  assert.equal(toTitleCase('agusan del norte'), 'Agusan Del Norte');
  assert.equal(toTitleCase('barangay 12-a'), 'Barangay 12-A');
  assert.ok(validateName(toTitleCase('shania  mae'), 'First name'));
});

test('generated usernames use only the first two first-name words and the complete surname', () => {
  assert.equal(buildUsername('Shania', 'Bugahod'), 'shania.bugahod');
  assert.equal(buildUsername('Shania Mae', 'Bugahod'), 'shaniamae.bugahod');
  assert.equal(buildUsername('Shania Mae Ann', 'Bugahod'), 'shaniamae.bugahod');
  assert.equal(buildUsername('  SHANIA   MAE ANN  ', 'De La Cruz'), 'shaniamae.delacruz');
  assert.equal(buildUsername('Ñina Mae', 'Peña'), 'ninamae.pena');
});

test('long valid names keep a usable firstname.lastname username within the account length limit', () => {
  for (const [firstName, lastName] of [
    ['A'.repeat(49), 'Bugahod'],
    ['A'.repeat(50), 'Bugahod'],
    ['Shania Mae', 'B'.repeat(50)],
    ['A'.repeat(50), 'B'.repeat(50)],
  ]) {
    const username = buildUsername(firstName, lastName);
    assert.match(username, /^[a-z]+\.[a-z]+$/);
    assert.ok(username.length <= 50, `${firstName.length}-character first name and ${lastName.length}-character surname`);
    assert.ok(username.split('.')[1].length > 0);
  }
});

test('age calculation uses the exact birthday and rejects invalid calendar dates', () => {
  assert.equal(calculateAge('2009-10-19', '2026-10-19'), '17');
  assert.equal(calculateAge('2009-10-20', '2026-10-19'), '16');
  assert.equal(calculateAge('2009-10-18', '2026-10-19'), '17');
  assert.equal(calculateAge('2000-02-29', '2026-02-28'), '25');
  assert.equal(calculateAge('2000-02-29', '2026-03-01'), '26');

  for (const value of ['', '2009-02-29', '2000-02-30', '2000-13-01', '2000-00-01', '2000-01-00', '2026-10-20', '2000-2-01']) {
    assert.equal(calculateAge(value, '2026-10-19'), '', value);
  }
});

test('personal information accepts valid address punctuation and numeric barangays', () => {
  assert.deepEqual(validatePersonalInformation(validPersonalInformation()), {});
  assert.deepEqual(validatePersonalInformation(validPersonalInformation({ middle_name: '' })), {});
});

test('contact validation requires exactly eleven digits starting with 09 and rejects pasted spaces', () => {
  assert.equal(normalizeContactNumber('09123456789123'), '09123456789');

  for (const value of ['08123456789', '0912345678', '091234567890', '09 123456789', '0912345678 ', ' 09123456789', '09\t123456789', '+639123456789']) {
    const errors = validatePersonalInformation(validPersonalInformation({ contact_number: value }));
    assert.ok(errors.contact_number, JSON.stringify(value));
  }
});

test('street and barangay validation reject unnecessary symbols and repeated or nonstandard whitespace', () => {
  for (const field of ['street_address', 'barangay']) {
    for (const value of ['Block #12', 'Block/12', 'Block_12', 'Block  12', 'Block\t12', 'Block\n12', 'Block\u00a012']) {
      const errors = validatePersonalInformation(validPersonalInformation({ [field]: value }));
      assert.ok(errors[field], `${field}: ${JSON.stringify(value)}`);
    }
  }
});

test('city, province and country reject numbers, unnecessary symbols and repeated spaces', () => {
  for (const field of ['city_municipality', 'province', 'country']) {
    for (const value of ['Area 12', 'Area@City', 'Area/City', 'Area  City', 'Area\tCity']) {
      const errors = validatePersonalInformation(validPersonalInformation({ [field]: value }));
      assert.ok(errors[field], `${field}: ${JSON.stringify(value)}`);
    }
  }
});

test('barangay, city, province and country require every word to begin with a capital letter', () => {
  for (const field of ['barangay', 'city_municipality', 'province', 'country']) {
    for (const value of ['lowercase', 'Upper lowercase']) {
      const errors = validatePersonalInformation(validPersonalInformation({ [field]: value }));
      assert.ok(errors[field], `${field}: ${value}`);
      const normalized = validatePersonalInformation(validPersonalInformation({ [field]: toTitleCase(value) }));
      assert.equal(normalized[field], undefined, `${field}: ${toTitleCase(value)}`);
    }
  }
});

test('minimum age comes from date of birth and cannot be bypassed with a supplied age', () => {
  const today = getManilaDateStamp();
  const [year, month, day] = today.split('-');
  const birthday = (years) => {
    const birthYear = Number(year) - years;
    const monthLastDay = new Date(Date.UTC(birthYear, Number(month), 0)).getUTCDate();
    return `${birthYear}-${month}-${String(Math.min(Number(day), monthLastDay)).padStart(2, '0')}`;
  };
  const allowed = validatePersonalInformation(validPersonalInformation({ date_of_birth: birthday(17), age: '16' }));
  assert.equal(allowed.date_of_birth, undefined);
  assert.equal(allowed.age, undefined);

  for (const years of [1, 16]) {
    const errors = validatePersonalInformation(validPersonalInformation({ date_of_birth: birthday(years), age: '18' }));
    assert.ok(errors.date_of_birth || errors.age, `${years}-year-old account`);
  }
});

test('completion profile validation supports its existing optional and absent fields', () => {
  const profile = validPersonalInformation({ street_address: '' });
  for (const field of ['first_name', 'last_name', 'country', 'zip_code']) delete profile[field];
  assert.deepEqual(validatePersonalInformation(profile, {
    requireStreet: false,
    includeCountry: false,
    includeZip: false,
    includeNames: false,
  }), {});
  assert.ok(validatePersonalInformation({ ...profile, middle_name: 'G.' }, {
    requireStreet: false,
    includeCountry: false,
    includeZip: false,
    includeNames: false,
  }).middle_name);
});

test('school email normalization keeps the school domain and validation rejects malformed or external addresses', () => {
  assert.equal(normalizeSchoolEmail('  Shania.Mae  '), 'shania.mae@csucc.edu.ph');
  assert.equal(normalizeSchoolEmail('  Shania.Mae@CSUCC.EDU.PH  '), 'shania.mae@csucc.edu.ph');
  assert.equal(validateSchoolEmail('shania.mae@csucc.edu.ph'), '');
  assert.equal(validateSchoolEmail(normalizeSchoolEmail('shania.mae')), '');

  for (const value of ['', 'shania@gmail.com', 'shania@csucc.edu.ph.evil.com', 'shania@@csucc.edu.ph', '@csucc.edu.ph', 'shania..mae@csucc.edu.ph', '.shania@csucc.edu.ph', 'shania.@csucc.edu.ph', 'shania mae@csucc.edu.ph']) {
    assert.ok(validateSchoolEmail(value), JSON.stringify(value));
  }
});

test('school email enforces the email column and mailbox length limits', () => {
  assert.equal(validateSchoolEmail(`${'a'.repeat(64)}@csucc.edu.ph`), '');
  assert.ok(validateSchoolEmail(`${'a'.repeat(65)}@csucc.edu.ph`));
  // The institutional domain is fixed, so the 64-character mailbox cap reaches
  // before the database's 100-character limit; oversized values still fail.
  assert.ok(validateSchoolEmail(`${'a'.repeat(87)}@csucc.edu.ph`));
  assert.ok(validateSchoolEmail(`${'a'.repeat(88)}@csucc.edu.ph`));
});
