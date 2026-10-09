import { useEffect, useState } from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';
import PublicFooter from '../../components/PublicFooter';
import csuLogo from '../../assets/images/Caraga_State_University_logo.png';
import csuccLogo from '../../assets/images/csucc_logo.png';
import '../../styles/home/home.css';
import '../../styles/home/faqs.css';

const faqs = [
  {
    question: 'What is Entrivo?',
    answer: [
      'Entrivo is a door lock and room access management system for classrooms and laboratories at Caraga State University — Cabadbaran Campus. It connects door devices, faculty fingerprints, student RFID school IDs, and assigned room schedules to control who can open or lock a room and when.',
      'Faculty are responsible for opening rooms during their assigned schedules using fingerprints enrolled by an administrator. Students do not need to scan their school IDs every time they enter for class. An approved, assigned student can use their registered RFID school ID to lock the room when an instructor leaves early and instructs them to do so. Students may also use their card to enter a vacant room after an administrator grants temporary access for a valid reason, even if a class is scheduled but the room is currently unused.',
      'Administrators manage accounts, student registration approvals, faculty fingerprint enrollment, RFID records, room schedules, and temporary access permissions. Student registration starts by verifying a card UID against the RFID Scanner Station records. Entrivo also records room access activity so administrators can review room use and investigate access issues.',
    ],
  },
  {
    question: 'Which rooms is the system intended for?',
    answer: [
      'Entrivo is intended for classrooms and laboratories equipped with its door lock devices. It helps manage the use of these rooms by connecting access permissions with the assigned room, instructor, and schedule.',
      'Faculty use their enrolled fingerprints to open the room for their scheduled classes or laboratory sessions. Students enter under the supervision of the instructor and do not need to scan their school IDs each time they attend class.',
      'Student RFID use is limited to permitted actions, such as locking the room when an instructor directs an assigned student to do so or entering a vacant room through temporary access approved by an administrator. An approved account still needs the appropriate permission for the room and action.',
    ],
  },
  {
    question: 'Who can use the Sign up button?',
    answer: [
      'The Sign up button is for students only. It starts the student enrollment process, which requires verification of the RFID UID from a CSUCC school ID before the registration form can be opened.',
      'Faculty registration and fingerprint enrollment are handled by an administrator. Faculty members should contact an administrator to have their account created, their fingerprints enrolled, and their room schedules assigned. They can then sign in using the account credentials provided to them.',
      'Students who already have an account should use Sign in. If you cannot access an existing account or your school ID is already registered, contact an administrator for assistance with that account.',
    ],
  },
  {
    question: 'How do students register?',
    answer: [
      'Scan your CSUCC school ID at the RFID Scanner Station and copy the UID displayed on its screen. Choose Sign up on the website, read the Before You Enroll notice, and enter that UID in the verification form. The system checks that the UID was recorded by the station and has not already been registered.',
      'After verification, complete the four registration steps: Personal Information, Student Information, Create Account, and Security Questions. Enter your details accurately, capture or upload a clear photo of your school ID, create your login credentials, and choose three different security questions with answers. Use Next and Back to review your information and correct any field errors.',
      'Submit the completed form to create an account that is waiting for administrator approval. Allow up to 24 hours for review, and contact an administrator if it is still pending after that period. Registration and approval do not automatically give students permission to open rooms; student RFID use follows the assigned locking permissions or temporary access granted by an administrator.',
    ],
  },
  {
    question: 'How do I get the UID of my school ID?',
    answer: [
      'Scan your CSUCC school ID at the RFID Scanner Station. When the station reads the card, it displays the RFID UID on its screen and records the scan. Copy or write down the complete UID exactly as displayed so you can enter it when you choose Sign up.',
      'The RFID UID identifies the electronic card and is different from the School ID number printed on it. Enter the displayed UID in the verification form; your printed School ID number belongs in the School ID field later in the registration process.',
      'You cannot enter a random value to register. The system verifies your entry against the RFID Scanner Station records, and a UID that has not been recorded or is already registered cannot be used to start a new registration. If verification fails, check your entry against the displayed UID and scan your card again if needed. Contact an administrator if your card cannot be read or verification still fails.',
    ],
  },
  {
    question: 'What do I need to complete registration?',
    answer: [
      'Prepare your personal information, including your name, sex, date of birth, contact number, and complete address. For your student information, provide your printed School ID number, college, program or department, and year level. Select your section if applicable, and use the verified RFID UID from your school ID.',
      'You must also capture a clear photo of your school ID using the camera or upload a JPG or PNG image. Make sure the details are readable and follow the image size guidance shown by the form. Enter your School ID number in the xxxx-xxxx format and use your school email with the @csucc.edu.ph domain.',
      'Create a unique username and a password with at least eight characters, including uppercase and lowercase letters, a number, and a special character. Re-enter the same password, then choose three different security questions and provide answers you can remember for account recovery. Your School ID number, RFID UID, email, and username must not already belong to another registered account. Correct any validation errors before submitting; contact an administrator if your own details appear to be already registered.',
    ],
  },
  {
    question: 'How do students use their school ID for room access?',
    answer: [
      'Your student registration must be approved before your registered CSUCC school ID can be used for permitted room actions. During regular classes, faculty are responsible for opening the room using their enrolled fingerprints. Students do not need to scan their school IDs each time they enter the room for class.',
      'If an instructor needs to leave early, they may instruct an assigned student to lock the room. That student can use their registered RFID school ID for the locking action according to their assigned permission and the instructions given by the instructor.',
      'A student may also request permission to use a vacant room for a valid reason. This includes a room that has a scheduled class but is currently unused. The administrator must approve the request and grant temporary access before the student can use their school ID to enter. Account approval alone does not authorize a student to open any room whenever they choose.',
    ],
  },
  {
    question: 'How can I request temporary access to a vacant room?',
    answer: [
      'Contact an administrator and explain which classroom or laboratory you want to use, when you need it, and your reason for requesting access. For example, explain the academic activity you need to complete and the period during which you intend to use the room.',
      'A room can be vacant even when a class is listed in its schedule. The administrator reviews whether the room is available and whether your reason is valid before deciding to grant temporary access. Seeing an empty room does not automatically give you permission to open it.',
      'Wait for the administrator to confirm that temporary access has been granted to your registered student account and school ID. Use the room only within the permission provided and follow any instructions about its use and locking. If the permission needs to be changed or your card is not accepted, contact the administrator again.',
    ],
  },
  {
    question: 'What happens to my inputs if I leave registration?',
    answer: [
      'Your unfinished inputs are kept while you remain on the registration page. You can move between the four steps using Next and Back, or refresh the page in the same browser session, and continue with your saved registration details.',
      'When you leave registration for Home, Login, or another page, the unfinished inputs and verified RFID UID are cleared. Returning to Sign up starts the UID verification process again, and you must re-enter your details. This prevents the next student using the page from seeing your unfinished registration information.',
      'This clearing applies to the unfinished form. It does not delete an account that you have already successfully submitted. If your account was created and is waiting for approval, use Sign in and contact an administrator if you need help with its status.',
    ],
  },
  {
    question: 'What should I do if my card or fingerprint is not accepted?',
    answer: [
      'First check that you are using the correct room and have permission for the action you are trying to perform. Faculty should confirm that their fingerprints have been enrolled by an administrator and that the room and time match their assigned schedule.',
      'Students should confirm that their account is approved and that they are using the registered CSUCC school ID. A student card needs the relevant permission to lock the room when instructed or temporary access granted by an administrator to open it. Students do not need to scan their cards for ordinary entry into a class opened by the instructor.',
      'If your card or fingerprint is still not accepted, contact an administrator and provide the room, the time, the action you attempted, and any message shown by the device. The administrator can review your account, RFID record or fingerprint enrollment, schedule, and access permissions to identify the issue. For a card that cannot be read, ask for help checking the card and its registration.',
    ],
  },
];

