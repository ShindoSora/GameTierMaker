(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
  const {
    storeDragEvent,
    calculateInsertIndex,
    dragState,
    clearDragEvent,
    DraggableImage,
    GlowCard,
  } = window.GameTierApp;
  function getTierTheme(color) {
    const match = String(color || '').trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    let hex = match ? match[1] : '808080';
    if (hex.length === 3) hex = [...hex].map((value) => value + value).join('');
    const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    const rgba = (alpha) => `rgba(${channels.join(', ')}, ${alpha})`;
    const labelChannels = channels.map((value) => Math.round(value * 0.88 + 255 * 0.12));
    const luminance = labelChannels.map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
    // Explicit RGB colors also work in the PNG renderer, unlike CSS color-mix().
    return {
      '--tier-color': `#${hex}`,
      '--tier-tint': rgba(0.12),
      '--tier-faint-tint': rgba(0.025),
      '--tier-border': rgba(0.5),
      '--tier-divider': rgba(0.18),
      '--tier-drag-tint': rgba(0.16),
      '--tier-glow': rgba(0.2),
      '--tier-label-background': `rgb(${labelChannels.join(', ')})`,
      '--tier-label-text': luminance > 0.179 ? '#171722' : '#ffffff',
    };
  }
  function TierHeader({
    tier,
    onRename,
    onColor,
    onDelete,
    onDragStart,
    onDragEnd,
    onContextMenu,
  }) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(tier.label);
    const inputRef = useRef(null);
    useEffect(() => {
      if (editing) inputRef.current?.focus();
    }, [editing]);
    const finishEdit = () => {
      setEditing(false);
      if (name.trim() && name !== tier.label) onRename(tier.id, name.trim());
    };
    const fontSize = tier.label.length < 3 ? 26 : tier.label.length < 6 ? 18 : 14;
    return (
      <>
        <div
          className="tier-header"
          style={{
            cursor: 'grab',
          }}
          draggable={true}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={() => setEditing(true)}
          onContextMenu={(e) => {
            e.preventDefault();
            onContextMenu(e, tier);
          }}
        >
          {editing ? (
            <input
              ref={inputRef}
              className="tier-header-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={finishEdit}
              onKeyDown={(e) => e.key === 'Enter' && finishEdit()}
              style={{
                width: '100%',
                textAlign: 'center',
                background: 'rgba(255,255,255,0.85)',
                border: 'none',
                borderRadius: 4,
                fontSize,
                fontWeight: 'bold',
                padding: 4,
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="tier-header-label"
              style={{
                fontSize,
              }}
            >
              {tier.label}
            </span>
          )}
        </div>
      </>
    );
  }
  function TierRow({
    tier,
    images,
    onDrop,
    onRename,
    onColor,
    onDeleteTier,
    onDeleteImage,
    onAddToUnassigned,
    imagesMeta,
    index,
    onRowReorder,
    onContextMenu,
  }) {
    const [dragOver, setDragOver] = useState(false);
    const [insertIndex, setInsertIndex] = useState(-1);
    const [rowDragOver, setRowDragOver] = useState(false);
    const [rowDropBefore, setRowDropBefore] = useState(false);
    const containerRef = useRef(null);

    // === 图片拖入 ===
    const handleDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      storeDragEvent(e);
      setDragOver(true);
      const idx = calculateInsertIndex(containerRef.current, dragState.imageId, images.length);
      setInsertIndex(idx);
    };
    const handleDragLeave = (e) => {
      if (!containerRef.current?.contains(e.relatedTarget)) {
        setDragOver(false);
        setInsertIndex(-1);
      }
    };
    const handleDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      storeDragEvent(e);
      const idx = calculateInsertIndex(containerRef.current, dragState.imageId, images.length);
      setDragOver(false);
      setInsertIndex(-1);
      clearDragEvent();
      const imageId = e.dataTransfer.getData('text/plain');
      if (imageId) onDrop(imageId, tier.id, idx);
    };

    // Render images with insertion indicator at the calculated position
    const renderWithIndicator = () => {
      const elements = [];
      images.forEach((id, idx) => {
        if (dragOver && insertIndex === idx && id !== dragState.imageId) {
          elements.push(<div key={`ind-${idx}`} className="insert-indicator" />);
        }
        elements.push(
          <DraggableImage
            key={id}
            imageId={id}
            onDelete={onDeleteImage}
            onAddToUnassigned={onAddToUnassigned}
            imagesMeta={imagesMeta}
          />
        );
      });
      // Indicator at the end
      if (dragOver && insertIndex >= images.length) {
        elements.push(<div key="ind-end" className="insert-indicator" />);
      }
      return elements;
    };

    // === 等级行拖动排序 ===
    const handleRowDragStart = (e) => {
      e.dataTransfer.setData('text/row-index', String(index));
      e.dataTransfer.effectAllowed = 'move';
      e.currentTarget.closest('.tier-row-container')?.classList.add('row-dragging');
    };
    const handleRowDragEnd = (e) => {
      e.currentTarget.closest('.tier-row-container')?.classList.remove('row-dragging');
      setRowDragOver(false);
    };
    const handleRowDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.dataTransfer.types.includes('text/row-index')) return;
      e.dataTransfer.dropEffect = 'move';
      const rect = e.currentTarget.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      setRowDropBefore(e.clientY < midY);
      setRowDragOver(true);
    };
    const handleRowDragLeave = (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) {
        setRowDragOver(false);
      }
    };
    const handleRowDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setRowDragOver(false);
      const fromIdx = parseInt(e.dataTransfer.getData('text/row-index'));
      if (isNaN(fromIdx) || fromIdx === index) return;
      const dropBefore =
        e.clientY <
        e.currentTarget.getBoundingClientRect().top +
          e.currentTarget.getBoundingClientRect().height / 2;
      const toIdx =
        fromIdx < index ? (dropBefore ? index - 1 : index) : dropBefore ? index : index + 1;
      if (toIdx !== fromIdx) onRowReorder(fromIdx, toIdx);
    };
    return (
      <GlowCard
        className={`tier-row-container ${dragOver ? 'image-drag-over' : ''}`}
        style={{
          ...getTierTheme(tier.color),
          borderTop: rowDragOver && rowDropBefore ? '2px solid var(--tier-color)' : undefined,
          borderBottom: rowDragOver && !rowDropBefore ? '2px solid var(--tier-color)' : undefined,
          opacity: rowDragOver && rowDropBefore ? 0.85 : 1,
        }}
        onDragOver={handleRowDragOver}
        onDragLeave={handleRowDragLeave}
        onDrop={handleRowDrop}
      >
        <div className="tier-row">
          <TierHeader
            tier={tier}
            onRename={onRename}
            onColor={onColor}
            onDelete={onDeleteTier}
            onDragStart={handleRowDragStart}
            onDragEnd={handleRowDragEnd}
            onContextMenu={onContextMenu}
          />
          <div
            ref={containerRef}
            className={`tier-images ${dragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {renderWithIndicator()}
          </div>
        </div>
      </GlowCard>
    );
  }
  Object.assign(window.GameTierApp, {
    getTierTheme,
    TierHeader,
    TierRow,
  });
})();
