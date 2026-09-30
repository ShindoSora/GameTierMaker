(() => {
  'use strict';

  const { useState } = React;
  const { t, getErrorMessage } = window.GameTierI18n;
  const { fetchAPI, showToast } = window.GameTierApp;
  function useDownloadSettings() {
    const [downloadSettings, setDownloadSettings] = useState(null);
    const [downloadDirectory, setDownloadDirectory] = useState('');
    const [downloadSaving, setDownloadSaving] = useState(false);
    const [downloadSelecting, setDownloadSelecting] = useState(false);
    const loadDownloadSettings = async () => {
      try {
        const result = await fetchAPI('/settings/download');
        setDownloadSettings(result);
        setDownloadDirectory(result?.configured_directory || '');
        return result;
      } catch (error) {
        let runtimeMode = window.pywebview?.api ? 'desktop' : 'browser';
        try {
          const health = await fetchAPI('/health');
          runtimeMode = health?.runtime_mode === 'desktop' ? 'desktop' : 'browser';
        } catch (healthError) {
          // Keep the best local hint when the backend is unavailable.
        }
        const fallback = {
          runtime_mode: runtimeMode,
          managed_by: runtimeMode === 'desktop' ? 'application' : 'browser',
        };
        setDownloadSettings(fallback);
        return fallback;
      }
    };
    const handleSaveDownloadDirectory = async (directory) => {
      setDownloadSaving(true);
      try {
        const result = await fetchAPI('/settings/download', {
          method: 'PUT',
          body: JSON.stringify({
            directory,
          }),
        });
        setDownloadSettings(result);
        setDownloadDirectory(result.configured_directory || '');
        showToast(t(directory.trim() ? 'download.saved' : 'download.defaultRestored'), 'success');
      } catch (error) {
        showToast(getErrorMessage(error, 'download.saveFailed'), 'error');
      } finally {
        setDownloadSaving(false);
      }
    };
    const handleChooseDownloadDirectory = async () => {
      if (!window.pywebview?.api?.choose_download_directory) {
        showToast(t('download.chooserUnavailable'), 'error');
        return;
      }
      setDownloadSelecting(true);
      try {
        const result = await window.pywebview.api.choose_download_directory(
          downloadDirectory || downloadSettings?.effective_directory || ''
        );
        if (!result?.ok) {
          showToast(t('download.chooserFailed'), 'error');
        } else if (result.path) {
          setDownloadDirectory(result.path);
        }
      } catch (error) {
        showToast(t('download.chooserFailed'), 'error');
      } finally {
        setDownloadSelecting(false);
      }
    };
    return {
      downloadSettings,
      downloadDirectory,
      setDownloadDirectory,
      downloadSaving,
      downloadSelecting,
      loadDownloadSettings,
      handleSaveDownloadDirectory,
      handleChooseDownloadDirectory,
    };
  }
  Object.assign(window.GameTierApp, {
    useDownloadSettings,
  });
})();
