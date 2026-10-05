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

export function normalizeIssuedId(value, kind = 'student') {
  const groupSize = kind === 'employee' ? 6 : 4;
  const digits = String(value || '').replace(/\D/g, '').slice(0, groupSize * 2);

  if (digits.length <= groupSize) {
    return digits;
  }

  return `${digits.slice(0, groupSize)}-${digits.slice(groupSize)}`;
}

export function temporaryPassword(username, identifier) {
  const name = String(username || '').trim();
  const match = String(identifier || '').match(/^(?:(\d{4})-(\d{4})|(\d{6})-(\d{6}))$/);

  if (!name || !match) {
    return '';
  }

  return `${name}@${match[2] || match[4]}`;
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
