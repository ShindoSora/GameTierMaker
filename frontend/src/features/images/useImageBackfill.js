(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
  const { t } = window.GameTierI18n;
  const { fetchAPI, fetchBackfillStream, showToast } = window.GameTierApp;
  function useImageBackfill({ getCurrentTemplate }) {
    const [backfill, setBackfill] = useState(null);
    const backfillRunningRef = useRef(false);
    const backfillPendingSourcesRef = useRef(new Set());
    const backfillClearTimerRef = useRef(null);
    const disposedRef = useRef(false);
    const requestRef = useRef(null);
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
      if (disposedRef.current) return;
      backfillPendingSourcesRef.current.add(source || '');
      if (backfillRunningRef.current) return;
      backfillRunningRef.current = true;
      if (backfillClearTimerRef.current) {
        clearTimeout(backfillClearTimerRef.current);
        backfillClearTimerRef.current = null;
      }
      try {
        while (!disposedRef.current && backfillPendingSourcesRef.current.size > 0) {
          const currentSource = backfillPendingSourcesRef.current.values().next().value;
          backfillPendingSourcesRef.current.delete(currentSource);
          let ok = 0,
            fail = 0,
            deferred = 0;
          setBackfill({
            source: currentSource,
            ok: 0,
            fail: 0,
            remaining: -1,
          });
          try {
            const sourceQuery = currentSource ? `?source=${encodeURIComponent(currentSource)}` : '';
            let streamed = false;
            let retryPending = 0;
            if (fetchBackfillStream) {
              const controller = new AbortController();
              requestRef.current = controller;
              let received = false;
              try {
                await fetchBackfillStream(`/settings/images/backfill/stream${sourceQuery}`, {
                  method: 'POST', signal: controller.signal,
                }, event => {
                  if (disposedRef.current || controller.signal.aborted || requestRef.current !== controller) return;
                  received = true;
                  ok = event.ok; fail = event.fail; deferred = event.deferred;
                  retryPending = event.retry_pending;
                  setBackfill({ source: currentSource, ok, fail, deferred, retryPending, remaining: event.remaining });
                });
                streamed = true;
              } catch (error) {
                // A running older backend may not have the new endpoint yet.
                if (received || ![404, 405].includes(error.status)) throw error;
              }
            }
            while (!disposedRef.current && !streamed) {
              const controller = new AbortController();
              requestRef.current = controller;
              const res = await fetchAPI(`/settings/images/backfill${sourceQuery}`, {
                method: 'POST',
                signal: controller.signal,
              });
              if (disposedRef.current) return;
              ok += res.ok;
              fail += res.fail;
              deferred += Number(res.deferred || 0);
              retryPending = Number(res.retry_pending || 0);
              setBackfill({
                source: currentSource,
                ok,
                fail,
                deferred,
                retryPending,
                remaining: res.remaining,
              });
              if (res.remaining === 0) {
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 150));
            }
            if (!disposedRef.current && retryPending > 0) {
              showToast(t('backfill.deferred', { count: retryPending }), 'error');
            }
          } catch (error) {
            if (disposedRef.current) return;
            console.error('图片回填失败:', error);
            setBackfill(previous => ({ ...previous, error: true }));
            showToast(t('backfill.interrupted'), 'error');
          }
        }
        if (disposedRef.current) return;
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
