(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const { SettingsSectionHeading } = window.GameTierApp;
  function NintendoSettings({ preferencesModel, nintendoModel, settingsModel }) {
    const { settingsActiveSection } = preferencesModel;
    const {
      handleNintendoStart,
      loadNintendoAccounts,
      nintendoAccounts,
      handleNintendoSync,
      handleNintendoDeleteImages,
      handleNintendoUnbind,
      nintendoExcludeDemos,
      handleNintendoExcludeDemos,
    } = nintendoModel;
    const { settingsOperation } = settingsModel;
    return (
      settingsActiveSection === 'nintendo_accounts' && (
        <div>
          <SettingsSectionHeading title="Nintendo" />
          <p
            style={{
              margin: '0 0 12px',
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.7,
            }}
          >
            {t('nintendo.bindHelp')}
          </p>
          <button
            className="btn btn-sm btn-primary"
            onClick={handleNintendoStart}
            disabled={!!settingsOperation}
          >
            {t('nintendo.openLogin')}
          </button>


          <div
            style={{
              height: 1,
              background: 'var(--divider)',
              margin: '16px 0',
            }}
          ></div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {t('account.boundAccounts')}
            </span>
            <button className="btn btn-xs" onClick={loadNintendoAccounts}>
              {t('actions.refresh')}
            </button>
          </div>

          {Object.keys(nintendoAccounts).length === 0 ? (
            <p
              style={{
                textAlign: 'center',
                color: 'var(--text-secondary)',
                padding: 20,
                fontSize: 13,
              }}
            >
              {t('nintendo.noAccounts')}
            </p>
          ) : (
            Object.entries(nintendoAccounts).map(([accountId, info]) => (
              <div key={accountId} className="steam-account-row nintendo-account-row">
                <div
                  className="avatar-fallback"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--accent-glow)',
                    color: 'var(--accent)',
                    flexShrink: 0,
                  }}
                >
                  N
                </div>
                <div
                  className="name"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <span>{info.display_name || accountId}</span>
                  <small
                    style={{
                      fontSize: 10,
                      color: info.needs_reauth ? 'var(--danger)' : 'var(--text-secondary)',
                    }}
                  >
                    {info.needs_reauth
                      ? t('nintendo.reauthRequired')
                      : info.last_sync_at
                        ? t('nintendo.lastSynced')
                        : t('nintendo.notSynced')}
                  </small>
                </div>
                <div className="actions">
                  <div className="nintendo-sync-controls">
                    <button
                      className="btn btn-xs btn-primary"
                      onClick={() => handleNintendoSync(accountId)}
                      disabled={!!settingsOperation}
                    >
                      {t('actions.sync')}
                    </button>
                    <label className="nintendo-demo-option" title={t('nintendo.excludeDemosHelp')}>
                      <input
                        type="checkbox"
                        checked={nintendoExcludeDemos[accountId] !== false}
                        onChange={event => handleNintendoExcludeDemos(accountId, event.target.checked)}
                        disabled={!!settingsOperation}
                      />
                      {t('nintendo.excludeDemos')}
                    </label>
                  </div>
                  <button
                    className="btn btn-xs"
                    style={{
                      color: 'var(--danger)',
                    }}
                    onClick={() => handleNintendoDeleteImages(accountId)}
                    disabled={!!settingsOperation}
                  >
                    {t('actions.deleteImages')}
                  </button>
                  <button
                    className="btn btn-xs btn-danger"
                    onClick={() => handleNintendoUnbind(accountId)}
                    disabled={!!settingsOperation}
                  >
                    {t('actions.unbind')}
                  </button>
                </div>
              </div>
            ))
          )}

        </div>
      )
    );
  }
  Object.assign(window.GameTierApp, {
    NintendoSettings,
  });
})();
