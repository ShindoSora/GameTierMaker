(() => {
  'use strict';

  const { useRef, useLayoutEffect, useEffect } = React;
  const { t } = window.GameTierI18n;
  function TierContextMenu({ tierBoardModel }) {
    const { tierContextMenu, setTierContextMenu, handleColorTier, handleDeleteTier } =
      tierBoardModel;
    const menuRef = useRef(null);
    useLayoutEffect(() => {
      const menu = menuRef.current;
      if (!tierContextMenu || !menu) return;
      const margin = 8;
      const left = Math.max(margin, Math.min(tierContextMenu.x, window.innerWidth - menu.offsetWidth - margin));
      const top = Math.max(margin, Math.min(tierContextMenu.y, window.innerHeight - menu.offsetHeight - margin));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
    }, [tierContextMenu]);
    useEffect(() => {
      if (!tierContextMenu) return undefined;
      const close = () => setTierContextMenu(null);
      const escape = event => { if (event.key === 'Escape') close(); };
      window.addEventListener('resize', close);
      document.addEventListener('keydown', escape);
      return () => {
        window.removeEventListener('resize', close);
        document.removeEventListener('keydown', escape);
      };
    }, [tierContextMenu, setTierContextMenu]);
    const navigate = event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(menuRef.current.querySelectorAll('[role="menuitem"]'));
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    };
    return (
      tierContextMenu && (
        <div
          ref={menuRef}
          className="context-menu tier-context-menu"
          role="menu"
          aria-label={t('tier.menuTitle')}
          style={{
            left: tierContextMenu.x,
            top: tierContextMenu.y,
          }}
          onClick={() => setTierContextMenu(null)}
          onKeyDown={navigate}
        >
          <button type="button" role="menuitem"
            className="context-menu-item"
            onClick={() => {
              handleColorTier(tierContextMenu.tierId, tierContextMenu.tierLabel);
            }}
          >
            {t('tier.changeColor')}
          </button>
          <div className="context-menu-separator" />
          <button type="button" role="menuitem"
            className="context-menu-item context-menu-item-danger"
            onClick={() => {
              handleDeleteTier(tierContextMenu.tierId);
              setTierContextMenu(null);
            }}
          >
            {t('tier.delete')}
          </button>
        </div>
      )
    );
  }
  Object.assign(window.GameTierApp, {
    TierContextMenu,
  });
})();
