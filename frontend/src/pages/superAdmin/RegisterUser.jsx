import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BriefcaseBusiness,
  Camera,
  CheckCircle2,
  Eye,
  EyeOff,
  Fingerprint,
  GraduationCap,
  ImagePlus,
  KeyRound,
  Nfc,
  Save,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import { getManilaDateStamp } from '../../utils/dateTime';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/registerUser.css';

const roleOptions = [
  { value: 'student', label: 'Student' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'staff', label: 'Staff' },
  { value: 'admin', label: 'Admin' },
  { value: 'super_admin', label: 'Super Admin' },
];

const suffixOptions = ['', 'Jr.', 'Sr.', 'II', 'III', 'IV', 'V'];
const collegeProgramOptions = [
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
const departmentOptions = collegeProgramOptions.map(({ college }) => college);
const yearLevelOptions = ['First Year', 'Second Year', 'Third Year', 'Fourth Year'];
const sectionOptions = ['Block A', 'Block B', 'Block C', 'Block D'];
const schoolEmailDomain = 'csucc.edu.ph';
const schoolEmailPattern = `^[^\\s@]+@${schoolEmailDomain.replace(/\./g, '\\.')}$`;
const contactNumberLength = 11;
const schoolIdPattern = '^\\d{4}-\\d{4}$';
const commonRequiredFieldLabels = {
  first_name: 'First name',
  last_name: 'Last name',
  sex: 'Sex',
  date_of_birth: 'Date of birth',
  contact_number: 'Contact number',
  province: 'Province',
  city_municipality: 'City / Municipality',
  barangay: 'Barangay',
  email: 'Email',
  role: 'Role',
  username: 'Username',
  password: 'Password',
  confirm_password: 'Re-enter password',
};
const employeeRequiredFieldLabels = {
  employee_id: 'Employee ID',
  office_department: 'Department / Office',
  work_position: 'Position',
};
const studentRequiredFieldLabels = {
  school_id: 'School ID',
  college: 'College',
  program_department: 'Program / Department',
  year_level: 'Year level',
};

const initialForm = {
  username: '',
  password: '',
  email: '',
  role: 'faculty',
  first_name: '',
  middle_name: '',
  last_name: '',
  extension_name: '',
  sex: '',
  date_of_birth: '',
  age: '',
  contact_number: '',
  street_address: '',
  province: '',
  city_municipality: '',
  barangay: '',
  users_photo: '',
  employee_id: '',
  rfid_uid: '',
  office_department: '',
  work_position: '',
  school_id: '',
  college: '',
  program_department: '',
  year_level: '',
  section: '',
};
const registrationDraftKey = 'entrivo_register_user_draft';

function getDefaultForm(role) {
  return { ...initialForm, role };
}

function readRegistrationDraft(role) {
  const fallback = {
    form: getDefaultForm(role),
    confirmPassword: '',
    photoPreview: '',
  };

  try {
    const savedDraft = window.sessionStorage.getItem(registrationDraftKey);

    if (!savedDraft) {
      return fallback;
    }

    const parsedDraft = JSON.parse(savedDraft);

    return {
      form: { ...fallback.form, ...(parsedDraft.form || {}), role },
      confirmPassword: parsedDraft.confirmPassword || '',
      photoPreview: parsedDraft.photoPreview || '',
    };
  } catch {
    return fallback;
  }
}

function hasRegistrationInput(form, confirmPassword, photoPreview, initialRole) {
  const defaultForm = getDefaultForm(initialRole);

  return Boolean(
    confirmPassword
      || photoPreview
      || Object.entries(form).some(([field, value]) => String(value || '') !== String(defaultForm[field] || '')),
  );
}

function normalizeInitialRole(role) {
  const normalizedRole = (role || '').toLowerCase();

  if (normalizedRole === 'admins') {
    return 'admin';
  }

  if (normalizedRole === 'students') {
    return 'student';
  }

  if (normalizedRole === 'superadmin') {
    return 'super_admin';
  }

  return roleOptions.some((option) => option.value === normalizedRole) ? normalizedRole : 'faculty';
}

function formatRole(role) {
  return roleOptions.find((option) => option.value === role)?.label || 'User';
}

function getProgramOptions(college) {
  return collegeProgramOptions.find((option) => option.college === college)?.programs || [];
}

function toTitleCase(value) {
  return value
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (match, separator, letter) => `${separator}${letter.toUpperCase()}`);
}

