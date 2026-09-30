(() => {
  'use strict';

  const { useState, useRef } = React;
  const { t, getErrorMessage } = window.GameTierI18n;
  const { fetchAPI, showToast } = window.GameTierApp;
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
    const [showPresetsModal, setShowPresetsModal] = useState(false);
    const [presetsList, setPresetsList] = useState([]);
    const handleDeleteGroup = async (groupId) => {
      if (!(await confirmAction(t('dialogs.deleteGroup')))) return;
      await fetchAPI(`/library/groups/${groupId}?template_id=${encodeURIComponent(currentId)}`, {
        method: 'DELETE',
      });
      if (activeLibraryGroup?.id === groupId) {
        setActiveLibraryGroup(null);
        setClosingLibraryGroup(false);
      }
      await loadCurrentTemplate(currentId);
    };
    const handleOpenLibraryGroup = (event, group) => {
      const host = libraryGroupsRef.current;
      if (!host) return;
      const hostRect = host.getBoundingClientRect();
      const groupRect = event.currentTarget.getBoundingClientRect();
      setClosingLibraryGroup(false);
      setActiveLibraryGroup({
        id: group.id,
        originX: groupRect.left - hostRect.left + groupRect.width / 2,
        originY: groupRect.top - hostRect.top + groupRect.height / 2,
      });
    };
    const handleCloseLibraryGroup = () => {
      if (activeLibraryGroup) setClosingLibraryGroup(true);
    };
    const handleLibraryGroupAnimationEnd = (event) => {
      if (closingLibraryGroup && event.animationName === 'libraryGroupClose') {
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
      if (!(await confirmAction(t('dialogs.clearGroup')))) return;
      try {
        await fetchAPI(
          `/library/groups/${groupId}/images?template_id=${encodeURIComponent(currentId)}`,
          {
            method: 'DELETE',
          }
        );
        await refreshSelectedTemplate();
        showToast(t('common.cleared'), 'success');
      } catch (e) {
        showToast(getErrorMessage(e, 'errors.clearFailed'), 'error');
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
      handleLibraryGroupAnimationEnd,
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
