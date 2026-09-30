(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const { SettingsSectionHeading, AccountAvatar } = window.GameTierApp;
  function XboxSettings({ preferencesModel, xboxModel, settingsModel }) {
    const { settingsActiveSection } = preferencesModel;
    const {
      xboxGamertag,
      setXboxGamertag,
      handleXboxBind,
      loadXboxAccounts,
      xboxAccounts,
      handleXboxSync,
      handleXboxDeleteImages,
      handleXboxUnbind,
    } = xboxModel;
    const { settingsOperation } = settingsModel;
    return (
      settingsActiveSection === 'xbox_accounts' && (
        <div>
          <SettingsSectionHeading title="Xbox" />
          {/* Xbox 玩家代号 + 绑定 */}
          <div
            style={{
              marginBottom: 14,
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 4,
                color: 'var(--text-secondary)',
              }}
            >
              {t('xbox.gamertag')}
            </label>
            <div
              style={{
                display: 'flex',
                gap: 8,
              }}
            >
              <input
                className="input"
                style={{
                  flex: 1,
                }}
                value={xboxGamertag}
                onChange={(e) => setXboxGamertag(e.target.value)}
                placeholder={t('xbox.gamertagPlaceholder')}
              />
              <button
                className="btn btn-sm btn-primary"
                onClick={handleXboxBind}
                disabled={!!settingsOperation}
                style={{
                  flexShrink: 0,
                  padding: '6px 20px',
                }}
              >
                {t('actions.bind')}
              </button>
            </div>
          </div>

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
            <button className="btn btn-xs" onClick={loadXboxAccounts}>
              {t('actions.refresh')}
            </button>
          </div>

          {Object.keys(xboxAccounts).length === 0 ? (
            <p
              style={{
                textAlign: 'center',
                color: 'var(--text-secondary)',
                padding: 20,
                fontSize: 13,
              }}
            >
              {t('xbox.noAccounts')}
            </p>
          ) : (
            Object.entries(xboxAccounts).map(([xuid, info]) => (
              <div key={xuid} className="steam-account-row">
                <AccountAvatar src={info.avatarfull || ''} name={info.gamertag || xuid} />
                <div className="name">{info.gamertag || xuid}</div>
                <div className="actions">
                  <button
                    className="btn btn-xs btn-primary"
                    onClick={() => handleXboxSync(xuid)}
                    disabled={!!settingsOperation}
                  >
                    {t('actions.sync')}
                  </button>
                  <button
                    className="btn btn-xs"
                    style={{
                      color: 'var(--danger)',
                    }}
                    onClick={() => handleXboxDeleteImages(xuid)}
                  >
                    {t('actions.deleteImages')}
                  </button>
                  <button className="btn btn-xs btn-danger" onClick={() => handleXboxUnbind(xuid)}>
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
    XboxSettings,
  });
})();
