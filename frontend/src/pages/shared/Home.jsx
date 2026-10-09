import { useEffect, useState } from 'react';
import { ArrowRight, Menu, X } from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import PublicFooter from '../../components/PublicFooter';
import campusBuilding from '../../assets/images/csucc_noback.png';
import campusOutline from '../../assets/images/outline_csucc.png';
import csuccLogo from '../../assets/images/csucc_logo.png';
import csuLogo from '../../assets/images/Caraga_State_University_logo.png';
import cbaLogo from '../../assets/images/CBA_logo.png';
import ceitLogo from '../../assets/images/CEIT_logo.png';
import citteLogo from '../../assets/images/CITTE_logo.png';
import cthmLogo from '../../assets/images/CTHM_logo4.png';
import '../../styles/home/home.css';

const navItems = [
  { label: 'Home', href: '#top' },
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#workflow' },
  { label: 'About', href: '#about' },
];

const collegeLogos = [
  { name: 'CBA', image: cbaLogo },
  { name: 'CEIT', image: ceitLogo },
  { name: 'CITTE', image: citteLogo },
  { name: 'CTHM', image: cthmLogo },
];

const highlights = [
  {
    title: 'Access Control',
    description: 'Keep classrooms and laboratories secure with door access based on assigned schedules.',
    href: '#workflow',
  },
  {
    title: 'Fingerprint Enrollment',
    description: 'Enroll biometrics and synchronize approved templates with connected door devices.',
    href: '#workflow',
  },
  {
    title: 'Attendance & Schedules',
    description: 'Record arrivals and align door access with class and staff schedules.',
    href: '#workflow',
  },
  {
    title: 'School ID Access',
    description: 'Approved students can use their CSUCC school ID to enter classrooms and laboratories during assigned schedules.',
    href: '#workflow',
  },
];

