export const schoolEmailDomain = 'csucc.edu.ph';

export const roleOptions = [
  { value: 'student', label: 'Student' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'staff', label: 'Staff' },
  { value: 'admin', label: 'Admin' },
  { value: 'super_admin', label: 'Super Admin' },
];

export const suffixOptions = ['', 'Jr.', 'Sr.', 'II', 'III', 'IV', 'V'];

export const collegeProgramOptions = [
  {
    college: '(CEIT) College of Engineering and Information Technology',
    programs: [
      '(BSIT) Bachelor of Science in Information Technology',
      '(BSEE) Bachelor of Science in Electrical Engineering',
      '(BSCpE) Bachelor of Science in Computer Engineering',
    ],
  },
  {
    college: '(CTHM) College of Tourism and Hospitality Management',
    programs: [
      '(BSHM) Bachelor of Science in Hospitality Management',
      '(BSTM) Bachelor of Science in Tourism Management',
    ],
  },
  {
    college: '(CITTE) College of Industrial and Technical Teacher Education',
    programs: [
      '(BSIndTech) - Architectural Drafting Technology',
      '(BSIndTech) - Automotive Technology',
      '(BSIndTech) - Civil Technology',
      '(BSIndTech) - (BSIndTech)',
      '(BSIndTech) - Electronics Technology',
      '(BTVTED) Bachelor of Technical Vocational Teacher Education',
    ],
  },
  {
    college: '(CBA) College of Business and Accountancy',
    programs: [
      '(BSA) Bachelor of Science in Accountancy',
      '(BSMA) Bachelor of Science in Management Accounting',
      '(BSOA) Bachelor of Science in Office Administration',
      '(BSBA) Bachelor of Science in Business Administration',
      '(BSEntrep) Bachelor of Science in Entrepreneurship',
    ],
  },
];

export const departmentOptions = collegeProgramOptions.map(({ college }) => college);
export const yearLevelOptions = ['First Year', 'Second Year', 'Third Year', 'Fourth Year'];
export const sectionOptions = ['Block A', 'Block B', 'Block C', 'Block D'];

export const securityQuestionOptions = [
  'What is the name of your first school?',
  "What is your mother's maiden name?",
  'What city were you born in?',
  'What is the name of your favorite teacher?',
  'What was the name of your first pet?',
  'What is your favorite book?',
];

export function programsForCollege(college) {
  return collegeProgramOptions.find((option) => option.college === college)?.programs || [];
}

export function formatRole(role) {
  return roleOptions.find((option) => option.value === role)?.label || 'User';
}

// School and employee IDs are typed as printed: letters, numbers, spaces,
// dashes, slashes and periods, up to 20 characters. No fixed format.
export const SCHOOL_ID_MAX_LENGTH = 20;
export const SCHOOL_ID_HINT = 'Type the ID exactly as printed on the school ID.';
export const SCHOOL_ID_ERROR = 'School ID can use letters, numbers, spaces, dashes, slashes and periods, up to 20 characters.';

export function isValidSchoolId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9 ./-]{0,19}$/.test(String(value || '').trim());
}

export function issuedIdError(label = 'ID') {
  return `${label} can use letters, numbers, spaces, dashes, slashes and periods, up to 20 characters.`;
}

// Keeps only the allowed characters while typing. The kind is unused now that
// school and employee IDs share one rule; callers still pass it.
export function normalizeIssuedId(value) {
  return String(value || '').replace(/[^A-Za-z0-9 ./-]/g, '').replace(/^[^A-Za-z0-9]+/, '').slice(0, SCHOOL_ID_MAX_LENGTH);
}

export function temporaryPassword(username, identifier, kind = 'employee') {
  const name = String(username || '').trim();
  const id = String(identifier || '').trim();
  const match = id.match(/^(?:(\d{4})-(\d{4})|(\d{6})-(\d{6}))$/);

  if (!name) {
    return '';
  }

  if (match) {
    return `${name}@${match[2] || match[4]}`;
  }

  // Any other ID uses its last letters or digits, as the server does:
  // four for a school ID, six for an employee ID.
  const suffix = isValidSchoolId(id) ? id.replace(/[^A-Za-z0-9]/g, '').slice(kind === 'student' ? -4 : -6) : '';

  return suffix ? `${name}@${suffix}` : '';
}

export function schoolEmailLocalPart(value) {
  const raw = String(value || '').trim().replace(/\s/g, '');
  const at = raw.indexOf('@');

  return at >= 0 ? raw.slice(0, at) : raw;
}

export function composeSchoolEmail(localPart) {
  const local = schoolEmailLocalPart(localPart).toLowerCase();

  if (!/^[a-z][a-z0-9._-]{2,49}$/.test(local)) {
    return '';
  }

  return `${local}@${schoolEmailDomain}`;
}

export function accountEmail(username) {
  return composeSchoolEmail(username);
}
