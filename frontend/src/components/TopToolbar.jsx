(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const { TemplateSelector } = window.GameTierApp;
  function TopToolbar({
    templatesModel,
    tierBoardModel,
    imagesModel,
    preferencesModel,
    backfillModel,
    settingsModel,
    logsModel,
  }) {
    const {
      templates,
      currentId,
      switchTemplate,
      handleCreateTemplate,
      handleDeleteTemplate,
      renameMode,
      templateName,
      setTemplateName,
      handleRenameTemplate,
      setRenameMode,
    } = templatesModel;
    const { handleAddTier } = tierBoardModel;
    const { handleExport, exporting } = imagesModel;
    const { toggleTheme, theme, handleGlobalRefresh } = preferencesModel;
    const { backfill } = backfillModel;
    const { handleOpenSettings } = settingsModel;
    const { logOpen, setLogOpen, unreadLogErrors } = logsModel;
    return (
      <div className="top-toolbar">
        {/* Template group */}
        <div className="toolbar-group template-selector-group toolbar-template-actions">
          <TemplateSelector templates={templates} currentId={currentId} onSelect={switchTemplate} />
          <div className="toolbar-separator" />
          <button
            className="btn btn-xs template-action-button"
            onClick={handleCreateTemplate}
            title={t('template.create')}
            style={{
              color: 'var(--success)',
            }}
          >
            {t('template.add')}
          </button>
          <button
            className="btn btn-xs template-action-button"
            onClick={handleDeleteTemplate}
            title={t('template.delete')}
            style={{
              color: 'var(--danger)',
            }}
          >
            {t('template.remove')}
          </button>
        </div>

        {/* Rename group — also houses add-tier, export, theme */}
        <div className="toolbar-group toolbar-primary-actions">
          <span className="toolbar-caption">{t('template.label')}</span>
          {renameMode && (
            <input
              autoFocus
              className="input toolbar-template-name"
              style={{
                width: 130,
                border: 'none',
                background: 'transparent',
              }}
              placeholder={t('template.renamePlaceholder')}
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameTemplate();
                if (e.key === 'Escape') setRenameMode(false);
              }}
            />
          )}
          <button
            className="btn btn-xs"
            onClick={() => (renameMode ? handleRenameTemplate() : setRenameMode(true))}
          >
            {renameMode ? t('actions.save') : t('actions.rename')}
          </button>
          {renameMode && (
            <button
              className="btn btn-xs btn-icon"
              onClick={() => setRenameMode(false)}
              aria-label={t('actions.cancel')}
              title={t('actions.cancel')}
            >
              ✕
            </button>
          )}
          <div className="toolbar-separator" />
          <button className="btn btn-xs btn-primary" onClick={handleAddTier}>
            {t('tier.add')}
          </button>
          <button className="btn btn-xs btn-primary" onClick={handleExport} disabled={exporting}>
            {t('actions.export')}
          </button>
          <button
            className="btn btn-xs btn-icon"
            onClick={toggleTheme}
            title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
          >
            {theme === 'dark' ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            )}
          </button>
          <button
            className="btn btn-xs btn-icon"
            onClick={handleGlobalRefresh}
            title={t('actions.refreshAll')}
            aria-label={t('actions.refreshAll')}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6v5h-5" />
              <path d="M4 18v-5h5" />
              <path d="M18.5 9A7 7 0 006.8 6.8L4 11" />
              <path d="M5.5 15A7 7 0 0017.2 17.2L20 13" />
            </svg>
          </button>
        </div>

        <div className="toolbar-spacer" />

        {/* 后台回填进度指示器 */}
        {backfill && (
          <div
            className="toolbar-group"
            style={{
              gap: 8,
              padding: '3px 10px',
              flexDirection: 'column',
              alignItems: 'stretch',
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" stroke="var(--border)" strokeWidth="2" fill="none" />
                <path d="M12 2a10 10 0 019.95 9" strokeLinecap="round">
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from="0 12 12"
                    to="360 12 12"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </path>
              </svg>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--accent)',
                  whiteSpace: 'nowrap',
                }}
              >
                {backfill.remaining < 0
                  ? t('backfill.checking')
                  : backfill.remaining > 0
                    ? t('backfill.running')
                    : t('backfill.complete')}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--success)',
                  whiteSpace: 'nowrap',
                }}
              >
                ✓{backfill.ok}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--danger)',
                  whiteSpace: 'nowrap',
                }}
              >
                ✗{backfill.fail}
              </span>
              {backfill.remaining > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t('backfill.remaining', {
                    count: backfill.remaining,
                  })}
                </span>
              )}
            </div>
            {(backfill.remaining > 0 || backfill.remaining < 0) && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: 3,
                    background: 'var(--bg-tertiary)',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      borderRadius: 2,
                      background:
                        backfill.remaining < 0
                          ? 'linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%)'
                          : 'var(--accent)',
                      width:
                        backfill.remaining < 0
                          ? '100%'
                          : Math.round(
                              ((backfill.ok + backfill.fail) /
                                Math.max(backfill.ok + backfill.fail + backfill.remaining, 1)) *
                                100
                            ) + '%',
                      transition: backfill.remaining < 0 ? 'none' : 'width 0.3s ease',
                      animation:
                        backfill.remaining < 0 ? 'indeterminate 1.5s ease-in-out infinite' : 'none',
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    minWidth: 32,
                    textAlign: 'right',
                  }}
                >
                  {backfill.remaining < 0
                    ? '...'
                    : Math.round(
                        ((backfill.ok + backfill.fail) /
                          Math.max(backfill.ok + backfill.fail + backfill.remaining, 1)) *
                          100
                      ) + '%'}
                </span>
              </div>
            )}
          </div>
        )}

        <button className="btn btn-sm" onClick={handleOpenSettings} title={t('settings.title')}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
        <button
          className={`sidebar-toggle ${logOpen ? 'active' : ''}`}
          onClick={() => setLogOpen((open) => !open)}
          title={logOpen ? t('logs.collapse') : t('logs.expand')}
          aria-label={logOpen ? t('logs.collapse') : t('logs.expand')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 4h16v16H4z" />
            <path d="M8 9h8M8 13h8M8 17h5" />
          </svg>
          {!logOpen && unreadLogErrors > 0 && (
            <span className="log-unread-badge">{Math.min(unreadLogErrors, 99)}</span>
          )}
        </button>
      </div>
    );
  }
  Object.assign(window.GameTierApp, {
    TopToolbar,
  });
})();
