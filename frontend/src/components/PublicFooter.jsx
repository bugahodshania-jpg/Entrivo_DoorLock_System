import csuLogo from '../assets/images/Caraga_State_University_logo.png';
import csuccLogo from '../assets/images/csucc_logo.png';

const sectionLinks = [
  { label: 'Home', href: '#top' },
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#workflow' },
  { label: 'About', href: '#about' },
];

export default function PublicFooter({ isHome = false, isFaqs = false }) {
  return (
    <footer className={`home-footer${isHome ? ' is-home' : ''}`}>
      <div className="home-footer-inner">
        <div className="home-footer-brand">
          <span className="home-brand-marks" aria-hidden="true">
            <span className="home-logo-csu"><img src={csuLogo} alt="" /></span>
            <span className="home-logo-csucc"><img src={csuccLogo} alt="" /></span>
          </span>
          <div>
            <strong>Entrivo</strong>
            <p>Secure access for Caraga State University — Cabadbaran Campus.</p>
          </div>
        </div>
        <nav className="home-footer-links" aria-label="Footer">
          {sectionLinks.map((item) => (
            <a key={item.href} href={`${isHome ? '' : '/'}${item.href}`}>{item.label}</a>
          ))}
          <a href="/faqs" aria-current={isFaqs ? 'page' : undefined}>FAQs</a>
          <a href="/login">Sign in</a>
        </nav>
      </div>
    </footer>
  );
}
