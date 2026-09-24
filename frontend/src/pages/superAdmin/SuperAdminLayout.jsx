import { useEffect, useRef, useState } from 'react';
import {
  ClipboardCheck,
  Activity,
  Bell,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Fingerprint,
  IdCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  User,
  Users,
  FileBarChart,
  ScrollText,
} from 'lucide-react';
import entrivoLogo from '../../assets/images/entrivo_logo.png';
import { formatDateInManila } from '../../utils/dateTime';
import '../../styles/superAdmin/adminLayout.css';

const navSections = [
  {
    heading: 'Overview',
    links: [
      {
        label: 'Dashboard',
        href: '/super-admin/dashboard',
        icon: LayoutDashboard,
      },
    ],
  },
  {
    heading: 'User Management',
    links: [
      {
        label: 'Manage Users',
        href: '/super-admin/manage-users',
        icon: Users,
      },
      {
        label: 'Pending registration',
        href: '/super-admin/pending-registrations',
        icon: ClipboardCheck,
      },
      {
        label: 'Fingerprint',
        href: '/super-admin/fingerprint',
        icon: Fingerprint,
      },
      {
        label: 'RFID Cards',
        href: '/super-admin/rfid-cards',
        icon: IdCard,
      },
    ],
  },
  {
    heading: 'Access Management',
    links: [
      {
        label: 'Schedules',
        href: '/super-admin/schedules',
        icon: CalendarClock,
      },
      {
        label: 'Access Logs',
        href: '/super-admin/access-logs',
        icon: Activity,
      },
      {
        label: 'Activity Logs',
        href: '/super-admin/activity-logs',
        icon: ScrollText,
      },
    ],
  },
  {
    heading: 'Analytics',
    links: [
      {
        label: 'Reports',
        href: '/super-admin/reports',
        icon: FileBarChart,
      },
    ],
  },
  {
    heading: 'System',
    links: [
      {
        label: 'Settings',
        href: '/super-admin/settings',
        icon: Settings,
      },
    ],
  },
];

const navLinks = navSections.flatMap((section) => section.links);

function ProfileMenu({ className = '', onLogout }) {
  return (
    <div className={`super-admin-profile-menu ${className}`.trim()} role="menu">
      <a className="super-admin-profile-menu-link" href="/super-admin/profile" role="menuitem">
        <User size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>View Profile</span>
      </a>
      <a className="super-admin-profile-menu-link" href="/super-admin/settings" role="menuitem">
        <Settings size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>Settings</span>
      </a>
      <div className="super-admin-profile-menu-divider" />
      <button className="super-admin-profile-menu-logout" type="button" role="menuitem" onClick={onLogout}>
        <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>Log Out</span>
      </button>
    </div>
  );
}

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

const pageTitles = {
  '/super-admin/register-user': 'Registration',
  '/super-admin/profile': 'Admin information',
};

export default function SuperAdminLayout({ children, user, onLogout }) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    return window.localStorage.getItem('super_admin_sidebar_collapsed') === 'true';
  });
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
  const headerMetaLabel = `${headerTime}, ${headerDay}`;
  const fullName = [
    user?.first_name,
    user?.middle_name,
    user?.last_name,
    user?.extension_name,
  ].filter(Boolean).join(' ');
  const displayName = fullName || user?.username || 'Super Admin';
  const unreadNotificationCount = Number(user?.unread_notifications || user?.unreadNotifications || 0);
  const profilePhoto = headerProfilePhoto(user);
  const profileInitial = (displayName.trim().charAt(0) || 'A').toUpperCase();

  useEffect(() => {
    window.localStorage.setItem('super_admin_sidebar_collapsed', String(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  useEffect(() => {
    if (!isProfileDrawerOpen && !isSidebarProfileOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!profileDrawerRef.current?.contains(event.target)) {
        setIsProfileDrawerOpen(false);
      }
      if (!sidebarProfileRef.current?.contains(event.target)) {
        setIsSidebarProfileOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsProfileDrawerOpen(false);
        setIsSidebarProfileOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isProfileDrawerOpen, isSidebarProfileOpen]);

  return (
    <div className={`super-admin-layout${isCollapsed ? ' is-sidebar-collapsed' : ''}`}>
      <aside className="super-admin-sidebar" aria-label="Super admin navigation">
        <div className="super-admin-sidebar-brand">
          <a className="super-admin-logo" href="/super-admin/dashboard" aria-label="Entrivo dashboard">
            <img className="super-admin-logo-mark" src={entrivoLogo} alt="" aria-hidden="true" />
            <span className="super-admin-logo-text">
              <strong>Entrivo</strong>
              <small>Door Lock Access Control</small>
            </span>
          </a>
          <button
            className="super-admin-sidebar-toggle"
            type="button"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!isCollapsed}
            onClick={() => setIsCollapsed((current) => !current)}
          >
            {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        <nav className="super-admin-nav" aria-label="Super admin pages">
          {navSections.map(({ heading, links }) => (
            <div className="super-admin-nav-section" key={heading}>
              <p className="super-admin-nav-heading" aria-hidden={isCollapsed}>
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
                      title={isCollapsed ? label : undefined}
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
            <a className="super-admin-profile-settings" href="/super-admin/settings" aria-label="Settings">
              <Settings size={16} strokeWidth={1.75} />
            </a>
          </div>

          {isSidebarProfileOpen && (
            <ProfileMenu className="super-admin-sidebar-profile-menu" onLogout={onLogout} />
          )}
        </div>

      </aside>

      <div className="super-admin-content">
        <header className="super-admin-topbar">
          <div className="super-admin-topbar-title">
            <button
              className="super-admin-header-sidebar-toggle"
              type="button"
              aria-label="Expand sidebar"
              aria-expanded={!isCollapsed}
              onClick={() => setIsCollapsed(false)}
            >
              <Menu size={18} />
            </button>
            <div>
              <h1>{headerTitle}</h1>
            </div>
          </div>

          <div className="super-admin-topbar-actions">
            <button className="super-admin-icon-button super-admin-notification" type="button" aria-label="Notifications">
              <Bell size={16} strokeWidth={1.75} />
              {unreadNotificationCount > 0 && (
                <span aria-label={`${unreadNotificationCount} unread notifications`}>
                  {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                </span>
              )}
            </button>
            <div className="super-admin-date-card" aria-label={`${headerDate}, ${headerMetaLabel} Asia/Manila`}>
              <div>
                <strong>{headerDate}</strong>
                <small>{headerMetaLabel}</small>
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
                  {profilePhoto ? (
                    <img src={profilePhoto} alt="" />
                  ) : (
                    <User size={18} strokeWidth={1.6} />
                  )}
                </div>
              </button>

              {isProfileDrawerOpen && <ProfileMenu onLogout={onLogout} />}
            </div>
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}
