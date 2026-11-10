(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
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
    const libraryGroupsRef = useRef(null);
    const activeGroupRef = useRef(null);
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
          setActiveLibraryGroup(null);
        }
      } catch (error) {
        showToast(getErrorMessage(error, 'errors.deleteFailed'), 'error');
      } finally {
        effect?.dispose();
        groupOperationsRef.current.delete(groupId);
      }
    };
    useEffect(() => {
      activeGroupRef.current = null;
      setActiveLibraryGroup(null);
    }, [currentId]);
    const handleOpenLibraryGroup = (_event, group) => {
      const active = { id: group.id };
      activeGroupRef.current = active;
      setActiveLibraryGroup(active);
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
        showToast(getErrorMessage(e, 'errors.requestFailed'), 'error');
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
      libraryGroupsRef,
      handleDeleteGroup,
      handleOpenLibraryGroup,
      handleDropToGroup,
      handleCreateGroup,
      handleClearGroup,
      activeGroupData,
    };
  }
  Object.assign(window.GameTierApp, {
    useLibraryActions,
  });
})();
