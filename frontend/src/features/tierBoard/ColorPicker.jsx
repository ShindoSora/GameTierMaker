(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  function ColorPicker({ tierBoardModel }) {
    const { colorPicker, setColorPicker, PRESET_COLORS, applyTierColor } = tierBoardModel;
    return (
      colorPicker &&
      colorPicker.show && (
        <div
          className="tier-color-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 5000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)',
          }}
          onClick={() => setColorPicker(null)}
        >
          <div
            className="tier-color-dialog"
            style={{
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-lg)',
              padding: 24,
              width: 320,
              maxWidth: 'calc(100vw - 32px)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                marginBottom: 16,
              }}
            >
              {t('tier.colorDialogTitle', {
                tierLabel: colorPicker.tierLabel,
              })}
            </div>

            {/* 调色盘 */}
            <input
              className="tier-color-input"
              type="color"
              value={colorPicker.color || '#808080'}
              onChange={(e) =>
                setColorPicker({
                  ...colorPicker,
                  color: e.target.value,
                })
              }
              style={{
                width: '100%',
                height: 48,
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                background: 'transparent',
                marginBottom: 16,
              }}
            />

            {/* 常用配色 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(8, 1fr)',
                gap: 6,
                marginBottom: 16,
              }}
            >
              {PRESET_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() =>
                    setColorPicker({
                      ...colorPicker,
                      color: c,
                    })
                  }
                  style={{
                    width: '100%',
                    minWidth: 0,
                    aspectRatio: '1',
                    padding: 0,
                    borderRadius: 6,
                    background: c,
                    cursor: 'pointer',
                    border:
                      colorPicker.color === c
                        ? '2px solid var(--text-primary)'
                        : '2px solid transparent',
                    transition: 'transform var(--transition-fast), border 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                  title={c}
                  aria-label={c}
                  aria-pressed={colorPicker.color === c}
                />
              ))}
            </div>

            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
              }}
            >
              <button className="btn btn-sm" onClick={() => setColorPicker(null)}>
                {t('actions.cancel')}
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={applyTierColor}
                disabled={!colorPicker.color}
              >
                {t('actions.apply')}
              </button>
            </div>
          </div>
        </div>
      )
    );
  }
  Object.assign(window.GameTierApp, {
    ColorPicker,
  });
})();
