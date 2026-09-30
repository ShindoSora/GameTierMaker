(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const { SettingsSectionHeading } = window.GameTierApp;
  function DownloadSettings({ preferencesModel, downloadsModel }) {
    const { settingsActiveSection } = preferencesModel;
    const {
      downloadSettings,
      downloadDirectory,
      setDownloadDirectory,
      handleChooseDownloadDirectory,
      downloadSaving,
      downloadSelecting,
      handleSaveDownloadDirectory,
    } = downloadsModel;
    return (
      settingsActiveSection === 'download' && (
        <div>
          <SettingsSectionHeading title={t('settings.tabs.download')} />
          {downloadSettings?.runtime_mode === 'browser' ? (
            <div
              style={{
                padding: '14px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface)',
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                {t('download.browserManagedTitle')}
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.7,
                  margin: 0,
                }}
              >
                {t('download.browserManagedDescription')}
              </p>
            </div>
          ) : downloadSettings ? (
            <div>
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.7,
                  marginBottom: 16,
                }}
              >
                {t('download.desktopDescription')}
              </p>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 600,
                  marginBottom: 6,
                  color: 'var(--text-secondary)',
                }}
              >
                {t('download.directory')}
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
                    minWidth: 0,
                  }}
                  value={downloadDirectory}
                  onChange={(event) => setDownloadDirectory(event.target.value)}
                  placeholder={downloadSettings.effective_directory || t('download.systemDefault')}
                />
                <button
                  className="btn btn-sm"
                  onClick={handleChooseDownloadDirectory}
                  disabled={downloadSaving || downloadSelecting}
                  style={{
                    flexShrink: 0,
                  }}
                >
                  {downloadSelecting ? t('common.pleaseWait') : t('download.choose')}
                </button>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.6,
                  marginTop: 8,
                  overflowWrap: 'anywhere',
                }}
              >
                {t('download.effectiveDirectory')}: {downloadSettings.effective_directory}
              </div>
              {!downloadSettings.is_valid && (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--danger)',
                    lineHeight: 1.6,
                    marginTop: 8,
                  }}
                >
                  {t('download.invalidFallback')}
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  marginTop: 16,
                }}
              >
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => handleSaveDownloadDirectory(downloadDirectory.trim())}
                  disabled={downloadSaving || downloadSelecting}
                >
                  {downloadSaving ? t('common.pleaseWait') : t('actions.save')}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => handleSaveDownloadDirectory('')}
                  disabled={downloadSaving || downloadSelecting}
                >
                  {t('download.restoreDefault')}
                </button>
              </div>
            </div>
          ) : (
            <p
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
              }}
            >
              {t('common.pleaseWait')}
            </p>
          )}
        </div>
      )
    );
  }
  Object.assign(window.GameTierApp, {
    DownloadSettings,
  });
})();
