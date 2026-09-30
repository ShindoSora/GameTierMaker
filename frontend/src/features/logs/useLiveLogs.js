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
    const [logEntries, setLogEntries] = useState([]);
    const [logConnection, setLogConnection] = useState('connecting');
    const [logSessionId, setLogSessionId] = useState('');
    const [unreadLogErrors, setUnreadLogErrors] = useState(0);
    const logOpenRef = useRef(logOpen);
    const lastLogIdRef = useRef(0);
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
      const appendEntry = (entry) => {
        const id = Number(entry.id) || 0;
        if (id <= lastLogIdRef.current) return;
        lastLogIdRef.current = id;
        setLogEntries((previous) => [...previous, entry].slice(-2000));
        if (!logOpenRef.current && (entry.level === 'ERROR' || entry.level === 'CRITICAL')) {
          setUnreadLogErrors((count) => count + 1);
        }
      };
      const connect = async () => {
        try {
          const initial = await fetchAPI('/logs');
          if (disposed) return;
          setLogSessionId(initial.session_id || '');
          (initial.entries || []).forEach(appendEntry);
        } catch (error) {
          if (!disposed) setLogConnection('disconnected');
        }
        if (disposed) return;
        await localSessionReady;
        if (disposed) return;
        const source = new EventSource(`${API}/logs/stream?after=${lastLogIdRef.current}`, {
          withCredentials: true,
        });
        source.onopen = () => !disposed && setLogConnection('connected');
        source.onerror = () => !disposed && setLogConnection('disconnected');
        source.addEventListener('log', (event) => {
          if (disposed) return;
          try {
            appendEntry(JSON.parse(event.data));
          } catch (error) {
            console.error('无法解析实时日志', error);
          }
        });
        source.addEventListener('clear', () => {
          if (!disposed) setLogEntries([]);
        });
        return source;
      };
      let source;
      connect()
        .then((value) => {
          if (disposed) value?.close();
          else source = value;
        })
        .catch(() => {
          if (!disposed) setLogConnection('disconnected');
        });
      return () => {
        disposed = true;
        if (source) source.close();
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
        .map((entry) => `${entry.timestamp} - ${entry.logger} - ${entry.level} - ${entry.message}`)
        .join('\n');
      try {
        await navigator.clipboard.writeText(text);
        showToast(t('logs.copied'), 'success');
      } catch (error) {
        showToast(t('logs.copyFailed'), 'error');
      }
    };
    const handleClearLogs = async () => {
      if (logEntries.length > 0 && !(await confirmAction(t('dialogs.clearSessionLogs')))) return;
      try {
        await fetchAPI('/logs/clear', {
          method: 'POST',
        });
        setLogEntries([]);
        setUnreadLogErrors(0);
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
        setLogEntries([]);
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
