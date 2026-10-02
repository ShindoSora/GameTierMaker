(() => {
  'use strict';

  const { useState, useRef, useEffect, useLayoutEffect } = React;
  const { t } = window.GameTierI18n;
  const { storeDragEvent, calculateInsertIndex, dragState, clearDragEvent, DraggableImage,
    getIslandOrigin, ISLAND_DURATION, ISLAND_OPEN_EASING, ISLAND_CLOSE_EASING } =
    window.GameTierApp;
  // Colors identify the source, independent of group order or account nickname.
  const accountPlatforms = [
    { idPrefix: 'psn_import_', label: 'PS', aliases: ['PS', 'PSN', 'PlayStation'], legacy: 'PSN', color: '#00439C' },
    { idPrefix: 'xbox:', label: 'Xbox', aliases: ['Xbox'], legacy: 'Xbox', color: '#107C10' },
    { idPrefix: 'nintendo:', label: 'Nintendo', aliases: ['Nintendo'], legacy: 'Nintendo', color: '#E60012' },
    { idPrefix: 'steam_import_', label: 'Steam', aliases: ['Steam'], legacy: 'Steam', color: '#66C0F4' },
  ];
  function getLibraryGroupPlatform(group) {
    return accountPlatforms.find((platform) => group.id.startsWith(platform.idPrefix));
  }
  function getLibraryGroupColor(group) {
    if (group.id === 'default_upload') return '#A78BFA';
    if (group.id === 'local_upload') return '#F5B942';
    return getLibraryGroupPlatform(group)?.color || '#94A3B8';
  }
  function getLibraryGroupName(group) {
    if (group.id === 'default_upload') return t('library.groups.searchResults');
    if (group.id === 'local_upload') return t('library.groups.uploadedImages');
    const platform = getLibraryGroupPlatform(group);
    if (!platform) return group.name;
    const accountId = group.id.slice(platform.idPrefix.length);
    let name = (group.name || '').trim();
    const alias = platform.aliases.find((label) => name.toLowerCase().startsWith(label.toLowerCase() + ':'));
    if (alias) name = name.slice(alias.length + 1).trim();
    if (name === `${platform.legacy} ${accountId.slice(0, 8)}`) name = accountId.slice(0, 8);
    return `${platform.label}:${name || accountId.slice(0, 8)}`;
  }
  function LibraryGroup({
    group,
    images,
    onOpen,
    onClose,
    expandedView = false,
    closing = false,
    overlayStyle,
    originRect,
    sourceListRef,
    onCloseComplete,
    onDelete,
    onClear,
    onDropToGroup,
    onDeleteImage,
    onAddToUnassigned,
    imagesMeta,
  }) {
    const [dragOver, setDragOver] = useState(false);
    const [insertIndex, setInsertIndex] = useState(-1);
    const [phase, setPhase] = useState(expandedView ? 'opening' : 'card');
    const overlayRef = useRef(null);
    const contentRef = useRef(null);
    const motionRef = useRef(null);
    const contentMotionRef = useRef(null);
    const listMotionRef = useRef(null);
    const closingRef = useRef(closing);
    const completeRef = useRef(onCloseComplete);
    closingRef.current = closing;
    completeRef.current = onCloseComplete;
    const cancelMotion = () => {
      if (motionRef.current) {
        motionRef.current.onfinish = null;
        motionRef.current.cancel();
        motionRef.current = null;
      }
      contentMotionRef.current?.cancel();
      contentMotionRef.current = null;
      listMotionRef.current?.cancel();
      listMotionRef.current = null;
    };
    useEffect(() => () => cancelMotion(), []);
    useEffect(() => {
      if (!expandedView) return;
      const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      const onChange = () => {
        if (!media?.matches) return;
        cancelMotion();
        if (closingRef.current) completeRef.current?.(group.id);
        else setPhase('open');
      };
      media?.addEventListener?.('change', onChange);
      return () => media?.removeEventListener?.('change', onChange);
    }, [expandedView, group.id]);
    useLayoutEffect(() => {
      if (!expandedView) return;
      const overlay = overlayRef.current, content = contentRef.current;
      const moving = motionRef.current && ['running', 'pending'].includes(motionRef.current.playState);
      const current = moving && overlay ? getComputedStyle(overlay) : null;
      const from = current ? { transform: current.transform, borderRadius: current.borderRadius, opacity: 1 } : null;
      const contentOpacity = moving && content ? Number(getComputedStyle(content).opacity) : closing ? 1 : 0;
      const list = sourceListRef?.current;
      const listOpacity = moving && list ? Number(getComputedStyle(list).opacity) : closing ? 0 : 1;
      cancelMotion();
      if (!overlay?.animate || !content?.animate || !originRect ||
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        setPhase(closing ? 'closed' : 'open');
        if (closing) completeRef.current?.(group.id);
        return;
      }
      const fullRect = overlay.getBoundingClientRect();
      const hostRect = overlay.parentElement.getBoundingClientRect();
      const target = { left: hostRect.left + originRect.left, top: hostRect.top + originRect.top,
        width: originRect.width, height: originRect.height };
      const origin = getIslandOrigin(fullRect, target, originRect.radius || 12);
      const full = { transform: 'none', borderRadius: getComputedStyle(overlay).borderRadius, opacity: 1 };
      const options = { duration: ISLAND_DURATION, easing: closing ? ISLAND_CLOSE_EASING : ISLAND_OPEN_EASING, fill: 'both' };
      setPhase(closing ? 'closing' : 'opening');
      const motion = overlay.animate(closing
        ? [from || full, { opacity: 1, offset: 0.8 }, { ...origin, opacity: 0 }]
        : [from || origin, full], options);
      motionRef.current = motion;
      contentMotionRef.current = content.animate(closing
        ? [{ opacity: contentOpacity }, { opacity: 0, offset: 0.3 }, { opacity: 0 }]
        : [{ opacity: contentOpacity }, { opacity: contentOpacity, offset: 0.2 }, { opacity: 1 }],
      { ...options, easing: 'linear' });
      if (list?.animate) {
        listMotionRef.current = list.animate(closing
          ? [{ opacity: listOpacity }, { opacity: listOpacity, offset: 0.55 }, { opacity: 1 }]
          : [{ opacity: listOpacity }, { opacity: 0, offset: 0.25 }, { opacity: 0 }],
        { ...options, easing: 'linear' });
      }
      motion.onfinish = () => {
        if (motionRef.current !== motion) return;
        setPhase(closing ? 'closed' : 'open');
        if (closing) completeRef.current?.(group.id);
      };
    }, [expandedView, closing, originRect]);
    useLayoutEffect(() => {
      if (phase === 'open' && motionRef.current?.playState === 'finished') cancelMotion();
    }, [phase]);
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
          ref={overlayRef}
          className={`library-group-overlay group-island-overlay ${closing ? 'closing' : ''}`}
          data-group-state={phase}
          data-library-group-id={group.id}
          style={{ '--group-accent': getLibraryGroupColor(group), ...overlayStyle }}
          onClick={onClose}
        >
          <div ref={contentRef} className="library-group-overlay-content">
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
        </div>
      );
    }
    return (
      <div className="library-group-item" data-library-group-id={group.id} style={{ '--group-accent': getLibraryGroupColor(group) }}>
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
    getLibraryGroupColor,
    LibraryGroup,
  });
})();
