(() => {
  'use strict';

  const { useState } = React;
  const { t, getErrorMessage } = window.GameTierI18n;
  const { fetchAPI, showToast } = window.GameTierApp;
  function useXboxAccount({
    setSettingsOperation,
    currentId,
    loadCurrentTemplate,
    runBackfill,
    confirmAction,
    refreshSelectedTemplate,
  }) {
    const [xboxGamertag, setXboxGamertag] = useState('');
    const [xboxAccounts, setXboxAccounts] = useState({});
    const loadXboxAccounts = async () => {
      try {
        const res = await fetchAPI('/settings/xbox/accounts');
        setXboxAccounts(res.accounts || {});
      } catch (e) {
        /* ignore */
      }
    };
    const handleXboxBind = async () => {
      if (!xboxGamertag.trim()) {
        showToast(t('xbox.gamertagRequired'), 'error');
        return;
      }
      try {
        setSettingsOperation({
          key: 'xbox-bind',
          labelKey: 'xbox.binding',
        });
        const res = await fetchAPI(
          `/settings/xbox/bind?template_id=${encodeURIComponent(currentId)}`,
          {
            method: 'POST',
            body: JSON.stringify({
              gamertag: xboxGamertag.trim(),
            }),
          }
        );
        setXboxGamertag('');
        showToast(
          t('xbox.bindSucceeded', {
            count: res.total,
          }),
          'success'
        );
        await loadCurrentTemplate(currentId);
        runBackfill('xbox');
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.bindFailed'), 'error');
      } finally {
        setSettingsOperation(null);
      }
    };
    const handleXboxSync = async (xuid) => {
      try {
        setSettingsOperation({
          key: `xbox-sync-${xuid}`,
          labelKey: 'xbox.syncing',
        });
        const res = await fetchAPI(
          '/settings/xbox/accounts/' + xuid + `/sync?template_id=${encodeURIComponent(currentId)}`,
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
        await loadCurrentTemplate(currentId);
        runBackfill('xbox');
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.syncFailed'), 'error');
      } finally {
        setSettingsOperation(null);
      }
    };
    const handleXboxUnbind = async (xuid) => {
      if (!(await confirmAction(t('dialogs.unbindAccount')))) return;
      try {
        await fetchAPI('/settings/xbox/accounts/' + xuid, {
          method: 'DELETE',
        });
        showToast(t('account.unbound'), 'success');
        await refreshSelectedTemplate();
        loadXboxAccounts();
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.unbindFailed'), 'error');
      }
    };
    const handleXboxDeleteImages = async (xuid) => {
      if (!(await confirmAction(t('dialogs.deleteAccountImages')))) return;
      try {
        const res = await fetchAPI('/settings/xbox/accounts/' + xuid + '/images', {
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
      xboxGamertag,
      setXboxGamertag,
      xboxAccounts,
      loadXboxAccounts,
      handleXboxBind,
      handleXboxSync,
      handleXboxUnbind,
      handleXboxDeleteImages,
    };
  }
  Object.assign(window.GameTierApp, {
    useXboxAccount,
  });
})();
