import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Fingerprint,
  Menu,
  ShieldCheck,
  Waves,
  X,
} from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import logo from '../../assets/images/entrivo_logo.png';
import PixelWave from '../../components/PixelWave';
import '../../styles/home/home.css';

const navItems = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#workflow' },
  { label: 'About', href: '#about' },
];

const highlights = [
  {
    icon: ShieldCheck,
    title: 'Smarter access control',
    description: 'Keep classrooms, offices, and restricted areas protected with role-based entry management.',
  },
  {
    icon: Fingerprint,
    title: 'Fingerprint-ready workflows',
    description: 'Support secure biometric enrollment and template synchronization for connected door devices.',
  },
  {
    icon: CalendarCheck2,
    title: 'Attendance and scheduling',
    description: 'Monitor attendance records and align access with class or staff schedules in one system.',
  },
];

const workflowSteps = [
  {
    title: 'Register people and roles',
    description: 'Create user identities, assign access levels, and organize accounts for staff, students, and admins.',
  },
  {
    title: 'Link credentials and devices',
    description: 'Support fingerprint and RFID-ready workflows so entry methods stay connected to the right person.',
  },
  {
    title: 'Control and monitor entry',
    description: 'Apply schedules, review attendance, and manage secure access events from one dashboard.',
  },
];

const metrics = [
  { value: '24/7', label: 'Access visibility' },
  { value: '512B', label: 'Fingerprint template ready' },
  { value: 'Role-based', label: 'Admin control' },
];

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const [enrollmentPrompt, setEnrollmentPrompt] = useState('');
  const [rfidUid, setRfidUid] = useState('');
  const [rfidError, setRfidError] = useState('');
  const [isVerifyingRfid, setIsVerifyingRfid] = useState(false);

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
      }
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
      }
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
          <a className="home-brand" href="/" aria-label="Entrivo home">
            <img src={logo} alt="Entrivo logo" />
            <span>Entrivo</span>
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
            <nav className="home-nav" aria-label="Section navigation">
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
            </nav>

            <nav className="home-actions" aria-label="Primary">
              <a className="home-link-button" href="/login" onClick={closeMenu}>
                Sign in
              </a>
              <button className="home-primary-button" type="button" onClick={openSchoolIdModal}>
                Sign up
              </button>
            </nav>
          </div>
        </div>
      </header>

      <section className="home-hero" data-reveal>
        <div className="home-hero-copy">
          <p className="home-eyebrow">Secure Access Management</p>
          <h1>Modern door control, attendance, and identity workflows in one place.</h1>
          <p className="home-description">
            Entrivo helps schools and organizations manage secure entry, biometric enrollment, and user access
            with a clean system experience.
          </p>

          <div className="home-hero-actions">
            <a className="home-primary-button" href="/login">
              Sign in
            </a>
            <a className="home-secondary-link" href="/register">
              Create account request
              <ArrowRight size={18} />
            </a>
          </div>

          <div className="home-hero-metrics" aria-label="Platform highlights">
            {metrics.map((metric) => (
              <div className="home-metric" key={metric.label}>
                <strong>{metric.value}</strong>
                <span>{metric.label}</span>
              </div>
            ))}
          </div>
        </div>


      </section>

      <section className="home-highlights" id="features" aria-label="Highlights">
        {highlights.map(({ icon: Icon, title, description }) => (
          <article className="home-highlight-card" data-reveal key={title}>
            <span className="home-highlight-icon">
              <Icon size={22} />
            </span>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <section className="home-band" id="workflow" data-reveal>
        <div className="home-band-visual">
          <PixelWave />

          <div className="home-section-heading">
            <p className="home-eyebrow">How it works</p>
            <h2>Built to keep access simple for people and secure for administrators.</h2>
          </div>

          <div className="home-workflow">
            {workflowSteps.map((step, index) => (
              <article className="home-workflow-card" key={step.title}>
                <span className="home-step-number">0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="home-about" id="about">
        <div className="home-about-card" data-reveal>
          <span className="home-about-icon">
            <Waves size={22} />
          </span>
          <h2>Clean interface, operational focus</h2>
          <p>
            The homepage is designed to feel lighter and more polished while still matching the system&apos;s
            access-control identity.
          </p>
        </div>

        <div className="home-about-card" data-reveal>
          <span className="home-about-icon">
            <CheckCircle2 size={22} />
          </span>
          <h2>Ready for real workflow expansion</h2>
          <p>
            This layout leaves room for future sections like live statistics, testimonials, campus maps, or device
            status summaries.
          </p>
        </div>
      </section>

      <section className="home-cta" data-reveal>
        <div>
          <p className="home-eyebrow">Get started</p>
          <h2>Access your dashboard or request a new account.</h2>
        </div>

        <div className="home-cta-actions">
          <a className="home-primary-button" href="/login">
            Sign in
          </a>
          <a className="home-link-button" href="/register">
            Sign up
          </a>
        </div>
      </section>

      <footer className="home-footer">
        <div className="home-footer-brand">
          <img src={logo} alt="Entrivo logo" />
          <div>
            <strong>Entrivo</strong>
            <p>Secure access, attendance, and identity management.</p>
          </div>
        </div>

        <nav className="home-footer-links" aria-label="Footer">
          {navItems.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
          <a href="/login">Sign in</a>
        </nav>
      </footer>

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
