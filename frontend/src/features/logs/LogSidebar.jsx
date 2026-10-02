(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
  const { t } = window.GameTierI18n;
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
    const listRef = useRef(null);
    useEffect(() => setAutoScroll(true), [source]);
    useEffect(() => {
      if (!autoScroll || !listRef.current) return;
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }, [entries, autoScroll]);
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
              ⧉
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
              ▶
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
          onScroll={(event) => {
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
          <button className="btn btn-xs tail" onClick={() => setAutoScroll(true)}>
            {autoScroll ? t('logs.autoScroll') : t('logs.backToBottom')}
          </button>
        </div>
        </div>
      </aside>
    );
  }
  Object.assign(window.GameTierApp, {
    LogSidebar,
  });
})();
