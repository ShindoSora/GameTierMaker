(() => {
  'use strict';

  const { useState } = React;
  const { t, getErrorMessage } = window.GameTierI18n;
  const { fetchAPI, showToast } = window.GameTierApp;
  function useNintendoAccount({
    setSettingsOperation,
    currentId,
    refreshSelectedTemplate,
    runBackfill,
    confirmAction,
  }) {
    const [nintendoAccounts, setNintendoAccounts] = useState({});
    const [nintendoAuthOperation, setNintendoAuthOperation] = useState(null);
    const [nintendoAuthorizeUrl, setNintendoAuthorizeUrl] = useState('');
    const [nintendoCallback, setNintendoCallback] = useState('');
    const [nintendoPreview, setNintendoPreview] = useState(null);
    const [nintendoSelected, setNintendoSelected] = useState(new Set());
    const [nintendoImportRequestId, setNintendoImportRequestId] = useState('');
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
        setSettingsOperation({
          key: 'nintendo-auth',
          labelKey: 'nintendo.authorizing',
        });
        const res = await fetchAPI('/settings/nintendo/auth/start', {
          method: 'POST',
          body: JSON.stringify({
            template_id: currentId,
          }),
        });
        setNintendoAuthOperation(res.operation_id || '');
        setNintendoAuthorizeUrl(res.authorize_url || '');
        const popup = window.open(res.authorize_url, '_blank');
        if (!popup) showToast(t('nintendo.popupBlocked'), 'error');
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.nintendoAuthFailed'), 'error');
      } finally {
        setSettingsOperation(null);
      }
    };
    const handleNintendoComplete = async () => {
      if (!nintendoAuthOperation || !nintendoCallback.trim()) {
        showToast(t('nintendo.callbackRequired'), 'error');
        return;
      }
      try {
        setSettingsOperation({
          key: 'nintendo-complete',
          labelKey: 'nintendo.verifying',
        });
        await fetchAPI('/settings/nintendo/auth/complete', {
          method: 'POST',
          body: JSON.stringify({
            operation_id: nintendoAuthOperation,
            callback_url: nintendoCallback.trim(),
          }),
        });
        setNintendoCallback('');
        setNintendoAuthOperation(null);
        setNintendoAuthorizeUrl('');
        await loadNintendoAccounts();
        showToast(t('nintendo.bound'), 'success');
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.nintendoAuthFailed'), 'error');
      } finally {
        setSettingsOperation(null);
      }
    };
    const handleNintendoSync = async (accountId) => {
      try {
        setSettingsOperation({
          key: `nintendo-sync-${accountId}`,
          labelKey: 'nintendo.syncing',
        });
        const res = await fetchAPI(
          `/settings/nintendo/accounts/${encodeURIComponent(accountId)}/sync?template_id=${encodeURIComponent(currentId)}`,
          {
            method: 'POST',
          }
        );
        setNintendoPreview(res);
        setNintendoSelected(new Set((res.titles || []).map((title) => title.record_key)));
        setNintendoImportRequestId('');
        showToast(
          t('nintendo.previewReady', {
            count: res.received || 0,
          }),
          'success'
        );
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.nintendoSyncFailed'), 'error');
      } finally {
        setSettingsOperation(null);
      }
    };
    const handleNintendoImport = async () => {
      if (!nintendoPreview || !nintendoSelected.size) {
        showToast(t('nintendo.selectRequired'), 'error');
        return;
      }
      const requestId =
        nintendoImportRequestId ||
        window.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random()}`;
      if (!nintendoImportRequestId) setNintendoImportRequestId(requestId);
      try {
        setSettingsOperation({
          key: 'nintendo-import',
          labelKey: 'nintendo.importing',
        });
        const res = await fetchAPI(
          `/settings/nintendo/accounts/${encodeURIComponent(nintendoPreview.account_id)}/import`,
          {
            method: 'POST',
            body: JSON.stringify({
              preview_id: nintendoPreview.preview_id,
              record_keys: Array.from(nintendoSelected),
              request_id: requestId,
            }),
          }
        );
        setNintendoPreview(null);
        setNintendoSelected(new Set());
        setNintendoImportRequestId('');
        await refreshSelectedTemplate();
        showToast(
          t('nintendo.imported', {
            count: res.registered || 0,
            pending: res.cover_pending || 0,
          }),
          'success'
        );
        runBackfill('nintendo');
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.nintendoImportFailed'), 'error');
      } finally {
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
      nintendoAuthOperation,
      nintendoAuthorizeUrl,
      nintendoCallback,
      setNintendoCallback,
      nintendoPreview,
      setNintendoPreview,
      nintendoSelected,
      setNintendoSelected,
      setNintendoImportRequestId,
      loadNintendoAccounts,
      handleNintendoStart,
      handleNintendoComplete,
      handleNintendoSync,
      handleNintendoImport,
      handleNintendoUnbind,
      handleNintendoDeleteImages,
    };
  }
  Object.assign(window.GameTierApp, {
    useNintendoAccount,
  });
})();
