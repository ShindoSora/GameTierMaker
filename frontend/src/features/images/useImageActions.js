(() => {
  'use strict';

  const { useRef, useState } = React;
  const { t, getErrorMessage } = window.GameTierI18n;
  const {
    fetchAPI,
    showToast,
    MAX_UPLOAD_BYTES,
    calculateTierExportWidth,
    createTierExportElement,
    canvasToPngBlob,
    buildExportFilename,
    startBrowserDownload,
  } = window.GameTierApp;
  function useImageActions({
    confirmAction,
    currentId,
    refreshSelectedTemplate,
    loadCurrentTemplate,
    setLoading,
    templateName,
    downloadSettings,
    loadDownloadSettings,
  }) {
    const fileInputRef = useRef(null);
    const exportingRef = useRef(false);
    const [exporting, setExporting] = useState(false);
    const handleDeleteImage = async (imageId, isGlobal) => {
      const msg = isGlobal
        ? t('dialogs.deleteImageGlobally')
        : t('dialogs.removeImageFromTemplate');
      if (!(await confirmAction(msg))) return;
      await fetchAPI(
        `/images/${imageId}?is_global=${isGlobal}&template_id=${encodeURIComponent(currentId)}`,
        {
          method: 'DELETE',
        }
      );
      if (isGlobal) await refreshSelectedTemplate();
      else await loadCurrentTemplate(currentId);
    };
    const handleUpload = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const operationTemplateId = currentId;
      if (!operationTemplateId) {
        showToast(t('errors.template_not_found'), 'error');
        e.target.value = '';
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        showToast(t('errors.upload_too_large'), 'error');
        e.target.value = '';
        return;
      }
      const formData = new FormData();
      formData.append('file', file);
      try {
        setLoading(true);
        const templateQuery = `?template_id=${encodeURIComponent(operationTemplateId)}`;
        await fetchAPI(`/images/upload${templateQuery}`, {
          method: 'POST',
          body: formData,
        });
        await loadCurrentTemplate(operationTemplateId);
        showToast(t('library.uploadSucceeded'), 'success');
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.uploadFailed'), 'error');
      } finally {
        setLoading(false);
        e.target.value = '';
      }
    };
    const handleExport = async () => {
      if (exportingRef.current) return;
      const source = document.getElementById('tier-list-area');
      if (!source || !source.querySelector('.tier-row-container')) {
        showToast(t('export.nothingToExport'), 'error');
        return;
      }
      if (typeof html2canvas === 'undefined') {
        showToast(t('export.rendererUnavailable'), 'error');
        return;
      }
      exportingRef.current = true;
      setExporting(true);
      setLoading(true);
      let exportArea = null;
      try {
        const exportWidth = calculateTierExportWidth(source);
        exportArea = createTierExportElement(source, exportWidth);
        if (!exportArea) throw new Error('nothing_to_export');
        const canvas = await html2canvas(exportArea, {
          backgroundColor: '#1e1e1e',
          scale: 2,
          useCORS: true,
          allowTaint: true,
          width: exportWidth,
          windowWidth: exportWidth,
        });
        const blob = await canvasToPngBlob(canvas);
        const filename = buildExportFilename(templateName || currentId);
        const currentDownloadSettings = downloadSettings || (await loadDownloadSettings());
        if (currentDownloadSettings?.runtime_mode === 'desktop') {
          const formData = new FormData();
          formData.append('file', blob, filename);
          formData.append('filename', filename);
          const result = await fetchAPI('/exports/tier-list', {
            method: 'POST',
            body: formData,
          });
          showToast({
            message: t(result.fallback_used ? 'export.savedWithFallback' : 'export.saved'),
            detail: result.saved_path || '',
            type: 'success',
          });
        } else {
          startBrowserDownload(blob, filename);
          showToast(t('export.downloadStarted'), 'success');
        }
      } catch (e) {
        showToast(getErrorMessage(e, 'export.failed'), 'error');
      } finally {
        exportArea?.remove();
        exportingRef.current = false;
        setExporting(false);
        setLoading(false);
      }
    };
    return {
      fileInputRef,
      exporting,
      handleDeleteImage,
      handleUpload,
      handleExport,
    };
  }
  Object.assign(window.GameTierApp, {
    useImageActions,
  });
})();
