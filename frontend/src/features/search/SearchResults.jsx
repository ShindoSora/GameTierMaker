(() => {
  'use strict';

  const { useRef, useMemo, useCallback, useState, useLayoutEffect } = React;
  const { t } = window.GameTierI18n;
  const EMPTY_RESULTS = [];
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
  function SearchResultsMinimized({ data, loading, onRestore, onClose }) {
    if (!data && !loading) return null;
    const results = Array.isArray(data) ? data : data?.results || EMPTY_RESULTS;
    return (
      <div className="library-search-minimized-bar" onClick={(e) => e.stopPropagation()}>
        <span className="library-group-overlay-title">{t('library.searchResults')}</span>
        {!loading && <span className="library-group-overlay-count">({results.length})</span>}
        <button
          className="btn btn-icon btn-sm library-search-restore"
          onClick={onRestore}
          aria-label={t('search.restore')}
          title={t('search.restore')}
        >
          ↗
        </button>
        <button
          className="btn btn-icon btn-sm library-group-overlay-close"
          onClick={onClose}
          aria-label={t('actions.close')}
          title={t('actions.close')}
        >
          ×
        </button>
      </div>
    );
  }
  function SearchResults({
    data,
    loading,
    activeSource,
    onSourceChange,
    onSelect,
    onClose,
    minimized,
    onMinimize,
    covered = false,
  }) {
    const tabRefs = useRef({});
    // Keep the memoized cover grid stable while using the latest template-aware handler.
    const selectRef = useRef(onSelect);
    selectRef.current = onSelect;
    const selectGame = useCallback((game) => selectRef.current?.(game), []);
    const [restoring, setRestoring] = useState(false);
    useLayoutEffect(() => {
      setRestoring(!!(data || loading) && !minimized && !covered);
    }, [data, loading, minimized, covered]);
    const results = Array.isArray(data) ? data : data?.results || EMPTY_RESULTS;
    const sourceStates = Array.isArray(data?.sources) ? data.sources : [];
    const availableSources = sourceStates.filter(
      (source) => source && source.count > 0 && ['ok', 'partial'].includes(source.status)
    );
    const tabs = [
      {
        source: 'all',
        count: results.length,
      },
      ...availableSources.map((source) => ({
        source: source.source,
        count: source.count,
      })),
    ];
    const selectedSource = tabs.some((tab) => tab.source === activeSource) ? activeSource : 'all';
    const visibleResults = useMemo(() =>
      selectedSource === 'all' ? results : results.filter((item) => item.source === selectedSource),
    [results, selectedSource]);
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
    const hidden = minimized || covered;
    return (
      <div
        className={`library-group-overlay library-search-overlay ${hidden ? 'search-minimized' : ''} ${restoring ? 'library-search-restoring' : ''}`}
        aria-hidden={!!hidden}
        inert={hidden ? '' : undefined}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) setRestoring(false);
        }}
        onClick={onClose}
      >
        <div className="library-group-overlay-header" onClick={(e) => e.stopPropagation()}>
          <span className="library-group-overlay-title">{t('library.searchResults')}</span>
          {!loading && <span className="library-group-overlay-count">({results.length})</span>}
          <button
            className="btn btn-icon btn-sm library-search-minimize"
            onClick={onMinimize}
            aria-label={t('search.minimize')}
            title={t('search.minimize')}
          >
            −
          </button>
          <button
            className="btn btn-icon btn-sm library-group-overlay-close"
            onClick={onClose}
            aria-label={t('actions.close')}
            title={t('actions.close')}
          >
            ×
          </button>
        </div>
        <div
          className="library-group-overlay-grid library-search-overlay-grid"
          onClick={(e) => e.stopPropagation()}
        >
          {loading ? (
            <div className="search-result-status">{t('search.loading')}</div>
          ) : (
            <>
              <div
                className="search-result-tabs"
                role="tablist"
                aria-label={t('search.sources')}
                onKeyDown={handleTabKeyDown}
              >
                {tabs.map((tab) => (
                  <button
                    key={tab.source}
                    type="button"
                    role="tab"
                    tabIndex={tab.source === selectedSource ? 0 : -1}
                    aria-selected={tab.source === selectedSource}
                    id={`search-tab-${tab.source}`}
                    aria-controls="search-results-panel"
                    ref={(node) => {
                      if (node) tabRefs.current[tab.source] = node;
                    }}
                    className={`search-result-tab ${tab.source === selectedSource ? 'active' : ''}`}
                    onClick={() => onSourceChange(tab.source)}
                  >
                    {tab.source === 'all' ? t('search.all') : t(`sources.${tab.source}`)}{' '}
                    {tab.count}
                  </button>
                ))}
              </div>
              <div className="search-results-divider" />
              {sourceFailure && (
                <div className="search-result-status">
                  {t(allSourcesFailed ? 'search.failed' : 'search.partial')}
                </div>
              )}
              {visibleResults.length === 0 ? (
                <div className="search-result-status">
                  {t(
                    allSourcesFailed
                      ? 'search.failed'
                      : sourceFailure
                        ? 'search.noResultsPartial'
                        : 'search.noResults'
                  )}
                </div>
              ) : (
                <div
                  id="search-results-panel"
                  className="search-result-overlay-cards"
                  role="tabpanel"
                  aria-labelledby={`search-tab-${selectedSource}`}
                >
                  <SearchResultCards games={visibleResults} onSelect={selectGame} locale={window.GameTierI18n.getLocale?.()} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }
  Object.assign(window.GameTierApp, {
    SearchResults,
    SearchResultsMinimized,
  });
})();
