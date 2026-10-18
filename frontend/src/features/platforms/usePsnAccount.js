(() => {
  'use strict';

  const { useState } = React;
  const { t, getErrorMessage } = window.GameTierI18n;
  const { fetchAPI, showToast } = window.GameTierApp;
  function usePsnAccount({
    authenticate,
    psnOnlineId,
    setSettingsOperation,
    psnCategories,
    psnMinPlayDuration,
    currentId,
    setPsnOnlineId,
    loadCurrentTemplate,
    runBackfill,
    confirmAction,
    refreshSelectedTemplate,
  }) {
    const [psnAccounts, setPsnAccounts] = useState({});
    const loadPsnAccounts = async () => {
      try {
        const res = await fetchAPI('/settings/psn/accounts');
        setPsnAccounts(res.accounts || {});
      } catch (e) {
        /* ignore */
      }
    };
    const handlePsnBind = async () => {
      if (!psnOnlineId.trim()) {
        showToast(t('psn.onlineIdRequired'), 'error');
        return;
      }
      try {
        setSettingsOperation({
          key: 'psn-bind',
          labelKey: 'psn.binding',
        });
        // Save filters before opening the platform sign-in page.
        await fetchAPI('/settings/psn/filters', {
          method: 'PUT',
          body: JSON.stringify({
            categories: psnCategories,
            min_play_duration_hours: psnMinPlayDuration,
          }),
        });
        const res = await authenticate('psn', {
          account: psnOnlineId.trim(), template_id: currentId,
        });
        setPsnOnlineId('');
        showToast(
          t('psn.bindSucceeded', {
            count: res.total,
          }),
          'success'
        );
        await loadPsnAccounts();
        await refreshSelectedTemplate();
        runBackfill('psn');
      } catch (e) {
        if (e.code === 'browser_auth_cancelled') showToast(t('browser.cancelled'), '');
        else showToast(getErrorMessage(e, 'errors.bindFailed'), 'error');
      } finally {
        setSettingsOperation(null);
      }
    };
    const handlePsnSync = async (accountId) => {
      try {
        setSettingsOperation({
          key: `psn-sync-${accountId}`,
          labelKey: 'psn.syncing',
        });
        // 先保存筛选配置
        await fetchAPI('/settings/psn/filters', {
          method: 'PUT',
          body: JSON.stringify({
            categories: psnCategories,
            min_play_duration_hours: psnMinPlayDuration,
          }),
        });
        const res = await fetchAPI(
          '/settings/psn/accounts/' +
            accountId +
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
        await loadCurrentTemplate(currentId);
        runBackfill('psn');
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.syncFailed'), 'error');
      } finally {
        setSettingsOperation(null);
      }
    };
    const handlePsnUnbind = async (accountId) => {
      if (!(await confirmAction(t('dialogs.unbindAccount')))) return;
      try {
        await fetchAPI('/settings/psn/accounts/' + accountId, {
          method: 'DELETE',
        });
        showToast(t('account.unbound'), 'success');
        await refreshSelectedTemplate();
        loadPsnAccounts();
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.unbindFailed'), 'error');
      }
    };
    const handlePsnDeleteImages = async (accountId) => {
      if (!(await confirmAction(t('dialogs.deleteAccountImages')))) return;
      try {
        const res = await fetchAPI('/settings/psn/accounts/' + accountId + '/images', {
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
      psnAccounts,
      loadPsnAccounts,
      handlePsnBind,
      handlePsnSync,
      handlePsnUnbind,
      handlePsnDeleteImages,
    };
  }
  Object.assign(window.GameTierApp, {
    usePsnAccount,
  });
})();
