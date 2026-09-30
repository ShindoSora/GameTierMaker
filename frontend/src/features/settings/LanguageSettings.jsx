(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const { SettingsSectionHeading, LanguageSelector } = window.GameTierApp;
  function LanguageSettings({ preferencesModel, languageModel }) {
    const { settingsActiveSection } = preferencesModel;
    const { uiLanguage, handleLanguageChange, languageSaving } = languageModel;
    return (
      settingsActiveSection === 'language' && (
        <div>
          <SettingsSectionHeading title={t('settings.tabs.language')} />
          <div
            style={{
              marginBottom: 20,
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                color: 'var(--text-secondary)',
              }}
            >
              {t('settings.language')}
            </label>
            <LanguageSelector
              value={uiLanguage}
              onChange={handleLanguageChange}
              disabled={languageSaving}
            />
          </div>
        </div>
      )
    );
  }
  Object.assign(window.GameTierApp, {
    LanguageSettings,
  });
})();
