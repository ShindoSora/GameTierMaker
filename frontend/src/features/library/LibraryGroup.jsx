(() => {
  'use strict';

  const { useState } = React;
  const { t } = window.GameTierI18n;
  const { storeDragEvent, calculateInsertIndex, dragState, clearDragEvent, DraggableImage } =
    window.GameTierApp;
  function getLibraryGroupName(group) {
    if (group.id === 'default_upload') return t('library.groups.searchResults');
    if (group.id === 'local_upload') return t('library.groups.uploadedImages');
    return group.name;
  }
  function LibraryGroup({
    group,
    images,
    onOpen,
    onClose,
    expandedView = false,
    closing = false,
    overlayStyle,
    onAnimationEnd,
    onDelete,
    onClear,
    onDropToGroup,
    onDeleteImage,
    onAddToUnassigned,
    imagesMeta,
  }) {
    const [dragOver, setDragOver] = useState(false);
    const [insertIndex, setInsertIndex] = useState(-1);
    const handleDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      storeDragEvent(e);
      setDragOver(true);
      const idx = calculateInsertIndex(e.currentTarget, dragState.imageId, group.image_ids.length);
      setInsertIndex(idx);
    };
    const handleDragLeave = (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) {
        setDragOver(false);
        setInsertIndex(-1);
      }
    };
    const handleDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Calculate index directly from drop event to avoid stale React state
      storeDragEvent(e);
      const idx = calculateInsertIndex(e.currentTarget, dragState.imageId, group.image_ids.length);
      setDragOver(false);
      setInsertIndex(-1);
      clearDragEvent();
      onDropToGroup(e.dataTransfer.getData('text/plain'), group.id, idx);
    };
    const renderWithIndicator = () => {
      const els = [];
      group.image_ids.forEach((id, idx) => {
        if (dragOver && insertIndex === idx && id !== dragState.imageId) {
          els.push(<div key={`gind-${idx}`} className="insert-indicator" />);
        }
        els.push(
          <DraggableImage
            key={id}
            imageId={id}
            onDelete={onDeleteImage}
            onAddToUnassigned={onAddToUnassigned}
            imagesMeta={imagesMeta}
          />
        );
      });
      if (dragOver && insertIndex >= group.image_ids.length) {
        els.push(<div key="gind-end" className="insert-indicator" />);
      }
      return els;
    };
    const groupTitle = getLibraryGroupName(group);
    const actionButtons = (
      <>
        {expandedView && (
          <button
            className="btn btn-icon btn-xs"
            onClick={(e) => {
              e.stopPropagation();
              onClear(group.id);
            }}
            title={t('group.clearTitle')}
            style={{
              color: 'var(--danger)',
              fontSize: 10,
            }}
          >
            {t('actions.clear')}
          </button>
        )}
        {expandedView ? (
          <button
            className="btn btn-xs btn-danger"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(group.id);
            }}
            title={t('group.deleteTitle')}
          >
            {t('group.deleteTitle')}
          </button>
        ) : null}
      </>
    );
    if (expandedView) {
      return (
        <div
          className={`library-group-overlay ${closing ? 'closing' : ''}`}
          style={overlayStyle}
          onAnimationEnd={onAnimationEnd}
          onClick={onClose}
        >
          <div className="library-group-overlay-header" onClick={(e) => e.stopPropagation()}>
            <span className="library-group-overlay-title">{groupTitle}</span>
            <span className="library-group-overlay-count">({group.image_ids.length})</span>
            {actionButtons}
            <button
              className="btn btn-icon btn-sm library-group-overlay-close"
              onClick={onClose}
              title={t('actions.close')}
              aria-label={t('actions.close')}
            >
              ×
            </button>
          </div>
          <div
            className="library-group-overlay-grid"
            onClick={(e) => e.stopPropagation()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {renderWithIndicator()}
          </div>
        </div>
      );
    }
    return (
      <div className="library-group-item">
        <div className="collapse-header" onClick={(e) => onOpen?.(e, group)}>
          <span
            style={{
              flex: 1,
            }}
          >
            {groupTitle} ({group.image_ids.length})
          </span>
        </div>
      </div>
    );
  }
  Object.assign(window.GameTierApp, {
    getLibraryGroupName,
    LibraryGroup,
  });
})();
