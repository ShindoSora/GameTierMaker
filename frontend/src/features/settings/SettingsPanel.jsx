(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const {
    LanguageSettings,
    SearchSettings,
    SteamSettings,
    PsnSettings,
    XboxSettings,
    NintendoSettings,
    DownloadSettings,
    StorageSettings,
    AboutSettings,
    SettingsSectionHeading,
  } = window.GameTierApp;
  function SettingsPanel({
    island,
    logVisible,
    logAnchorRef,
    preferencesModel,
    logsModel,
    settingsModel,
    languageModel,
    steamModel,
    psnModel,
    xboxModel,
    nintendoModel,
    downloadsModel,
    storageModel,
  }) {
    const {
      showSettings,
      setShowSettings,
      settingsWidth,
      setSettingsWidth,
      settingsActiveSection,
      setSettingsActiveSection,
    } = preferencesModel;
    const { logOpen, logWidth, setLogOpen, unreadLogErrors } = logsModel;
    const { settingsOperation } = settingsModel;
    return (
      (island ? island.visible : showSettings) && (
        <div
          className="settings-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            right: 0,
            zIndex: 3000,
          }}
          onClick={() => {
            if (!settingsOperation) setShowSettings(false);
          }}
        >
          <div ref={island?.backdropRef} className="settings-backdrop" />
          <div
            ref={island?.panelRef}
            className="settings-panel island-panel"
            data-island-state={island?.phase || 'open'}
            style={{
              position: 'absolute',
              top: 8,
              right: (logVisible ?? logOpen) ? logWidth + 16 : 8,
              bottom: 8,
              width: settingsWidth,
              maxWidth: 'calc(100% - 16px)',
              border: '1px solid var(--border-strong)',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              minHeight: 0,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div ref={island?.contentRef} className="island-panel-content" inert={island?.phase === 'closing' ? '' : undefined}>
            {/* 左侧拖拽手柄 */}
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = settingsWidth;
                const onMove = (ev) =>
                  setSettingsWidth(Math.max(320, Math.min(900, startW - (ev.clientX - startX))));
                const onUp = () => {
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }}
              style={{
                position: 'absolute',
                top: 0,
                left: -3,
                bottom: 0,
                width: 6,
                cursor: 'col-resize',
                zIndex: 10,
                background: 'transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            />
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                borderBottom: '1px solid var(--divider-strong)',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                {t('settings.title')}
              </span>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <button
                  className={`btn btn-sm ${logOpen ? 'btn-primary' : ''}`}
                  onClick={(event) => {
                    if (logAnchorRef) logAnchorRef.current = event.currentTarget;
                    setLogOpen((open) => !open);
                  }}
                >
                  {logOpen ? t('logs.collapse') : t('logs.view')}
                  {!logOpen && unreadLogErrors > 0 && (
                    <span className="log-unread-badge">{Math.min(unreadLogErrors, 99)}</span>
                  )}
                </button>
                <button
                  className="btn btn-icon btn-sm"
                  onClick={() => setShowSettings(false)}
                  disabled={!!settingsOperation}
                  aria-label={t('actions.close')}
                >
                  ✕
                </button>
              </div>
            </div>
            {/* Two-column: left tabs + right content */}
            <div className="settings-columns">
              {/* Left tab column */}
              <div className="settings-nav">
                {[
                  {
                    key: 'general',
                    label: t('settings.groups.general'),
                    items: [
                      {
                        key: 'search_settings',
                        label: t('settings.tabs.search'),
                      },
                      {
                        key: 'language',
                        label: t('settings.tabs.language'),
                      },
                      { key: 'appearance', label: t('settings.tabs.appearance') },
                    ],
                  },
                  {
                    key: 'accounts',
                    label: t('settings.groups.accounts'),
                    items: [
                      {
                        key: 'steam_accounts',
                        label: 'Steam',
                      },
                      {
                        key: 'psn_accounts',
                        label: 'PSN',
                      },
                      {
                        key: 'xbox_accounts',
                        label: 'Xbox',
                      },
                      {
                        key: 'nintendo_accounts',
                        label: 'Nintendo',
                      },
                    ],
                  },
                  {
                    key: 'maintenance',
                    label: t('settings.groups.maintenance'),
                    items: [
                      {
                        key: 'download',
                        label: t('settings.tabs.download'),
                      },
                      {
                        key: 'storage',
                        label: t('settings.tabs.cleanup'),
                      },
                      {
                        key: 'licenses',
                        label: t('settings.tabs.licenses'),
                      },
                    ],
                  },
                ].map((group) => (
                  <div key={group.key} className="settings-nav-group">
                    <div className="settings-nav-group-label">{group.label}</div>
                    {group.items.map((tab) => (
                      <button
                        key={tab.key}
                        className={`btn btn-xs settings-nav-item ${settingsActiveSection === tab.key ? 'active' : ''}`}
                        onClick={() => setSettingsActiveSection(tab.key)}
                      >
                        <span className="settings-nav-label">{tab.label}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              {/* Right content */}
              <div className="settings-content">
                {settingsActiveSection === 'appearance' && (
                  <div className="appearance-settings">
                    <SettingsSectionHeading title={t('settings.tabs.appearance')} />
                    <label className="glass-toggle-row">
                      <span>{t('settings.glass.enabled')}</span>
                      <input type="checkbox" checked={preferencesModel.liquidGlassEnabled}
                        onChange={event => preferencesModel.setLiquidGlassEnabled(event.target.checked)} />
                    </label>
                    <p className="glass-help">{t('settings.glass.description')}</p>
                    <div className="glass-transparency-heading">
                      <label htmlFor="glass-transparency">{t('settings.glass.transparency')}</label>
                      <output htmlFor="glass-transparency">{preferencesModel.liquidGlassTransparency}%</output>
                    </div>
                    <input id="glass-transparency" type="range" min="0" max="80" step="1"
                      value={preferencesModel.liquidGlassTransparency}
                      disabled={!preferencesModel.liquidGlassEnabled}
                      onChange={event => preferencesModel.setLiquidGlassTransparency(Number(event.target.value))} />
                    <p className="glass-help">{t('settings.glass.hint')}</p>
                  </div>
                )}
                {settingsOperation && (
                  <div className="settings-operation">
                    <div className="loading-spinner" />
                    <div>
                      <div
                        style={{
                          fontWeight: 600,
                        }}
                      >
                        {t(settingsOperation.labelKey)}
                      </div>
                      <div
                        style={{
                          marginTop: 2,
                          color: 'var(--text-secondary)',
                          fontSize: 11,
                        }}
                      >
                        {t('settings.operationLogHint')}
                      </div>
                    </div>
                  </div>
                )}
                {
                  <LanguageSettings
                    preferencesModel={preferencesModel}
                    languageModel={languageModel}
                  />
                }

                {
                  <SearchSettings
                    preferencesModel={preferencesModel}
                    settingsModel={settingsModel}
                  />
                }

                {
                  <SteamSettings
                    preferencesModel={preferencesModel}
                    settingsModel={settingsModel}
                    steamModel={steamModel}
                  />
                }

                {
                  <PsnSettings
                    preferencesModel={preferencesModel}
                    settingsModel={settingsModel}
                    psnModel={psnModel}
                  />
                }

                {
                  <XboxSettings
                    preferencesModel={preferencesModel}
                    xboxModel={xboxModel}
                    settingsModel={settingsModel}
                  />
                }

                {
                  <NintendoSettings
                    preferencesModel={preferencesModel}
                    nintendoModel={nintendoModel}
                    settingsModel={settingsModel}
                  />
                }

                {
                  <DownloadSettings
                    preferencesModel={preferencesModel}
                    downloadsModel={downloadsModel}
                  />
                }

                {
                  <StorageSettings
                    preferencesModel={preferencesModel}
                    storageModel={storageModel}
                    logsModel={logsModel}
                  />
                }

                {
                  <AboutSettings
                    preferencesModel={preferencesModel}
                    settingsModel={settingsModel}
                  />
                }
              </div>
            </div>
            </div>
          </div>
        </div>
      )
    );
  }
  Object.assign(window.GameTierApp, {
    SettingsPanel,
  });
})();
