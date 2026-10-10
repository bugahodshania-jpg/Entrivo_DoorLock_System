import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  ShieldAlert,
  User,
} from 'lucide-react';
import UniversityBrand from '../../components/UniversityBrand';
import { ActionConfirmProvider } from '../../components/ActionConfirm';
import NotificationBell from '../../components/NotificationBell';
import { formatDateInManila } from '../../utils/dateTime';
import { portalLayoutClassName, useCompactNav } from '../../hooks/useCompactNav';
import '../../styles/superAdmin/adminLayout.css';
import '../../styles/user/userLayout.css';

const navSections = [
  {
    heading: 'Overview',
    links: [{ label: 'Dashboard', href: '/user/dashboard', icon: LayoutDashboard }],
  },
  {
    heading: 'My Access',
    links: [
      { label: 'My Schedule', href: '/user/my-schedule', icon: CalendarClock },
      { label: 'Request Override', href: '/user/request-override', icon: ShieldAlert },
      { label: 'Access Logs', href: '/user/access-logs', icon: Activity },
    ],
  },
  {
    heading: 'Activity',
    links: [{ label: 'Activity Logs', href: '/user/activity-logs', icon: ScrollText }],
  },
  {
    heading: 'Account',
    links: [{ label: 'My Account', href: '/user/my-account', icon: User }],
  },
];

const navLinks = navSections.flatMap((section) => section.links);

const pageTitles = {
  '/user/dashboard': 'Dashboard',
  '/user/my-account': 'My Account',
  '/user/access-logs': 'Access Logs',
  '/user/activity-logs': 'Activity Logs',
  '/user/request-override': 'Request Override',
  '/user/my-schedule': 'My Schedule',
};

function headerProfilePhoto(user) {
  const photo = String(user?.users_photo || user?.usersPhoto || user?.photo || '').trim();

  if (!photo) {
    return '';
  }

  if (/^(data:image\/|blob:|https?:\/\/)/i.test(photo)) {
    return photo;
  }

  if (photo.startsWith('/') || photo.startsWith('./') || photo.startsWith('../')) {
    return photo;
  }

  return '';
}

function ProfileMenu({ className = '', onLogout }) {
  return (
    <div className={`super-admin-profile-menu ${className}`.trim()} role="menu">
      <a className="super-admin-profile-menu-link" href="/user/my-account" role="menuitem">
        <User size={16} aria-hidden="true" />
        <span>My Account</span>
      </a>
      <a className="super-admin-profile-menu-link" href="/user/my-account#security" role="menuitem">
        <KeyRound size={16} aria-hidden="true" />
        <span>Security</span>
      </a>
      <div className="super-admin-profile-menu-divider" />
      <button className="super-admin-profile-menu-logout" type="button" role="menuitem" onClick={() => onLogout()}>
        <LogOut size={16} aria-hidden="true" />
        <span>Log Out</span>
      </button>
    </div>
  );
}

