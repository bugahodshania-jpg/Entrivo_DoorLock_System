import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, Eye, EyeOff, GraduationCap, IdCard, Info, KeyRound, Lock, MapPin, Menu, Shield, Trash2, Upload, UserRound, X } from 'lucide-react';
import PixelWave from '../../components/PixelWave';
import axiosClient from '../../api/axiosClient';
import logo from '../../assets/images/entrivo_logo.png';
import schoolIdExample from '../../assets/images/csucc-school-id-example.jpg';
import { getManilaDateStamp } from '../../utils/dateTime';
import '../../styles/home/home.css';
import '../../styles/auth/auth.css';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/registerUser.css';

const steps = [
  {
    id: 1,
    label: 'Personal Information',
    shortLabel: 'Personal Info',
    subtitle: 'Fill in your personal information and address.',
    icon: UserRound,
  },
  {
    id: 2,
    label: 'Student Information',
    shortLabel: 'School Information',
    subtitle: 'Fill in your school information and photograph your school ID.',
    icon: GraduationCap,
  },
  {
    id: 3,
    label: 'Create Account',
    shortLabel: 'Create Account',
    subtitle: 'Choose the email, username, and password for this account.',
    icon: KeyRound,
  },
  {
    id: 4,
    label: 'Security Questions',
    shortLabel: 'Security Questions',
    subtitle: 'Add three security questions for account recovery.',
    icon: Lock,
  },
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
const securityQuestionOptions = [
  'What is the name of your first school?',
  "What is your mother's maiden name?",
  'What city were you born in?',
  'What is the name of your favorite teacher?',
  'What was the name of your first pet?',
  'What is your favorite book?',
];
const schoolEmailDomain = 'csucc.edu.ph';
const contactNumberLength = 11;
const stepFields = {
  1: ['first_name', 'middle_name', 'last_name', 'extension_name', 'sex', 'contact_number', 'date_of_birth', 'street_address', 'barangay', 'city_municipality', 'province', 'zip_code', 'country'],
  2: ['school_id', 'college', 'program_department', 'year_level', 'section', 'school_id_photo'],
  3: ['email', 'username', 'password', 'confirm_password'],
  4: ['security_question_1', 'security_answer_1', 'security_question_2', 'security_answer_2', 'security_question_3', 'security_answer_3'],
};

const initialForm = {
  first_name: '',
  middle_name: '',
  last_name: '',
  extension_name: '',
  sex: '',
  date_of_birth: '',
  age: '',
  contact_number: '',
  street_address: '',
  barangay: '',
  city_municipality: '',
  province: '',
  zip_code: '',
  country: 'Philippines',
  school_id: '',
  rfid_uid: '',
  email: '',
  college: '',
  program_department: '',
  year_level: '',
  section: '',
  school_id_photo: '',
  username: '',
  password: '',
  confirm_password: '',
};

const initialQuestions = [
  { question: '', answer: '' },
  { question: '', answer: '' },
  { question: '', answer: '' },
];

function getProgramOptions(college) {
  return collegeProgramOptions.find((option) => option.college === college)?.programs || [];
}

function toTitleCase(value) {
  return value
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (match, separator, letter) => `${separator}${letter.toUpperCase()}`);
}

function buildUsername(firstName, lastName) {
  const part = (value) => value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  const first = part(firstName);
  const last = part(lastName);

  if (!first || !last) {
    return first || last;
  }

  return `${first}.${last}`.slice(0, 50);
}

