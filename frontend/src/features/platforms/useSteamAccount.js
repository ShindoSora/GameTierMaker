(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
  const { t, getErrorMessage } = window.GameTierI18n;
  const { showToast, fetchAPI } = window.GameTierApp;
  function useSteamAccount({
    getCurrentTemplate,
    runBackfill,
    currentId,
    setSettingsOperation,
    refreshSelectedTemplate,
    confirmAction,
  }) {
    const [steamAccounts, setSteamAccounts] = useState({});
    const steamImportPollTokenRef = useRef(0);
    const handledSteamImportsRef = useRef(new Set());
    const processingSteamImportsRef = useRef(new Map());
    const handleSteamImportComplete = async (result) => {
      const operationId = String(result?.operation_id || '');
      let expectedOperationId = '';
      try {
        expectedOperationId = sessionStorage.getItem('steam-import-operation') || '';
      } catch (error) {
        /* session storage is optional */
      }
      // Ignore unsolicited or stale callback messages. The polling endpoint is
      // protected by the HttpOnly local-session cookie as a second check.
      if (!operationId) return false;
      if (handledSteamImportsRef.current.has(operationId)) return true;
      if (!expectedOperationId || operationId !== expectedOperationId) return false;
      if (processingSteamImportsRef.current.has(operationId)) {
        return processingSteamImportsRef.current.get(operationId);
      }
      const completion = (async () => {
        const { currentId: activeTemplateId, loadCurrentTemplate } = getCurrentTemplate();
        if (activeTemplateId) await loadCurrentTemplate(activeTemplateId);
        await loadSteamAccounts();
        runBackfill('steam');
        handledSteamImportsRef.current.add(operationId);
        try {
          if (sessionStorage.getItem('steam-import-operation') === operationId) {
            sessionStorage.removeItem('steam-import-operation');
          }
        } catch (error) {
          /* session storage is optional */
        }
        const total = Number(result?.total);
        showToast(
          Number.isFinite(total)
            ? t('steam.loadedCovers', { count: total })
            : t('steam.coversLoaded'),
          'success'
        );
        showToast(t('library.dragDisabledWhileDownloading'), '');
        return true;
      })();
      processingSteamImportsRef.current.set(operationId, completion);
      try {
        return await completion;
      } finally {
        processingSteamImportsRef.current.delete(operationId);
      }
    };
    const monitorSteamImport = async (operationId) => {
      if (!operationId) return;
      const pollToken = ++steamImportPollTokenRef.current;
      const deadline = Date.now() + 10 * 60 * 1000;
      let requestFailures = 0;
      while (pollToken === steamImportPollTokenRef.current && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (pollToken !== steamImportPollTokenRef.current) return;
        try {
          const result = await fetchAPI(
            `/settings/steam/import-status/${encodeURIComponent(operationId)}`
          );
          if (pollToken !== steamImportPollTokenRef.current) return;
          if (result.status === 'complete') {
            if (await handleSteamImportComplete(result)) return;
          }
          if (result.status === 'error') {
            try {
              sessionStorage.removeItem('steam-import-operation');
            } catch (error) {
              /* session storage is optional */
            }
            showToast(result.message || t('errors.bindFailed'), 'error');
            await loadSteamAccounts();
            return;
          }
          requestFailures = 0;
        } catch (error) {
          requestFailures += 1;
          if (requestFailures >= 5) {
            showToast(getErrorMessage(error, 'errors.backendUnavailable'), 'error');
            return;
          }
        }
      }
      if (pollToken === steamImportPollTokenRef.current) {
        try {
          sessionStorage.removeItem('steam-import-operation');
        } catch (error) {
          /* session storage is optional */
        }
        showToast(t('steam.bindTimeout'), 'error');
      }
    };
    useEffect(() => {
      const handler = async (event) => {
        if (event.origin !== window.location.origin) return;
        if (!event.data || event.data.type !== 'steam-import-done') return;
        try {
          await handleSteamImportComplete(event.data);
        } catch (error) {
          showToast(getErrorMessage(error, 'errors.requestFailed'), 'error');
        }
      };
      window.addEventListener('message', handler);
      return () => window.removeEventListener('message', handler);
    }, []);
    useEffect(() => {
      try {
        const pendingOperation = sessionStorage.getItem('steam-import-operation');
        if (pendingOperation) monitorSteamImport(pendingOperation);
      } catch (error) {
        /* session storage is optional */
      }
      return () => {
        steamImportPollTokenRef.current += 1;
      };
    }, []);
    const handleSteamJump = async () => {
      try {
        const res = await fetchAPI(
          `/settings/steam/jump?template_id=${encodeURIComponent(currentId)}`,
          {
            method: 'POST',
            body: JSON.stringify({
              game_name: '',
            }),
          }
        );
        try {
          sessionStorage.setItem('steam-import-operation', res.operation_id || '');
        } catch (error) {
          /* session storage is optional */
        }
        window.open(res.url, '_blank');
        monitorSteamImport(res.operation_id);
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.redirectFailed'), 'error');
      }
    };
    const loadSteamAccounts = async () => {
      try {
        const res = await fetchAPI('/settings/steam/accounts');
        setSteamAccounts(res.accounts || {});
      } catch (e) {
        /* ignore */
      }
    };
    const handleSyncAccount = async (steamid) => {
      try {
        setSettingsOperation({
          key: `steam-sync-${steamid}`,
          labelKey: 'steam.syncing',
        });
        const res = await fetchAPI(
          '/settings/steam/accounts/' +
            steamid +
            `/sync?template_id=${encodeURIComponent(currentId)}`,
          {
            method: 'POST',
          }
        );
        showToast(
          t('platform.loadedCovers', {
            count: res.total,
          }),
          'success'
        );
        await refreshSelectedTemplate();
        runBackfill('steam');
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.syncFailed'), 'error');
      } finally {
        setSettingsOperation(null);
      }
    };
    const handleUnbindAccount = async (steamid) => {
      if (!(await confirmAction(t('dialogs.unbindAccount')))) return;
      try {
        const res = await fetchAPI('/settings/steam/accounts/' + steamid, {
          method: 'DELETE',
        });
        showToast(
          t('account.unboundWithImages', {
            count: res.deleted_images,
          }),
          'success'
        );
        await refreshSelectedTemplate();
        loadSteamAccounts();
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.unbindFailed'), 'error');
      }
    };
    const handleDeleteAccountImages = async (steamid) => {
      if (!(await confirmAction(t('dialogs.deleteAccountImages')))) return;
      try {
        const res = await fetchAPI('/settings/steam/accounts/' + steamid + '/images', {
          method: 'DELETE',
        });
        showToast(
          t('account.deletedImages', {
            count: res.deleted_images,
          }),
          'success'
        );
        await refreshSelectedTemplate();
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.deleteFailed'), 'error');
      }
    };
    return {
      steamAccounts,
      handleSteamJump,
      loadSteamAccounts,
      handleSyncAccount,
      handleUnbindAccount,
      handleDeleteAccountImages,
    };
  }
  Object.assign(window.GameTierApp, {
    useSteamAccount,
  });
})();