export default function UserLayout({ children, user, onLogout }) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    return window.localStorage.getItem('user_portal_sidebar_collapsed') === 'true';
  });
  const { isCompact, isMobileNavOpen, setIsMobileNavOpen } = useCompactNav();
  const [isProfileDrawerOpen, setIsProfileDrawerOpen] = useState(false);
  const [isSidebarProfileOpen, setIsSidebarProfileOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const profileDrawerRef = useRef(null);
  const sidebarProfileRef = useRef(null);
  const currentPage = navLinks.find((link) => link.href === window.location.pathname);
  const headerTitle = pageTitles[window.location.pathname] || currentPage?.label || 'Dashboard';
  const headerDate = formatDateInManila(now, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const headerDay = formatDateInManila(now, { weekday: 'long' });
  const headerTime = formatDateInManila(now, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const fullName = [user?.first_name, user?.middle_name, user?.last_name, user?.extension_name]
    .filter(Boolean)
    .join(' ');
  const displayName = fullName || user?.username || 'Faculty / Staff';
  const roleLabel = user?.role === 'staff' ? 'Staff' : 'Faculty';
  const profilePhoto = headerProfilePhoto(user);
  const profileInitial = (displayName.trim().charAt(0) || 'U').toUpperCase();

  useEffect(() => {
    window.localStorage.setItem('user_portal_sidebar_collapsed', String(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (!isProfileDrawerOpen && !isSidebarProfileOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (isProfileDrawerOpen && !profileDrawerRef.current?.contains(event.target)) {
        setIsProfileDrawerOpen(false);
      }

      if (isSidebarProfileOpen && !sidebarProfileRef.current?.contains(event.target)) {
        setIsSidebarProfileOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsProfileDrawerOpen(false);
        setIsSidebarProfileOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isProfileDrawerOpen, isSidebarProfileOpen]);

  return (
    <div className={portalLayoutClassName({ isCollapsed, isCompact, isMobileNavOpen, extra: 'user-portal-layout' })}>
      {isCompact && isMobileNavOpen ? (
        <button
          className="super-admin-nav-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setIsMobileNavOpen(false)}
        />
      ) : null}
      <aside
        className="super-admin-sidebar"
        aria-label="Faculty and staff navigation"
        aria-hidden={isCompact && !isMobileNavOpen}
        inert={isCompact && !isMobileNavOpen ? true : undefined}
      >
        <div className="super-admin-sidebar-brand">
          <a className="super-admin-logo" href="/user/dashboard" aria-label="Entrivo dashboard">
            <UniversityBrand />
          </a>
          <button
            className="super-admin-sidebar-toggle"
            type="button"
            aria-label={isCompact ? 'Close navigation' : isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => {
              if (isCompact) {
                setIsMobileNavOpen(false);
                return;
              }

              setIsCollapsed((value) => !value);
            }}
          >
            {isCompact || !isCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>

        <nav className="super-admin-nav" aria-label="Portal pages">
          {navSections.map(({ heading, links }) => (
            <div className="super-admin-nav-section" key={heading}>
              <p className="super-admin-nav-heading" aria-hidden={!isCompact && isCollapsed}>
                {heading}
              </p>
              <div className="super-admin-nav-section-links">
                {links.map(({ label, href, icon: Icon }) => {
                  const isActive = window.location.pathname === href;

                  return (
                    <a
                      className={`super-admin-nav-link${isActive ? ' is-active' : ''}`}
                      href={href}
                      key={href}
                      data-label={label}
                      title={!isCompact && isCollapsed ? label : undefined}
                      onClick={() => setIsMobileNavOpen(false)}
                    >
                      <Icon size={20} aria-hidden="true" />
                      <span>{label}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="super-admin-sidebar-profile" ref={sidebarProfileRef}>
          <div className="super-admin-profile">
            <button
              className="super-admin-profile-trigger"
              type="button"
              aria-expanded={isSidebarProfileOpen}
              aria-haspopup="menu"
              onClick={() => {
                setIsProfileDrawerOpen(false);
                setIsSidebarProfileOpen((current) => !current);
              }}
            >
              <div className="super-admin-profile-avatar" aria-hidden="true">
                {profilePhoto ? <img src={profilePhoto} alt="" /> : <span>{profileInitial}</span>}
              </div>
              <span className="super-admin-profile-name">{displayName}</span>
            </button>
            <a className="super-admin-profile-settings" href="/user/my-account" aria-label="My Account">
              <User size={16} strokeWidth={1.75} />
            </a>
          </div>

          {isSidebarProfileOpen ? (
            <ProfileMenu className="super-admin-sidebar-profile-menu" onLogout={onLogout} />
          ) : null}
        </div>
      </aside>

      <div className="super-admin-content">
        <header className="super-admin-topbar">
          <div className="super-admin-topbar-title">
            <button
              className="super-admin-header-sidebar-toggle"
              type="button"
              aria-label={isCompact ? 'Open navigation' : 'Expand sidebar'}
              aria-expanded={isCompact ? isMobileNavOpen : !isCollapsed}
              onClick={() => {
                if (isCompact) {
                  setIsMobileNavOpen((open) => !open);
                  return;
                }

                setIsCollapsed(false);
              }}
            >
              <Menu size={18} />
            </button>
            <div>
              <h1>{headerTitle}</h1>
            </div>
          </div>

          <div className="super-admin-topbar-actions">
            <NotificationBell
              requestUrl="/api/user_portal.php"
              requestParams={{ action: 'activity_logs', user_id: user?.id, limit: 10 }}
              viewAllHref="/user/activity-logs"
              dismissOpen={isProfileDrawerOpen || isSidebarProfileOpen}
              onOpen={() => {
                setIsProfileDrawerOpen(false);
                setIsSidebarProfileOpen(false);
              }}
            />
            <div
              className="super-admin-date-card"
              aria-label={`${headerDate}, ${headerDay} ${headerTime} Asia/Manila`}
            >
              <div>
                <strong>{headerDate}</strong>
                <small>
                  {headerDay} · {headerTime}
                </small>
              </div>
            </div>
            <div className="super-admin-profile-drawer" ref={profileDrawerRef}>
              <button
                className="super-admin-topbar-profile"
                type="button"
                aria-expanded={isProfileDrawerOpen}
                aria-haspopup="menu"
                onClick={() => {
                  setIsSidebarProfileOpen(false);
                  setIsProfileDrawerOpen((current) => !current);
                }}
              >
                <div className="super-admin-topbar-avatar" aria-hidden="true">
                  {profilePhoto ? <img src={profilePhoto} alt="" /> : <User size={18} strokeWidth={1.6} />}
                </div>
              </button>

              {isProfileDrawerOpen ? <ProfileMenu onLogout={onLogout} /> : null}
            </div>
          </div>
        </header>

        <ActionConfirmProvider user={user}>{children}</ActionConfirmProvider>
      </div>
    </div>
  );
}
