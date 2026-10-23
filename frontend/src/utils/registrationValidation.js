import { getManilaDateStamp } from './dateTime.js';

export const schoolEmailDomain = 'csucc.edu.ph';
export const contactNumberLength = 11;

export function toTitleCase(value) {
  return value.replace(/(^|[ -])([a-zñ])/g, (match, separator, letter) => `${separator}${letter.toUpperCase()}`);
}

export function buildUsername(firstName, lastName) {
  const part = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '');
  const first = part(firstName.trim().split(/\s+/).slice(0, 2).join(''));
  const last = part(lastName);
  if (!first || !last) return first || last;
  const surname = last.slice(0, 48);
  return `${first.slice(0, 49 - surname.length)}.${surname}`;
}

export function calculateAge(dateOfBirth, today = getManilaDateStamp()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth || '')) return '';
  const date = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateOfBirth || dateOfBirth > today) return '';
  const [birthYear, birthMonth, birthDay] = dateOfBirth.split('-').map(Number);
  if (birthYear < 1) return '';
  const [year, month, day] = today.split('-').map(Number);
  const age = year - birthYear - (month < birthMonth || (month === birthMonth && day < birthDay) ? 1 : 0);
  return age >= 0 ? String(age) : '';
}

export function normalizeContactNumber(value) {
  return value.replace(/\D/g, '').slice(0, contactNumberLength);
}

export function normalizeSchoolEmail(value) {
  const email = value.trim().toLowerCase();
  return email && !email.includes('@') ? `${email}@${schoolEmailDomain}` : email;
}

export function validateSchoolEmail(value) {
  const email = normalizeSchoolEmail(value);
  if (!email) return 'Email is required.';
  if (email.length > 100) return 'Email must be 100 characters or fewer.';
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@csucc\.edu\.ph$/.test(email) || email.split('@')[0].length > 64) {
    return email.endsWith(`@${schoolEmailDomain}`)
      ? 'Enter a valid institutional email address.'
      : `Email must use the @${schoolEmailDomain} domain.`;
  }
  return '';
}

export function validateName(value = '', label, { required = true } = {}) {
  if (!value.trim()) return required ? `${label} is required.` : '';
  if (/[^A-Za-zÑñ ]/.test(value)) return 'Use letters only, with one space between words.';
  if (/ {2,}/.test(value)) return `${label} cannot contain consecutive spaces. Use only one space between words.`;
  if (value.trim().length > 50) return `${label} must be 50 characters or fewer.`;
  return '';
}

function validateAddress(value = '', label, { required = true, numbers = true, title = false, max = 100 } = {}) {
  if (!value.trim()) return required ? `${label} is required.` : '';
  const characters = numbers ? /[^A-Za-zÑñ0-9 .,\-]/ : /[^A-Za-zÑñ .,\-]/;
  if (characters.test(value)) {
    return `${label} can only contain letters${numbers ? ', numbers' : ''}, spaces, periods, commas, and hyphens.`;
  }
  if (/ {2,}/.test(value)) return `${label} cannot contain consecutive spaces. Use only one space between words.`;
  if (!(numbers ? /[A-Za-zÑñ0-9]/ : /[A-Za-zÑñ]/).test(value)) return `Enter a valid ${label.toLowerCase()}.`;
  if (value.trim().length > max) return `${label} must be ${max} characters or fewer.`;
  if (title && value !== toTitleCase(value)) return `Capitalize the first letter of each word in ${label.toLowerCase()}.`;
  return '';
}

export function validatePersonalInformation(form, { requireStreet = true, includeCountry = true, includeZip = true, includeNames = true } = {}) {
  const errors = {};
  const check = (field, message) => { if (message) errors[field] = message; };
  if (includeNames) {
    check('first_name', validateName(form.first_name, 'First name'));
    check('last_name', validateName(form.last_name, 'Last name'));
  }
  check('middle_name', validateName(form.middle_name, 'Middle name', { required: false }));
  if (!form.sex) errors.sex = 'Sex is required.';
  const contact = form.contact_number || '';
  if (!contact) errors.contact_number = 'Contact number is required.';
  else if (!/^[0-9]+$/.test(contact)) errors.contact_number = 'Contact number must contain digits only, without spaces.';
  else if (!contact.startsWith('09')) errors.contact_number = 'Contact number must start with 09.';
  else if (contact.length !== contactNumberLength) errors.contact_number = 'Contact number must be 11 digits.';
  const age = calculateAge(form.date_of_birth);
  if (!form.date_of_birth) errors.date_of_birth = 'Date of birth is required.';
  else if (age === '') errors.date_of_birth = 'Date of birth must be a valid past date.';
  else if (Number(age) < 17) {
    errors.date_of_birth = 'You must be at least 17 years old to register.';
    errors.age = errors.date_of_birth;
  }
  check('street_address', validateAddress(form.street_address, 'Street address', { required: requireStreet, max: 255 }));
  check('barangay', validateAddress(form.barangay, 'Barangay', { title: true }));
  check('city_municipality', validateAddress(form.city_municipality, 'City / Municipality', { numbers: false, title: true }));
  check('province', validateAddress(form.province, 'Province', { numbers: false, title: true }));
  if (includeCountry) check('country', validateAddress(form.country, 'Country', { numbers: false, title: true }));
  if (includeZip) {
    if (!form.zip_code) errors.zip_code = 'Zip code is required.';
    else if (!/^[0-9]{4}$/.test(form.zip_code)) errors.zip_code = 'Zip code must be 4 digits.';
  }
  return errors;
}
