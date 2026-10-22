(() => {
  'use strict';

  const { useEffect, useLayoutEffect, useRef, useState } = React;
  const { t } = window.GameTierI18n;
  const { SearchResults, LibraryGroup, getLibraryGroupName, getLibraryGroupColor, getLibraryGroupDetails, getLibraryGroupPlatform, useSearchPresentation, getIslandOrigin, ISLAND_DURATION, ISLAND_OPEN_EASING, ISLAND_CLOSE_EASING } = window.GameTierApp;
  function LibraryPanel({
    preferencesModel,
    searchModel,
    imagesModel,
    libraryModel,
    tierBoardModel,
    templatesModel,
  }) {
    const { libraryOpen, setLibraryOpen, libraryWidth, setLibraryWidth } = preferencesModel;
    const [phase, setPhase] = useState(libraryOpen ? 'open' : 'closed');
    const [draggedOverGroup, setDraggedOverGroup] = useState(null);
    const toggleRef = useRef(null);
    const panelRef = useRef(null);
    const contentRef = useRef(null);
    const searchDockRef = useRef(null);
    const animationRef = useRef(null);
    const contentAnimationRef = useRef(null);
    const previousOpenRef = useRef(libraryOpen);
    const requestedTargetRef = useRef(null);
    const cancelMotion = () => {
      if (animationRef.current) {
        animationRef.current.onfinish = null;
        animationRef.current.cancel();
        animationRef.current = null;
      }
      contentAnimationRef.current?.cancel();
      contentAnimationRef.current = null;
    };
    useEffect(() => () => cancelMotion(), []);
    useEffect(() => {
      const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      const onChange = () => {
        if (!media?.matches) return;
        cancelMotion();
        setPhase(previousOpenRef.current ? 'open' : 'closed');
      };
      media?.addEventListener?.('change', onChange);
      return () => media?.removeEventListener?.('change', onChange);
    }, []);
    useLayoutEffect(() => {
      const changed = previousOpenRef.current !== libraryOpen;
      previousOpenRef.current = libraryOpen;
      const requested = requestedTargetRef.current === libraryOpen;
      requestedTargetRef.current = null;
      const panel = panelRef.current;
      const content = contentRef.current;
      const button = toggleRef.current;
      const reversing = animationRef.current && ['running', 'pending'].includes(animationRef.current.playState);
      const current = reversing && panel ? getComputedStyle(panel) : null;
      const from = current ? { transform: current.transform, borderRadius: current.borderRadius, opacity: current.opacity } : null;
      const contentOpacity = reversing && content ? Number(getComputedStyle(content).opacity) : libraryOpen ? 0 : 1;
      cancelMotion();
      if (!changed || !requested || !panel?.animate || !content?.animate || !button ||
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        setPhase(libraryOpen ? 'open' : 'closed');
        return;
      }
      const panelRect = panel.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      if (!panelRect.width || !panelRect.height || !buttonRect.width || !buttonRect.height) {
        setPhase(libraryOpen ? 'open' : 'closed');
        return;
      }
      const origin = getIslandOrigin(panelRect, buttonRect, Number.parseFloat(getComputedStyle(button).borderRadius) || 12);
      const full = { transform: 'none', borderRadius: getComputedStyle(panel).borderRadius, opacity: 1 };
      const frames = libraryOpen ? [from || origin, full] : [from || full, origin];
      setPhase(libraryOpen ? 'opening' : 'closing');
      if (!libraryOpen && panel.contains(document.activeElement)) button.focus({ preventScroll: true });
      const easing = libraryOpen ? ISLAND_OPEN_EASING : ISLAND_CLOSE_EASING;
      const options = { duration: ISLAND_DURATION, easing, fill: 'both' };
      const animation = panel.animate(frames, options);
      animationRef.current = animation;
      contentAnimationRef.current = content.animate(libraryOpen
        ? [{ opacity: contentOpacity }, { opacity: contentOpacity, offset: 0.2 }, { opacity: 1 }]
        : [{ opacity: contentOpacity }, { opacity: 0, offset: 0.3 }, { opacity: 0 }],
      { ...options, easing: 'linear' });
      animation.onfinish = () => {
        if (animationRef.current !== animation) return;
        setPhase(libraryOpen ? 'open' : 'closed');
      };
    }, [libraryOpen, libraryWidth]);
    useLayoutEffect(() => {
      if ((phase === 'open' || phase === 'closed') && animationRef.current?.playState === 'finished') {
        cancelMotion();
      }
    }, [phase]);
    const panelVisible = libraryOpen || phase !== 'closed';
    const transitioning = phase === 'opening' || phase === 'closing' || requestedTargetRef.current === libraryOpen;
    const {
      searchQuery,
      setSearchQuery,
      handleSearch,
      searchMinimized,
      searchResults,
      searchLoading,
      searchSource,
      setSearchSource,
      handleSelectSearchResult,
      handleCloseSearchResults,
      setSearchMinimized,
    } = searchModel;
    const { fileInputRef, handleUpload, handleDeleteImage } = imagesModel;
    const {
      handleCreateGroup,
      libraryGroupsRef,
      activeGroupData,
      handleDeleteGroup,
      handleClearGroup,
      handleDropToGroup,
      handleOpenLibraryGroup,
    } = libraryModel;
    const { handleAddToUnassigned } = tierBoardModel;
    const { imagesMeta, libraryGroups } = templatesModel;
    const searchPresentation = useSearchPresentation({ data: searchResults, loading: searchLoading,
      minimized: searchMinimized, source: searchSource });
    const searchCoversGroups = !!(searchResults || searchLoading) && !searchMinimized;
    const displayedGroup = activeGroupData || libraryGroups[0] || null;
    const sourceGroups = libraryGroups.filter(group => ['default_upload', 'local_upload'].includes(group.id));
    const accountGroups = libraryGroups.filter(group => getLibraryGroupPlatform(group));
    const customGroups = libraryGroups.filter(group => !sourceGroups.includes(group) && !accountGroups.includes(group));
    useLayoutEffect(() => {
      if (libraryOpen) libraryGroupsRef.current?.querySelector('[aria-pressed="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [displayedGroup?.id, libraryWidth, libraryOpen]);
    const renderGroupNavigation = (group) => {
      const details = getLibraryGroupDetails(group);
      const selected = displayedGroup?.id === group.id;
      return (
        <button key={group.id} type="button"
          className={`library-group-nav-item ${selected ? 'selected' : ''} ${draggedOverGroup === group.id ? 'drag-over' : ''}`}
          data-library-nav-id={group.id} aria-pressed={selected} title={getLibraryGroupName(group)}
          style={{ '--group-accent': getLibraryGroupColor(group) }}
          onClick={(event) => handleOpenLibraryGroup(event, group)}
          onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setDraggedOverGroup(group.id); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDraggedOverGroup(null); }}
          onDrop={(event) => {
            event.preventDefault(); event.stopPropagation(); setDraggedOverGroup(null);
            const imageId = event.dataTransfer.getData('text/plain');
            if (imageId) handleDropToGroup(imageId, group.id);
          }}>
          <span className="library-group-nav-label">
            <i className="library-group-dot" aria-hidden="true" />
            {details.platform || details.name}
          </span>
          {details.platform && <span className="library-group-nav-account">{details.name}</span>}
          <span className="library-group-nav-count">{t('library.coverCount', { count: group.image_ids.length })}</span>
        </button>
      );
    };
    return (
      <>
        <div className="library-toggle-rail">
          <button
            ref={toggleRef}
            className={`sidebar-toggle ${libraryOpen ? 'active' : ''}`}
            onClick={() => {
              requestedTargetRef.current = !libraryOpen;
              setLibraryOpen(!libraryOpen);
            }}
            title={libraryOpen ? t('library.collapse') : t('library.expand')}
            aria-label={libraryOpen ? t('library.collapse') : t('library.expand')}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={libraryOpen ? 'M10 4L6 8L10 12' : 'M6 4L10 8L6 12'} />
            </svg>
          </button>
        </div>
        {/* Library Sidebar */}
        <div
          className={`library-panel-slot ${transitioning ? 'island-transition' : ''}`}
          style={{
            width: libraryOpen ? libraryWidth + 5 : 0,
            '--library-island-easing': libraryOpen ? ISLAND_OPEN_EASING : ISLAND_CLOSE_EASING,
          }}
        >
        <div
          ref={panelRef}
          className={`library-panel ${panelVisible ? '' : 'collapsed'} ${libraryWidth <= 240 ? 'compact' : ''} island-${phase}`}
          data-library-state={phase}
          style={{ width: libraryWidth, minWidth: libraryWidth }}
          aria-hidden={!libraryOpen || phase !== 'open'}
          inert={!libraryOpen || phase !== 'open' ? '' : undefined}
        >
          <div ref={contentRef} className="library-panel-content">
          <div className="library-header">
            <div
              className="library-search-row"
              style={{
                display: 'flex',
                gap: 6,
                marginBottom: 8,
              }}
            >
              <input
                className="input"
                style={{
                  flex: 1,
                }}
                placeholder={t('library.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <button
                className="btn btn-primary btn-sm"
                style={{
                  flexShrink: 0,
                  minWidth: '56px',
                  justifyContent: 'center',
                  padding: '4px 8px',
                }}
                onClick={handleSearch}
              >
                {t('actions.search')}
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{
                display: 'none',
              }}
              onChange={handleUpload}
            />
            <div
              className="library-upload-actions"
            >
              <div
                className="library-upload-main"
                style={{
                  flex: 1,
                  display: 'flex',
                  gap: 6,
                }}
              >
                <button
                  className="btn btn-sm"
                  style={{
                    flex: 1,
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  {t('library.upload')}
                </button>
              </div>

            </div>
            {searchPresentation.visible && <div ref={searchDockRef} className="search-panel-dock" aria-hidden="true" />}
          </div>
          <div className="library-groups-area library-workspace"
            aria-hidden={searchCoversGroups} inert={searchCoversGroups ? '' : undefined}>
            <nav className="library-navigation" aria-label={t('library.navigation')}>
              <div className="library-navigation-scroll" ref={libraryGroupsRef}>
                <div className="library-navigation-label">{t('library.resources')}</div>
                {sourceGroups.map(renderGroupNavigation)}
                {accountGroups.length > 0 && <div className="library-navigation-label library-navigation-divider">{t('library.platformAccounts')}</div>}
                {accountGroups.map(renderGroupNavigation)}
                {customGroups.length > 0 && <div className="library-navigation-label library-navigation-divider">{t('library.collections')}</div>}
                {customGroups.map(renderGroupNavigation)}
              </div>
              <div className="library-navigation-footer">
              <button
                className="btn btn-sm library-create-group library-nav-create"
                onClick={handleCreateGroup}
                title={t('library.newGroup')}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v3M2 11h20" />
                  <path d="M18 16v6m-3-3h6" />
                </svg>
                {t('library.newGroup')}
              </button>
              </div>
            </nav>
            {displayedGroup ? <LibraryGroup key={displayedGroup.id} group={displayedGroup}
              onDelete={handleDeleteGroup} onClear={handleClearGroup}
              onDropToGroup={handleDropToGroup} onDeleteImage={handleDeleteImage}
              onAddToUnassigned={handleAddToUnassigned} imagesMeta={imagesMeta} />
              : <div className="library-browser-empty"><strong>{t('library.noGroups')}</strong></div>}
          </div>
          {/* One persistent shell grows from the header dock over the groups below. */}
          <SearchResults
            data={searchPresentation.data} loading={searchPresentation.loading} activeSource={searchPresentation.source}
            onSourceChange={setSearchSource} onSelect={handleSelectSearchResult}
            onClose={handleCloseSearchResults} onMinimize={() => setSearchMinimized(true)}
            onRestore={() => setSearchMinimized(false)} hostRef={contentRef} dockRef={searchDockRef}
            minimized={searchPresentation.minimized} exiting={searchPresentation.exiting}
            onExitComplete={searchPresentation.onExitComplete}
            covered={!libraryOpen || phase !== 'open'}
          />
          </div>
        </div>

        {/* 图片库拖拽缩放手柄 */}
        {libraryOpen && phase === 'open' && (
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = libraryWidth;
              const onMove = (ev) =>
                setLibraryWidth(Math.max(180, Math.min(600, startW + ev.clientX - startX)));
              const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
              };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            }}
            style={{
              width: 5,
              position: 'absolute',
              left: libraryWidth,
              top: 0,
              bottom: 0,
              cursor: 'col-resize',
              flexShrink: 0,
              background: 'transparent',
              zIndex: 5,
            }}
          />
        )}
        </div>
      </>
    );
  }
  Object.assign(window.GameTierApp, {
    getLibraryIslandOrigin: getIslandOrigin,
    LibraryPanel,
  });
})();
