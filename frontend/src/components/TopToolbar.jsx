(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const { TemplateSelector } = window.GameTierApp;
  const { useState, useRef, useLayoutEffect } = React;

  function createRenameMorph(root, trigger, fields) {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let open = false, width = trigger.offsetWidth, velocity = 0, frame = 0, last = null;
    let compact = width, expanded = fields.offsetWidth, elapsed = 0, disposed = false;
    const paint = () => {
      const progress = Math.max(0, Math.min(1, (width - compact) / Math.max(1, expanded - compact)));
      root.style.width = `${Math.max(compact, width)}px`;
      root.style.setProperty('--rename-reveal', String(Math.max(0, (progress - .12) / .88)));
      root.style.setProperty('--rename-trigger', String(Math.max(0, 1 - progress * 4)));
      root.style.setProperty('--rename-shift', `${(1 - progress) * 6}px`);
      root.style.setProperty('--rename-radius', `${8 + progress * 8}px`);
    };
    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0; last = null;
    };
    const settle = () => {
      stop(); width = open ? expanded : compact; velocity = 0;
      paint(); root.style.willChange = 'auto';
    };
    const step = now => {
      frame = 0;
      if (disposed) return;
      const dt = Math.max(.001, Math.min(.032, last === null ? 1 / 60 : (now - last) / 1000));
      last = now; elapsed += dt;
      const target = open ? expanded : compact;
      const count = Math.ceil(dt * 120), h = dt / count;
      for (let i = 0; i < count; i++) {
        velocity += (380 * (target - width) - 29 * velocity) * h;
        width += velocity * h;
      }
      paint();
      if ((Math.abs(width - target) < .15 && Math.abs(velocity) < 1) || elapsed > 1.2) settle();
      else frame = window.requestAnimationFrame(step);
    };
    const measure = () => {
      if (disposed) return;
      compact = trigger.offsetWidth;
      expanded = Math.max(compact, fields.offsetWidth);
      elapsed = 0;
      if (media?.matches) { settle(); return; }
      root.style.willChange = 'width';
      if (!frame) { last = null; frame = window.requestAnimationFrame(step); }
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(trigger); observer?.observe(fields);
    const motionChange = () => { if (media?.matches) settle(); };
    media?.addEventListener?.('change', motionChange);
    window.addEventListener('resize', measure, { passive: true });
    paint();
    return {
      select(value) { open = value; measure(); },
      dispose() {
        disposed = true; stop(); observer?.disconnect();
        media?.removeEventListener?.('change', motionChange);
        window.removeEventListener('resize', measure);
        root.style.willChange = 'auto';
      },
    };
  }

  function TemplateRename({ templateName, renameMode, setRenameMode, handleRenameTemplate }) {
    const [draft, setDraft] = useState(templateName);
    const [saving, setSaving] = useState(false);
    const rootRef = useRef(null), triggerRef = useRef(null), fieldsRef = useRef(null);
    const inputRef = useRef(null), morphRef = useRef(null), submittingRef = useRef(false);
    const mountedRef = useRef(false), composingRef = useRef(false);
    const previousOpenRef = useRef(false);
    useLayoutEffect(() => {
      mountedRef.current = true;
      morphRef.current = createRenameMorph(rootRef.current, triggerRef.current, fieldsRef.current);
      return () => { mountedRef.current = false; morphRef.current?.dispose(); };
    }, []);
    useLayoutEffect(() => {
      const wasOpen = previousOpenRef.current;
      previousOpenRef.current = renameMode;
      morphRef.current?.select(renameMode);
      if (renameMode) {
        inputRef.current?.focus({ preventScroll: true });
        inputRef.current?.select();
      } else if (wasOpen) {
        triggerRef.current?.focus({ preventScroll: true });
      }
    }, [renameMode]);
    const cancel = () => { if (!submittingRef.current) setRenameMode(false); };
    const save = async () => {
      if (!renameMode || submittingRef.current || composingRef.current) return;
      if (!draft.trim()) { inputRef.current?.focus({ preventScroll: true }); return; }
      submittingRef.current = true; setSaving(true);
      try {
        await handleRenameTemplate(draft);
      } finally {
        submittingRef.current = false;
        if (mountedRef.current) setSaving(false);
      }
    };
    return (
      <div ref={rootRef} className="template-rename" data-open={renameMode ? 'true' : 'false'}
        onKeyDown={(event) => {
          if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || composingRef.current) return;
          if (event.key === 'Escape' && renameMode) { event.preventDefault(); event.stopPropagation(); cancel(); }
        }}>
        <button ref={triggerRef} type="button" className="btn btn-xs rename-trigger"
          aria-expanded={renameMode} aria-hidden={renameMode || undefined} tabIndex={renameMode ? -1 : 0}
          disabled={renameMode} onClick={() => { setDraft(templateName); setRenameMode(true); }}>
          {t('actions.rename')}
        </button>
        <div ref={fieldsRef} className="rename-fields" aria-hidden={!renameMode} inert={renameMode ? undefined : ''}>
          <input ref={inputRef} className="input toolbar-template-name" value={draft}
            aria-label={t('template.renamePlaceholder')} placeholder={t('template.renamePlaceholder')}
            disabled={!renameMode} readOnly={saving} onChange={(event) => setDraft(event.target.value)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || composingRef.current) return;
              event.preventDefault(); event.stopPropagation(); save();
            }} />
          <button type="button" className="btn btn-xs rename-save" disabled={!renameMode || saving || !draft.trim()}
            aria-busy={saving} onClick={save}>{t('actions.save')}</button>
          <button type="button" className="btn btn-xs rename-cancel" disabled={!renameMode || saving}
            onClick={cancel}>{t('actions.cancel')}</button>
        </div>
      </div>
    );
  }
  function ThemeSwitch({ theme, toggleTheme }) {
    return (
      <div className="theme-switch" data-value={theme} role="group" aria-label={t('theme.label')}>
        <span className="theme-switch-indicator" aria-hidden="true" />
        {['dark', 'light'].map((value) => (
          <button
            key={value}
            type="button"
            className="theme-switch-option"
            aria-pressed={theme === value}
            onClick={() => { if (theme !== value) toggleTheme(); }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {value === 'dark' ? (
                <path d="M20.9 13.2A8.6 8.6 0 0 1 10.8 3.1 8.6 8.6 0 1 0 20.9 13.2Z" />
              ) : (
                <>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </>
              )}
            </svg>
            <span>{t(`theme.${value}`)}</span>
          </button>
        ))}
      </div>
    );
  }
  function TopToolbar({
    templatesModel,
    tierBoardModel,
    imagesModel,
    preferencesModel,
    backfillModel,
    settingsModel,
    logsModel,
    settingsAnchorRef,
    logAnchorRef,
    logToolbarRef,
  }) {
    const {
      templates,
      currentId,
      switchTemplate,
      handleCreateTemplate,
      handleDeleteTemplate,
      renameMode,
      templateName,
      handleRenameTemplate,
      setRenameMode,
    } = templatesModel;
    const { handleAddTier } = tierBoardModel;
    const { handleExport, exporting } = imagesModel;
    const { toggleTheme, theme, handleGlobalRefresh } = preferencesModel;
    const { backfill } = backfillModel;
    const backfillProcessed = backfill ? backfill.ok + backfill.fail : 0;
    const backfillTotal = backfill ? backfillProcessed + Math.max(0, backfill.remaining) + (backfill.retryPending || 0) : 0;
    const backfillPercent = Math.round(backfillProcessed / Math.max(1, backfillTotal) * 100);
    const backfillActive = backfill && !backfill.error && backfill.remaining !== 0;
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
          <TemplateRename key={currentId} templateName={templateName} renameMode={renameMode}
            setRenameMode={setRenameMode} handleRenameTemplate={handleRenameTemplate} />
          <div className="toolbar-separator" />
          <button className="btn btn-xs btn-primary" onClick={handleAddTier}>
            {t('tier.add')}
          </button>
          <button className="btn btn-xs btn-primary" onClick={handleExport} disabled={exporting}>
            {t('actions.export')}
          </button>
          <ThemeSwitch theme={theme} toggleTheme={toggleTheme} />
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
            role="status"
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
                  {backfillActive && <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from="0 12 12"
                    to="360 12 12"
                    dur="2s"
                    repeatCount="indefinite"
                  />}
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
                {backfill.source ? `${t(`sources.${backfill.source}`)} · ` : ''}
                {backfill.error ? t('backfill.interrupted') : backfill.remaining < 0
                  ? t('backfill.checking')
                  : backfill.remaining > 0
                    ? t('backfill.running')
                    : backfill.retryPending > 0 ? t('backfill.partial') : t('backfill.complete')}
              </span>
              {backfill.retryPending > 0 && <span style={{fontSize:10,color:'var(--text-secondary)',whiteSpace:'nowrap'}}>
                {t('backfill.retryPending', {count:backfill.retryPending})}
              </span>}
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
            {backfillActive && (
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
                          : backfillPercent + '%',
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
                    : backfillPercent + '%'}
                </span>
              </div>
            )}
          </div>
        )}

        <button ref={settingsAnchorRef} className="btn btn-sm settings-toolbar-button" onClick={handleOpenSettings} title={t('settings.title')}>
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
          ref={logToolbarRef}
          className={`sidebar-toggle log-toolbar-button ${logOpen ? 'active' : ''}`}
          onClick={(event) => {
            if (logAnchorRef) logAnchorRef.current = event.currentTarget;
            setLogOpen((open) => !open);
          }}
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
    createRenameMorph,
    TemplateRename,
    ThemeSwitch,
    TopToolbar,
  });
})();
