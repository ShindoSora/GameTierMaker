(() => {
  'use strict';

  const { useRef, useMemo, useCallback } = React;
  const { t } = window.GameTierI18n;
  const { useSlidingPill, useSearchPanelMorph } = window.GameTierApp;
  const EMPTY_RESULTS = [];
  const pendingSource = source => ['waiting', 'searching'].includes(source.status);
  function sourceStatus(source) {
    if (['ok', 'partial'].includes(source.status)) return source.count;
    return t(`search.source.${source.status}`);
  }
  function SearchProgress({ sources }) {
    const active = sources.filter(source => source.status === 'searching');
    return (
      <div className="search-progress" role="status" aria-live="polite">
        <div className="search-progress-heading">
          <span className="search-glass-orb" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="8.5" cy="8.5" r="5" /><path d="m12.2 12.2 4 4" />
            </svg>
          </span>
          <div className="search-progress-copy">
            <strong>{t('search.searching')}</strong>
            <span>{active.length
              ? t('search.currentSources', { sources: active.map(source => t(`sources.${source.source}`)).join('、') })
              : t('search.waitingSources')}</span>
          </div>
        </div>
        <div className="search-flow-line" aria-hidden="true" />
      </div>
    );
  }
  function SearchSkeletonCards({ count }) {
    return Array.from({ length: count }, (_, index) => (
      <div key={index} className="search-result-card search-result-skeleton" aria-hidden="true">
        <div className="search-skeleton-cover" />
        <div className="search-skeleton-title" />
        <div className="search-skeleton-source" />
      </div>
    ));
  }
  const SearchResultCards = React.memo(function SearchResultCards({ games, onSelect }) {
    return (<>
      {games.map((game) => (
        <div
          key={
            game.result_id || `${game.source}:${game.id}:${game.asset_id || 'cover'}`
          }
          className="search-result-card"
          onClick={() => onSelect(game)}
        >
          {game.cover?.url ? (
            <img
              src={
                game.cover.url.startsWith('//')
                  ? 'https:' + game.cover.url.replace('t_thumb', 't_cover_big')
                  : game.cover.url
              }
              loading="lazy"
              decoding="async"
              width={108}
              height={108}
              style={{
                width: 108,
                height: 108,
                objectFit: 'cover',
                objectPosition: 'center top',
                borderRadius: 4,
              }}
              alt=""
            />
          ) : (
            <div
              style={{
                width: 108,
                height: 108,
                background: 'var(--bg-tertiary)',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#666',
                fontSize: 11,
              }}
            >
              {t('library.noCover')}
            </div>
          )}
          <div
            style={{
              fontSize: 11,
              marginTop: 4,
              textAlign: 'center',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {game.name}
          </div>
          <div className="search-result-source">
            {t(`sources.${game.source || 'cache'}`)}
          </div>
        </div>
      ))}
    </>);
  });
  function SearchResults({
    data,
    loading,
    activeSource,
    onSourceChange,
    onSelect,
    onClose,
    minimized,
    onMinimize,
    onRestore,
    hostRef,
    dockRef,
    covered = false,
    exiting = false,
    onExitComplete,
  }) {
    const tabRefs = useRef({});
    // Keep the memoized cover grid stable while using the latest template-aware handler.
    const selectRef = useRef(onSelect);
    selectRef.current = onSelect;
    const selectGame = useCallback((game) => selectRef.current?.(game), []);
    const morph = useSearchPanelMorph({ active: !!(data || loading), minimized, covered, hostRef, dockRef, exiting, onExitComplete });
    const contentHidden = minimized || covered || exiting;
    const showPill = !contentHidden && morph.phase === 'expanded';
    const results = Array.isArray(data) ? data : data?.results || EMPTY_RESULTS;
    const sourceStates = Array.isArray(data?.sources) ? data.sources : [];
    const availableSources = sourceStates.filter(
      (source) => source && (loading || (source.count > 0 && ['ok', 'partial'].includes(source.status)))
    );
    const tabs = [
      {
        source: 'all',
        count: results.length,
      },
      ...availableSources.map((source) => ({
        source: source.source,
        count: source.count,
        status: source.status,
      })),
    ];
    const selectedSource = tabs.some((tab) => tab.source === activeSource) ? activeSource : 'all';
    const pill = useSlidingPill({selectedKey:selectedSource,
      layoutKey:JSON.stringify(tabs) + (window.GameTierI18n.getLocale?.() || ''),
      visible:showPill, buttonsRef:tabRefs});
    const visibleResults = useMemo(() =>
      selectedSource === 'all' ? results : results.filter((item) => item.source === selectedSource),
    [results, selectedSource]);
    const pending = sourceStates.filter(pendingSource);
    const skeletonCount = !loading ? 0 : selectedSource === 'all'
      ? (sourceStates.length ? Math.min(6, pending.length * 2) : 6)
      : pending.some(source => source.source === selectedSource) ? 3 : 0;
    const sourceFailure = sourceStates.some((source) =>
      ['error', 'unconfigured', 'partial'].includes(source.status)
    );
    const hasSuccessfulSource = sourceStates.some(
      (source) => ['ok', 'partial'].includes(source.status) && source.count > 0
    );
    const allSourcesFailed =
      sourceStates.length > 0 &&
      !hasSuccessfulSource &&
      sourceStates.every((source) => ['error', 'unconfigured'].includes(source.status));
    const handleTabKeyDown = (event) => {
      if (!tabs.length) return;
      const currentIndex = Math.max(
        0,
        tabs.findIndex((tab) => tab.source === selectedSource)
      );
      let nextIndex = currentIndex;
      if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
      else if (event.key === 'ArrowLeft')
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      const nextSource = tabs[nextIndex].source;
      onSourceChange(nextSource);
      requestAnimationFrame(() => tabRefs.current[nextSource]?.focus());
    };
    if (!data && !loading) return null;
    return (
      <div
        ref={morph.panelRef}
        className="search-panel library-search-overlay"
        data-search-state={exiting ? 'exiting' : morph.phase}
        data-search-covered={covered ? 'true' : undefined}
        aria-hidden={!!(covered || exiting)}
        inert={covered || exiting ? '' : undefined}
        onPointerMove={morph.onPointerMove}
        onPointerLeave={morph.onPointerLeave}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="search-panel-header">
          <span className="library-group-overlay-title">{t('library.searchResults')}</span>
          <span className="library-group-overlay-count">({results.length})</span>
          <button
            ref={morph.toggleRef}
            type="button"
            className={`btn btn-icon btn-sm ${minimized ? 'library-search-restore' : 'library-search-minimize'}`}
            onClick={(event) => { event?.stopPropagation(); (minimized ? onRestore : onMinimize)?.(); }}
            aria-label={t(minimized ? 'search.restore' : 'search.minimize')}
            title={t(minimized ? 'search.restore' : 'search.minimize')}
            aria-expanded={!minimized}
            aria-controls="search-results-content"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={minimized ? 'M4 12L12 4M4 4h8v8' : 'M4 8h8'} />
            </svg>
          </button>
          <button
            className="btn btn-icon btn-sm library-group-overlay-close"
            type="button"
            onClick={(event) => { event?.stopPropagation(); onClose?.(); }}
            aria-label={t('actions.close')}
            title={t('actions.close')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div id="search-results-content" className="search-panel-content-clip"
          aria-hidden={!!contentHidden} inert={contentHidden ? '' : undefined}>
        <div
          className="search-panel-grid library-search-overlay-grid"
        >
          {loading && <SearchProgress sources={sourceStates} />}
              <div
                ref={pill.hostRef}
                className="search-result-tabs"
                role="tablist"
                aria-label={t('search.sources')}
                onKeyDown={handleTabKeyDown}
                onPointerMove={pill.onPointerMove}
                onPointerLeave={pill.onPointerLeave}
              >
                {showPill && (
                  <span ref={pill.pillRef} className="search-source-pill" aria-hidden="true">
                    <span className="search-pill-face" />
                  </span>
                )}
                {tabs.map((tab) => (
                  <button
                    key={tab.source}
                    type="button"
                    role="tab"
                    tabIndex={tab.source === selectedSource ? 0 : -1}
                    aria-selected={tab.source === selectedSource}
                    aria-busy={loading && tab.status && pendingSource(tab) ? true : undefined}
                    data-source-state={loading ? tab.status : undefined}
                    id={`search-tab-${tab.source}`}
                    aria-controls="search-results-panel"
                    title={`${tab.source === 'all' ? t('search.all') : t(`sources.${tab.source}`)} ${loading && tab.status ? sourceStatus(tab) : tab.count}`}
                    ref={(node) => {
                      if (node) tabRefs.current[tab.source] = node;
                      else delete tabRefs.current[tab.source];
                    }}
                    className={`search-result-tab ${tab.source === selectedSource ? 'active' : ''}`}
                    onClick={() => onSourceChange(tab.source)}
                  >
                    <span>{tab.source === 'all' ? t('search.all') : t(`sources.${tab.source}`)}</span>{' '}
                    <span className="search-source-status">{loading && tab.status ? sourceStatus(tab) : tab.count}</span>
                  </button>
                ))}
              </div>
              <div className="search-results-divider" />
              {!loading && (sourceFailure || data?.interrupted) && (
                <div className="search-result-status">
                  {t(data?.interrupted ? 'search.interrupted' : allSourcesFailed ? 'search.failed' : 'search.partial')}
                </div>
              )}
              <div
                id="search-results-panel"
                className="search-result-overlay-cards"
                role="tabpanel"
                aria-busy={!!loading}
                aria-labelledby={`search-tab-${selectedSource}`}
              >
                <SearchResultCards games={visibleResults} onSelect={selectGame} locale={window.GameTierI18n.getLocale?.()} />
                <SearchSkeletonCards count={skeletonCount} />
              {!loading && visibleResults.length === 0 && (
                <div className="search-result-status">
                  {t(
                    allSourcesFailed
                      ? 'search.failed'
                      : sourceFailure
                        ? 'search.noResultsPartial'
                        : 'search.noResults'
                  )}
                </div>
              )}
              </div>
        </div>
        </div>
      </div>
    );
  }
  Object.assign(window.GameTierApp, {
    SearchResults,
  });
})();
