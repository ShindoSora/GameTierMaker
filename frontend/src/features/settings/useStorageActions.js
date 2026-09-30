(() => {
  'use strict';

  const { t, getErrorMessage } = window.GameTierI18n;
  const { fetchAPI, showToast } = window.GameTierApp;
  function useStorageActions({ confirmAction, setLoading, loadCurrentTemplate, currentId }) {
    const handleClearSource = async (source) => {
      if (
        source &&
        !(await confirmAction(
          t('dialogs.clearSourceCache', {
            source: t(`sources.${source}`),
          })
        ))
      )
        return;
      if (!source && !(await confirmAction(t('dialogs.clearAllSourceCaches')))) return;
      try {
        const res = await fetchAPI('/settings/clear_cache', {
          method: 'POST',
          body: JSON.stringify({
            source,
          }),
        });
        showToast(
          t('storage.cacheCleared', {
            source: t(`sources.${res.source}`),
            count: res.deleted,
          }),
          'success'
        );
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.clearFailed'), 'error');
      }
    };
    const handleResetAllImages = async () => {
      if (!(await confirmAction(t('dialogs.resetAllImages')))) return;
      try {
        setLoading(true);
        const res = await fetchAPI('/settings/reset_all_images', {
          method: 'POST',
        });
        showToast(
          t('storage.projectImagesReset', {
            count: res.deleted,
          }),
          'success'
        );
        await loadCurrentTemplate(currentId);
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.clearFailed'), 'error');
      } finally {
        setLoading(false);
      }
    };
    return {
      handleClearSource,
      handleResetAllImages,
    };
  }
  Object.assign(window.GameTierApp, {
    useStorageActions,
  });
})();