export default function Faqs() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    const handleResize = () => { if (window.innerWidth > 900) setMenuOpen(false); };
    const handleKeyDown = (event) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div className="home-page faq-page">
      <header className="home-header faq-header">
        <div className="home-header-inner">
          <a className="home-brand" href="/" aria-label="Entrivo home">
            <span className="home-brand-marks" aria-hidden="true">
              <span className="home-logo-csu"><img src={csuLogo} alt="" /></span>
              <span className="home-logo-csucc"><img src={csuccLogo} alt="" /></span>
            </span>
            <span className="home-brand-text">
              <strong>Caraga State University</strong>
              <small>Cabadbaran Campus</small>
            </span>
          </a>
          <button className="home-menu-toggle" type="button" aria-expanded={menuOpen}
            aria-controls="faq-mobile-nav" aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <div className={`home-header-right${menuOpen ? ' is-open' : ''}`} id="faq-mobile-nav">
            <nav className="home-nav" aria-label="Main navigation">
              <a href="/" onClick={closeMenu}>Home</a>
              <a href="/#features" onClick={closeMenu}>Features</a>
              <a className="is-active" href="/faqs" aria-current="page" onClick={closeMenu}>FAQs</a>
            </nav>
            <nav className="home-actions" aria-label="Account">
              <a className="home-header-link" href="/login" onClick={closeMenu}>Sign in</a>
              <a className="home-header-link is-gold" href="/?signup=1" onClick={closeMenu}>Sign up</a>
            </nav>
          </div>
        </div>
      </header>
      <div className="faq-pattern-band" aria-hidden="true" />
      <main className="faq-content" aria-labelledby="faq-title">
        <div className="faq-intro">
          <p className="home-kicker"><span /> FAQs</p>
          <h1 id="faq-title">Frequently asked questions</h1>
          <p>Answers about registration, school IDs, and scheduled room access.</p>
        </div>
        <ul className="faq-list" aria-label="Frequently asked questions">
          {faqs.map(({ question, answer }) => (
            <li key={question}>
              <details className="faq-item">
                <summary className="faq-question">
                  <h2>
                    <span>{question}</span>
                    <ChevronDown className="faq-toggle-icon" size={22} aria-hidden="true" />
                  </h2>
                </summary>
                <div className="faq-answer">
                  {(Array.isArray(answer) ? answer : [answer]).map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </main>
      <PublicFooter isFaqs />
    </div>
  );
}
