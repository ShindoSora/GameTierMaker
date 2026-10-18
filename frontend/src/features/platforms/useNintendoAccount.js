(() => {
  'use strict';

  const { useState, useRef } = React;
  const { t, getErrorMessage } = window.GameTierI18n;
  const { fetchAPI, showToast } = window.GameTierApp;
  function useNintendoAccount({
    authenticate,
    setSettingsOperation,
    currentId,
    refreshSelectedTemplate,
    runBackfill,
    confirmAction,
  }) {
    const [nintendoAccounts, setNintendoAccounts] = useState({});
    const [nintendoExcludeDemos, setNintendoExcludeDemos] = useState(() => {
      try {
        const saved = JSON.parse(localStorage.getItem('nintendo-exclude-demos') || '{}');
        return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
      } catch (error) {
        return {};
      }
    });
    const syncingRef = useRef(false);
    const syncRequestRef = useRef(null);
    const handleNintendoExcludeDemos = (accountId, checked) => {
      setNintendoExcludeDemos(previous => {
        const next = { ...previous, [accountId]: checked };
        try {
          localStorage.setItem('nintendo-exclude-demos', JSON.stringify(next));
        } catch (error) {
          /* The current session can still use this preference. */
        }
        return next;
      });
    };
    const loadNintendoAccounts = async () => {
      try {
        const res = await fetchAPI('/settings/nintendo/accounts');
        setNintendoAccounts(res.accounts || {});
      } catch (e) {
        /* ignore */
      }
    };
    const handleNintendoStart = async () => {
      try {
        setSettingsOperation({ key: 'nintendo-auth', labelKey: 'nintendo.authorizing' });
        await authenticate('nintendo', { template_id: currentId });
        await loadNintendoAccounts();
        showToast(t('nintendo.bound'), 'success');
      } catch (error) {
        if (error.code === 'browser_auth_cancelled') showToast(t('browser.cancelled'), '');
        else showToast(getErrorMessage(error, 'errors.nintendoAuthFailed'), 'error');
      } finally {
        setSettingsOperation(null);
      }
    };
    const handleNintendoSync = async (accountId) => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      const excludeDemos = nintendoExcludeDemos[accountId] !== false;
      const scope = JSON.stringify([accountId, currentId, excludeDemos]);
      if (syncRequestRef.current?.scope !== scope) {
        syncRequestRef.current = {
          scope,
          requestId: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        };
      }
      try {
        setSettingsOperation({
          key: `nintendo-sync-${accountId}`,
          labelKey: 'nintendo.syncing',
        });
        const res = await fetchAPI(
          `/settings/nintendo/accounts/${encodeURIComponent(accountId)}/sync?template_id=${encodeURIComponent(currentId)}`,
          {
            method: 'POST',
            body: JSON.stringify({
              exclude_demos: excludeDemos,
              request_id: syncRequestRef.current.requestId,
            }),
          }
        );
        if (res.status !== 'completed') {
          throw Object.assign(new Error(t('errors.nintendo_sync_update_required')), {
            code: 'nintendo_sync_update_required',
          });
        }
        await loadNintendoAccounts();
        await refreshSelectedTemplate();
        await runBackfill('nintendo');
        syncRequestRef.current = null;
        showToast(
          t('nintendo.syncCompleted', {
            count: res.registered || 0,
            pending: res.cover_pending || 0,
            excluded: res.excluded_demos || 0,
          }),
          'success'
        );
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.nintendoSyncFailed'), 'error');
      } finally {
        syncingRef.current = false;
        setSettingsOperation(null);
      }
    };
    const handleNintendoUnbind = async (accountId) => {
      if (!(await confirmAction(t('dialogs.nintendoUnbindAccount')))) return;
      try {
        await fetchAPI(`/settings/nintendo/accounts/${encodeURIComponent(accountId)}`, {
          method: 'DELETE',
        });
        await loadNintendoAccounts();
        showToast(t('nintendo.unbound'), 'success');
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.unbindFailed'), 'error');
      }
    };
    const handleNintendoDeleteImages = async (accountId) => {
      if (!(await confirmAction(t('dialogs.deleteAccountImages')))) return;
      try {
        const res = await fetchAPI(
          `/settings/nintendo/accounts/${encodeURIComponent(accountId)}/images`,
          {
            method: 'DELETE',
          }
        );
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
      nintendoAccounts,
      nintendoExcludeDemos,
      handleNintendoExcludeDemos,
      loadNintendoAccounts,
      handleNintendoStart,
      handleNintendoSync,
      handleNintendoUnbind,
      handleNintendoDeleteImages,
    };
  }
  Object.assign(window.GameTierApp, {
    useNintendoAccount,
  });
})();
