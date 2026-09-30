(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
  const { t } = window.GameTierI18n;
  const { fetchAPI, showToast } = window.GameTierApp;
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
            ok: 0,
            fail: 0,
            remaining: -1,
          });
          try {
            while (!disposedRef.current) {
              const sourceQuery = currentSource
                ? `?source=${encodeURIComponent(currentSource)}`
                : '';
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
              const retryPending = Number(res.retry_pending || 0);
              setBackfill({
                ok,
                fail,
                deferred,
                retryPending,
                remaining: res.remaining,
              });
              if (res.remaining === 0) {
                if (retryPending > 0) {
                  showToast(
                    t('backfill.deferred', {
                      count: retryPending,
                    }),
                    'error'
                  );
                }
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 150));
            }
          } catch (error) {
            if (disposedRef.current) return;
            console.error('图片回填失败:', error);
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
