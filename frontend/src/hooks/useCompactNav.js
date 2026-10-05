import { useEffect, useState } from 'react';

export const COMPACT_NAV_QUERY = '(max-width: 1279px)';

export function useCompactNav() {
  const [isCompact, setIsCompact] = useState(() => window.matchMedia(COMPACT_NAV_QUERY).matches);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(COMPACT_NAV_QUERY);

    function handleChange() {
      setIsCompact(media.matches);

      if (!media.matches) {
        setIsMobileNavOpen(false);
      }
    }

    handleChange();
    media.addEventListener('change', handleChange);

    return () => media.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!isMobileNavOpen) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsMobileNavOpen(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMobileNavOpen]);

  return {
    isCompact,
    isMobileNavOpen,
    setIsMobileNavOpen,
  };
}

export function portalLayoutClassName({ isCollapsed, isCompact, isMobileNavOpen, extra = '' }) {
  return [
    'super-admin-layout',
    extra,
    !isCompact && isCollapsed ? 'is-sidebar-collapsed' : '',
    isCompact ? 'is-compact-nav' : '',
    isMobileNavOpen ? 'is-mobile-nav-open' : '',
  ]
    .filter(Boolean)
    .join(' ');
}
