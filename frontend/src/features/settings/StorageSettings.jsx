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
        <div>
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
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
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
            <button
              className="btn btn-sm"
              onClick={handleClearLogFile}
              style={{
                justifyContent: 'center',
                marginTop: 8,
              }}
            >
              {t('storage.clearLogFile')}
            </button>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => handleClearSource('')}
              style={{
                justifyContent: 'center',
                marginTop: 8,
              }}
            >
              {t('storage.clearAllSources')}
            </button>
            <button
              className="btn btn-sm btn-danger"
              onClick={handleResetAllImages}
              style={{
                justifyContent: 'center',
                marginTop: 8,
                background: 'var(--danger)',
                borderColor: 'var(--danger)',
                color: '#fff',
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
