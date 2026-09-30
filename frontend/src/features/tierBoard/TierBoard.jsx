(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const { TierRow, storeDragEvent, calculateInsertIndex, dragState, DraggableImage } =
    window.GameTierApp;
  function TierBoard({ templatesModel, tierBoardModel, imagesModel }) {
    const { tiers, imagesMeta, unassigned } = templatesModel;
    const {
      handleDropToTier,
      handleRenameTier,
      handleColorTier,
      handleDeleteTier,
      handleAddToUnassigned,
      handleRowReorder,
      handleTierContextMenu,
      unassignedDragOver,
      setUnassignedDragOver,
      setUnassignedInsertIdx,
      handleDropToUnassigned,
      unassignedInsertIdx,
    } = tierBoardModel;
    const { handleDeleteImage } = imagesModel;
    return (
      <div id="tier-list-area" className="tier-list-area">
        {tiers.map((tier, i) => (
          <TierRow
            key={tier.id}
            tier={tier}
            images={tier.image_ids}
            index={i}
            onDrop={handleDropToTier}
            onRename={handleRenameTier}
            onColor={handleColorTier}
            onDeleteTier={handleDeleteTier}
            onDeleteImage={handleDeleteImage}
            onAddToUnassigned={handleAddToUnassigned}
            onRowReorder={handleRowReorder}
            onContextMenu={handleTierContextMenu}
            imagesMeta={imagesMeta}
          />
        ))}

        {/* Unassigned */}
        <div className="unsorted-section">
          <div className="unsorted-header">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            {t('unassigned.title')}
            <span className="unsorted-count">{unassigned.length}</span>
          </div>
          <div
            className={`unsorted-drop-zone ${unassignedDragOver ? 'drag-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              storeDragEvent(e);
              setUnassignedDragOver(true);
              const idx = calculateInsertIndex(
                e.currentTarget,
                dragState.imageId,
                unassigned.length
              );
              setUnassignedInsertIdx(idx);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) {
                setUnassignedDragOver(false);
                setUnassignedInsertIdx(-1);
              }
            }}
            onDrop={(e) => {
              // Calculate index directly from drop event to avoid stale state
              storeDragEvent(e);
              const idx = calculateInsertIndex(
                e.currentTarget,
                dragState.imageId,
                unassigned.length
              );
              handleDropToUnassigned(e, idx);
            }}
          >
            {unassigned.length === 0 ? (
              <div className="unsorted-empty">
                <strong>{t('unassigned.emptyState')}</strong>
                <span>{t('unassigned.empty')}</span>
              </div>
            ) : (
              (() => {
                const els = [];
                unassigned.forEach((id, idx) => {
                  if (
                    unassignedDragOver &&
                    unassignedInsertIdx === idx &&
                    id !== dragState.imageId
                  ) {
                    els.push(<div key={`uind-${idx}`} className="insert-indicator" />);
                  }
                  els.push(
                    <DraggableImage
                      key={id}
                      imageId={id}
                      onDelete={handleDeleteImage}
                      onAddToUnassigned={handleAddToUnassigned}
                      imagesMeta={imagesMeta}
                    />
                  );
                });
                if (unassignedDragOver && unassignedInsertIdx >= unassigned.length) {
                  els.push(<div key="uind-end" className="insert-indicator" />);
                }
                return els;
              })()
            )}
          </div>
        </div>
      </div>
    );
  }
  Object.assign(window.GameTierApp, {
    TierBoard,
  });
})();