const workflowSteps = [
  {
    title: 'Register people and roles',
    description: 'Create identities, assign access levels, and organize accounts for students, staff, and admins.',
  },
  {
    title: 'Link credentials and devices',
    description: 'Connect fingerprint and RFID workflows so each entry method stays tied to the right person.',
  },
  {
    title: 'Control and monitor entry',
    description: 'Apply schedules, review attendance, and follow secure access events from one dashboard.',
  },
];

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('top');
  const [enrollmentPrompt, setEnrollmentPrompt] = useState(() => (
    new URLSearchParams(window.location.search).get('signup') === '1' ? 'notice' : ''
  ));
  const [rfidUid, setRfidUid] = useState('');
  const [rfidError, setRfidError] = useState('');
  const [isVerifyingRfid, setIsVerifyingRfid] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('signup') !== '1') {
      return;
    }

    setEnrollmentPrompt('notice');
    params.delete('signup');
    const nextSearch = params.toString();
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`,
    );
  }, []);

  useEffect(() => {
    const animatedElements = document.querySelectorAll('[data-reveal]');

    if (!animatedElements.length) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.2,
      },
    );

    animatedElements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sectionIds = navItems.map((item) => item.href.replace('#', ''));
    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    if (!sections.length) {
      return undefined;
    }

    const syncFromHash = () => {
      const hash = window.location.hash.replace('#', '');
      if (sectionIds.includes(hash)) {
        setActiveSection(hash);
      }
    };

    const sectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visible[0]?.target?.id) {
          setActiveSection(visible[0].target.id);
        }
      },
      {
        rootMargin: '-30% 0px -50% 0px',
        threshold: [0.15, 0.35, 0.6],
      },
    );

    sections.forEach((section) => sectionObserver.observe(section));
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);

    return () => {
      sectionObserver.disconnect();
      window.removeEventListener('hashchange', syncFromHash);
    };
  }, []);

  useEffect(() => {
    const closeMenu = () => setMenuOpen(false);
    const onResize = () => {
      if (window.innerWidth > 900) {
        setMenuOpen(false);
      }
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('hashchange', closeMenu);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('hashchange', closeMenu);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen || enrollmentPrompt ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen, enrollmentPrompt]);

  const closeMenu = () => setMenuOpen(false);

  const openSchoolIdModal = () => {
    setRfidUid('');
    setRfidError('');
    setEnrollmentPrompt('notice');
    closeMenu();
  };

  const closeSchoolIdModal = () => {
    if (isVerifyingRfid) {
      return;
    }

    setEnrollmentPrompt('');
    setRfidError('');
  };

  const verifySchoolId = async (event) => {
    event.preventDefault();
    const normalizedUid = rfidUid.replace(/\s/g, '').toUpperCase();

    if (!normalizedUid) {
      setRfidError('This field is required.');
      return;
    }

    setIsVerifyingRfid(true);
    setRfidError('');

    try {
      const response = await axiosClient.post('/api/verify_rfid_uid.php', {
        rfid_uid: normalizedUid,
      });
      window.sessionStorage.setItem('entrivo_verified_rfid_uid', response.data.rfid_uid || normalizedUid);
      window.location.assign('/register');
    } catch (error) {
      setRfidError(error.response?.data?.message || 'Unable to verify the RFID UID right now.');
      setIsVerifyingRfid(false);
    }
  };

  const handleNavClick = (href) => {
    setActiveSection(href.replace('#', ''));
    closeMenu();
  };

  return (
    <main className={`home-page${menuOpen ? ' is-menu-open' : ''}`}>
      <header className="home-header">
        <div className="home-header-inner">
          <a className="home-brand" href="#top" aria-label="Entrivo home" onClick={() => handleNavClick('#top')}>
            <span className="home-brand-marks">
              <span className="home-logo-csu">
                <img src={csuLogo} alt="" />
              </span>
              <span className="home-logo-csucc">
                <img src={csuccLogo} alt="" />
              </span>
            </span>
            <span className="home-brand-text">
              <strong>Caraga State University</strong>
              <small>Cabadbaran Campus</small>
            </span>
          </a>

          <button
            type="button"
            className="home-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="home-mobile-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>

          <div className={`home-header-right${menuOpen ? ' is-open' : ''}`} id="home-mobile-nav">
            <nav className="home-nav" aria-label="Main navigation">
              {navItems.map((item) => {
                const sectionId = item.href.replace('#', '');
                const isActive = activeSection === sectionId;

                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className={isActive ? 'is-active' : undefined}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => handleNavClick(item.href)}
                  >
                    {item.label}
                  </a>
                );
              })}
              <a href="/faqs" onClick={closeMenu}>FAQs</a>
            </nav>

            <nav className="home-actions" aria-label="Primary">
              <a className="home-header-link" href="/login" onClick={closeMenu}>
                Sign in
              </a>
              <button className="home-header-link is-gold" type="button" onClick={openSchoolIdModal}>
                Sign up
              </button>
            </nav>
          </div>
        </div>
      </header>

      <section className="home-hero" id="top">
        <div className="home-hero-band" aria-hidden="true" />
        <img className="home-hero-seal" src={csuccLogo} alt="" aria-hidden="true" />
        <div className="home-hero-stripes" aria-hidden="true">
          <span />
          <span className="home-hero-stripe-green" />
        </div>
        <div className="home-hero-inner">
          <div className="home-hero-copy">
            <p className="home-eyebrow">Entrivo</p>
            <h1>Room Access Control</h1>
            <p className="home-tagline">Secure · Attend · Serve</p>
            <p className="home-description">
              The door lock system for Caraga State University — Cabadbaran Campus. Manage secure entry,
              biometric enrollment, and attendance in one place.
            </p>
            <div className="home-hero-actions">
              <a className="home-gold-button" href="/login">
                Sign in
                <ArrowRight size={18} />
              </a>
            </div>
          </div>
        </div>
        <div className="home-hero-visual">
          <img src={campusBuilding} alt="Caraga State University Cabadbaran Campus building" />
        </div>
      </section>

      <section className="home-featured" id="features">
        <div className="home-featured-inner">
          <div className="home-featured-intro" data-reveal>
            <p className="home-kicker"><span /> Featured</p>
            <h2>Discover Entrivo at Cabadbaran Campus</h2>
            <p>
              From secure door access to attendance and campus schedules, Entrivo is where entry for students,
              staff, and administrators stays organized.
            </p>
            <a className="home-dark-button" href="#workflow">
              Learn more
              <ArrowRight size={16} />
            </a>
          </div>

          <div className="home-featured-grid">
            {highlights.map((item) => (
              <article className="home-feature-card" data-reveal key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="home-steps" id="workflow">
        <div className="home-steps-inner">
          <div className="home-steps-header">
            <div className="home-steps-heading" data-reveal>
              <p className="home-kicker"><span /> How it works</p>
              <h2>Secure and organized room access.</h2>
            </div>
            <img
              className="home-steps-outline"
              src={campusOutline}
              alt="Outline of the Caraga State University Cabadbaran Campus building"
              loading="lazy"
            />
            <ul className="home-college-logos" aria-label="Campus colleges">
              {collegeLogos.map((college) => (
                <li key={college.name}>
                  <img src={college.image} alt={`${college.name} logo`} loading="lazy" />
                </li>
              ))}
            </ul>
          </div>
          <div className="home-steps-grid">
            {workflowSteps.map((step, index) => (
              <article className="home-step" data-reveal key={step.title}>
                <span>0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="home-banner" id="about" data-reveal>
        <img className="home-banner-csu" src={csuLogo} alt="" aria-hidden="true" />
        <div className="home-banner-stripes" aria-hidden="true">
          <span />
          <span />
        </div>
        <div className="home-banner-inner">
          <div>
            <p className="home-banner-line">Building a brighter future</p>
            <p className="home-banner-gold">Together</p>
          </div>
          <div className="home-banner-actions">
            <a className="home-gold-button" href="/login">
              Sign in
              <ArrowRight size={18} />
            </a>
            <button className="home-banner-ghost" type="button" onClick={openSchoolIdModal}>
              Sign up
            </button>
          </div>
        </div>
      </section>

      <PublicFooter isHome />

      {enrollmentPrompt ? (
        <div className="home-school-id-backdrop" role="presentation">
          {enrollmentPrompt === 'notice' ? (
            <section
              className="home-school-id-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="before-enroll-title"
            >
              <h2 id="before-enroll-title">Before You Enroll</h2>
              <p>To create your Entrivo account, you must first scan your school ID at the RFID Scanner Station.</p>
              <p>The scanner will display your RFID UID. You will need this UID to continue with enrollment.</p>
              <p>Please make sure you remember or copy the UID exactly as displayed by the scanner.</p>
              <div className="home-school-id-actions">
                <button type="button" onClick={closeSchoolIdModal}>
                  Cancel
                </button>
                <button type="button" className="is-primary" onClick={() => setEnrollmentPrompt('verify')}>
                  Continue
                </button>
              </div>
            </section>
          ) : (
            <section
              className="home-school-id-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="verify-school-id-title"
            >
              <h2 id="verify-school-id-title">Verify Your School ID</h2>
              <form onSubmit={verifySchoolId}>
                <p>Enter the exact RFID UID displayed on the scanner to continue with enrollment.</p>
                <p>The UID you enter must exactly match the UID from the RFID Scanner Station.</p>
                <label>
                  <span className="home-school-id-sr">Enter RFID UID</span>
                  <input
                    value={rfidUid}
                    placeholder="Enter RFID UID"
                    autoComplete="off"
                    maxLength={30}
                    aria-invalid={rfidError === 'This field is required.' || undefined}
                    onChange={(event) => {
                      setRfidUid(event.target.value.replace(/\s/g, '').toUpperCase().slice(0, 30));
                      setRfidError('');
                    }}
                  />
                </label>
                {rfidError ? <p className="home-school-id-error" role="alert">{rfidError}</p> : null}
                <p>You can proceed with enrollment once your UID has been verified.</p>
                <div className="home-school-id-actions">
                  <button type="button" onClick={closeSchoolIdModal} disabled={isVerifyingRfid}>
                    Cancel
                  </button>
                  <button type="submit" className="is-primary" disabled={isVerifyingRfid}>
                    {isVerifyingRfid ? 'Verifying...' : 'Verify UID'}
                  </button>
                </div>
              </form>
            </section>
          )}
        </div>
      ) : null}
    </main>
  );
}
