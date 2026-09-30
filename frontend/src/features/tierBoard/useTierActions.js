(() => {
  'use strict';

  const { useState, useEffect } = React;
  const { t } = window.GameTierI18n;
  const { fetchAPI, clearDragEvent, showToast } = window.GameTierApp;
  function useTierActions({ currentId, loadCurrentTemplate, confirmAction }) {
    const [unassignedDragOver, setUnassignedDragOver] = useState(false);
    const [unassignedInsertIdx, setUnassignedInsertIdx] = useState(-1);
    const [tierContextMenu, setTierContextMenu] = useState(null);
    useEffect(() => {
      if (!tierContextMenu) return;
      const close = () => setTierContextMenu(null);
      document.addEventListener('click', close);
      return () => document.removeEventListener('click', close);
    }, [tierContextMenu]);
    const handleAddTier = async () => {
      await fetchAPI(`/templates/current/tiers?template_id=${encodeURIComponent(currentId)}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await loadCurrentTemplate(currentId);
    };
    const handleRenameTier = async (tierId, newName) => {
      await fetchAPI(
        `/templates/current/tiers/${tierId}/rename?template_id=${encodeURIComponent(currentId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            new_name: newName,
          }),
        }
      );
      await loadCurrentTemplate(currentId);
    };
    const [colorPicker, setColorPicker] = useState(null);
    const PRESET_COLORS = [
      '#FF7F7F',
      '#FFBF7F',
      '#FFFF7F',
      '#BFFF7F',
      '#7FFF7F',
      '#7FFFB2',
      '#7FFFFF',
      '#7FBFFF',
      '#7F7FFF',
      '#BF7FFF',
      '#FF7FFF',
      '#FF7FBF',
      '#E74C3C',
      '#E67E22',
      '#F1C40F',
      '#2ECC71',
      '#1ABC9C',
      '#3498DB',
      '#9B59B6',
      '#E91E63',
      '#FF5722',
      '#795548',
      '#607D8B',
      '#95A5A6',
    ];
    const handleColorTier = (tierId, tierLabel) => {
      setColorPicker({
        show: true,
        tierId,
        tierLabel,
        color: '',
      });
      setTierContextMenu(null);
    };
    const applyTierColor = async () => {
      if (!colorPicker || !colorPicker.color) return;
      await fetchAPI(
        `/templates/current/tiers/${colorPicker.tierId}/color?template_id=${encodeURIComponent(currentId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            color: colorPicker.color,
          }),
        }
      );
      setColorPicker(null);
      await loadCurrentTemplate(currentId);
    };
    const handleDeleteTier = async (tierId) => {
      if (!(await confirmAction(t('dialogs.deleteTier')))) return;
      await fetchAPI(
        `/templates/current/tiers/${tierId}?template_id=${encodeURIComponent(currentId)}`,
        {
          method: 'DELETE',
        }
      );
      await loadCurrentTemplate(currentId);
    };
    const handleRowReorder = async (fromIdx, toIdx) => {
      await fetchAPI(
        `/templates/current/tiers/reorder?template_id=${encodeURIComponent(currentId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            from_index: fromIdx,
            to_index: toIdx,
          }),
        }
      );
      await loadCurrentTemplate(currentId);
    };
    const handleTierContextMenu = (e, tier) => {
      setTierContextMenu({
        x: e.clientX,
        y: e.clientY,
        tierId: tier.id,
        tierLabel: tier.label,
      });
    };
    const handleDropToTier = async (imageId, targetTierId, index = -1) => {
      try {
        await fetchAPI(`/images/move?template_id=${encodeURIComponent(currentId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            image_id: imageId,
            target_type: 'tier',
            target_id: targetTierId,
            index,
          }),
        });
        await loadCurrentTemplate(currentId);
      } catch (e) {
        console.error(e);
      }
    };
    const handleDropToUnassigned = async (e, index = -1) => {
      e.preventDefault();
      setUnassignedDragOver(false);
      setUnassignedInsertIdx(-1);
      clearDragEvent();
      const imageId = e.dataTransfer.getData('text/plain');
      if (imageId) {
        try {
          await fetchAPI(`/images/move?template_id=${encodeURIComponent(currentId)}`, {
            method: 'PUT',
            body: JSON.stringify({
              image_id: imageId,
              target_type: 'unassigned',
              index,
            }),
          });
          await loadCurrentTemplate(currentId);
        } catch (err) {
          console.error(err);
        }
      }
    };
    const handleAddToUnassigned = async (imageId) => {
      try {
        await fetchAPI(`/images/move?template_id=${encodeURIComponent(currentId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            image_id: imageId,
            target_type: 'unassigned',
          }),
        });
        await loadCurrentTemplate(currentId);
        showToast(t('image.addedToUnassigned'), 'success');
      } catch (e) {
        console.error(e);
      }
    };
    return {
      unassignedDragOver,
      setUnassignedDragOver,
      unassignedInsertIdx,
      setUnassignedInsertIdx,
      tierContextMenu,
      setTierContextMenu,
      handleAddTier,
      handleRenameTier,
      colorPicker,
      setColorPicker,
      PRESET_COLORS,
      handleColorTier,
      applyTierColor,
      handleDeleteTier,
      handleRowReorder,
      handleTierContextMenu,
      handleDropToTier,
      handleDropToUnassigned,
      handleAddToUnassigned,
    };
  }
  Object.assign(window.GameTierApp, {
    useTierActions,
  });
})();
