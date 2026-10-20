(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
  const { t } = window.GameTierI18n;
  function getSelectedLogText(list) {
    const selection = window.getSelection?.();
    if (!list || !selection || selection.isCollapsed || !selection.rangeCount
      || !list.contains(selection.anchorNode) || !list.contains(selection.focusNode)) return '';
    return selection.toString();
  }
  function LogSidebar({
    island,
    width,
    entries,
    connection,
    sessionId,
    source = 'application',
    sourceCounts = {},
    onSourceChange,
    onResize,
    onClose,
    onClear,
    onCopy,
  }) {
    const [enabledLevels, setEnabledLevels] = useState(
      () => new Set(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'])
    );
    const [autoScroll, setAutoScroll] = useState(true);
    const [selectionMenu, setSelectionMenu] = useState(null);
    const listRef = useRef(null);
    useEffect(() => { setAutoScroll(true); setSelectionMenu(null); }, [source]);
    useEffect(() => { if (island?.phase === 'closing') setSelectionMenu(null); }, [island?.phase]);
    useEffect(() => {
      if (!autoScroll || !listRef.current || getSelectedLogText(listRef.current)) return;
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }, [entries, autoScroll]);
    useEffect(() => {
      if (!selectionMenu) return;
      const close = () => setSelectionMenu(null);
      const escape = event => { if (event.key === 'Escape') close(); };
      document.addEventListener('pointerdown', close);
      document.addEventListener('keydown', escape);
      window.addEventListener('resize', close);
      return () => {
        document.removeEventListener('pointerdown', close);
        document.removeEventListener('keydown', escape);
        window.removeEventListener('resize', close);
      };
    }, [selectionMenu]);
    const copySelection = async () => {
      const text = selectionMenu?.text;
      setSelectionMenu(null);
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        window.GameTierApp.showToast(t('logs.selectionCopied'), 'success');
      } catch (_) {
        window.GameTierApp.showToast(t('logs.copyFailed'), 'error');
      }
    };
    const toggleLevel = (level) => {
      setEnabledLevels((previous) => {
        const next = new Set(previous);
        if (next.has(level)) next.delete(level);
        else next.add(level);
        return next;
      });
    };
    const filteredEntries = entries.filter((entry) => enabledLevels.has(entry.level));
    const connectionLabel =
      connection === 'unavailable'
        ? t('logs.consoleUnavailable')
        : connection === 'connected'
        ? t('logs.connected')
        : connection === 'connecting'
          ? t('logs.connecting')
          : t('logs.disconnected');
    return (
      <aside
        ref={island?.panelRef}
        className="log-sidebar island-panel"
        data-island-state={island?.phase || 'open'}
        style={{
          width,
        }}
        aria-label={t('logs.title')}
      >
        <div ref={island?.contentRef} className="island-panel-content" inert={island?.phase === 'closing' ? '' : undefined}>
        <div className="log-resize-handle" onMouseDown={onResize} title={t('logs.resize')} />
        <div className="log-header">
          <div className="log-title">
            <span className={`log-live-dot ${connection}`} />
            <span>{t('logs.title')}</span>
          </div>
          <div className="log-header-actions">
            <button
              className="btn btn-icon btn-sm"
              onClick={onCopy}
              title={t('logs.copySession')}
              aria-label={t('logs.copySession')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <rect x="8" y="8" width="12" height="12" rx="2" />
                <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
              </svg>
            </button>
            <button
              className="btn btn-icon btn-sm"
              onClick={onClear}
              disabled={connection === 'unavailable'}
              title={t('logs.clearDisplayTitle')}
              aria-label={t('logs.clearSession')}
            >
              {t('logs.clear')}
            </button>
            <button
              className="btn btn-icon btn-sm"
              onClick={onClose}
              title={t('logs.collapse')}
              aria-label={t('logs.collapse')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="m9 5 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="log-tabs" role="tablist" aria-label={t('logs.sources')}>
          {['application', 'console'].map((name) => (
            <button
              key={name}
              id={`log-tab-${name}`}
              data-log-source={name}
              role="tab"
              aria-selected={source === name}
              aria-controls="log-content"
              tabIndex={source === name ? 0 : -1}
              className={`log-tab ${source === name ? 'active' : ''}`}
              onClick={() => onSourceChange(name)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 'application' : event.key === 'End' ? 'console' : name === 'application' ? 'console' : 'application';
                onSourceChange(next);
                event.currentTarget.parentElement.querySelector(`[data-log-source="${next}"]`)?.focus();
              }}
            >
              <span>{t(name === 'console' ? 'logs.consoleTab' : 'logs.applicationTab')}</span>
              <span className="log-tab-count">{sourceCounts[name] || 0}</span>
            </button>
          ))}
        </div>
        <div className="log-filters">
          {['DEBUG', 'INFO', 'WARNING', 'ERROR'].map((level) => (
            <button
              key={level}
              className={`log-filter ${enabledLevels.has(level) ? 'active' : ''}`}
              onClick={() => toggleLevel(level)}
            >
              {level === 'WARNING' ? 'WARN' : level}
            </button>
          ))}
          <span className="log-session">
            {sessionId
              ? t('logs.sessionId', {
                  sessionId,
                })
              : t('logs.session')}
          </span>
        </div>
        <div
          className={`log-list ${source === 'console' ? 'log-console-list' : ''}`}
          id="log-content"
          role="tabpanel"
          aria-labelledby={`log-tab-${source}`}
          ref={listRef}
          tabIndex={0}
          onMouseDown={event => { if (event.button === 0) setAutoScroll(false); }}
          onContextMenu={event => {
            const text = getSelectedLogText(listRef.current);
            if (!text) return;
            event.preventDefault(); event.stopPropagation();
            setSelectionMenu({text, x:Math.max(0, Math.min(event.clientX, window.innerWidth - 180)),
              y:Math.max(0, Math.min(event.clientY, window.innerHeight - 48))});
          }}
          onScroll={(event) => {
            if (getSelectedLogText(listRef.current)) return;
            const el = event.currentTarget;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            if (atBottom !== autoScroll) setAutoScroll(atBottom);
          }}
        >
          {filteredEntries.length === 0 ? (
            <div className="log-empty">
              <div>{connection === 'connected' ? t(source === 'console' ? 'logs.consoleEmpty' : 'logs.empty') : connectionLabel}</div>
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <div className={`log-row ${entry.level}`} key={entry.id}>
                <span className="log-time">{entry.time}</span>
                <span className="log-level">
                  {entry.level === 'WARNING' ? 'WARN' : entry.level}
                </span>
                <span className="log-message">
                  <span className="log-logger">{entry.logger}</span>
                  {entry.message}
                </span>
              </div>
            ))
          )}
        </div>
        <div className="log-footer">
          <span className={`log-live-dot ${connection}`} />
          <span>{connectionLabel}</span>
          <span>
            {t('logs.entryCount', {
              count: entries.length,
            })}
          </span>
          <button className="btn btn-xs tail" onClick={() => {
            if (getSelectedLogText(listRef.current)) window.getSelection()?.removeAllRanges();
            setAutoScroll(true);
          }}>
            {autoScroll ? t('logs.autoScroll') : t('logs.backToBottom')}
          </button>
        </div>
        {selectionMenu && ReactDOM.createPortal(
          <div className="context-menu log-selection-menu" role="menu" aria-label={t('logs.copySelected')}
            style={{left:selectionMenu.x, top:selectionMenu.y}}
            onPointerDown={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
            <button type="button" className="context-menu-item" role="menuitem" autoFocus onClick={copySelection}>
              {t('logs.copySelected')}
            </button>
          </div>, document.body
        )}
        </div>
      </aside>
    );
  }
  Object.assign(window.GameTierApp, {
    getSelectedLogText,
    LogSidebar,
  });
})();
