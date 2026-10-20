(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const { SettingsSectionHeading } = window.GameTierApp;
  function StorageSettings({ preferencesModel, storageModel, logsModel }) {
    const { settingsActiveSection } = preferencesModel;
    const { handleClearSource, handleResetAllImages } = storageModel;
    const { handleClearLogFile } = logsModel;
    return (
      settingsActiveSection === 'storage' && (
        <div className="storage-settings">
          <SettingsSectionHeading title={t('settings.tabs.cleanup')} />
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-secondary)',
              marginBottom: 16,
            }}
          >
            {t('storage.description')}
          </p>
          <div className="storage-cache-grid">
            {[
              {
                key: 'steam',
                label: t('storage.clearSteam'),
              },
              {
                key: 'igdb',
                label: t('storage.clearIgdb'),
              },
              {
                key: 'bangumi',
                label: t('storage.clearBangumi'),
              },
              {
                key: 'vndb',
                label: t('storage.clearVndb'),
              },
              {
                key: 'steamgriddb',
                label: t('storage.clearSteamgriddb'),
              },
              {
                key: 'xbox',
                label: t('storage.clearXbox'),
              },
              {
                key: 'nintendo',
                label: t('storage.clearNintendo'),
              },
              {
                key: 'cache',
                label: t('storage.clearGeneric'),
              },
            ].map((s) => (
              <button
                key={s.key}
                className="btn btn-sm"
                onClick={() => handleClearSource(s.key)}
                style={{
                  justifyContent: 'center',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="storage-maintenance">
            <button
              className="btn btn-sm"
              onClick={handleClearLogFile}
              style={{
                justifyContent: 'center',
              }}
            >
              {t('storage.clearLogFile')}
            </button>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => handleClearSource('')}
              style={{
                justifyContent: 'center',
              }}
            >
              {t('storage.clearAllSources')}
            </button>
          </div>
          <div className="storage-danger-zone">
            <h3>{t('storage.projectData')}</h3>
            <button
              className="btn btn-sm btn-danger"
              onClick={handleResetAllImages}
              style={{
                justifyContent: 'center',
              }}
            >
              {t('storage.resetProject')}
            </button>
          </div>
        </div>
      )
    );
  }
  Object.assign(window.GameTierApp, {
    StorageSettings,
  });
})();
