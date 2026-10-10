import { useEffect, useRef, useState } from 'react';
import { ActionConfirmProvider } from '../../components/ActionConfirm';
import NotificationBell from '../../components/NotificationBell';
import {
  ClipboardCheck,
  Activity,
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
  ShieldAlert,
  User,
  Users,
  FileBarChart,
  ScrollText,
} from 'lucide-react';
import UniversityBrand from '../../components/UniversityBrand';
import { formatDateInManila } from '../../utils/dateTime';
import { portalLayoutClassName, useCompactNav } from '../../hooks/useCompactNav';
import { normalizePrivileges } from '../../utils/privileges';
import '../../styles/superAdmin/adminLayout.css';

const navSections = [
  {
    heading: 'Overview',
    links: [
      {
        label: 'Dashboard',
        href: '/admin/dashboard',
        icon: LayoutDashboard,
        privilege: 'dashboard',
      },
    ],
  },
  {
    heading: 'User Management',
    links: [
      {
        label: 'Manage Users',
        href: '/admin/manage-users',
        icon: Users,
        privilege: 'manage_users',
      },
      {
        label: 'Pending registration',
        href: '/admin/pending-registrations',
        icon: ClipboardCheck,
        privilege: 'pending_registrations',
      },
      {
        label: 'Fingerprint',
        href: '/admin/fingerprint',
        icon: Fingerprint,
        privilege: 'fingerprint',
      },
      {
        label: 'RFID Cards',
        href: '/admin/rfid-cards',
        icon: IdCard,
        privilege: 'rfid_cards',
      },
    ],
  },
  {
    heading: 'Access Management',
    links: [
      {
        label: 'Schedules',
        href: '/admin/schedules',
        icon: CalendarClock,
        privilege: 'schedules',
      },
      {
        label: 'Pending overrides',
        href: '/admin/pending-overrides',
        icon: ShieldAlert,
        privilege: 'pending_overrides',
      },
      {
        label: 'Access Logs',
        href: '/admin/access-logs',
        icon: Activity,
        privilege: 'access_logs',
      },
    ],
  },
  {
    heading: 'Activity',
    links: [
      {
        label: 'Activity Logs',
        href: '/admin/activity-logs',
        icon: ScrollText,
        privilege: 'activity_logs',
      },
    ],
  },
  {
    heading: 'Analytics',
    links: [
      {
        label: 'Reports',
        href: '/admin/reports',
        icon: FileBarChart,
        privilege: 'reports',
      },
    ],
  },
  {
    heading: 'System',
    links: [
      {
        label: 'Settings',
        href: '/admin/settings',
        icon: Settings,
        privilege: 'settings',
      },
    ],
  },
];

const navLinks = navSections.flatMap((section) => section.links);

function ProfileMenu({ className = '', onLogout, canOpenSettings = true }) {
  return (
    <div className={`super-admin-profile-menu ${className}`.trim()} role="menu">
      <a className="super-admin-profile-menu-link" href="/admin/profile" role="menuitem">
        <User size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>View Profile</span>
      </a>
      {canOpenSettings ? (
        <a className="super-admin-profile-menu-link" href="/admin/settings" role="menuitem">
          <Settings size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>Settings</span>
        </a>
      ) : null}
      <div className="super-admin-profile-menu-divider" />
      <button className="super-admin-profile-menu-logout" type="button" role="menuitem" onClick={() => onLogout()}>
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
  '/admin/register-user': 'Registration',
  '/admin/profile': 'Admin information',
};

export default function AdminLayout({ children, user, onLogout }) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    return window.localStorage.getItem('admin_sidebar_collapsed') === 'true';
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
  const headerMetaLabel = `${headerTime}, ${headerDay}`;
  const fullName = [
    user?.first_name,
    user?.middle_name,
    user?.last_name,
    user?.extension_name,
  ].filter(Boolean).join(' ');
  const displayName = fullName || user?.username || 'Admin';
  const unreadNotificationCount = Number(user?.unread_notifications || user?.unreadNotifications || 0);
  const profilePhoto = headerProfilePhoto(user);
  const profileInitial = (displayName.trim().charAt(0) || 'A').toUpperCase();
  const userPrivileges = normalizePrivileges(user?.privileges, user?.role);
  const visibleNavSections = navSections
    .map((section) => ({
      ...section,
      links: section.links.filter((link) => userPrivileges.includes(link.privilege)),
    }))
    .filter((section) => section.links.length > 0);
  const dashboardHref = userPrivileges.includes('dashboard')
    ? '/admin/dashboard'
    : visibleNavSections[0]?.links?.[0]?.href || '/admin/dashboard';
  const canOpenSettings = userPrivileges.includes('settings');

  useEffect(() => {
    window.localStorage.setItem('admin_sidebar_collapsed', String(isCollapsed));
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
    <div className={portalLayoutClassName({ isCollapsed, isCompact, isMobileNavOpen })}>
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
        aria-label="Admin navigation"
        aria-hidden={isCompact && !isMobileNavOpen}
        inert={isCompact && !isMobileNavOpen ? true : undefined}
      >
        <div className="super-admin-sidebar-brand">
          <a className="super-admin-logo" href={dashboardHref} aria-label="Entrivo dashboard">
            <UniversityBrand />
          </a>
          <button
            className="super-admin-sidebar-toggle"
            type="button"
            aria-label={isCompact ? 'Close navigation' : isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={isCompact ? isMobileNavOpen : !isCollapsed}
            onClick={() => {
              if (isCompact) {
                setIsMobileNavOpen(false);
                return;
              }

              setIsCollapsed((current) => !current);
            }}
          >
            {isCompact || !isCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>

        <nav className="super-admin-nav" aria-label="Admin pages">
          {visibleNavSections.map(({ heading, links }) => (
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
            <a className="super-admin-profile-settings" href="/admin/settings" aria-label="Settings">
              <Settings size={16} strokeWidth={1.75} />
            </a>
          </div>

          {isSidebarProfileOpen && (
            <ProfileMenu
              className="super-admin-sidebar-profile-menu"
              onLogout={onLogout}
              canOpenSettings={canOpenSettings}
            />
          )}
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
              requestUrl="/api/activity_logs.php"
              requestParams={{ limit: 10 }}
              viewAllHref="/admin/activity-logs"
              badgeCount={unreadNotificationCount}
              dismissOpen={isProfileDrawerOpen || isSidebarProfileOpen}
              onOpen={() => {
                setIsProfileDrawerOpen(false);
                setIsSidebarProfileOpen(false);
              }}
            />
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

              {isProfileDrawerOpen && (
                <ProfileMenu onLogout={onLogout} canOpenSettings={canOpenSettings} />
              )}
            </div>
          </div>
        </header>

        <ActionConfirmProvider user={user}>{children}</ActionConfirmProvider>
      </div>
    </div>
  );
}
