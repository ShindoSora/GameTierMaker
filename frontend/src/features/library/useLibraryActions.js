(() => {
  'use strict';

  const { useState, useRef } = React;
  const { t, getErrorMessage } = window.GameTierI18n;
  const { fetchAPI, showToast, prepareGroupImagesDissolve, prepareGroupPanelDissolve } = window.GameTierApp;
  function useLibraryActions({
    confirmAction,
    currentId,
    loadCurrentTemplate,
    refreshSelectedTemplate,
    inputDialog,
    libraryGroups,
  }) {
    const [activeLibraryGroup, setActiveLibraryGroup] = useState(null);
    const [closingLibraryGroup, setClosingLibraryGroup] = useState(false);
    const libraryGroupsRef = useRef(null);
    const originElementRef = useRef(null);
    const activeGroupRef = useRef(null);
    const closingGroupRef = useRef(false);
    const [showPresetsModal, setShowPresetsModal] = useState(false);
    const [presetsList, setPresetsList] = useState([]);
    const groupOperationsRef = useRef(new Set());
    const handleDeleteGroup = async (groupId) => {
      if (groupOperationsRef.current.has(groupId)) return;
      groupOperationsRef.current.add(groupId);
      const targetTemplateId = currentId;
      let effect = null;
      try {
        if (!(await confirmAction(t('dialogs.deleteGroup')))) return;
        try { effect = await prepareGroupPanelDissolve?.(groupId); } catch (_) { /* Visual fallback. */ }
        await fetchAPI(`/library/groups/${encodeURIComponent(groupId)}?template_id=${encodeURIComponent(targetTemplateId)}`, {
          method: 'DELETE',
        });
        try { await effect?.play(); } catch (_) { /* Still refresh successful deletion. */ }
        await loadCurrentTemplate(targetTemplateId);
        if (activeGroupRef.current?.id === groupId) {
          activeGroupRef.current = null;
          closingGroupRef.current = false;
          setActiveLibraryGroup(null);
          setClosingLibraryGroup(false);
        }
      } catch (error) {
        showToast(getErrorMessage(error, 'errors.deleteFailed'), 'error');
      } finally {
        effect?.dispose();
        groupOperationsRef.current.delete(groupId);
      }
    };
    const handleOpenLibraryGroup = (event, group) => {
      const host = libraryGroupsRef.current;
      if (!host) return;
      const hostRect = host.getBoundingClientRect();
      const element = event.currentTarget.closest?.('.library-group-item') || event.currentTarget;
      const groupRect = element.getBoundingClientRect();
      originElementRef.current = element;
      closingGroupRef.current = false;
      setClosingLibraryGroup(false);
      const active = {
        id: group.id,
        originRect: {
          left: groupRect.left - hostRect.left, top: groupRect.top - hostRect.top,
          width: groupRect.width, height: groupRect.height,
          radius: Number.parseFloat(getComputedStyle(element).borderRadius) || 12,
        },
      };
      activeGroupRef.current = active;
      setActiveLibraryGroup(active);
    };
    const handleCloseLibraryGroup = () => {
      if (!activeGroupRef.current || closingGroupRef.current) return;
      const host = libraryGroupsRef.current;
      const element = originElementRef.current;
      if (host && element?.isConnected) {
        const hostRect = host.getBoundingClientRect(), rect = element.getBoundingClientRect();
        activeGroupRef.current = { ...activeGroupRef.current, originRect: {
          left: rect.left - hostRect.left, top: rect.top - hostRect.top,
          width: rect.width, height: rect.height,
          radius: Number.parseFloat(getComputedStyle(element).borderRadius) || 12,
        } };
        setActiveLibraryGroup(activeGroupRef.current);
      }
      closingGroupRef.current = true;
      setClosingLibraryGroup(true);
    };
    const handleLibraryGroupCloseComplete = (groupId) => {
      if (closingGroupRef.current && activeGroupRef.current?.id === groupId) {
        activeGroupRef.current = null;
        closingGroupRef.current = false;
        setActiveLibraryGroup(null);
        setClosingLibraryGroup(false);
      }
    };
    const handleToggleGroup = async (groupId, currentState) => {
      await fetchAPI(
        `/library/groups/${groupId}/expand?expanded=${!currentState}&template_id=${encodeURIComponent(currentId)}`,
        {
          method: 'PUT',
        }
      );
      await loadCurrentTemplate(currentId);
    };
    const handleDropToGroup = async (imageId, groupId, index = -1) => {
      try {
        await fetchAPI(`/images/move?template_id=${encodeURIComponent(currentId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            image_id: imageId,
            target_type: 'library_group',
            target_id: groupId,
            index,
          }),
        });
        await refreshSelectedTemplate();
      } catch (e) {
        console.error(e);
      }
    };
    const handleImportPreset = async () => {
      try {
        const res = await fetchAPI('/library/presets');
        const filtered = (res.presets || []).filter((p) => p.template_id !== currentId);
        setPresetsList(filtered);
        setShowPresetsModal(true);
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.presetListFailed'), 'error');
      }
    };
    const handleImportFromTemplate = async (templateId) => {
      try {
        const res = await fetchAPI(
          `/library/presets/import/${templateId}?target_template_id=${encodeURIComponent(currentId)}`,
          {
            method: 'POST',
          }
        );
        setShowPresetsModal(false);
        await refreshSelectedTemplate();
        if (res.imported > 0) {
          showToast(
            t('preset.imported', {
              count: res.imported,
            }),
            'success'
          );
        } else {
          showToast(t('preset.alreadyImported'));
        }
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.importFailed'), 'error');
      }
    };
    const handleCreateGroup = async () => {
      const name = await inputDialog({
        message: t('group.namePrompt'),
      });
      if (!name || !name.trim()) return;
      try {
        await fetchAPI(`/library/groups?template_id=${encodeURIComponent(currentId)}`, {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
          }),
        });
        await refreshSelectedTemplate();
        showToast(t('group.created'), 'success');
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.createFailed'), 'error');
      }
    };
    const handleClearGroup = async (groupId) => {
      if (groupOperationsRef.current.has(groupId)) return;
      groupOperationsRef.current.add(groupId);
      const targetTemplateId = currentId;
      let effect = null;
      try {
        if (!(await confirmAction(t('dialogs.clearGroup')))) return;
        try { effect = prepareGroupImagesDissolve?.(groupId); } catch (_) { /* Visual fallback. */ }
        await fetchAPI(
          `/library/groups/${encodeURIComponent(groupId)}/images?template_id=${encodeURIComponent(targetTemplateId)}`,
          {
            method: 'DELETE',
          }
        );
        try { await effect?.play(); } catch (_) { /* Still refresh successful clearing. */ }
        await refreshSelectedTemplate();
        showToast(t('common.cleared'), 'success');
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.clearFailed'), 'error');
      } finally {
        effect?.dispose();
        groupOperationsRef.current.delete(groupId);
      }
    };
    const activeGroupData = activeLibraryGroup
      ? libraryGroups.find((group) => group.id === activeLibraryGroup.id)
      : null;
    return {
      activeLibraryGroup,
      closingLibraryGroup,
      libraryGroupsRef,
      showPresetsModal,
      setShowPresetsModal,
      presetsList,
      handleDeleteGroup,
      handleOpenLibraryGroup,
      handleCloseLibraryGroup,
      handleLibraryGroupCloseComplete,
      handleDropToGroup,
      handleImportFromTemplate,
      handleCreateGroup,
      handleClearGroup,
      activeGroupData,
    };
  }
  Object.assign(window.GameTierApp, {
    useLibraryActions,
  });
})();
