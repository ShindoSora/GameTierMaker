(() => {
  'use strict';

  const { useState, useRef, useEffect, useLayoutEffect } = React;
  const { t } = window.GameTierI18n;
  const { storeDragEvent, calculateInsertIndex, dragState, clearDragEvent, DraggableImage,
    getIslandOrigin } =
    window.GameTierApp;
  const GROUP_OPEN_DURATION = 320;
  const GROUP_CLOSE_DURATION = 220;
  const GROUP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
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
    if (group.id === 'default_upload') return t('library.groups.downloadedImages');
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
    const surfaceRef = useRef(null);
    const contentRef = useRef(null);
    const headerRef = useRef(null);
    const titleRef = useRef(null);
    const gridRef = useRef(null);
    const actionsRef = useRef(null);
    const motionRef = useRef(null);
    const motionsRef = useRef([]);
    const closingRef = useRef(closing);
    const completeRef = useRef(onCloseComplete);
    closingRef.current = closing;
    completeRef.current = onCloseComplete;
    const cancelMotion = () => {
      motionsRef.current.forEach((motion) => {
        motion.onfinish = null;
        motion.cancel();
      });
      motionsRef.current = [];
      motionRef.current = null;
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
      const overlay = overlayRef.current, surface = surfaceRef.current, content = contentRef.current;
      const header = headerRef.current, title = titleRef.current, grid = gridRef.current, actions = actionsRef.current;
      const moving = motionRef.current && ['running', 'pending'].includes(motionRef.current.playState);
      // Sample before cancelling so a close during opening continues from the visible frame.
      const sample = (element, properties) => {
        if (!moving || !element) return null;
        const style = getComputedStyle(element);
        return Object.fromEntries(properties.map((property) => [property, style[property]]));
      };
      const fromSurface = sample(surface, ['transform', 'borderRadius']);
      const fromContent = sample(content, ['clipPath']);
      const fromHeader = sample(header, ['transform']);
      const fromTitle = sample(title, ['fontSize']);
      const fromGrid = sample(grid, ['opacity', 'transform']);
      const fromActions = sample(actions, ['opacity']);
      const list = sourceListRef?.current;
      const listOpacity = moving && list ? Number(getComputedStyle(list).opacity) : closing ? 0 : 1;
      cancelMotion();
      if (!surface?.animate || !content?.animate || !header || !title || !grid || !actions || !originRect ||
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
      const full = { transform: 'none', borderRadius: getComputedStyle(surface).borderRadius, opacity: 1 };
      const contentRect = content.getBoundingClientRect(), headerRect = header.getBoundingClientRect();
      const contentRadius = Number.parseFloat(getComputedStyle(content).borderRadius) || 0;
      const foldedClip = { clipPath: `inset(${target.top - contentRect.top}px ${contentRect.right - target.left - target.width}px ${contentRect.bottom - target.top - target.height}px ${target.left - contentRect.left}px round ${originRect.radius || 12}px)` };
      const openClip = { clipPath: `inset(0px 0px 0px 0px round ${contentRadius}px)` };
      const foldedHeader = { transform: `translate(${target.left - headerRect.left + 4}px, ${target.top - headerRect.top + (target.height - headerRect.height) / 2}px)` };
      const openHeader = { transform: 'translate(0px, 0px)' };
      const foldedTitle = { fontSize: '12px' }, openTitle = { fontSize: getComputedStyle(title).fontSize };
      const hiddenGrid = { opacity: 0, transform: 'translateY(6px)' };
      const visibleGrid = { opacity: 1, transform: 'translateY(0px)' };
      const options = { duration: closing ? GROUP_CLOSE_DURATION : GROUP_OPEN_DURATION, easing: GROUP_EASING, fill: 'both' };
      const animate = (element, frames, timing = {}) => {
        const motion = element.animate(frames, { ...options, ...timing });
        motionsRef.current.push(motion);
        return motion;
      };
      setPhase(closing ? 'closing' : 'opening');
      // Only the empty shell scales. Text and covers retain their own proportions.
      const motion = animate(surface, closing ? [fromSurface || full, origin] : [fromSurface || origin, full]);
      motionRef.current = motion;
      animate(content, closing ? [fromContent || openClip, foldedClip] : [fromContent || foldedClip, openClip]);
      animate(header, closing ? [fromHeader || openHeader, foldedHeader] : [fromHeader || foldedHeader, openHeader]);
      animate(title, closing ? [fromTitle || openTitle, foldedTitle] : [fromTitle || foldedTitle, openTitle]);
      animate(grid, closing ? [fromGrid || visibleGrid, hiddenGrid] : [fromGrid || hiddenGrid, visibleGrid],
        { duration: closing ? 90 : 150, delay: closing || moving ? 0 : 100 });
      animate(actions, closing ? [fromActions || { opacity: 1 }, { opacity: 0 }] : [fromActions || { opacity: 0 }, { opacity: 1 }],
        { duration: closing ? 70 : 120, delay: closing || moving ? 0 : 100, easing: 'linear' });
      if (list?.animate) {
        animate(list, [{ opacity: listOpacity }, { opacity: closing ? 1 : 0 }],
          { duration: closing ? 140 : 80, delay: closing ? 80 : 0, easing: 'linear' });
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
          <div ref={surfaceRef} className="library-group-overlay-surface" aria-hidden="true" />
          <div ref={contentRef} className="library-group-overlay-content">
          <div ref={headerRef} className="library-group-overlay-header" onClick={(e) => e.stopPropagation()}>
            <span ref={titleRef} className="library-group-overlay-title">{groupTitle}</span>
            <span className="library-group-overlay-count">({group.image_ids.length})</span>
            <div ref={actionsRef} className="library-group-overlay-actions">
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
          </div>
          <div
            ref={gridRef}
            className="library-group-overlay-grid"
            inert={phase !== 'open' ? '' : undefined}
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
