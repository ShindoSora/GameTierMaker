(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const { SettingsSectionHeading } = window.GameTierApp;
  function AboutSettings({ preferencesModel, settingsModel }) {
    const { settingsActiveSection } = preferencesModel;
    const { openSourceLicenses } = settingsModel;
    return (
      settingsActiveSection === 'licenses' && (
        <div>
          <SettingsSectionHeading
            title={t('settings.tabs.licenses')}
            description={t('settings.licensesDescription')}
          />
          {openSourceLicenses.length === 0 ? (
            <p
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
              }}
            >
              {t('common.pleaseWait')}
            </p>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              {openSourceLicenses.map((license) => (
                <section
                  key={license.id}
                  style={{
                    border: '1px solid var(--border-strong)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--surface)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid var(--divider)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      alignItems: 'baseline',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      {license.name}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {license.license}
                    </span>
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 12,
                      maxHeight: 260,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'Consolas, monospace',
                      fontSize: 11,
                      lineHeight: 1.5,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {license.text}
                  </pre>
                </section>
              ))}
            </div>
          )}
        </div>
      )
    );
  }
  Object.assign(window.GameTierApp, {
    AboutSettings,
  });
})();
