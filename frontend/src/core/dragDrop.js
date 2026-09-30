(() => {
  'use strict';

  const dragState = {
    imageId: null,
  };
  function calculateInsertIndex(containerEl, draggedId, imageCount) {
    if (!containerEl || imageCount === 0) return 0;
    // Exclude the dragged image from position calculation
    const items = containerEl.querySelectorAll('.drag-image:not(.dragging)');
    if (items.length === 0) return 0;
    return _findClosestSlot(items, draggedId, imageCount);
  }
  function _findClosestSlot(items, draggedId, totalCount) {
    // Uses mouse position from a synthetic event — called during dragOver
    // We need to capture the latest mouse position
    if (!_lastDragEvent) return totalCount;
    const e = _lastDragEvent;
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.hypot(mouseX - cx, mouseY - cy);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = mouseX > cx ? i + 1 : i;
      }
    }

    // If cursor is far below the last row, insert at end
    const lastItem = items[items.length - 1];
    if (lastItem) {
      const lastRect = lastItem.getBoundingClientRect();
      if (mouseY > lastRect.bottom + items[0]?.getBoundingClientRect().height * 0.5) {
        bestIdx = items.length;
      }
    }
    return Math.min(bestIdx, totalCount);
  }
  let _lastDragEvent = null;
  function storeDragEvent(e) {
    _lastDragEvent = e;
  }
  function clearDragEvent() {
    _lastDragEvent = null;
  }
  Object.assign(window.GameTierApp, {
    dragState,
    calculateInsertIndex,
    _findClosestSlot,
    storeDragEvent,
    clearDragEvent,
  });
})();