function calculateAge(dateOfBirth) {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    return '';
  }

  const [birthYear, birthMonth, birthDay] = dateOfBirth.split('-').map(Number);
  const [todayYear, todayMonth, todayDay] = getManilaDateStamp().split('-').map(Number);

  let age = todayYear - birthYear;
  const hasBirthdayPassed =
    todayMonth > birthMonth || (todayMonth === birthMonth && todayDay >= birthDay);

  if (!hasBirthdayPassed) {
    age -= 1;
  }

  return age >= 0 ? String(age) : '';
}

function normalizeContactNumber(value) {
  return value.replace(/\D/g, '').slice(0, contactNumberLength);
}

function normalizeSchoolId(value) {
  const digits = value.replace(/\D/g, '').slice(0, 8);

  if (digits.length <= 4) {
    return digits;
  }

  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

function normalizeRfidUid(value) {
  return value.replace(/\s/g, '').toUpperCase().slice(0, 30);
}

function normalizeSchoolEmail(value) {
  const normalized = value.trim().toLowerCase().replace(/\s/g, '');

  if (!normalized || normalized.endsWith(`@${schoolEmailDomain}`)) {
    return normalized;
  }

  if (!normalized.includes('@')) {
    return `${normalized}@${schoolEmailDomain}`;
  }

  return normalized;
}

function validateForm(form, confirmPassword) {
  const errors = {};
  const requiredFieldLabels = {
    ...commonRequiredFieldLabels,
    ...(form.role === 'student' ? studentRequiredFieldLabels : employeeRequiredFieldLabels),
  };

  Object.entries(requiredFieldLabels).forEach(([field, label]) => {
    const value = field === 'confirm_password' ? confirmPassword : form[field];

    if (!String(value || '').trim()) {
      errors[field] = `${label} is required.`;
    }
  });

  if (form.role === 'student' && form.username.trim() && !form.username.includes('.')) {
    errors.username = 'Username must include a dot (.).';
  }

  if (form.password && form.password.length < 8) {
    errors.password = 'Password must be at least 8 characters.';
  }

  if (confirmPassword && confirmPassword !== form.password) {
    errors.confirm_password = 'Password and re-entered password must match.';
  }

  if (form.date_of_birth && calculateAge(form.date_of_birth) === '') {
    errors.date_of_birth = 'Date of birth must be a valid past date.';
  }

  if (form.contact_number && form.contact_number.length !== contactNumberLength) {
    errors.contact_number = 'Contact number must be 11 digits.';
  }

  if (form.role === 'student' && form.school_id && !/^\d{4}-\d{4}$/.test(form.school_id)) {
    errors.school_id = 'School ID must use xxxx-xxxx format.';
  }

  if (form.role === 'student' && form.college && !departmentOptions.includes(form.college)) {
    errors.college = 'Select a college from the list.';
  }

  if (form.role === 'student' && form.program_department) {
    const programOptions = getProgramOptions(form.college);

    if (!programOptions.includes(form.program_department)) {
      errors.program_department = 'Select a program for the chosen college.';
    }
  }

  const email = normalizeSchoolEmail(form.email);

  if (email && !email.endsWith(`@${schoolEmailDomain}`)) {
    errors.email = `Email must use the @${schoolEmailDomain} domain.`;
  }

  if (form.role === 'student' && form.rfid_uid && form.rfid_uid.length > 30) {
    errors.rfid_uid = 'RFID UID must be 30 characters or fewer.';
  }

  return errors;
}

function buildPayload(form) {
  return Object.fromEntries(
    Object.entries({ ...form, email: normalizeSchoolEmail(form.email) }).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.trim() : value,
    ]),
  );
}

