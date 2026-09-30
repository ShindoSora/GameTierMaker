(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const { SettingsSectionHeading, PasswordField, AccountAvatar } = window.GameTierApp;
  function SteamSettings({ preferencesModel, settingsModel, steamModel }) {
    const { settingsActiveSection } = preferencesModel;
    const {
      steamKey,
      updateSettingSecret,
      setSteamKey,
      revealSettingSecret,
      handleSaveSteamKeyFromPlatform,
      settingsOperation,
    } = settingsModel;
    const {
      loadSteamAccounts,
      handleSteamJump,
      steamAccounts,
      handleSyncAccount,
      handleDeleteAccountImages,
      handleUnbindAccount,
    } = steamModel;
    return (
      settingsActiveSection === 'steam_accounts' && (
        <div>
          <SettingsSectionHeading title="Steam" />
          <div
            style={{
              marginBottom: 16,
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
              {t('settings.steamApiKeyLabel')}
            </label>
            <PasswordField
              value={steamKey}
              onChange={(e) => updateSettingSecret('steam_key', setSteamKey, e.target.value)}
              onReveal={() => revealSettingSecret('steam_key', setSteamKey)}
              placeholder={t('settings.steamKeyPlaceholder')}
            />
            <p
              style={{
                marginTop: 4,
                fontSize: 11,
                color: 'var(--text-secondary)',
              }}
            >
              {t('settings.steamKeyHelpBefore')}{' '}
              <a
                href="https://steamcommunity.com/dev/apikey"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--accent)',
                }}
              >
                {t('settings.steamDeveloperPage')}
              </a>
              {t('settings.steamKeyHelpAfter')}
            </p>
            <button
              className="btn btn-sm btn-primary"
              onClick={handleSaveSteamKeyFromPlatform}
              disabled={!!settingsOperation}
            >
              {t('actions.save')}
            </button>
          </div>
          <div
            style={{
              height: 1,
              background: 'var(--divider)',
              marginBottom: 16,
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
            <button className="btn btn-xs" onClick={loadSteamAccounts}>
              {t('actions.refresh')}
            </button>
          </div>
          {/* Steam 绑定跳转 */}
          <p
            style={{
              marginBottom: 12,
              fontSize: 13,
              color: 'var(--text-secondary)',
            }}
          >
            {t('steam.bindHelp')}
          </p>
          <button
            className="btn btn-sm"
            onClick={handleSteamJump}
            style={{
              background: '#1a3a5c',
              border: '1px solid #2a5a8c',
              color: '#66c0f4',
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            {t('steam.bindAccount')}
          </button>

          <div
            style={{
              height: 1,
              background: 'var(--divider)',
              margin: '16px 0',
            }}
          ></div>

          {Object.keys(steamAccounts).length === 0 ? (
            <p
              style={{
                textAlign: 'center',
                color: 'var(--text-secondary)',
                padding: 20,
                fontSize: 13,
              }}
            >
              {t('steam.noAccounts')}
            </p>
          ) : (
            Object.entries(steamAccounts).map(([steamid, info]) => (
              <div key={steamid} className="steam-account-row">
                <AccountAvatar src={info.avatarfull || ''} name={info.personaname || steamid} />
                <div className="name">{info.personaname || steamid}</div>
                <div className="actions">
                  <button
                    className="btn btn-xs btn-primary"
                    onClick={() => handleSyncAccount(steamid)}
                    disabled={!!settingsOperation}
                  >
                    {t('actions.sync')}
                  </button>
                  <button
                    className="btn btn-xs"
                    style={{
                      color: 'var(--danger)',
                    }}
                    onClick={() => handleDeleteAccountImages(steamid)}
                  >
                    {t('actions.deleteImages')}
                  </button>
                  <button
                    className="btn btn-xs btn-danger"
                    onClick={() => handleUnbindAccount(steamid)}
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
    SteamSettings,
  });
})();
