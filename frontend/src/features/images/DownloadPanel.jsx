(() => {
  'use strict';
  const { useState, useRef, useEffect, useLayoutEffect } = React;
  const { t } = window.GameTierI18n;
  const { useIslandPanel, useSlidingPill } = window.GameTierApp;

  function DownloadPanel({ model }) {
    const { downloads, downloadsOpen: open, setDownloadsOpen, downloadAnchorRef } = model;
    const [tab, setTab] = useState('pending');
    const [position, setPosition] = useState({ top: 70, right: 12 });
    const island = useIslandPanel({ open, width: 460, anchorRef: downloadAnchorRef });
    const panelRef = island.panelRef;
    const listRef = useRef(null), buttonsRef = useRef({});
    const swapRef = useRef(null), listMotionRef = useRef(null), heightMotionRef = useRef(null);
    const successful = downloads.filter(item => item.status === 'success');
    const pending = downloads.filter(item => item.status !== 'success');
    const pill = useSlidingPill({ selectedKey: tab, layoutKey: `${pending.length}:${successful.length}`,
      visible: island.visible, buttonsRef });
    const close = restore => {
      setDownloadsOpen(false);
      if (restore) downloadAnchorRef.current?.focus({ preventScroll: true });
    };
    useLayoutEffect(() => {
      if (!downloadAnchorRef.current) return;
      const align = () => {
        const anchor = downloadAnchorRef.current?.getBoundingClientRect();
        const width = document.documentElement.clientWidth;
        const panelWidth = panelRef.current?.offsetWidth || Math.min(460, width - 24);
        const top = Math.min((anchor?.bottom || 58) + 10, Math.max(12, window.innerHeight - 180));
        const right = Math.max(12, Math.min(width - (anchor?.right || width - 12), width - panelWidth - 12));
        setPosition(previous => previous.top === top && previous.right === right ? previous : { top, right });
      };
      align();
      const observer = new ResizeObserver(align);
      if (downloadAnchorRef.current) observer.observe(downloadAnchorRef.current);
      if (panelRef.current) observer.observe(panelRef.current);
      window.addEventListener('resize', align);
      return () => { observer.disconnect(); window.removeEventListener('resize', align); };
    }, [open, Boolean(model.backfill)]);
    useLayoutEffect(() => {
      const swap = swapRef.current;
      swapRef.current = null;
      if (!swap || !open) return;
      listMotionRef.current?.cancel();
      heightMotionRef.current?.cancel();
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      const panel = panelRef.current, list = listRef.current;
      const height = panel?.offsetHeight;
      if (panel?.animate && island.phase === 'open' && height && Math.abs(height - swap.height) > 1) {
        heightMotionRef.current = panel.animate([{ height: `${swap.height}px` }, { height: `${height}px` }],
          { duration: 260, easing: 'cubic-bezier(.22,.8,.25,1)' });
      }
      if (list?.animate) listMotionRef.current = list.animate([
        { opacity: .15, transform: `translateX(${swap.direction * 12}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ], { duration: 220, easing: 'cubic-bezier(.22,.8,.25,1)' });
      if (list) list.scrollTop = 0;
    }, [tab]);
    useEffect(() => {
      const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      const cancel = () => { listMotionRef.current?.cancel(); heightMotionRef.current?.cancel(); };
      const settle = () => { if (media?.matches) cancel(); };
      media?.addEventListener?.('change', settle);
      return () => { cancel(); media?.removeEventListener?.('change', settle); };
    }, []);
    useEffect(() => {
      if (!open) return;
      buttonsRef.current[tab]?.focus({ preventScroll: true });
      const onPointer = event => {
        if (!panelRef.current?.contains(event.target) && !downloadAnchorRef.current?.contains(event.target)) close(false);
      };
      const onKey = event => {
        if (event.key === 'Escape' && !event.defaultPrevented
            && (panelRef.current?.contains(event.target) || downloadAnchorRef.current?.contains(event.target))) {
          event.preventDefault(); event.stopPropagation(); close(true);
        }
      };
      document.addEventListener('pointerdown', onPointer);
      document.addEventListener('keydown', onKey, true);
      return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey, true); };
    }, [open]);
    if (!island.visible) return null;
    const priority = { downloading: 0, searching: 0, saving: 0, queued: 1, deferred: 2, interrupted: 3, failed: 3 };
    const rows = tab === 'success' ? successful : pending.slice().sort((a, b) => priority[a.status] - priority[b.status]);
    const chooseTab = key => {
      if (key !== tab) {
        swapRef.current = { height: panelRef.current?.offsetHeight || 0, direction: key === 'success' ? 1 : -1 };
        setTab(key);
      }
      buttonsRef.current[key]?.focus({ preventScroll: true });
    };
    const tabKeys = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      chooseTab(event.key === 'Home' ? 'pending' : event.key === 'End' ? 'success' : tab === 'pending' ? 'success' : 'pending');
    };
    const bytes = value => value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`;
    return ReactDOM.createPortal(
      <section ref={panelRef} id="download-queue-panel" className="download-queue-panel" role="dialog"
        data-island-state={island.phase} inert={!open ? '' : undefined} aria-hidden={!open}
        aria-labelledby="download-queue-title" style={{ ...position, maxHeight: `calc(100dvh - ${position.top + 12}px)` }}>
        <div ref={island.contentRef} className="download-queue-content">
        <header className="download-queue-header">
          <h2 id="download-queue-title">{t('downloads.title')}</h2>
          <button type="button" className="btn btn-icon" onClick={() => close(true)} aria-label={t('actions.close')}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div ref={pill.hostRef} className="download-queue-tabs" role="tablist" aria-label={t('downloads.title')} onKeyDown={tabKeys}
          onPointerMove={pill.onPointerMove} onPointerLeave={pill.onPointerLeave}>
          <span ref={pill.pillRef} className="download-queue-tab-pill" aria-hidden="true" />
          {[['pending', pending.length], ['success', successful.length]].map(([key, count]) =>
            <button key={key} ref={node => { if (node) buttonsRef.current[key] = node; else delete buttonsRef.current[key]; }}
              type="button" role="tab" id={`download-tab-${key}`} aria-selected={tab === key}
              aria-controls="download-queue-list" tabIndex={tab === key ? 0 : -1} onClick={() => chooseTab(key)}>
              {t(`downloads.${key}`)}<span>{count}</span>
            </button>)}
        </div>
        <div ref={listRef} id="download-queue-list" className="download-queue-list" role="tabpanel" aria-labelledby={`download-tab-${tab}`}>
          {!rows.length ? <p className="download-queue-empty">{t(tab === 'success' ? 'downloads.noSuccess' : 'downloads.noPending')}</p>
            : rows.map(item => <article key={item.key} className="download-queue-item" data-state={item.status}>
              <div className="download-queue-name"><strong title={item.name}>{item.name}</strong>
                <span className="download-queue-percent">{item.progress === null ? '—' : `${item.progress}%`}</span></div>
              <div className="download-queue-progress" role="progressbar" aria-label={t('downloads.progressFor', { name: item.name })}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress === null ? undefined : item.progress}
                data-indeterminate={item.progress === null && ['downloading', 'searching', 'saving'].includes(item.status)}>
                <span style={{ width: item.progress === null ? undefined : `${item.progress}%` }} />
              </div>
              <div className="download-queue-meta"><span>{t(`sources.${item.source}`)} · {t(`downloads.state.${item.status}`)}</span>
                {item.loaded > 0 && <span>{bytes(item.loaded)}{item.total ? ` / ${bytes(item.total)}` : ''}</span>}</div>
            </article>)}
        </div>
        </div>
      </section>, document.body);
  }
  Object.assign(window.GameTierApp, { DownloadPanel });
})();