export default function RegisterUser() {
  const params = new URLSearchParams(window.location.search);
  const initialRole = normalizeInitialRole(params.get('role'));
  const uploadInputRef = useRef(null);
  const formErrorRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const initialDraft = useMemo(() => readRegistrationDraft(initialRole), [initialRole]);
  const [form, setForm] = useState(initialDraft.form);
  const [confirmPassword, setConfirmPassword] = useState(initialDraft.confirmPassword);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(initialDraft.photoPreview);
  const [photoError, setPhotoError] = useState('');
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [savedUser, setSavedUser] = useState(null);
  const [touchedFields, setTouchedFields] = useState({});
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const roleLabel = useMemo(() => formatRole(form.role), [form.role]);
  const isStudentRole = form.role === 'student';
  const isSavedStudent = savedUser?.role === 'student';
  const savedStudentRfid = savedUser?.rfid?.rfid_uid || 'No RFID assigned';
  const programOptions = useMemo(() => getProgramOptions(form.college), [form.college]);
  const fieldErrors = useMemo(() => validateForm(form, confirmPassword), [form, confirmPassword]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateCollege(value) {
    setForm((current) => {
      const nextProgramOptions = getProgramOptions(value);

      return {
        ...current,
        college: value,
        program_department: nextProgramOptions.includes(current.program_department) ? current.program_department : '',
      };
    });
  }

  function markFieldTouched(field) {
    setTouchedFields((current) => ({ ...current, [field]: true }));
  }

  function getFieldError(field) {
    return hasSubmitted || touchedFields[field] ? fieldErrors[field] || '' : '';
  }

  function updateTitleField(field, value) {
    updateField(field, toTitleCase(value));
  }

  function updateDateOfBirth(value) {
    setForm((current) => ({
      ...current,
      date_of_birth: value,
      age: calculateAge(value),
    }));
  }

  function updateSchoolEmail(value) {
    updateField('email', value.toLowerCase().replace(/\s/g, ''));
  }

  function finalizeSchoolEmail() {
    markFieldTouched('email');
    updateField('email', normalizeSchoolEmail(form.email));
  }

  function FieldError({ field }) {
    const message = getFieldError(field);

    return (
      <small className={`register-user-field-error${message ? ' is-visible' : ''}`}>
        {message || ' '}
      </small>
    );
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function openCamera() {
    setPhotoError('');

    if (!navigator.mediaDevices?.getUserMedia) {
      setPhotoError('Camera is not available in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      setIsCameraOpen(true);
    } catch {
      setPhotoError('Unable to open camera. Please allow camera permission or upload a photo.');
    }
  }

  function closeCamera() {
    stopCamera();
    setIsCameraOpen(false);
  }

  function handlePhotoChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setPhotoError('Please choose a JPG or PNG image.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setPhotoError('Photo must be 2MB or smaller.');
      return;
    }

    setPhotoError('');
    updateField('users_photo', file.name);

    const reader = new FileReader();
    reader.onload = () => {
      setPhotoPreview(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.readAsDataURL(file);
  }

  function capturePhoto() {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    setPhotoPreview(canvas.toDataURL('image/png'));
    updateField('users_photo', `camera-capture-${Date.now()}.png`);
    closeCamera();
  }

  function clearPhoto() {
    setPhotoError('');
    setPhotoPreview('');
    updateField('users_photo', '');

    if (uploadInputRef.current) {
      uploadInputRef.current.value = '';
    }
  }

  function handleCancelRegistration() {
    window.sessionStorage.removeItem(registrationDraftKey);
    stopCamera();
    setForm(getDefaultForm(initialRole));
    setConfirmPassword('');
    setPhotoPreview('');
    setPhotoError('');
    setErrorMessage('');
    setTouchedFields({});
    setHasSubmitted(false);

    if (uploadInputRef.current) {
      uploadInputRef.current.value = '';
    }
  }

  function handleSkipFingerprintEnrollment() {
    setSavedUser(null);
    handleCancelRegistration();
  }

  useEffect(() => {
    if (isCameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [isCameraOpen]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        registrationDraftKey,
        JSON.stringify({ form, confirmPassword, photoPreview }),
      );
    } catch {
      // Ignore storage limits so the registration form stays usable.
    }
  }, [confirmPassword, form, photoPreview]);

  useEffect(() => {
    function handleBeforeUnload(event) {
      if (!hasRegistrationInput(form, confirmPassword, photoPreview, initialRole)) {
        return;
      }

      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [confirmPassword, form, initialRole, photoPreview]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  function scrollToFormError() {
    window.setTimeout(() => {
      const scrollContainer = formErrorRef.current?.closest('.super-admin-content');

      scrollContainer?.scrollTo({ top: 0, behavior: 'smooth' });
      window.scrollTo({ top: 0, behavior: 'smooth' });

      requestAnimationFrame(() => {
        formErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }, 0);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setErrorMessage('');
    setHasSubmitted(true);

    const currentErrors = validateForm(form, confirmPassword);

    if (Object.keys(currentErrors).length > 0) {
      setErrorMessage('Please correct the highlighted fields before saving.');
      scrollToFormError();
      setIsSaving(false);
      return;
    }

    const payload = buildPayload(form);

    try {
      const response = await axiosClient.post('/api/user.php', payload);
      window.sessionStorage.removeItem(registrationDraftKey);
      setSavedUser(response.data.user);
    } catch (error) {
      setErrorMessage(
        error.response?.data?.message || 'Unable to save this user. Please check the required details.',
      );
      scrollToFormError();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="admin-dashboard register-user-page" aria-label="Register user">
      <section className="dashboard-recent-card register-user-card" aria-label={`Register ${roleLabel} user`}>
        <div className="dashboard-panel-header register-user-header">
          <div>
            <span>Register {roleLabel}</span>
            <p>
              {isStudentRole
                ? 'Save the student profile and RFID details for access.'
                : 'Save the profile first. Fingerprint enrollment follows after the saved user is confirmed.'}
            </p>
          </div>
          <a className="dashboard-text-link register-user-back" href="/super-admin/manage-users">
            <ArrowLeft size={16} />
            Back to Manage Users
          </a>
        </div>

        <form className="register-user-form" onSubmit={handleSubmit} noValidate>
          <datalist id="department-office-options">
            {departmentOptions.map((department) => (
              <option key={department} value={department} />
            ))}
          </datalist>
          <div ref={formErrorRef} className="register-user-form-error-anchor">
            {errorMessage && (
              <div className="register-user-error register-user-form-error" role="alert">
                <span>{errorMessage}</span>
                <button type="button" aria-label="Dismiss error message" onClick={() => setErrorMessage('')}>
                  <X size={15} />
                </button>
              </div>
            )}
          </div>
          <div className="register-user-layout">
            <div className="register-user-main-column">
              <section className="register-user-section" aria-labelledby="personal-information">
                <div className="register-user-section-title">
                  <UserRound size={18} />
                  <h2 id="personal-information">Personal Information</h2>
                </div>

                <div className="register-user-field-grid">
                  <label>
                    <span>First Name</span>
                    <input
                      required
                      aria-invalid={Boolean(getFieldError('first_name'))}
                      value={form.first_name}
                      onChange={(event) => updateTitleField('first_name', event.target.value)}
                      onBlur={() => markFieldTouched('first_name')}
                    />
                    <FieldError field="first_name" />
                  </label>
                  <label>
                    <span>Middle Name</span>
                    <input
                      value={form.middle_name}
                      onChange={(event) => updateTitleField('middle_name', event.target.value)}
                    />
                    <FieldError field="middle_name" />
                  </label>
                  <label>
                    <span>Last Name</span>
                    <input
                      required
                      aria-invalid={Boolean(getFieldError('last_name'))}
                      value={form.last_name}
                      onChange={(event) => updateTitleField('last_name', event.target.value)}
                      onBlur={() => markFieldTouched('last_name')}
                    />
                    <FieldError field="last_name" />
                  </label>
                  <label>
                    <span>Suffix</span>
                    <select
                      value={form.extension_name}
                      onChange={(event) => updateField('extension_name', event.target.value)}
                      onBlur={() => markFieldTouched('extension_name')}
                    >
                      {suffixOptions.map((suffix) => (
                        <option key={suffix || 'none'} value={suffix}>
                          {suffix || 'No suffix'}
                        </option>
                      ))}
                    </select>
                    <FieldError field="extension_name" />
                  </label>
                  <label>
                    <span>Sex</span>
                    <select
                      required
                      aria-invalid={Boolean(getFieldError('sex'))}
                      value={form.sex}
                      onChange={(event) => updateField('sex', event.target.value)}
                      onBlur={() => markFieldTouched('sex')}
                    >
                      <option value="">Select sex</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                    <FieldError field="sex" />
                  </label>
                  <label>
                    <span>Date of Birth</span>
                    <input
                      required
                      type="date"
                      aria-invalid={Boolean(getFieldError('date_of_birth'))}
                      value={form.date_of_birth}
                      max={getManilaDateStamp()}
                      onChange={(event) => updateDateOfBirth(event.target.value)}
                      onBlur={() => markFieldTouched('date_of_birth')}
                    />
                    <FieldError field="date_of_birth" />
                  </label>
                  <label>
                    <span>Age</span>
                    <input
                      min="0"
                      type="number"
                      readOnly
                      value={form.age}
                    />
                    <FieldError field="age" />
                  </label>
                  <label>
                    <span>Contact Number</span>
                    <input
                      required
                      aria-invalid={Boolean(getFieldError('contact_number'))}
                      inputMode="numeric"
                      maxLength={contactNumberLength}
                      pattern="\d{11}"
                      placeholder="09*********"
                      value={form.contact_number}
                      onChange={(event) => updateField('contact_number', normalizeContactNumber(event.target.value))}
                      onBlur={() => markFieldTouched('contact_number')}
                    />
                    <FieldError field="contact_number" />
                  </label>
                  <div className="register-user-field-divider" aria-hidden="true" />
                  <label>
                    <span>Province</span>
                    <input
                      required
                      aria-invalid={Boolean(getFieldError('province'))}
                      value={form.province}
                      onChange={(event) => updateTitleField('province', event.target.value)}
                      onBlur={() => markFieldTouched('province')}
                    />
                    <FieldError field="province" />
                  </label>
                  <label>
                    <span>City / Municipality</span>
                    <input
                      required
                      aria-invalid={Boolean(getFieldError('city_municipality'))}
                      value={form.city_municipality}
                      onChange={(event) => updateTitleField('city_municipality', event.target.value)}
                      onBlur={() => markFieldTouched('city_municipality')}
                    />
                    <FieldError field="city_municipality" />
                  </label>
                  <label>
                    <span>Barangay</span>
                    <input
                      required
                      aria-invalid={Boolean(getFieldError('barangay'))}
                      value={form.barangay}
                      onChange={(event) => updateTitleField('barangay', event.target.value)}
                      onBlur={() => markFieldTouched('barangay')}
                    />
                    <FieldError field="barangay" />
                  </label>
                  <label>
                    <span>Street Address</span>
                    <input
                      value={form.street_address}
                      onChange={(event) => updateField('street_address', event.target.value)}
                      onBlur={() => markFieldTouched('street_address')}
                    />
                    <FieldError field="street_address" />
                  </label>
                </div>
              </section>

              <section
                className="register-user-section register-user-work-section"
                aria-labelledby={isStudentRole ? 'student-information' : 'work-information'}
              >
                <div className="register-user-section-title">
                  {isStudentRole ? <GraduationCap size={18} /> : <BriefcaseBusiness size={18} />}
                  <h2 id={isStudentRole ? 'student-information' : 'work-information'}>
                    {isStudentRole ? 'Student Information' : 'Occupation / Work Information'}
                  </h2>
                </div>

                <div className="register-user-field-grid">
                  {isStudentRole ? (
                    <>
                      <label>
                        <span>School ID</span>
                        <input
                          required
                          inputMode="numeric"
                          maxLength={9}
                          pattern={schoolIdPattern}
                          placeholder="xxxx-xxxx"
                          aria-invalid={Boolean(getFieldError('school_id'))}
                          value={form.school_id}
                          onChange={(event) => updateField('school_id', normalizeSchoolId(event.target.value))}
                          onBlur={() => markFieldTouched('school_id')}
                        />
                        <FieldError field="school_id" />
                      </label>
                      <label>
                        <span>Email</span>
                        <input
                          required
                          aria-invalid={Boolean(getFieldError('email'))}
                          type="email"
                          pattern={schoolEmailPattern}
                          placeholder={`username@${schoolEmailDomain}`}
                          value={form.email}
                          onBlur={finalizeSchoolEmail}
                          onChange={(event) => updateSchoolEmail(event.target.value)}
                        />
                        <FieldError field="email" />
                      </label>
                      <label>
                        <span>College</span>
                        <select
                          required
                          aria-invalid={Boolean(getFieldError('college'))}
                          value={form.college}
                          onChange={(event) => updateCollege(event.target.value)}
                          onBlur={() => markFieldTouched('college')}
                        >
                          <option value="">Select college</option>
                          {departmentOptions.map((department) => (
                            <option key={department} value={department}>
                              {department}
                            </option>
                          ))}
                        </select>
                        <FieldError field="college" />
                      </label>
                      <label>
                        <span>Program / Department</span>
                        <select
                          required
                          aria-invalid={Boolean(getFieldError('program_department'))}
                          disabled={!form.college}
                          value={form.program_department}
                          onChange={(event) => updateField('program_department', event.target.value)}
                          onBlur={() => markFieldTouched('program_department')}
                        >
                          <option value="">{form.college ? 'Select program' : 'Select college first'}</option>
                          {programOptions.map((program) => (
                            <option key={program} value={program}>
                              {program}
                            </option>
                          ))}
                        </select>
                        <FieldError field="program_department" />
                      </label>
                      <label>
                        <span>Year Level</span>
                        <select
                          required
                          aria-invalid={Boolean(getFieldError('year_level'))}
                          value={form.year_level}
                          onChange={(event) => updateField('year_level', event.target.value)}
                          onBlur={() => markFieldTouched('year_level')}
                        >
                          <option value="">Select year level</option>
                          {yearLevelOptions.map((yearLevel) => (
                            <option key={yearLevel} value={yearLevel}>
                              {yearLevel}
                            </option>
                          ))}
                        </select>
                        <FieldError field="year_level" />
                      </label>
                      <label>
                        <span>Section</span>
                        <select
                          value={form.section}
                          onChange={(event) => updateField('section', event.target.value)}
                          onBlur={() => markFieldTouched('section')}
                        >
                          <option value="">Select block</option>
                          {sectionOptions.map((section) => (
                            <option key={section} value={section}>
                              {section}
                            </option>
                          ))}
                        </select>
                        <FieldError field="section" />
                      </label>
                    </>
                  ) : (
                    <>
                      <label>
                        <span>Employee ID</span>
                        <input
                          required
                          aria-invalid={Boolean(getFieldError('employee_id'))}
                          value={form.employee_id}
                          onChange={(event) => updateField('employee_id', event.target.value)}
                          onBlur={() => markFieldTouched('employee_id')}
                        />
                        <FieldError field="employee_id" />
                      </label>
                      <label>
                        <span>Email</span>
                        <input
                          required
                          aria-invalid={Boolean(getFieldError('email'))}
                          type="email"
                          pattern={schoolEmailPattern}
                          placeholder={`username@${schoolEmailDomain}`}
                          value={form.email}
                          onBlur={finalizeSchoolEmail}
                          onChange={(event) => updateSchoolEmail(event.target.value)}
                        />
                        <FieldError field="email" />
                      </label>
                      <label>
                        <span>Position</span>
                        <input
                          required
                          aria-invalid={Boolean(getFieldError('work_position'))}
                          value={form.work_position}
                          onChange={(event) => updateField('work_position', event.target.value)}
                          onBlur={() => markFieldTouched('work_position')}
                        />
                        <FieldError field="work_position" />
                      </label>
                      <label>
                        <span>Department / Office</span>
                        <input
                          required
                          aria-invalid={Boolean(getFieldError('office_department'))}
                          list="department-office-options"
                          value={form.office_department}
                          onChange={(event) => updateField('office_department', event.target.value)}
                          onBlur={() => markFieldTouched('office_department')}
                        />
                        <FieldError field="office_department" />
                      </label>
                    </>
                  )}
                </div>
              </section>
            </div>

            <aside className="register-user-side-column" aria-label="Account and photo">
              <section className="register-user-side-card" aria-labelledby="account-information">
                <div className="register-user-section-title">
                  <KeyRound size={18} />
                  <h2 id="account-information">Account Information</h2>
                </div>

                <div className="register-user-side-fields">
                  <label>
                    <span>Role</span>
                    <select
                      value={form.role}
                      aria-invalid={Boolean(getFieldError('role'))}
                      onChange={(event) => updateField('role', event.target.value)}
                      onBlur={() => markFieldTouched('role')}
                    >
                      {roleOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <FieldError field="role" />
                  </label>
                  <label>
                    <span>Username</span>
                    <input
                      required
                      aria-invalid={Boolean(getFieldError('username'))}
                      placeholder={isStudentRole ? 'firstname.lastname' : 'username'}
                      value={form.username}
                      onChange={(event) => updateField('username', event.target.value)}
                      onBlur={() => markFieldTouched('username')}
                    />
                    <FieldError field="username" />
                  </label>
                  <label>
                    <span>Password</span>
                    <div className="register-user-password-field" data-invalid={Boolean(getFieldError('password'))}>
                      <input
                        required
                        minLength={8}
                        aria-invalid={Boolean(getFieldError('password'))}
                        type={isPasswordVisible ? 'text' : 'password'}
                        value={form.password}
                        onChange={(event) => updateField('password', event.target.value)}
                        onBlur={() => markFieldTouched('password')}
                      />
                      <button
                        type="button"
                        aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
                        onClick={() => setIsPasswordVisible((current) => !current)}
                      >
                        {isPasswordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <FieldError field="password" />
                  </label>
                  <label>
                    <span>Re-enter Password</span>
                    <div className="register-user-password-field" data-invalid={Boolean(getFieldError('confirm_password'))}>
                      <input
                        required
                        minLength={8}
                        aria-invalid={Boolean(getFieldError('confirm_password'))}
                        type={isConfirmPasswordVisible ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        onBlur={() => markFieldTouched('confirm_password')}
                      />
                      <button
                        type="button"
                        aria-label={isConfirmPasswordVisible ? 'Hide re-entered password' : 'Show re-entered password'}
                        onClick={() => setIsConfirmPasswordVisible((current) => !current)}
                      >
                        {isConfirmPasswordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <FieldError field="confirm_password" />
                  </label>
                </div>
              </section>

              {isStudentRole && (
                <section className="register-user-side-card register-user-rfid-card" aria-labelledby="rfid-information">
                  <div className="register-user-section-title">
                    <Nfc size={16} strokeWidth={2.25} />
                    <h2 id="rfid-information">RFID</h2>
                  </div>

                  <div className="register-user-side-fields">
                    <label>
                      <span>RFID UID</span>
                      <input
                        aria-invalid={Boolean(getFieldError('rfid_uid'))}
                        maxLength={30}
                        placeholder="Scan or enter RFID UID"
                        value={form.rfid_uid}
                        onChange={(event) => updateField('rfid_uid', normalizeRfidUid(event.target.value))}
                        onBlur={() => markFieldTouched('rfid_uid')}
                      />
                      <FieldError field="rfid_uid" />
                    </label>
                  </div>
                </section>
              )}

              <section className="register-user-side-card" aria-labelledby="user-photo">
                <div className="register-user-section-title">
                  <ImagePlus size={18} />
                  <h2 id="user-photo">User Photo</h2>
                </div>

                <div className="register-user-photo-dropzone">
                  {photoPreview ? (
                    <>
                      <img src={photoPreview} alt="Selected user preview" />
                      <button
                        className="register-user-photo-delete"
                        type="button"
                        onClick={clearPhoto}
                        aria-label="Delete selected photo"
                        title="Delete selected photo"
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  ) : (
                    <div>
                      <ImagePlus size={34} />
                      <span>Photo preview</span>
                    </div>
                  )}
                </div>

                <input
                  ref={uploadInputRef}
                  className="register-user-hidden-file"
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handlePhotoChange}
                />

                <div className="register-user-photo-actions">
                  <button type="button" onClick={() => uploadInputRef.current?.click()}>
                    <Upload size={17} strokeWidth={2.25} />
                    Upload Photo
                  </button>
                  <button type="button" onClick={openCamera}>
                    <Camera size={17} strokeWidth={2.25} />
                    {photoPreview ? 'Retake' : 'Take Photo'}
                  </button>
                </div>

                <p className="register-user-photo-help">Allowed file types: JPG, PNG<br />Max file size: 2MB</p>
                {photoError && <p className="register-user-photo-error">{photoError}</p>}
              </section>
            </aside>
          </div>

          <div className="register-user-actions">
            <button
              className="register-user-cancel-button"
              disabled={isSaving}
              type="button"
              onClick={handleCancelRegistration}
            >
              <X size={16} />
              Cancel
            </button>
            <button className="manage-users-register-button" disabled={isSaving} type="submit">
              <Save size={16} />
              {isSaving ? 'Saving User...' : 'Save User'}
            </button>
          </div>
        </form>
      </section>

      {savedUser && isSavedStudent && (
        <div className="register-user-modal-backdrop" role="presentation">
          <section
            className="register-user-modal register-user-success-modal register-user-student-success-modal"
            aria-label="Student registration success"
            role="dialog"
            aria-modal="true"
          >
            <button
              className="register-user-modal-close"
              type="button"
              aria-label="Close student registration success"
              onClick={handleSkipFingerprintEnrollment}
            >
              <X size={20} />
            </button>

            <div className="register-user-success-header">
              <div className="register-user-modal-icon">
                <CheckCircle2 size={44} />
              </div>
              <div className="register-user-modal-header">
                <span>Student saved successfully!</span>
                <h2>Student Registration Complete</h2>
                <p>The student account and access details have been saved.</p>
              </div>
            </div>

            <div className="register-user-success-grid">
              <section className="register-user-success-panel" aria-label="Student information">
                <div className="register-user-panel-heading">
                  <span className="register-user-panel-icon">
                    <GraduationCap size={20} />
                  </span>
                  <h3>Student Information</h3>
                </div>

                <dl className="register-user-detail-list">
                  {[
                    ['Full Name', savedUser.full_name, UserRound],
                    ['Email', savedUser.email?.toLowerCase(), KeyRound],
                    ['School ID', savedUser.school_id, GraduationCap],
                    ['RFID', savedStudentRfid, Nfc],
                  ].map(([label, value, Icon]) => (
                    <div className="register-user-detail-row" key={label}>
                      <dt>
                        <Icon size={15} />
                        {label}
                      </dt>
                      <dd>{value || 'Not provided'}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>

            <div className="register-user-modal-actions">
              <button className="register-user-enroll-button" type="button" onClick={handleSkipFingerprintEnrollment}>
                <CheckCircle2 size={17} />
                Done
              </button>
            </div>
          </section>
        </div>
      )}

      {savedUser && !isSavedStudent && (
        <div className="register-user-modal-backdrop" role="presentation">
          <section
            className="register-user-modal register-user-success-modal"
            aria-label="Fingerprint enrollment section"
            role="dialog"
            aria-modal="true"
          >
            <button
              className="register-user-modal-close"
              type="button"
              aria-label="Close fingerprint enrollment section"
              onClick={handleSkipFingerprintEnrollment}
            >
              <X size={20} />
            </button>

            <div className="register-user-success-header">
              <div className="register-user-modal-icon">
                <CheckCircle2 size={44} />
              </div>
              <div className="register-user-modal-header">
                <span>User saved successfully!</span>
                <h2>Fingerprint Enrollment Section</h2>
                <p>A pending fingerprint record has been created for this user.</p>
                <p>You can enroll the fingerprint now or skip for later.</p>
              </div>
            </div>

            <div className="register-user-success-grid">
              <section className="register-user-success-panel" aria-label="User information">
                <div className="register-user-panel-heading">
                  <span className="register-user-panel-icon">
                    <UserRound size={20} />
                  </span>
                  <h3>User Information</h3>
                </div>

                <dl className="register-user-detail-list">
                  {[
                    ['Full Name', savedUser.full_name, UserRound],
                    ['Employee ID', savedUser.employee_id, KeyRound],
                    ['Role', formatRole(savedUser.role), UserRound],
                    ['Department', savedUser.department || 'Not provided', BriefcaseBusiness],
                    ['Position', savedUser.position || 'Not provided', BriefcaseBusiness],
                    ['Fingerprint ID', savedUser.fingerprint?.fingerprint_id || 'Pending', Fingerprint],
                  ].map(([label, value, Icon]) => (
                    <div className="register-user-detail-row" key={label}>
                      <dt>
                        <Icon size={15} />
                        {label}
                      </dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="register-user-success-panel" aria-label="Fingerprint status">
                <div className="register-user-panel-heading">
                  <span className="register-user-panel-icon">
                    <Fingerprint size={20} />
                  </span>
                  <h3>Fingerprint Status</h3>
                </div>

                <div className="register-user-fingerprint-status-card">
                  <span className="register-user-status-clock" aria-hidden="true" />
                  <strong>{savedUser.fingerprint?.status || 'Pending'}</strong>
                  <p>No fingerprint enrolled yet.</p>
                  <p>Click the button below to enroll fingerprint now.</p>
                </div>
              </section>
            </div>

            <p className="register-user-success-note">
              <span aria-hidden="true">i</span>
              You can always enroll or update the fingerprint later from the <strong>Fingerprint</strong> menu.
            </p>

            <div className="register-user-modal-actions">
              <button className="register-user-skip-button" type="button" onClick={handleSkipFingerprintEnrollment}>
                <span className="register-user-button-clock" aria-hidden="true" />
                Skip for now
              </button>
              <button className="register-user-enroll-button" type="button">
                <Fingerprint size={17} />
                Enroll Fingerprint Now
              </button>
            </div>
          </section>
        </div>
      )}

      {isCameraOpen && (
        <div className="register-user-modal-backdrop" role="presentation">
          <section className="register-user-camera-modal" aria-label="Take user photo" role="dialog">
            <div className="register-user-camera-header">
              <div>
                <span>Camera</span>
                <h2>Take Photo</h2>
              </div>
              <button type="button" aria-label="Close camera" onClick={closeCamera}>
                <X size={18} />
              </button>
            </div>
            <video ref={videoRef} autoPlay playsInline muted />
            <div className="register-user-camera-actions">
              <button type="button" onClick={capturePhoto}>
                <Camera size={16} />
                Capture Photo
              </button>
              <button type="button" onClick={closeCamera}>
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
