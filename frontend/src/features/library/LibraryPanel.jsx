(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const { SearchResults, LibraryGroup } = window.GameTierApp;
  function LibraryPanel({
    preferencesModel,
    searchModel,
    imagesModel,
    libraryModel,
    tierBoardModel,
    templatesModel,
  }) {
    const { libraryOpen, setLibraryOpen, libraryWidth, setLibraryWidth } = preferencesModel;
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
      handleLibraryGroupAnimationEnd,
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
            className={`sidebar-toggle ${libraryOpen ? 'active' : ''}`}
            onClick={() => setLibraryOpen(!libraryOpen)}
            title={libraryOpen ? t('library.collapse') : t('library.expand')}
            aria-label={libraryOpen ? t('library.collapse') : t('library.expand')}
          >
            {libraryOpen ? '◀' : '▶'}
          </button>
        </div>
        {/* Library Sidebar */}
        <div
          className={`library-panel ${libraryOpen ? '' : 'collapsed'} ${libraryOpen && libraryWidth <= 240 ? 'compact' : ''}`}
          style={
            libraryOpen
              ? {
                  width: libraryWidth,
                  minWidth: libraryWidth,
                }
              : {}
          }
        >
          <div
            style={{
              padding: 10,
              borderBottom: '1px solid var(--border)',
            }}
          >
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
              <SearchResults
                data={searchResults}
                loading={searchLoading}
                activeSource={searchSource}
                onSourceChange={setSearchSource}
                onSelect={handleSelectSearchResult}
                onClose={handleCloseSearchResults}
                minimized
                onRestore={() => setSearchMinimized(false)}
              />
            )}
          </div>
          <div className="library-groups-scroll" ref={libraryGroupsRef}>
            {activeGroupData ? (
              <LibraryGroup
                key={`active-${activeGroupData.id}`}
                group={activeGroupData}
                images={activeGroupData.image_ids}
                expandedView
                closing={closingLibraryGroup}
                onClose={handleCloseLibraryGroup}
                onAnimationEnd={handleLibraryGroupAnimationEnd}
                overlayStyle={{
                  '--library-origin-x': `${activeLibraryGroup.originX}px`,
                  '--library-origin-y': `${activeLibraryGroup.originY}px`,
                }}
                onDelete={handleDeleteGroup}
                onClear={handleClearGroup}
                onDropToGroup={handleDropToGroup}
                onDeleteImage={handleDeleteImage}
                onAddToUnassigned={handleAddToUnassigned}
                imagesMeta={imagesMeta}
              />
            ) : (
              libraryGroups.map((g) => (
                <LibraryGroup
                  key={g.id}
                  group={g}
                  images={g.image_ids}
                  onOpen={handleOpenLibraryGroup}
                  onDelete={handleDeleteGroup}
                  onClear={handleClearGroup}
                  onDropToGroup={handleDropToGroup}
                  onDeleteImage={handleDeleteImage}
                  onAddToUnassigned={handleAddToUnassigned}
                  imagesMeta={imagesMeta}
                />
              ))
            )}
            {!searchMinimized && (
              <SearchResults
                data={searchResults}
                loading={searchLoading}
                activeSource={searchSource}
                onSourceChange={setSearchSource}
                onSelect={handleSelectSearchResult}
                onClose={handleCloseSearchResults}
                onMinimize={() => setSearchMinimized(true)}
              />
            )}
          </div>
        </div>

        {/* 图片库拖拽缩放手柄 */}
        {libraryOpen && (
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
      </>
    );
  }
  Object.assign(window.GameTierApp, {
    LibraryPanel,
  });
})();
