(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const { getTemplateDisplayName } = window.GameTierApp;
  function PresetsDialog({ libraryModel }) {
    const { showPresetsModal, setShowPresetsModal, presetsList, handleImportFromTemplate } =
      libraryModel;
    return (
      showPresetsModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
          }}
          onClick={() => setShowPresetsModal(false)}
        >
          <div
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-xl)',
              width: 420,
              maxHeight: '70vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                borderBottom: '1px solid var(--divider-strong)',
              }}
            >
              {/*<span style={{fontSize:16, fontWeight:700}}>{t('preset.title')}</span>*/}
              <button className="btn btn-icon btn-sm" onClick={() => setShowPresetsModal(false)}>
                ✕
              </button>
            </div>
            <div
              style={{
                padding: 18,
                overflow: 'auto',
                flex: 1,
              }}
            >
              {presetsList.length === 0 || !presetsList.some((p) => p.total_images > 0) ? (
                <p
                  style={{
                    textAlign: 'center',
                    color: 'var(--text-secondary)',
                    padding: 30,
                    fontSize: 14,
                  }}
                >
                  {t('preset.empty')}
                </p>
              ) : (
                presetsList.map((p) => (
                  <div
                    key={p.template_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      marginBottom: 8,
                      background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
                        }}
                      >
                        {getTemplateDisplayName(p.template_name)}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          marginTop: 2,
                        }}
                      >
                        {t('preset.imageCount', {
                          count: p.total_images,
                        })}
                      </div>
                    </div>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleImportFromTemplate(p.template_id)}
                      style={{
                        flexShrink: 0,
                      }}
                    >
                      {t('actions.import')}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )
    );
  }
  Object.assign(window.GameTierApp, {
    PresetsDialog,
  });
})();
