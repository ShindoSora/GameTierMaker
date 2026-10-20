(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
  const { t } = window.GameTierI18n;
  const { fetchBackfillStream, showToast } = window.GameTierApp;
  const activeDownloadStates = new Set(['queued', 'downloading', 'searching', 'saving']);
  function mergeDownloadQueue(previous, incoming, newBatch = false) {
    const records = new Map(previous.filter(item => !newBatch || item.status !== 'success').map(item => [item.key, item]));
    for (const item of incoming) records.set(item.key, { ...records.get(item.key), ...item });
    return Array.from(records.values());
  }
  function interruptDownloads(previous, keys) {
    return previous.map(item => keys.has(item.key) && activeDownloadStates.has(item.status)
      ? { ...item, status: 'interrupted' } : item);
  }
  function useImageBackfill({ getCurrentTemplate }) {
    const [backfill, setBackfill] = useState(null);
    const [downloads, setDownloads] = useState([]);
    const [downloadsOpen, setDownloadsOpen] = useState(false);
    const downloadAnchorRef = useRef(null);
    const backfillRunningRef = useRef(false);
    const backfillPendingSourcesRef = useRef(new Set());
    const disposedRef = useRef(false);
    const requestRef = useRef(null);
    const restartRequiredRef = useRef(false);
    useEffect(() => {
      disposedRef.current = false;
      return () => {
        disposedRef.current = true;
        requestRef.current?.abort();
        backfillPendingSourcesRef.current.clear();
      };
    }, []);
    const runBackfill = async (source = '') => {
      if (disposedRef.current || restartRequiredRef.current) return;
      backfillPendingSourcesRef.current.add(source || '');
      if (backfillRunningRef.current) return;
      backfillRunningRef.current = true;
      let requiresRestart = false;
      try {
        while (!disposedRef.current && backfillPendingSourcesRef.current.size > 0) {
          const currentSource = backfillPendingSourcesRef.current.values().next().value;
          backfillPendingSourcesRef.current.delete(currentSource);
          setDownloads(previous => mergeDownloadQueue(previous, [], true));
          const batchKeys = new Set();
          setBackfill({
            source: currentSource,
            ok: 0,
            fail: 0,
            remaining: -1,
          });
          try {
            const sourceQuery = currentSource ? `?source=${encodeURIComponent(currentSource)}` : '';
            let retryPending = 0;
            const outdatedBackend = () => Object.assign(new Error(t('backfill.restartRequired')), {code:'backfill_update_required'});
            if (!fetchBackfillStream) throw outdatedBackend();
            const controller = new AbortController();
            requestRef.current = controller;
            let received = false;
            try {
              await fetchBackfillStream(`/settings/images/backfill/stream${sourceQuery}`, {
                method: 'POST', signal: controller.signal,
              }, event => {
                if (disposedRef.current || controller.signal.aborted || requestRef.current !== controller) return;
                if (event.detail_version !== 1 || (event.event === 'start' && !Array.isArray(event.items))) throw outdatedBackend();
                received = true;
                const incoming = event.items || (event.item ? [event.item] : []);
                incoming.forEach(item => batchKeys.add(item.key));
                if (incoming.length) setDownloads(previous => mergeDownloadQueue(previous, incoming));
                if (event.event === 'done') setDownloads(previous => interruptDownloads(previous, batchKeys));
                retryPending = event.retry_pending;
                setBackfill({ source: currentSource, ok:event.ok, fail:event.fail, deferred:event.deferred,
                  retryPending, remaining:event.remaining });
              });
            } catch (error) {
              // Never silently restore the 20-cover batches behind a live-progress UI.
              if (!received && [404, 405].includes(error.status)) throw outdatedBackend();
              throw error;
            }
            if (!disposedRef.current && retryPending > 0) {
              showToast(t('backfill.deferred', { count: retryPending }), 'error');
            }
          } catch (error) {
            if (disposedRef.current) return;
            console.error('图片回填失败:', error);
            requiresRestart = error.code === 'backfill_update_required';
            if (requiresRestart) {
              restartRequiredRef.current = true;
              backfillPendingSourcesRef.current.clear();
            }
            setBackfill(previous => ({ ...previous, error: true, requiresRestart }));
            setDownloads(previous => interruptDownloads(previous, batchKeys));
            showToast(t(requiresRestart ? 'backfill.restartRequired' : 'backfill.interrupted'), 'error');
          }
        }
        if (disposedRef.current || requiresRestart) return;
        const { currentId, loadCurrentTemplate } = getCurrentTemplate();
        if (currentId) await loadCurrentTemplate(currentId);
        if (disposedRef.current) return;
      } catch (error) {
        if (disposedRef.current) return;
        console.error('图片回填流程失败:', error);
        setBackfill(previous => previous ? { ...previous, error: true } : previous);
      } finally {
        backfillRunningRef.current = false;
        const pending = backfillPendingSourcesRef.current.values().next();
        if (!pending.done) runBackfill(pending.value);
      }
    };
    return {
      backfill,
      runBackfill,
      downloads,
      downloadsOpen,
      setDownloadsOpen,
      downloadAnchorRef,
    };
  }
  Object.assign(window.GameTierApp, {
    useImageBackfill,
    mergeDownloadQueue,
    interruptDownloads,
  });
})();
