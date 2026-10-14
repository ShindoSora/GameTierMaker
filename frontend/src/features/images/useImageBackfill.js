(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
  const { t } = window.GameTierI18n;
  const { fetchBackfillStream, showToast } = window.GameTierApp;
  function useImageBackfill({ getCurrentTemplate }) {
    const [backfill, setBackfill] = useState(null);
    const backfillRunningRef = useRef(false);
    const backfillPendingSourcesRef = useRef(new Set());
    const backfillClearTimerRef = useRef(null);
    const disposedRef = useRef(false);
    const requestRef = useRef(null);
    const restartRequiredRef = useRef(false);
    useEffect(() => {
      disposedRef.current = false;
      return () => {
        disposedRef.current = true;
        requestRef.current?.abort();
        backfillPendingSourcesRef.current.clear();
        clearTimeout(backfillClearTimerRef.current);
      };
    }, []);
    const runBackfill = async (source = '') => {
      if (disposedRef.current || restartRequiredRef.current) return;
      backfillPendingSourcesRef.current.add(source || '');
      if (backfillRunningRef.current) return;
      backfillRunningRef.current = true;
      if (backfillClearTimerRef.current) {
        clearTimeout(backfillClearTimerRef.current);
        backfillClearTimerRef.current = null;
      }
      let requiresRestart = false;
      try {
        while (!disposedRef.current && backfillPendingSourcesRef.current.size > 0) {
          const currentSource = backfillPendingSourcesRef.current.values().next().value;
          backfillPendingSourcesRef.current.delete(currentSource);
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
                received = true;
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
            showToast(t(requiresRestart ? 'backfill.restartRequired' : 'backfill.interrupted'), 'error');
          }
        }
        if (disposedRef.current || requiresRestart) return;
        const { currentId, loadCurrentTemplate } = getCurrentTemplate();
        if (currentId) await loadCurrentTemplate(currentId);
        if (disposedRef.current) return;
        backfillClearTimerRef.current = setTimeout(() => {
          setBackfill(null);
          backfillClearTimerRef.current = null;
        }, 3000);
      } catch (error) {
        if (disposedRef.current) return;
        console.error('图片回填流程失败:', error);
        setBackfill(null);
      } finally {
        backfillRunningRef.current = false;
        const pending = backfillPendingSourcesRef.current.values().next();
        if (!pending.done) runBackfill(pending.value);
      }
    };
    return {
      backfill,
      runBackfill,
    };
  }
  Object.assign(window.GameTierApp, {
    useImageBackfill,
  });
})();
