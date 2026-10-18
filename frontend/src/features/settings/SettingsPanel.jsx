(() => {
  'use strict';

  const { useRef, useLayoutEffect } = React;
  const { t } = window.GameTierI18n;
  const {
    useSlidingPill,
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
    BrowserPreviewLauncher,
  } = window.GameTierApp;
  function GlassTransparencySlider({ value, enabled, onChange }) {
    const position = Math.max(0, Math.min(80, Number(value) || 0)) / 80;
    const shape = 'M10 1 L22 1 Q24 1 26 3 L29 6 Q31 8 31 10 L31 20 Q31 22 29 24 L26 27 Q24 29 22 29 L10 29 Q8 29 6 27 L3 24 Q1 22 1 20 L1 10 Q1 8 3 6 L6 3 Q8 1 10 1 Z';
    return (
      <div className="glass-range-surface" data-disabled={!enabled ? 'true' : 'false'}
        style={{ '--glass-range-progress': `${position * 100}%`, '--glass-slider-position': position }}>
        <div className="glass-slider-control">
          <input id="glass-transparency" type="range" min="0" max="80" step="1"
            value={value} disabled={!enabled} onChange={event => onChange(Number(event.target.value))} />
          <span className="glass-range-thumb" aria-hidden="true">
            <span className="glass-slider-lens" />
            <svg viewBox="0 0 32 30" focusable="false">
              <path className="glass-thumb-depth" d={shape} transform="translate(0 .6)" />
              <path className="glass-thumb-rim" d={shape} />
              <path className="glass-thumb-highlight" d="M2 13 L2 10 Q2 8 4 6 L7 3 Q9 1.5 11 1.5 L21 1.5 Q24 1.5 26 3.5 L28 5.5" />
              <path className="glass-thumb-inner" d="M7 25 Q9 27 11 27 L21 27 Q23 27 25 25 L28 22" />
            </svg>
          </span>
        </div>
      </div>
    );
  }
  function SettingsNavigation({ groups, activeSection, onSelect, enabled = true }) {
    const buttonsRef = useRef({});
    const items = groups.flatMap(group => group.items);
    const selected = items.some(item => item.key === activeSection);
    const visible = enabled && selected;
    // One coordinate space keeps the same indicator alive across every category.
    const pill = useSlidingPill({
      selectedKey: activeSection,
      layoutKey: JSON.stringify(groups),
      visible,
      buttonsRef,
    });
    const navigate = (event, key) => {
      const index = items.findIndex(item => item.key === key);
      let next;
      if (event.key === 'ArrowDown') next = (index + 1) % items.length;
      else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = items.length - 1;
      else return;
      event.preventDefault();
      const nextKey = items[next].key;
      onSelect(nextKey);
      buttonsRef.current[nextKey]?.focus();
    };
    return (
      <div ref={pill.hostRef} className="settings-nav-body"
        onPointerMove={pill.onPointerMove} onPointerLeave={pill.onPointerLeave}>
        {visible && (
          <span ref={pill.pillRef} className="search-source-pill settings-nav-pill" aria-hidden="true">
            <span className="search-pill-face" />
          </span>
        )}
        {groups.map(group => (
          <div key={group.key} className="settings-nav-group" data-settings-group={group.key} role="group" aria-label={group.label}>
            <div className="settings-nav-group-label">{group.label}</div>
            <div className="settings-nav-track">
              {group.items.map(tab => (
                <button key={tab.key} type="button"
                  ref={node => {
                    if (node) buttonsRef.current[tab.key] = node;
                    else delete buttonsRef.current[tab.key];
                  }}
                  className={`btn btn-xs settings-nav-item ${activeSection === tab.key ? 'active' : ''}`}
                  aria-current={activeSection === tab.key ? 'page' : undefined}
                  data-settings-section={tab.key}
                  onKeyDown={event => navigate(event, tab.key)}
                  onClick={() => onSelect(tab.key)}>
                  <span className="settings-nav-label">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  function SettingsPanel({
    browserModel,
    island,
    logVisible,
    logAnchorRef,
    logToolbarRef,
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
    const headerRef = useRef(null), closeRef = useRef(null), logButtonRef = useRef(null);
    useLayoutEffect(() => {
      const anchor = island?.anchorRef?.current, panel = island?.panelRef?.current;
      const logAnchor = logToolbarRef?.current;
      const header = headerRef.current, close = closeRef.current;
      if (!anchor || !panel || !header || !close) return;
      const align = () => {
        const rect = anchor.getBoundingClientRect();
        const logRect = logAnchor?.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const panelRight = (logVisible ?? logOpen) ? logWidth + 16 : 8;
        // Read layout coordinates, not the island's temporary scale transform.
        const style = getComputedStyle(panel);
        const viewportWidth = document.documentElement.getBoundingClientRect().width;
        const right = viewportWidth - panelRight - (parseFloat(style.borderRightWidth) || 0) - (logRect || rect).right;
        const maxRight = Math.max(12, panel.clientWidth - rect.width - 180);
        header.style.paddingRight = `${Math.max(12, Math.min(maxRight, right))}px`;
        header.style.paddingTop = `${Math.max(10, rect.top - parseFloat(style.top) - (parseFloat(style.borderTopWidth) || 0))}px`;
        close.style.width = `${rect.width}px`;
        close.style.height = `${rect.height}px`;
        close.style.minHeight = `${rect.height}px`;
        if (logRect && logButtonRef.current) {
          const logButton = logButtonRef.current;
          logButton.style.width = `${logRect.width}px`;
          logButton.style.height = `${logRect.height}px`;
          logButton.style.minHeight = `${logRect.height}px`;
          header.style.setProperty('--settings-action-gap', `${Math.max(0, logRect.left - rect.right)}px`);
        }
      };
      align();
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(align) : null;
      observer?.observe(anchor); observer?.observe(panel);
      if (logAnchor) observer?.observe(logAnchor);
      const toolbar = anchor.closest('.top-toolbar');
      if (toolbar) observer?.observe(toolbar);
      window.addEventListener('resize', align, { passive: true });
      return () => { observer?.disconnect(); window.removeEventListener('resize', align); };
    }, [showSettings, island?.visible, island?.phase, island?.anchorRef, logToolbarRef, settingsWidth, logVisible, logOpen, logWidth]);
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
          onClick={() => setShowSettings(false)}
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
              ref={headerRef}
              className="settings-panel-header"
            >
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                {t('settings.title')}
              </span>
              <div className="settings-panel-header-actions">
                <button
                  ref={closeRef}
                  type="button"
                  className="btn btn-icon btn-sm settings-panel-close"
                  onClick={() => setShowSettings(false)}
                  aria-label={t('actions.close')}
                  title={t('actions.close')}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
                    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
                <button
                  ref={logButtonRef}
                  type="button"
                  className={`btn btn-sm settings-panel-log ${logOpen ? 'btn-primary' : ''}`}
                  aria-label={t('logs.title')}
                  aria-pressed={!!logOpen}
                  title={logOpen ? t('logs.collapse') : t('logs.expand')}
                  onClick={(event) => {
                    if (logAnchorRef) logAnchorRef.current = event.currentTarget;
                    setLogOpen((open) => !open);
                  }}
                >
                  {t('logs.title')}
                  {!logOpen && unreadLogErrors > 0 && (
                    <span className="log-unread-badge">{Math.min(unreadLogErrors, 99)}</span>
                  )}
                </button>
              </div>
            </div>
            {/* Two-column: left tabs + right content */}
            <div className="settings-columns">
              {/* Left tab column */}
              <div className="settings-nav">
                <SettingsNavigation
                  activeSection={settingsActiveSection} onSelect={setSettingsActiveSection}
                  enabled={!island || island.phase === 'open'}
                  groups={[
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
                ]} />
              </div>
              {/* Right content */}
              <div className="settings-content">
                <BrowserPreviewLauncher model={browserModel} section={settingsActiveSection} />
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
                    <GlassTransparencySlider value={preferencesModel.liquidGlassTransparency}
                      enabled={preferencesModel.liquidGlassEnabled} onChange={preferencesModel.setLiquidGlassTransparency} />
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
    GlassTransparencySlider,
    SettingsNavigation,
    SettingsPanel,
  });
})();
