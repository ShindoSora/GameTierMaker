(() => {
  'use strict';

  const { useState, useRef, useEffect, useLayoutEffect } = React;
  const { t } = window.GameTierI18n;
  const { fetchAPI, ApiError, BrowserCanvas } = window.GameTierApp;
  const PLATFORMS = {
    steam: { name: 'Steam', host: 'steamcommunity.com', color: '#96b8dc' },
    psn: { name: 'PSN', host: 'my.account.sony.com', color: '#759eff' },
    xbox: { name: 'Xbox', host: 'login.live.com', color: '#77d6a1' },
    nintendo: { name: 'Nintendo', host: 'accounts.nintendo.com', color: '#ff939c' },
  };

  function BrowserIcon({ name = 'browser', size = 18 }) {
    const paths = {
      browser: <><rect x="3" y="4" width="18" height="16" rx="4" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></>,
      close: <path d="m7 7 10 10M17 7 7 17" />,
      collapse: <path d="m6 15 6-6 6 6" />,
      expand: <path d="m6 9 6 6 6-6" />,
      back: <path d="m14 7-5 5 5 5" />,
      forward: <path d="m10 7 5 5-5 5" />,
      reload: <><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7" /></>,
      lock: <><rect x="6" y="10" width="12" height="10" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" /></>,
    };
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
  }

  function useBrowserPreview() {
    const [mode, setMode] = useState('closed');
    const [platform, setPlatform] = useState('psn');
    const [availableWidth, setAvailableWidth] = useState(window.innerWidth - 16);
    const [auth, setAuth] = useState(null);
    const [viewer, setViewer] = useState({ connection: 'connecting', host: '', canBack: false, canForward: false });
    const viewerSocket = useRef(null);
    const updateViewer = values => setViewer(current => Object.keys(values).every(key => current[key] === values[key]) ? current : { ...current, ...values });
    const authRef = useRef(null), operationRef = useRef(''), busyRef = useRef(false);
    const cancelledRef = useRef(false), mountedRef = useRef(true);
    const launchRef = useRef(null);
    const restoreFocus = () => launchRef.current?.focus({ preventScroll: true });
    const updateAuth = value => { authRef.current = value; if (mountedRef.current) setAuth(value); };
    useEffect(() => {
      const cancel = () => {
        cancelledRef.current = true;
        if (operationRef.current && authRef.current?.status !== 'binding')
          fetchAPI(`/settings/browser-auth/${encodeURIComponent(operationRef.current)}`, { method: 'DELETE', keepalive: true }).catch(() => {});
      };
      window.addEventListener('pagehide', cancel);
      return () => { mountedRef.current = false; cancel(); window.removeEventListener('pagehide', cancel); };
    }, []);
    const authenticate = async (key, payload = {}) => {
      if (busyRef.current) throw new ApiError('browser_auth_busy', t('browser.busy'));
      busyRef.current = true; cancelledRef.current = false;
      setPlatform(key); setMode('expanded');
      updateViewer({ connection: 'connecting', host: '', canBack: false, canForward: false });
      updateAuth({ platform: key, status: 'starting', mode: 'stream' });
      let completed = false;
      try {
        if (cancelledRef.current) throw new ApiError('browser_auth_cancelled', t('browser.cancelled'));
        let job = await fetchAPI('/settings/browser-auth', { method: 'POST', body: JSON.stringify({ platform: key, ...payload }) });
        operationRef.current = job.operation_id;
        const deadline = Date.now() + 16 * 60 * 1000;
        let failures = 0;
        while (Date.now() < deadline && mountedRef.current) {
          if (cancelledRef.current && job.status !== 'binding') {
            try {
              await fetchAPI(`/settings/browser-auth/${encodeURIComponent(job.operation_id)}`, { method: 'DELETE' });
            } catch (error) {
              if (error.code !== 'browser_auth_binding') throw error;
            }
            // Authorization may finish between the last poll and the close click.
            // Reconcile with the server before calling a completed bind cancelled.
            job = await fetchAPI(`/settings/browser-auth/${encodeURIComponent(job.operation_id)}`);
            if (job.status === 'cancelled') throw new ApiError('browser_auth_cancelled', t('browser.cancelled'));
            cancelledRef.current = false;
          }
          updateAuth(job);
          if (job.status === 'complete') {
            completed = true; setMode('closed'); return job.result;
          }
          if (job.status === 'error' || job.status === 'cancelled')
            throw new ApiError(job.error || 'browser_auth_cancelled', job.message || t('browser.cancelled'));
          await new Promise(resolve => setTimeout(resolve, 650));
          try {
            job = await fetchAPI(`/settings/browser-auth/${encodeURIComponent(job.operation_id)}`);
            failures = 0;
          } catch (error) { if (++failures >= 4) throw error; }
        }
        throw new ApiError('browser_auth_timeout', t('browser.timeout'));
      } catch (error) {
        if (mountedRef.current) updateAuth({ ...authRef.current, status: 'error', error: error.code, message: error.message });
        throw error;
      } finally {
        if (!completed && operationRef.current && authRef.current?.status !== 'binding')
          fetchAPI(`/settings/browser-auth/${encodeURIComponent(operationRef.current)}`, { method: 'DELETE' }).catch(() => {});
        operationRef.current = ''; busyRef.current = false;
      }
    };
    return {
      mode, platform, launchRef, availableWidth, setAvailableWidth, auth, authenticate, viewer, viewerSocket, updateViewer,
      sendBrowser: type => { if (viewerSocket.current?.readyState === 1) viewerSocket.current.send(JSON.stringify({ type })); },
      open: (section) => {
        const key = String(section || '').replace('_accounts', '');
        if (!busyRef.current) {
          updateAuth(null);
          if (PLATFORMS[key]) setPlatform(key);
        }
        setMode('expanded');
      },
      selectPlatform: key => { if (!busyRef.current) setPlatform(key); },
      collapse: () => { setMode('collapsed'); restoreFocus(); },
      close: () => {
        if (authRef.current?.status === 'binding') { setMode('collapsed'); return; }
        cancelledRef.current = true; setMode('closed'); restoreFocus();
      },
    };
  }

  function BrowserPreviewLauncher({ model, section }) {
    const expanded = model.mode === 'expanded';
    return (
      <div className="browser-preview-launcher">
        <div className="browser-launcher-label"><BrowserIcon /><span>{t('browser.title')}</span></div>
        <button ref={model.launchRef} type="button" className={`btn btn-sm ${expanded ? '' : 'btn-primary'}`}
          aria-expanded={expanded} aria-controls="browser-preview"
          disabled={!expanded && model.availableWidth < 120}
          onClick={() => expanded ? model.collapse() : model.open(section)}>
          {t(expanded ? 'browser.collapse' : 'browser.launch')}
        </button>
        {model.availableWidth < 280 && <p className="browser-launcher-hint">{t('browser.spaceHint')}</p>}
      </div>
    );
  }

  function BrowserPreview({ model, settingsIsland, settingsWidth, logVisible, logWidth }) {
    const { mode, platform } = model;
    const [phase, setPhase] = useState('closed');
    const previous = useRef('closed');
    const pillRef = useRef(null), collapseRef = useRef(null);
    const info = PLATFORMS[platform];
    const auth = model.auth;
    const visible = mode !== 'closed' || phase !== 'closed';

    useLayoutEffect(() => {
      const panel = settingsIsland.panelRef.current;
      const measure = () => {
        const viewport = document.documentElement.clientWidth;
        // Use the destination right offset: the current offsetLeft lags behind
        // while the settings panel slides to make room for the log sidebar.
        const boundary = settingsIsland.visible && panel
          ? viewport - (logVisible ? logWidth + 16 : 8) - panel.offsetWidth
          : viewport - (logVisible ? logWidth + 8 : 0);
        const available = Math.max(0, boundary - (settingsIsland.visible || logVisible ? 16 : 8) - 8);
        model.setAvailableWidth(available);
      };
      measure();
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
      if (panel) observer?.observe(panel);
      window.addEventListener('resize', measure);
      return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
    }, [settingsIsland.visible, settingsWidth, logVisible, logWidth]);

    useEffect(() => {
      const oldMode = previous.current;
      previous.current = mode;
      const media = window.matchMedia('(prefers-reduced-motion: reduce)');
      const timers = [];
      const later = (next, delay) => timers.push(setTimeout(() => setPhase(next), delay));
      const finish = () => setPhase(mode === 'expanded' ? 'expanded' : mode);
      const onMotionChange = () => { if (media.matches) { timers.forEach(clearTimeout); finish(); } };
      media.addEventListener?.('change', onMotionChange);
      if (media.matches) finish();
      else if (mode === 'expanded') {
        setPhase(oldMode === 'closed' ? 'island' : 'unfolding');
        if (oldMode === 'closed') later('unfolding', 220);
        later('expanding', oldMode === 'closed' ? 440 : 220);
        later('expanded', oldMode === 'closed' ? 1040 : 820);
      } else if (oldMode !== 'closed' || mode !== 'closed') {
        setPhase(mode === 'closed' ? 'closing' : 'collapsing');
        later(mode, 600);
      } else setPhase('closed');
      return () => { timers.forEach(clearTimeout); media.removeEventListener?.('change', onMotionChange); };
    }, [mode]);

    useEffect(() => {
      if (!visible) return;
      const onKeyDown = (event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        // Other dialogs keep ownership of Escape when focus is outside the browser.
        if (!event.target.closest?.('.browser-preview-shell')) return;
        event.preventDefault();
        if (mode === 'expanded') model.collapse(); else model.close();
      };
      document.addEventListener('keydown', onKeyDown);
      return () => document.removeEventListener('keydown', onKeyDown);
    }, [visible, mode]);

    useEffect(() => {
      if (phase === 'expanded') collapseRef.current?.focus({ preventScroll: true });
      else if (phase === 'collapsed' && document.activeElement === document.body) pillRef.current?.focus({ preventScroll: true });
    }, [phase]);

    if (!visible) return null;
    const expanded = phase === 'expanded' || phase === 'expanding';
    const compact = ['island', 'collapsed', 'collapsing', 'closing'].includes(phase);
    return ReactDOM.createPortal(
      <div className="browser-preview-space" data-browser-phase={phase}
        style={{ width: model.availableWidth, '--browser-color': info.color }}>
        <section id="browser-preview" className="browser-preview-shell" aria-label={t('browser.title')}>
          <div className="browser-island" inert={!compact || mode === 'closed' ? '' : undefined} aria-hidden={!compact || mode === 'closed'}>
            <button ref={pillRef} type="button" className="browser-island-open" onClick={() => model.open(platform)}
              title={t('browser.expand')} aria-label={t('browser.expand')}>
              <BrowserIcon /><span>{info.name}</span><span className="browser-island-dot" />
              <span className="browser-island-caption">{t('browser.title')}</span><BrowserIcon name="expand" size={15} />
            </button>
            <button type="button" className="browser-icon-button" onClick={model.close} title={t('actions.close')} aria-label={t('actions.close')}>
              <BrowserIcon name="close" size={15} />
            </button>
          </div>
          <div className="browser-preview-content" inert={!expanded || mode !== 'expanded' ? '' : undefined} aria-hidden={!expanded || mode !== 'expanded'}>
            <header className="browser-chrome">
              <div className="browser-tab-row">
                <div className="browser-brand"><BrowserIcon /><span>{t('browser.title')}</span></div>
                <div className="browser-window-actions">
                  <button ref={collapseRef} type="button" className="browser-icon-button" onClick={model.collapse}
                    title={t('browser.collapse')} aria-label={t('browser.collapse')}><BrowserIcon name="collapse" /></button>
                  <button type="button" className="browser-icon-button" onClick={model.close}
                    title={t('actions.close')} aria-label={t('actions.close')}><BrowserIcon name="close" /></button>
                </div>
              </div>
              <div className="browser-address-row">
                {['back', 'forward', 'reload'].map(command => <button key={command} type="button" className="browser-icon-button"
                  disabled={auth?.status !== 'waiting' || model.viewer.connection !== 'connected' || (command === 'back' && !model.viewer.canBack) || (command === 'forward' && !model.viewer.canForward)} aria-label={t(`browser.${command}`)}
                  onClick={() => model.sendBrowser(command)}><BrowserIcon name={command} /></button>)}
                <div className="browser-address"><BrowserIcon name="lock" size={14} /><span>{model.viewer.host || auth?.display_host || info.host}</span></div>
                <span className="browser-preview-badge">{t(auth ? 'browser.login' : 'browser.preview')}</span>
              </div>
            </header>
            <div className="browser-viewport">
              {!auth && <div className="browser-platforms" role="group" aria-label={t('browser.platforms')}>
                {Object.entries(PLATFORMS).map(([key, item]) => <button key={key} type="button"
                  className={`browser-platform ${platform === key ? 'active' : ''}`} aria-pressed={platform === key}
                  onClick={() => model.selectPlatform(key)} style={{ '--platform-color': item.color }}>
                  <span />{item.name}
                </button>)}
              </div>}
              <div className={`browser-content-surface ${auth ? 'active' : ''}`}>
              {auth?.mode === 'stream' && auth.status === 'waiting' ? (
                <BrowserCanvas model={model} operationId={auth.operation_id} visible={mode === 'expanded' && phase === 'expanded'} />
              ) : (
              <div className="browser-empty-state">
                <div className="browser-preview-art" aria-hidden="true">
                  <span className="browser-art-orbit" /><span className="browser-art-orbit second" />
                  <div className="browser-art-window"><span /><BrowserIcon name="lock" size={30} /></div>
                  <span className="browser-art-chip">{info.name}</span>
                </div>
                <span className="browser-preview-eyebrow">{t(auth ? 'browser.login' : 'browser.preview')}</span>
                <h2>{auth ? t(`browser.status.${auth.status}`) : t('browser.welcome', { platform: info.name })}</h2>
                <p>{auth?.status === 'error' ? auth.message : t(auth ? 'browser.embeddedHelp' : 'browser.description')}</p>
                <div className="browser-preview-note"><BrowserIcon name="lock" size={15} /><span>{t(auth ? 'browser.manualLogin' : 'browser.previewNote')}</span></div>
              </div>
              )}
              </div>
              <footer className="browser-status-bar"><span><i />{t(auth ? `browser.status.${auth.status}` : 'browser.ready')}</span><span>{t('browser.layoutHint')}</span></footer>
            </div>
          </div>
        </section>
      </div>, document.body,
    );
  }

  Object.assign(window.GameTierApp, { useBrowserPreview, BrowserPreviewLauncher, BrowserPreview });
})();
