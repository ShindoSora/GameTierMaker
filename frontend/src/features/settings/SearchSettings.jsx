(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const { SettingsSectionHeading, PasswordField } = window.GameTierApp;
  function SearchSettings({ preferencesModel, settingsModel }) {
    const { settingsActiveSection } = preferencesModel;
    const {
      igdbClientId,
      setIgdbClientId,
      igdbClientSecret,
      updateSettingSecret,
      setIgdbClientSecret,
      revealSettingSecret,
      bangumiUserAgent,
      setBangumiUserAgent,
      bangumiToken,
      setBangumiToken,
      steamgriddbApiKey,
      setSteamgriddbApiKey,
      handleSaveAllSettings,
    } = settingsModel;
    return (
      settingsActiveSection === 'search_settings' && (
        <div>
          <SettingsSectionHeading title={t('settings.tabs.search')} />
          {/* IGDB */}
          <div
            style={{
              marginBottom: 12,
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
              IGDB Client ID
            </label>
            <input
              className="input"
              style={{
                width: '100%',
              }}
              value={igdbClientId}
              onChange={(e) => setIgdbClientId(e.target.value)}
              placeholder={t('settings.igdbClientIdPlaceholder')}
            />
          </div>
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
              IGDB Client Secret
            </label>
            <PasswordField
              value={igdbClientSecret}
              onChange={(e) =>
                updateSettingSecret('client_secret', setIgdbClientSecret, e.target.value)
              }
              onReveal={() => revealSettingSecret('client_secret', setIgdbClientSecret)}
              placeholder={t('settings.igdbClientSecretPlaceholder')}
            />
            <p
              style={{
                marginTop: 8,
                fontSize: 11,
                color: 'var(--text-secondary)',
              }}
            >
              {t('settings.goTo')}{' '}
              <a
                href="https://api-docs.igdb.com/#getting-started"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--accent)',
                }}
              >
                {t('settings.igdbApiDocs')}
              </a>{' '}
              {t('settings.igdbCredentialsHelp')}
            </p>
          </div>

          <div className="section-divider" />

          {/* Bangumi */}
          <div
            style={{
              marginBottom: 12,
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
              Bangumi User-Agent
            </label>
            <input
              className="input"
              style={{
                width: '100%',
              }}
              value={bangumiUserAgent}
              onChange={(e) => setBangumiUserAgent(e.target.value)}
              placeholder="Bangumi User-Agent"
            />
          </div>
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
              {t('settings.bangumiTokenOptional')}
            </label>
            <PasswordField
              value={bangumiToken}
              onChange={(e) =>
                updateSettingSecret('bangumi_token', setBangumiToken, e.target.value)
              }
              onReveal={() => revealSettingSecret('bangumi_token', setBangumiToken)}
              placeholder="Bangumi OAuth Token"
            />
            <div
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 4,
                color: 'var(--text-secondary)',
              }}
            >
              {t('settings.goTo')}{' '}
              <a
                href="https://bangumi.github.io/api/#/"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--accent)',
                }}
              >
                Bangumi API
              </a>{' '}
              {t('settings.bangumiHelp')}
            </div>
          </div>

          <div className="section-divider" />

          {/* SteamGridDB */}
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
              {t('settings.steamgriddbApiKeyLabel')}
            </label>
            <PasswordField
              value={steamgriddbApiKey}
              onChange={(e) =>
                updateSettingSecret('steamgriddb_api_key', setSteamgriddbApiKey, e.target.value)
              }
              onReveal={() => revealSettingSecret('steamgriddb_api_key', setSteamgriddbApiKey)}
              placeholder={t('settings.steamgriddbApiKeyPlaceholder')}
            />
            <p
              style={{
                marginTop: 8,
                fontSize: 11,
                color: 'var(--text-secondary)',
              }}
            >
              {t('settings.steamgriddbHelpBefore')}{' '}
              <a
                href="https://www.steamgriddb.com/profile/preferences/api"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--accent)',
                }}
              >
                {t('settings.steamgriddbApiDocs')}
              </a>{' '}
              {t('settings.steamgriddbHelpAfter')}
            </p>
            <p
              style={{
                marginTop: 8,
                fontSize: 11,
                color: 'var(--text-secondary)',
              }}
            >
              {t('settings.vndbNoKey')}
            </p>
          </div>

          <div className="section-divider" />

          <button
            className="btn btn-primary btn-sm"
            onClick={handleSaveAllSettings}
            style={{
              marginBottom: 10,
            }}
          >
            {t('settings.saveAll')}
          </button>

          <div className="section-divider" />
        </div>
      )
    );
  }
  Object.assign(window.GameTierApp, {
    SearchSettings,
  });
})();
