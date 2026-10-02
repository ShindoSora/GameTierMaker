(() => {
  'use strict';

  const { useEffect, useLayoutEffect, useRef, useState } = React;
  const { t } = window.GameTierI18n;
  const { SearchResults, SearchResultsMinimized, LibraryGroup, getIslandOrigin, ISLAND_DURATION, ISLAND_OPEN_EASING, ISLAND_CLOSE_EASING } = window.GameTierApp;
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
    const toggleRef = useRef(null);
    const panelRef = useRef(null);
    const contentRef = useRef(null);
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
      closingLibraryGroup,
      handleCloseLibraryGroup,
      handleLibraryGroupCloseComplete,
      activeLibraryGroup,
      handleDeleteGroup,
      handleClearGroup,
      handleDropToGroup,
      handleOpenLibraryGroup,
    } = libraryModel;
    const { handleAddToUnassigned } = tierBoardModel;
    const { imagesMeta, libraryGroups } = templatesModel;
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
              style={{
                display: 'flex',
                gap: 6,
              }}
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
              <button
                className="btn btn-sm library-create-group"
                style={{
                  flexShrink: 0,
                  width: '56px',
                  justifyContent: 'center',
                  color: 'var(--success)',
                  padding: '4px 0',
                }}
                onClick={handleCreateGroup}
                title={t('library.newGroup')}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
            {searchMinimized && (
              <SearchResultsMinimized
                data={searchResults}
                loading={searchLoading}
                onClose={handleCloseSearchResults}
                onRestore={() => setSearchMinimized(false)}
              />
            )}
          </div>
          <div className="library-groups-area">
          <div className={`library-groups-scroll ${activeGroupData ? 'covered' : ''}`} ref={libraryGroupsRef}
            style={{ opacity: activeGroupData ? 0 : 1 }}
            aria-hidden={!!activeGroupData} inert={activeGroupData ? '' : undefined}>
            {libraryGroups.map((g) => (
              <LibraryGroup
                key={g.id} group={g} images={g.image_ids} onOpen={handleOpenLibraryGroup}
                onDelete={handleDeleteGroup} onClear={handleClearGroup} onDropToGroup={handleDropToGroup}
                onDeleteImage={handleDeleteImage} onAddToUnassigned={handleAddToUnassigned} imagesMeta={imagesMeta}
              />
            ))}
          </div>
            {/* Keep covers and their scroll container mounted while minimized. */}
            <SearchResults
              data={searchResults} loading={searchLoading} activeSource={searchSource}
              onSourceChange={setSearchSource} onSelect={handleSelectSearchResult}
              onClose={handleCloseSearchResults} onMinimize={() => setSearchMinimized(true)}
              minimized={searchMinimized} covered={!!activeGroupData}
            />
            {activeGroupData && (
              <LibraryGroup
                key={`active-${activeGroupData.id}`}
                group={activeGroupData}
                images={activeGroupData.image_ids}
                expandedView
                closing={closingLibraryGroup}
                onClose={handleCloseLibraryGroup}
                onCloseComplete={handleLibraryGroupCloseComplete}
                originRect={activeLibraryGroup.originRect}
                sourceListRef={libraryGroupsRef}
                onDelete={handleDeleteGroup}
                onClear={handleClearGroup}
                onDropToGroup={handleDropToGroup}
                onDeleteImage={handleDeleteImage}
                onAddToUnassigned={handleAddToUnassigned}
                imagesMeta={imagesMeta}
              />
            )}
          </div>
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
              transition: 'background 0.15s',
              zIndex: 5,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
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
