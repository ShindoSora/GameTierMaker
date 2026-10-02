(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
  const { t } = window.GameTierI18n;
  const { fetchAPI, localSessionReady, API, showToast } = window.GameTierApp;
  function useLiveLogs({ confirmAction }) {
    const [logOpen, setLogOpen] = useState(() => localStorage.getItem('log-panel-open') === 'true');
    const [logWidth, setLogWidth] = useState(() => {
      const saved = Number(localStorage.getItem('log-panel-width'));
      return Number.isFinite(saved) && saved >= 280 ? Math.min(saved, 640) : 340;
    });
    const [logSource, setLogSource] = useState(() =>
      localStorage.getItem('log-panel-source') === 'console' ? 'console' : 'application'
    );
    const [entriesBySource, setEntriesBySource] = useState({ application: [], console: [] });
    const [connections, setConnections] = useState({ application: 'connecting', console: 'connecting' });
    const [sessionIds, setSessionIds] = useState({ application: '', console: '' });
    const logEntries = entriesBySource[logSource];
    const logConnection = connections[logSource];
    const logSessionId = sessionIds[logSource];
    const [unreadLogErrors, setUnreadLogErrors] = useState(0);
    const logOpenRef = useRef(logOpen);
    const consoleSupportedRef = useRef(false);
    const streamStateRef = useRef({
      application: { lastId: 0, sessionId: '' },
      console: { lastId: 0, sessionId: '' },
    });
    useEffect(() => {
      localStorage.setItem('log-panel-source', logSource);
    }, [logSource]);
    useEffect(() => {
      logOpenRef.current = logOpen;
      localStorage.setItem('log-panel-open', String(logOpen));
      if (logOpen) setUnreadLogErrors(0);
    }, [logOpen]);
    useEffect(() => {
      localStorage.setItem('log-panel-width', String(logWidth));
    }, [logWidth]);
    useEffect(() => {
      const openLogPanel = () => setLogOpen(true);
      window.addEventListener('open-log-panel', openLogPanel);
      return () => window.removeEventListener('open-log-panel', openLogPanel);
    }, []);
    useEffect(() => {
      let disposed = false;
      const sources = {};
      const setConnection = (name, value) => {
        if (!disposed) setConnections((previous) => ({ ...previous, [name]: value }));
      };
      const acceptSession = (name, sessionId) => {
        const state = streamStateRef.current[name];
        if (!sessionId || state.sessionId === sessionId) return;
        state.sessionId = sessionId;
        state.lastId = 0;
        setSessionIds((previous) => ({ ...previous, [name]: sessionId }));
        setEntriesBySource((previous) => ({ ...previous, [name]: [] }));
        if (name === 'application') setUnreadLogErrors(0);
      };
      const appendEntry = (name, entry) => {
        if (entry.source && entry.source !== name) return;
        if (name === 'console' && entry.source !== 'console') return;
        if (name === 'console') consoleSupportedRef.current = true;
        acceptSession(name, entry.session_id);
        const state = streamStateRef.current[name];
        const id = Number(entry.id) || 0;
        if (id <= state.lastId) return;
        state.lastId = id;
        setEntriesBySource((previous) => ({ ...previous, [name]: [...previous[name], entry].slice(-2000) }));
        if (name === 'application' && !logOpenRef.current && (entry.level === 'ERROR' || entry.level === 'CRITICAL')) {
          setUnreadLogErrors((count) => count + 1);
        }
      };
      const connect = async (name) => {
        try {
          const initial = await fetchAPI(name === 'console' ? '/logs?source=console' : '/logs');
          if (disposed) return;
          if (name === 'console' && initial.source !== 'console') {
            setConnection(name, 'unavailable');
            return;
          }
          if (name === 'console') consoleSupportedRef.current = true;
          acceptSession(name, initial.session_id);
          (initial.entries || []).forEach((entry) => appendEntry(name, entry));
        } catch (error) {
          setConnection(name, 'disconnected');
        }
        if (disposed) return;
        await localSessionReady;
        if (disposed) return;
        const state = streamStateRef.current[name];
        const source = new EventSource(`${API}/logs/stream?after=${state.lastId}&source=${name}&session_id=${encodeURIComponent(state.sessionId)}`, {
          withCredentials: true,
        });
        sources[name] = source;
        source.onopen = () => setConnection(name, 'connected');
        source.onerror = () => setConnection(name, 'disconnected');
        source.addEventListener('session', (event) => {
          if (disposed) return;
          try {
            const session = JSON.parse(event.data);
            if (name === 'console' && session.source === 'console') consoleSupportedRef.current = true;
            acceptSession(name, session.session_id);
          } catch (error) {
            console.error('无法解析日志会话', error);
          }
        });
        source.addEventListener('log', (event) => {
          if (disposed) return;
          try {
            const entry = JSON.parse(event.data);
            if (name === 'console' && entry.source !== 'console') {
              consoleSupportedRef.current = false;
              setConnection(name, 'unavailable');
              source.close();
              return;
            }
            appendEntry(name, entry);
          } catch (error) {
            console.error('无法解析实时日志', error);
          }
        });
        source.addEventListener('clear', () => {
          if (!disposed) {
            setEntriesBySource((previous) => ({ ...previous, [name]: [] }));
            if (name === 'application') setUnreadLogErrors(0);
          }
        });
        return source;
      };
      ['application', 'console'].forEach((name) => {
        connect(name).catch(() => setConnection(name, 'disconnected'));
      });
      return () => {
        disposed = true;
        Object.values(sources).forEach((source) => source.close());
      };
    }, []);
    const handleLogResize = (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = logWidth;
      const onMove = (moveEvent) => {
        const maxWidth = Math.max(280, Math.min(640, window.innerWidth - 80));
        setLogWidth(Math.max(280, Math.min(maxWidth, startWidth - (moveEvent.clientX - startX))));
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    const handleCopyLogs = async () => {
      if (logEntries.length === 0) {
        showToast(t('logs.nothingToCopy'));
        return;
      }
      const text = logEntries
        .map((entry) => logSource === 'console' ? entry.message : `${entry.timestamp} - ${entry.logger} - ${entry.level} - ${entry.message}`)
        .join('\n');
      try {
        await navigator.clipboard.writeText(text);
        showToast(t('logs.copied'), 'success');
      } catch (error) {
        showToast(t('logs.copyFailed'), 'error');
      }
    };
    const handleClearLogs = async () => {
      const source = logSource;
      if (source === 'console' && !consoleSupportedRef.current) {
        showToast(t('logs.consoleUnavailable'));
        return;
      }
      if (logEntries.length > 0 && !(await confirmAction(t('dialogs.clearLogTab', {
        source: t(source === 'console' ? 'logs.consoleTab' : 'logs.applicationTab'),
      })))) return;
      try {
        await fetchAPI(`/logs/clear?source=${source}`, {
          method: 'POST',
        });
        setEntriesBySource((previous) => ({ ...previous, [source]: [] }));
        if (source === 'application') setUnreadLogErrors(0);
        showToast(t('logs.cleared'), 'success');
      } catch (error) {
        showToast(t('logs.clearFailed'), 'error');
      }
    };
    const handleClearLogFile = async () => {
      if (!(await confirmAction(t('dialogs.clearLogFile')))) return;
      try {
        await fetchAPI('/logs/clear-file', {
          method: 'POST',
        });
        setEntriesBySource((previous) => ({ ...previous, application: [] }));
        setUnreadLogErrors(0);
        showToast(t('logs.fileCleared'), 'success');
      } catch (error) {
        showToast(t('logs.fileClearFailed'), 'error');
      }
    };
    return {
      logOpen,
      setLogOpen,
      logWidth,
      logSource,
      setLogSource,
      logSourceCounts: { application: entriesBySource.application.length, console: entriesBySource.console.length },
      logEntries,
      logConnection,
      logSessionId,
      unreadLogErrors,
      handleLogResize,
      handleCopyLogs,
      handleClearLogs,
      handleClearLogFile,
    };
  }
  Object.assign(window.GameTierApp, {
    useLiveLogs,
  });
})();
