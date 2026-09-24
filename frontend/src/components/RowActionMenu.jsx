import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import '../styles/shared/rowActionMenu.css';

export default function RowActionMenu({ label, items, disabled = false }) {
  const [menu, setMenu] = useState(null);
  const visibleItems = items.filter((item) => item && !item.hidden);
  const regularItems = visibleItems.filter((item) => !item.danger);
  const dangerItems = visibleItems.filter((item) => item.danger);

  useEffect(() => {
    if (!menu) {
      return undefined;
    }

    function closeMenu() {
      setMenu(null);
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setMenu(null);
      }
    }

    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);

    return () => {
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [menu]);

  function toggleMenu(event) {
    event.stopPropagation();

    if (menu) {
      setMenu(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const width = 188;
    const height = 12 + visibleItems.length * 38 + (dangerItems.length > 0 && regularItems.length > 0 ? 13 : 0);
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    const top = rect.bottom + 6 + height < window.innerHeight
      ? rect.bottom + 6
      : Math.max(8, rect.top - height - 6);

    setMenu({ top, left });
  }

  function renderItem(item) {
    const Icon = item.icon;

    return (
      <button
        key={item.label}
        type="button"
        role="menuitem"
        className={item.danger ? 'is-danger' : undefined}
        disabled={item.disabled}
        onClick={() => {
          setMenu(null);
          item.onClick?.();
        }}
      >
        {Icon ? <Icon size={16} strokeWidth={1.75} aria-hidden="true" /> : null}
        {item.label}
      </button>
    );
  }

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <div className="row-action-menu-cell">
      <button
        type="button"
        className="row-action-menu-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(menu)}
        onClick={toggleMenu}
        disabled={disabled}
      >
        <MoreVertical size={16} aria-hidden="true" />
      </button>
      {menu
        ? createPortal(
            <div
              className="row-action-menu"
              role="menu"
              style={{ top: menu.top, left: menu.left }}
              onClick={(event) => event.stopPropagation()}
            >
              {regularItems.map(renderItem)}
              {dangerItems.length > 0 && regularItems.length > 0 ? (
                <div className="row-action-menu-divider" role="separator" />
              ) : null}
              {dangerItems.map(renderItem)}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
