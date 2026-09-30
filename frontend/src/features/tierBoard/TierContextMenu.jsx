(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  function TierContextMenu({ tierBoardModel }) {
    const { tierContextMenu, setTierContextMenu, handleColorTier, handleDeleteTier } =
      tierBoardModel;
    return (
      tierContextMenu && (
        <div
          className="context-menu"
          style={{
            left: tierContextMenu.x,
            top: tierContextMenu.y,
          }}
          onClick={() => setTierContextMenu(null)}
        >
          <div
            className="context-menu-item"
            onClick={() => {
              handleColorTier(tierContextMenu.tierId, tierContextMenu.tierLabel);
            }}
          >
            {t('tier.changeColor')}
          </div>
          <div className="context-menu-separator" />
          <div
            className="context-menu-item"
            style={{
              color: 'var(--danger)',
            }}
            onClick={() => {
              handleDeleteTier(tierContextMenu.tierId);
              setTierContextMenu(null);
            }}
          >
            {t('tier.delete')}
          </div>
        </div>
      )
    );
  }
  Object.assign(window.GameTierApp, {
    TierContextMenu,
  });
})();