function getPasswordRuleChecks(password) {
  return {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

function getPasswordStrength(password) {
  if (!password) {
    return 0;
  }

  const met = Object.values(getPasswordRuleChecks(password)).filter(Boolean).length;

  if (met >= 5) return 4;
  if (met >= 4) return 3;
  if (met >= 3) return 2;
  if (met >= 1) return 1;

  return 0;
}

function calculateAge(dateOfBirth) {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    return '';
  }

  const [birthYear, birthMonth, birthDay] = dateOfBirth.split('-').map(Number);
  const [todayYear, todayMonth, todayDay] = getManilaDateStamp().split('-').map(Number);
  let age = todayYear - birthYear;
  const hasBirthdayPassed = todayMonth > birthMonth || (todayMonth === birthMonth && todayDay >= birthDay);

  if (!hasBirthdayPassed) {
    age -= 1;
  }

  return age >= 0 ? String(age) : '';
}

function normalizeContactNumber(value) {
  return value.replace(/\D/g, '').slice(0, contactNumberLength);
}

function normalizeZipCode(value) {
  return value.replace(/\D/g, '').slice(0, 4);
}

function normalizeSchoolId(value) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return digits.length <= 4 ? digits : `${digits.slice(0, 4)}-${digits.slice(4)}`;
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

function validateRegistration(form, questions) {
  const errors = {};

  if (!form.first_name.trim()) errors.first_name = 'First name is required.';
  if (!form.last_name.trim()) errors.last_name = 'Last name is required.';
  if (!form.sex) errors.sex = 'Sex is required.';
  if (!form.date_of_birth) {
    errors.date_of_birth = 'Date of birth is required.';
  } else if (calculateAge(form.date_of_birth) === '') {
    errors.date_of_birth = 'Date of birth must be a valid past date.';
  }
  if (!form.contact_number) {
    errors.contact_number = 'Contact number is required.';
  } else if (form.contact_number.length !== contactNumberLength) {
    errors.contact_number = 'Contact number must be 11 digits.';
  }
  if (!form.street_address.trim()) errors.street_address = 'Street address is required.';
  if (!form.barangay.trim()) errors.barangay = 'Barangay is required.';
  if (!form.city_municipality.trim()) errors.city_municipality = 'City / Municipality is required.';
  if (!form.province.trim()) errors.province = 'Province is required.';
  if (!form.zip_code) {
    errors.zip_code = 'Zip code is required.';
  } else if (!/^\d{4}$/.test(form.zip_code)) {
    errors.zip_code = 'Zip code must be 4 digits.';
  }
  if (!form.country.trim()) errors.country = 'Country is required.';

  if (!form.school_id) {
    errors.school_id = 'School ID is required.';
  } else if (!/^\d{4}-\d{4}$/.test(form.school_id)) {
    errors.school_id = 'School ID must use xxxx-xxxx format.';
  }

  const email = normalizeSchoolEmail(form.email);
  if (!email) {
    errors.email = 'Email is required.';
  } else if (!email.endsWith(`@${schoolEmailDomain}`)) {
    errors.email = `Email must use the @${schoolEmailDomain} domain.`;
  }

  if (!form.college) {
    errors.college = 'College is required.';
  } else if (!departmentOptions.includes(form.college)) {
    errors.college = 'Select a college from the list.';
  }

  if (!form.program_department) {
    errors.program_department = 'Program / Department is required.';
  } else if (!getProgramOptions(form.college).includes(form.program_department)) {
    errors.program_department = 'Select a program for the chosen college.';
  }

  if (!form.year_level) {
    errors.year_level = 'Year level is required.';
  } else if (!yearLevelOptions.includes(form.year_level)) {
    errors.year_level = 'Select a year level from the list.';
  }

  if (form.section && !sectionOptions.includes(form.section)) {
    errors.section = 'Select a section from the list.';
  }

  if (!form.school_id_photo) {
    errors.school_id_photo = 'A photo of your school ID is required.';
  } else if (!/^data:image\/(jpeg|png);base64,/.test(form.school_id_photo)) {
    errors.school_id_photo = 'School ID photo must be a JPG or PNG image.';
  } else if (form.school_id_photo.length > 2500000) {
    errors.school_id_photo = 'School ID photo must be 2MB or smaller.';
  }

  if (!form.username.trim()) {
    errors.username = 'Username is required.';
  } else if (/\s/.test(form.username)) {
    errors.username = 'Username cannot contain spaces.';
  } else if (!form.username.includes('.')) {
    errors.username = 'Username must include a dot (.).';
  } else if (form.username.trim().length > 50) {
    errors.username = 'Username must be 50 characters or fewer.';
  }

  if (!form.password) {
    errors.password = 'Password is required.';
  } else if (form.password.length < 8) {
    errors.password = 'Password must be at least 8 characters.';
  } else if (!/[A-Z]/.test(form.password)) {
    errors.password = 'Password must include an uppercase letter.';
  } else if (!/[a-z]/.test(form.password)) {
    errors.password = 'Password must include a lowercase letter.';
  } else if (!/\d/.test(form.password)) {
    errors.password = 'Password must include a number.';
  } else if (!/[^A-Za-z0-9]/.test(form.password)) {
    errors.password = 'Password must include a special character.';
  } else if (form.password.length > 72) {
    errors.password = 'Password must be 72 characters or fewer.';
  }

  if (!form.confirm_password) {
    errors.confirm_password = 'Re-enter password is required.';
  } else if (form.confirm_password !== form.password) {
    errors.confirm_password = 'Password and re-entered password must match.';
  }

  const chosenQuestions = questions.map((item) => item.question).filter(Boolean);
  questions.forEach((item, index) => {
    const questionKey = `security_question_${index + 1}`;
    const answerKey = `security_answer_${index + 1}`;
    const answer = item.answer.trim();

    if (!item.question) {
      errors[questionKey] = 'Security question is required.';
    } else if (!securityQuestionOptions.includes(item.question)) {
      errors[questionKey] = 'Select a security question from the list.';
    } else if (chosenQuestions.filter((question) => question === item.question).length > 1) {
      errors[questionKey] = 'Choose three different security questions.';
    }

    if (!answer) {
      errors[answerKey] = 'Security answer is required.';
    } else if (answer.length < 2) {
      errors[answerKey] = 'Security answer must be at least 2 characters.';
    } else if (answer.length > 100) {
      errors[answerKey] = 'Security answer must be 100 characters or fewer.';
    }
  });

  return errors;
}

function firstInvalidStep(errors) {
  return steps.find((step) => stepFields[step.id].some((field) => errors[field]))?.id || 0;
}

const registrationDraftKey = 'entrivo_public_register_draft';
const verifiedRfidKey = 'entrivo_verified_rfid_uid';

function readVerifiedRfidUid() {
  try {
    return window.sessionStorage.getItem(verifiedRfidKey) || '';
  } catch {
    return '';
  }
}

function readRegistrationDraft() {
  const verifiedRfidUid = readVerifiedRfidUid();
  const fallback = {
    step: 1,
    form: { ...initialForm, rfid_uid: verifiedRfidUid },
    questions: initialQuestions,
  };

  try {
    const savedDraft = window.sessionStorage.getItem(registrationDraftKey);

    if (!savedDraft) {
      return fallback;
    }

    const parsedDraft = JSON.parse(savedDraft);
    const savedStep = Number(parsedDraft.step);
    const savedQuestions = Array.isArray(parsedDraft.questions) ? parsedDraft.questions : [];

    return {
      step: savedStep >= 1 && savedStep <= steps.length ? savedStep : 1,
      form: {
        ...initialForm,
        ...(parsedDraft.form || {}),
        rfid_uid: verifiedRfidUid || parsedDraft.form?.rfid_uid || '',
      },
      questions: initialQuestions.map((item, index) => ({
        question: typeof savedQuestions[index]?.question === 'string' ? savedQuestions[index].question : item.question,
        answer: typeof savedQuestions[index]?.answer === 'string' ? savedQuestions[index].answer : item.answer,
      })),
    };
  } catch {
    return fallback;
  }
}

export default function Register() {
  const savedDraft = useMemo(() => readRegistrationDraft(), []);
  const [step, setStep] = useState(savedDraft.step);
  const [form, setForm] = useState(savedDraft.form);
  const [questions, setQuestions] = useState(savedDraft.questions);
  const [touchedFields, setTouchedFields] = useState({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
  const [visibleAnswers, setVisibleAnswers] = useState([false, false, false]);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [createdAccount, setCreatedAccount] = useState(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [idPhotoAction, setIdPhotoAction] = useState('');
  const [idPhotoError, setIdPhotoError] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const uploadInputRef = useRef(null);
  const usernameIsAutoRef = useRef(
    !savedDraft.form.username
    || savedDraft.form.username === buildUsername(savedDraft.form.first_name, savedDraft.form.last_name),
  );
  const fieldErrors = useMemo(() => validateRegistration(form, questions), [form, questions]);
  const programOptions = useMemo(() => getProgramOptions(form.college), [form.college]);
  const currentStep = steps[step - 1];
  const StepIcon = currentStep.icon;

  function updateField(field, value) {
    if (field === 'username') {
      usernameIsAutoRef.current = value === buildUsername(form.first_name, form.last_name);
    }

    setForm((current) => ({ ...current, [field]: value }));
  }

  function markFieldsTouched(fields) {
    setTouchedFields((current) => ({
      ...current,
      ...Object.fromEntries(fields.map((field) => [field, true])),
    }));
  }

  function getFieldError(field) {
    return touchedFields[field] ? fieldErrors[field] || '' : '';
  }

  function FieldError({ field }) {
    const message = getFieldError(field);

    return (
      <small className={`register-user-field-error${message ? ' is-visible' : ''}`}>
        {message || ' '}
      </small>
    );
  }

  function updateTitleField(field, value) {
    updateField(field, toTitleCase(value));
  }

  function updateCollege(value) {
    setForm((current) => {
      const nextPrograms = getProgramOptions(value);

      return {
        ...current,
        college: value,
        program_department: nextPrograms.includes(current.program_department) ? current.program_department : '',
      };
    });
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function openCamera() {
    setIdPhotoError('');

    if (!navigator.mediaDevices?.getUserMedia) {
      setIdPhotoError('Camera permission was denied. Allow camera access to capture your school ID.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setIsCameraOpen(true);
    } catch {
      setIdPhotoError('Camera permission was denied. Allow camera access to capture your school ID.');
    }
  }

  function closeCamera() {
    stopCamera();
    setIsCameraOpen(false);
  }

  function captureSchoolId() {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    const sourceWidth = video.videoWidth || 480;
    const sourceHeight = video.videoHeight || 640;
    const portraitRatio = 3 / 4;
    let cropWidth = sourceWidth;
    let cropHeight = sourceHeight;

    if (sourceWidth / sourceHeight > portraitRatio) {
      cropWidth = sourceHeight * portraitRatio;
    } else {
      cropHeight = sourceWidth / portraitRatio;
    }

    const cropX = (sourceWidth - cropWidth) / 2;
    const cropY = (sourceHeight - cropHeight) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 960;
    canvas.getContext('2d').drawImage(
      video,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    updateField('school_id_photo', canvas.toDataURL('image/jpeg', 0.82));
    setIdPhotoError('');
    markFieldsTouched(['school_id_photo']);
    closeCamera();
  }

  function handleSchoolIdUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setIdPhotoError('Please choose a JPG or PNG image.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const source = typeof reader.result === 'string' ? reader.result : '';
      const image = new Image();

      image.onload = () => {
        const maxSide = 960;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const photo = canvas.toDataURL('image/jpeg', 0.82);

        if (photo.length > 2500000) {
          setIdPhotoError('School ID photo must be 2MB or smaller.');
          return;
        }

        updateField('school_id_photo', photo);
        setIdPhotoError('');
        markFieldsTouched(['school_id_photo']);
      };

      image.onerror = () => {
        setIdPhotoError('Please choose a JPG or PNG image.');
      };
      image.src = source;
    };
    reader.readAsDataURL(file);
  }

  function clearSchoolIdPhoto() {
    updateField('school_id_photo', '');
    setIdPhotoError('');

    if (uploadInputRef.current) {
      uploadInputRef.current.value = '';
    }
  }

  function continueSchoolIdPhoto() {
    const action = idPhotoAction;
    setIdPhotoAction('');

    if (action === 'camera') {
      openCamera();
      return;
    }

    if (action === 'upload') {
      uploadInputRef.current?.click();
    }
  }

  useEffect(() => {
    if (!usernameIsAutoRef.current) {
      return;
    }

    const nextUsername = buildUsername(form.first_name, form.last_name);

    setForm((current) => (
      current.username === nextUsername ? current : { ...current, username: nextUsername }
    ));
  }, [form.first_name, form.last_name]);

  useEffect(() => {
    if (isCameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [isCameraOpen]);

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    if (createdAccount) {
      window.sessionStorage.removeItem(registrationDraftKey);
      window.sessionStorage.removeItem(verifiedRfidKey);
      return;
    }

    const draft = { step, form, questions };

    try {
      window.sessionStorage.setItem(registrationDraftKey, JSON.stringify(draft));
    } catch {
      try {
        window.sessionStorage.setItem(registrationDraftKey, JSON.stringify({
          step,
          form: { ...form, school_id_photo: '' },
          questions,
        }));
      } catch {
        try {
          window.sessionStorage.setItem(registrationDraftKey, JSON.stringify({
            step,
            form: initialForm,
            questions: initialQuestions,
          }));
        } catch {
          // Keep the current step in memory when the browser cannot store the draft.
        }
      }
    }
  }, [createdAccount, form, questions, step]);

  function updateQuestion(index, key, value) {
    setQuestions((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [key]: value } : item
    )));
  }

  function goNext() {
    const fields = stepFields[step];
    markFieldsTouched(fields);

    if (fields.some((field) => fieldErrors[field])) {
      return;
    }

    setErrorMessage('');
    setStep((current) => Math.min(steps.length, current + 1));
  }

  function goBack() {
    setErrorMessage('');
    setStep((current) => Math.max(1, current - 1));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const fields = Object.values(stepFields).flat();
    markFieldsTouched(fields);
    const invalidStep = firstInvalidStep(fieldErrors);

    if (invalidStep) {
      setStep(invalidStep);
      setErrorMessage('');
      return;
    }

    setIsSaving(true);
    setErrorMessage('');

    try {
      const response = await axiosClient.post('/api/public_register.php', {
        ...form,
        email: normalizeSchoolEmail(form.email),
        rfid_uid: form.rfid_uid,
        security_questions: questions.map((item) => ({
          question: item.question,
          answer: item.answer.trim(),
        })),
      });
      setCreatedAccount(response.data);
    } catch (error) {
      setErrorMessage(error.response?.data?.message || 'Unable to create the account right now.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className={`auth-page auth-page-register${menuOpen ? ' is-menu-open' : ''}`}>
      <PixelWave variant="auth" className="auth-pixel-wave auth-pixel-wave-corner" />
      <PixelWave variant="auth" className="auth-pixel-wave auth-pixel-wave-corner is-top-left" />
      <header className="home-header">
        <div className="home-header-inner">
          <a className="home-brand" href="/" aria-label="Entrivo home">
            <img src={logo} alt="Entrivo logo" />
            <span>Entrivo</span>
          </a>
          <button
            type="button"
            className="home-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="register-mobile-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <div className={`home-header-right${menuOpen ? ' is-open' : ''}`} id="register-mobile-nav">
            <nav className="home-actions" aria-label="Primary">
              <a className="home-link-button" href="/" onClick={() => setMenuOpen(false)}>
                Home
              </a>
              <a className="home-primary-button" href="/login" onClick={() => setMenuOpen(false)}>
                Sign in
              </a>
            </nav>
          </div>
        </div>
      </header>

      {createdAccount ? (
        <div className="public-register-success-screen">
          <section className="public-register-success" role="dialog" aria-modal="true" aria-labelledby="account-created-title">
            <h2 id="account-created-title">Waiting for Approval</h2>
            <p>
              Your account has been created successfully and is now <strong>waiting for approval</strong>.
            </p>
            <p>
              Please allow up to <strong>24 hours</strong> for your account to be reviewed. If your account is still pending after the 24-hour period, please contact an administrator for assistance.
            </p>
            {createdAccount.user?.approval_due_at ? (
              <p>
                <strong>You may follow up after {createdAccount.user.approval_due_at} if your account is still pending.</strong>
              </p>
            ) : null}
            <a className="public-register-submit" href="/login">
              Back to sign in
            </a>
          </section>
        </div>
      ) : (
      <section className="public-register-shell" aria-labelledby="register-title">
        <div className="dashboard-recent-card register-user-card public-register-card">
          <div className="public-register-top">
            <div className="public-register-brand">
              <img src={logo} alt="" />
              <div>
                <h1 id="register-title">Create Your Account</h1>
                <p>{currentStep.subtitle}</p>
              </div>
            </div>
            <ol className="public-register-steps" aria-label="Registration steps">
              {steps.map((item, index) => (
                <li
                  key={item.id}
                  className={`public-register-step${item.id === step ? ' is-active' : ''}${item.id < step ? ' is-complete' : ''}`}
                  aria-current={item.id === step ? 'step' : undefined}
                >
                  <div className="public-register-step-track">
                    <span>{item.id}</span>
                    {index < steps.length - 1 ? <i aria-hidden="true" /> : null}
                  </div>
                  <small>{item.shortLabel}</small>
                </li>
              ))}
            </ol>
          </div>

          <form className="register-user-form public-register-form" onSubmit={handleSubmit} noValidate>
              {errorMessage ? (
                <div className="register-user-error register-user-form-error" role="alert">
                  <span>{errorMessage}</span>
                  <button type="button" aria-label="Dismiss error message" onClick={() => setErrorMessage('')}>
                    <X size={15} />
                  </button>
                </div>
              ) : null}

              <section className="register-user-section" aria-labelledby="register-step-title">
                <div className="register-user-section-title">
                  <StepIcon size={18} />
                  <h2 id="register-step-title">{currentStep.label}</h2>
                </div>

                {step === 1 ? (
                  <div className="register-user-field-grid public-register-personal">
                    <label>
                      <span>First Name<i className="public-register-required">*</i></span>
                      <input
                        required
                        placeholder="Enter your first name"
                        aria-invalid={Boolean(getFieldError('first_name'))}
                        value={form.first_name}
                        onChange={(event) => updateTitleField('first_name', event.target.value)}
                        onBlur={() => markFieldsTouched(['first_name'])}
                      />
                      <FieldError field="first_name" />
                    </label>
                    <label>
                      <span>Middle Name <small>(Optional)</small></span>
                      <input
                        placeholder="Enter your middle name"
                        value={form.middle_name}
                        onChange={(event) => updateTitleField('middle_name', event.target.value)}
                      />
                      <FieldError field="middle_name" />
                    </label>
                    <label>
                      <span>Last Name<i className="public-register-required">*</i></span>
                      <input
                        required
                        placeholder="Enter your last name"
                        aria-invalid={Boolean(getFieldError('last_name'))}
                        value={form.last_name}
                        onChange={(event) => updateTitleField('last_name', event.target.value)}
                        onBlur={() => markFieldsTouched(['last_name'])}
                      />
                      <FieldError field="last_name" />
                    </label>
                    <label>
                      <span>Suffix <small>(Optional)</small></span>
                      <select
                        value={form.extension_name}
                        onChange={(event) => updateField('extension_name', event.target.value)}
                      >
                        {suffixOptions.map((suffix) => (
                          <option key={suffix || 'none'} value={suffix}>
                            {suffix || 'e.g. Jr., III, Sr.'}
                          </option>
                        ))}
                      </select>
                      <FieldError field="extension_name" />
                    </label>
                    <label>
                      <span>Sex<i className="public-register-required">*</i></span>
                      <select
                        required
                        aria-invalid={Boolean(getFieldError('sex'))}
                        value={form.sex}
                        onChange={(event) => updateField('sex', event.target.value)}
                        onBlur={() => markFieldsTouched(['sex'])}
                      >
                        <option value="">Select sex</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                      </select>
                      <FieldError field="sex" />
                    </label>
                    <label>
                      <span>Contact Number<i className="public-register-required">*</i></span>
                      <input
                        required
                        inputMode="numeric"
                        maxLength={contactNumberLength}
                        placeholder="09*********"
                        aria-invalid={Boolean(getFieldError('contact_number'))}
                        value={form.contact_number}
                        onChange={(event) => updateField('contact_number', normalizeContactNumber(event.target.value))}
                        onBlur={() => markFieldsTouched(['contact_number'])}
                      />
                      <FieldError field="contact_number" />
                    </label>
                    <label>
                      <span>Birthdate<i className="public-register-required">*</i></span>
                      <input
                        required
                        type="date"
                        max={getManilaDateStamp()}
                        aria-invalid={Boolean(getFieldError('date_of_birth'))}
                        value={form.date_of_birth}
                        onChange={(event) => setForm((current) => ({
                          ...current,
                          date_of_birth: event.target.value,
                          age: calculateAge(event.target.value),
                        }))}
                        onBlur={() => markFieldsTouched(['date_of_birth'])}
                      />
                      <FieldError field="date_of_birth" />
                    </label>
                    <label>
                      <span>Age</span>
                      <input readOnly placeholder="Age will auto-calculate" value={form.age} />
                      <small className="public-register-hint">Age will auto-calculate</small>
                      <FieldError field="age" />
                    </label>
                    <div className="public-register-subsection">
                      <MapPin size={16} />
                      <h3>Address Information</h3>
                    </div>
                    <label className="public-register-street">
                      <span>Street Address<i className="public-register-required">*</i></span>
                      <input
                        required
                        placeholder="Enter street address"
                        aria-invalid={Boolean(getFieldError('street_address'))}
                        value={form.street_address}
                        onChange={(event) => updateField('street_address', event.target.value)}
                        onBlur={() => markFieldsTouched(['street_address'])}
                      />
                      <FieldError field="street_address" />
                    </label>
                    <label>
                      <span>Barangay<i className="public-register-required">*</i></span>
                      <input
                        required
                        placeholder="Enter barangay"
                        aria-invalid={Boolean(getFieldError('barangay'))}
                        value={form.barangay}
                        onChange={(event) => updateTitleField('barangay', event.target.value)}
                        onBlur={() => markFieldsTouched(['barangay'])}
                      />
                      <FieldError field="barangay" />
                    </label>
                    <label>
                      <span>City / Municipality<i className="public-register-required">*</i></span>
                      <input
                        required
                        placeholder="Enter city or municipality"
                        aria-invalid={Boolean(getFieldError('city_municipality'))}
                        value={form.city_municipality}
                        onChange={(event) => updateTitleField('city_municipality', event.target.value)}
                        onBlur={() => markFieldsTouched(['city_municipality'])}
                      />
                      <FieldError field="city_municipality" />
                    </label>
                    <label>
                      <span>Province<i className="public-register-required">*</i></span>
                      <input
                        required
                        placeholder="Enter province"
                        aria-invalid={Boolean(getFieldError('province'))}
                        value={form.province}
                        onChange={(event) => updateTitleField('province', event.target.value)}
                        onBlur={() => markFieldsTouched(['province'])}
                      />
                      <FieldError field="province" />
                    </label>
                    <label>
                      <span>Zip code<i className="public-register-required">*</i></span>
                      <input
                        required
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="Enter zip code"
                        aria-invalid={Boolean(getFieldError('zip_code'))}
                        value={form.zip_code}
                        onChange={(event) => updateField('zip_code', normalizeZipCode(event.target.value))}
                        onBlur={() => markFieldsTouched(['zip_code'])}
                      />
                      <FieldError field="zip_code" />
                    </label>
                    <label>
                      <span>Country<i className="public-register-required">*</i></span>
                      <input
                        required
                        aria-invalid={Boolean(getFieldError('country'))}
                        value={form.country}
                        onChange={(event) => updateTitleField('country', event.target.value)}
                        onBlur={() => markFieldsTouched(['country'])}
                      />
                      <FieldError field="country" />
                    </label>
                  </div>
                ) : null}

                {step === 2 ? (
                  <div className="public-register-student">
                    <div className="public-register-student-fields">
                      <label>
                        <span>School ID<i className="public-register-required">*</i></span>
                        <input
                          required
                          inputMode="numeric"
                          maxLength={9}
                          placeholder="xxxx-xxxx"
                          aria-invalid={Boolean(getFieldError('school_id'))}
                          value={form.school_id}
                          onChange={(event) => updateField('school_id', normalizeSchoolId(event.target.value))}
                          onBlur={() => markFieldsTouched(['school_id'])}
                        />
                        <FieldError field="school_id" />
                      </label>
                      <label>
                        <span>College<i className="public-register-required">*</i></span>
                        <select
                          required
                          aria-invalid={Boolean(getFieldError('college'))}
                          value={form.college}
                          onChange={(event) => updateCollege(event.target.value)}
                          onBlur={() => markFieldsTouched(['college'])}
                        >
                          <option value="">Select college</option>
                          {departmentOptions.map((department) => (
                            <option key={department} value={department}>{department}</option>
                          ))}
                        </select>
                        <FieldError field="college" />
                      </label>
                      <label>
                        <span>Program / Department<i className="public-register-required">*</i></span>
                        <select
                          required
                          disabled={!form.college}
                          aria-invalid={Boolean(getFieldError('program_department'))}
                          value={form.program_department}
                          onChange={(event) => updateField('program_department', event.target.value)}
                          onBlur={() => markFieldsTouched(['program_department'])}
                        >
                          <option value="">{form.college ? 'Select program' : 'Select college first'}</option>
                          {programOptions.map((program) => (
                            <option key={program} value={program}>{program}</option>
                          ))}
                        </select>
                        <FieldError field="program_department" />
                      </label>
                      <label>
                        <span>Year Level<i className="public-register-required">*</i></span>
                        <select
                          required
                          aria-invalid={Boolean(getFieldError('year_level'))}
                          value={form.year_level}
                          onChange={(event) => updateField('year_level', event.target.value)}
                          onBlur={() => markFieldsTouched(['year_level'])}
                        >
                          <option value="">Select year level</option>
                          {yearLevelOptions.map((yearLevel) => (
                            <option key={yearLevel} value={yearLevel}>{yearLevel}</option>
                          ))}
                        </select>
                        <FieldError field="year_level" />
                      </label>
                      <label>
                        <span>Section <small>(Optional)</small></span>
                        <select
                          aria-invalid={Boolean(getFieldError('section'))}
                          value={form.section}
                          onChange={(event) => updateField('section', event.target.value)}
                          onBlur={() => markFieldsTouched(['section'])}
                        >
                          <option value="">No section</option>
                          {sectionOptions.map((section) => (
                            <option key={section} value={section}>{section}</option>
                          ))}
                        </select>
                        <FieldError field="section" />
                      </label>
                      <div className="public-register-rfid-partition" role="separator">
                        <span>RFID</span>
                      </div>
                      <label>
                        <span>School ID. UID</span>
                        <input
                          readOnly
                          value={form.rfid_uid}
                          placeholder="Verified school UID"
                        />
                      </label>
                    </div>

                    <section className="public-register-id-card" aria-labelledby="school-id-photo">
                      <div className="register-user-section-title">
                        <Camera size={18} />
                        <h2 id="school-id-photo">Capture Image<i className="public-register-required">*</i></h2>
                      </div>
                      <div className="public-register-id-preview">
                        {form.school_id_photo ? (
                          <>
                            <img src={form.school_id_photo} alt="Captured school ID" />
                            <button
                              className="public-register-id-delete"
                              type="button"
                              aria-label="Delete image"
                              title="Delete image"
                              onClick={clearSchoolIdPhoto}
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        ) : (
                          <div>
                            <IdCard size={36} />
                            <p>Open the camera or upload a clear photo of your school ID.</p>
                          </div>
                        )}
                      </div>
                      <div className="public-register-id-actions">
                        <button className="public-register-id-button" type="button" onClick={() => setIdPhotoAction('camera')}>
                          {form.school_id_photo ? 'Retake' : 'Open Camera'}
                        </button>
                        <button className="public-register-id-button" type="button" onClick={() => setIdPhotoAction('upload')}>
                          <Upload size={15} />
                          Upload Image
                        </button>
                      </div>
                      <input
                        ref={uploadInputRef}
                        className="public-register-hidden-file"
                        type="file"
                        accept="image/jpeg,image/png"
                        onChange={handleSchoolIdUpload}
                      />
                      {idPhotoError ? <p className="public-register-id-error">{idPhotoError}</p> : <FieldError field="school_id_photo" />}
                      <p className="public-register-id-note">This photo verifies that you are a student.</p>
                    </section>
                  </div>
                ) : null}

                {step === 3 ? (
                  <div className="public-register-account">
                    <aside className="public-register-account-info">
                      <span>
                        <Shield size={28} />
                      </span>
                      <h3>Keep your account secure</h3>
                      <p>
                        Choose a strong password to protect your account.
                        Your email, username, and password will be used to sign in to Entrivo.
                      </p>
                    </aside>
                    <div className="public-register-account-main">
                      <div className="public-register-account-fields">
                        <label>
                          <span>Role</span>
                          <input readOnly value="Student" />
                        </label>
                        <label>
                          <span>Email<i className="public-register-required">*</i></span>
                          <input
                            required
                            type="email"
                            placeholder={`username@${schoolEmailDomain}`}
                            aria-invalid={Boolean(getFieldError('email'))}
                            value={form.email}
                            onChange={(event) => updateField('email', event.target.value.toLowerCase().replace(/\s/g, ''))}
                            onBlur={() => {
                              updateField('email', normalizeSchoolEmail(form.email));
                              markFieldsTouched(['email']);
                            }}
                          />
                          <FieldError field="email" />
                        </label>
                        <label>
                          <span>Username<i className="public-register-required">*</i></span>
                          <input
                            required
                            placeholder="firstname.lastname"
                            aria-invalid={Boolean(getFieldError('username'))}
                            value={form.username}
                            onChange={(event) => updateField('username', event.target.value)}
                            onBlur={() => markFieldsTouched(['username'])}
                          />
                          <FieldError field="username" />
                        </label>
                        <label>
                          <span>Password<i className="public-register-required">*</i></span>
                          <div className="register-user-password-field" data-invalid={Boolean(getFieldError('password'))}>
                            <input
                              required
                              minLength={8}
                              aria-invalid={Boolean(getFieldError('password'))}
                              type={isPasswordVisible ? 'text' : 'password'}
                              value={form.password}
                              onChange={(event) => updateField('password', event.target.value)}
                              onBlur={() => markFieldsTouched(['password'])}
                            />
                            <button
                              type="button"
                              aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
                              onClick={() => setIsPasswordVisible((current) => !current)}
                            >
                              {isPasswordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                          <div
                            className={`public-register-strength is-level-${getPasswordStrength(form.password)}`}
                            aria-hidden="true"
                          >
                            <span />
                            <span />
                            <span />
                            <span />
                          </div>
                          <FieldError field="password" />
                        </label>
                        <label>
                          <span>Re-enter Password<i className="public-register-required">*</i></span>
                          <div className="register-user-password-field" data-invalid={Boolean(getFieldError('confirm_password'))}>
                            <input
                              required
                              minLength={8}
                              aria-invalid={Boolean(getFieldError('confirm_password'))}
                              type={isConfirmPasswordVisible ? 'text' : 'password'}
                              value={form.confirm_password}
                              onChange={(event) => updateField('confirm_password', event.target.value)}
                              onBlur={() => markFieldsTouched(['confirm_password'])}
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
                      <aside className="public-register-account-rules" aria-label="Account requirements">
                        <h3>Username</h3>
                        <ul>
                          <li className={form.username.includes('.') ? 'is-met' : ''}>Include a dot, like firstname.lastname</li>
                          <li className={form.username.length > 0 && !/\s/.test(form.username) ? 'is-met' : ''}>No spaces</li>
                        </ul>
                        <h3>Password must contain:</h3>
                        <ul>
                          <li className={getPasswordRuleChecks(form.password).length ? 'is-met' : ''}>8+ characters</li>
                          <li className={getPasswordRuleChecks(form.password).upper ? 'is-met' : ''}>Uppercase letter</li>
                          <li className={getPasswordRuleChecks(form.password).lower ? 'is-met' : ''}>Lowercase letter</li>
                          <li className={getPasswordRuleChecks(form.password).number ? 'is-met' : ''}>A number</li>
                          <li className={getPasswordRuleChecks(form.password).special ? 'is-met' : ''}>A special character</li>
                        </ul>
                      </aside>
                    </div>
                  </div>
                ) : null}

                {step === 4 ? (
                  <div className="public-register-questions">
                    <div className="public-register-question-fields">
                      {questions.map((item, index) => (
                        <div className="public-register-question-item" key={`security-question-${index + 1}`}>
                          <label>
                            <span>Security Question {index + 1}<i className="public-register-required">*</i></span>
                            <select
                              required
                              aria-invalid={Boolean(getFieldError(`security_question_${index + 1}`))}
                              value={item.question}
                              onChange={(event) => updateQuestion(index, 'question', event.target.value)}
                              onBlur={() => markFieldsTouched([`security_question_${index + 1}`])}
                            >
                              <option value="">-Select a question-</option>
                              {securityQuestionOptions.map((question) => (
                                <option
                                  key={question}
                                  value={question}
                                  disabled={questions.some((entry, entryIndex) => entryIndex !== index && entry.question === question)}
                                >
                                  {question}
                                </option>
                              ))}
                            </select>
                            <FieldError field={`security_question_${index + 1}`} />
                          </label>
                          <label>
                            <span>Answer<i className="public-register-required">*</i></span>
                            <div className="register-user-password-field" data-invalid={Boolean(getFieldError(`security_answer_${index + 1}`))}>
                              <input
                                required
                                maxLength={100}
                                autoComplete="off"
                                placeholder="Enter your answer"
                                aria-invalid={Boolean(getFieldError(`security_answer_${index + 1}`))}
                                type={visibleAnswers[index] ? 'text' : 'password'}
                                value={item.answer}
                                onChange={(event) => updateQuestion(index, 'answer', event.target.value)}
                                onBlur={() => markFieldsTouched([`security_answer_${index + 1}`])}
                              />
                              <button
                                type="button"
                                aria-label={visibleAnswers[index] ? 'Hide answer' : 'Show answer'}
                                onClick={() => setVisibleAnswers((current) => current.map((visible, itemIndex) => (
                                  itemIndex === index ? !visible : visible
                                )))}
                              >
                                {visibleAnswers[index] ? <EyeOff size={16} /> : <Eye size={16} />}
                              </button>
                            </div>
                            <FieldError field={`security_answer_${index + 1}`} />
                          </label>
                        </div>
                      ))}
                    </div>
                    <aside className="public-register-question-info" aria-label="Why security questions are needed">
                      <div>
                        <span><Shield size={16} /></span>
                        <div>
                          <h3>Why do we need this?</h3>
                          <p>Your answers keep your account safe and recoverable.</p>
                        </div>
                      </div>
                      <div>
                        <span><UserRound size={16} /></span>
                        <div>
                          <h3>Account Recovery</h3>
                          <p>Verify your identity instantly if you ever forget your password.</p>
                        </div>
                      </div>
                      <div>
                        <span><EyeOff size={16} /></span>
                        <div>
                          <h3>Keep It Private</h3>
                          <p>Pick answers only you would know and avoid guessable details.</p>
                        </div>
                      </div>
                      <div>
                        <span><Lock size={16} /></span>
                        <div>
                          <h3>Fully Encrypted</h3>
                          <p>Your answers are hashed and stored securely — never shown to anyone.</p>
                        </div>
                      </div>
                      <div className="public-register-question-note">
                        <Info size={15} />
                        <p>Choose answers you'll remember easily — you'll need them to regain access to your account.</p>
                      </div>
                    </aside>
                  </div>
                ) : null}
              </section>

              <div className="public-register-footer">
                {step === 1 ? (
                  <a className="public-register-cancel" href="/login">
                    Cancel
                  </a>
                ) : (
                  <button className="public-register-cancel" type="button" onClick={goBack}>
                    <ArrowLeft size={15} />
                    Back
                  </button>
                )}
                <p>Step {step} of {steps.length}</p>
                {step < steps.length ? (
                  <button className="public-register-submit" type="button" onClick={goNext}>
                    Next
                    <ArrowRight size={16} />
                  </button>
                ) : (
                  <button className="public-register-submit" type="submit" disabled={isSaving}>
                    {isSaving ? 'Creating account...' : 'Create Account'}
                  </button>
                )}
              </div>
            </form>
        </div>
      </section>
      )}

      {idPhotoAction ? (
        <div className="register-user-modal-backdrop" role="presentation">
          <section className="public-register-id-warning" role="dialog" aria-modal="true" aria-labelledby="school-id-warning-title">
            <h2 id="school-id-warning-title">School ID photo</h2>
            <p>
              The ID you use must be a school ID of Caraga State University - Cabadbaran Campus.
              Make sure the school ID and name are clear and visible.
            </p>
            <figure className="public-register-id-example">
              <img src={schoolIdExample} alt="Example Caraga State University Cabadbaran Campus student ID" />
              <figcaption>Example</figcaption>
            </figure>
            <div className="public-register-id-warning-actions">
              <button type="button" onClick={() => setIdPhotoAction('')}>Cancel</button>
              <button type="button" onClick={continueSchoolIdPhoto}>Continue</button>
            </div>
          </section>
        </div>
      ) : null}

      {isCameraOpen ? (
        <div className="register-user-modal-backdrop" role="presentation">
          <section className="register-user-camera-modal" aria-label="Photograph school ID" role="dialog">
            <div className="register-user-camera-header">
              <div>
                <span>Camera</span>
                <h2>Photograph School ID</h2>
              </div>
              <button type="button" aria-label="Close camera" onClick={closeCamera}>
                <X size={18} />
              </button>
            </div>
            <video ref={videoRef} autoPlay playsInline muted />
            <div className="register-user-camera-actions">
              <button type="button" onClick={captureSchoolId}>
                <Camera size={16} />
                Capture Photo
              </button>
              <button type="button" onClick={closeCamera}>
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
