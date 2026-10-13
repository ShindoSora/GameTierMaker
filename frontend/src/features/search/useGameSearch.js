(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
  const { getErrorMessage, t } = window.GameTierI18n;
  const { fetchAPI, fetchAPIStream, showToast } = window.GameTierApp;
  function useGameSearch({ currentId, setLoading, loadCurrentTemplate }) {
    const [searchResults, setSearchResults] = useState(null);
    const [searchSource, setSearchSource] = useState('all');
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchMinimized, setSearchMinimized] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const downloadingRef = useRef(false);
    const searchSequenceRef = useRef(0);
    const searchAbortRef = useRef(null);
    useEffect(
      () => () => {
        searchSequenceRef.current += 1;
        searchAbortRef.current?.abort();
        searchAbortRef.current = null;
      },
      []
    );
    const handleSearch = async () => {
      const query = searchQuery.trim();
      if (!query) return;
      const sequence = ++searchSequenceRef.current;
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      setSearchResults(null);
      setSearchSource('all');
      setSearchMinimized(false);
      setSearchLoading(true);
      try {
        const options = {
          method: 'POST',
          body: JSON.stringify({
            query,
          }),
          signal: controller.signal,
        };
        const legacySearch = async () => {
          const res = await fetchAPI('/images/search', options);
          if (sequence === searchSequenceRef.current) setSearchResults(res);
        };
        if (typeof fetchAPIStream === 'function') {
          try {
            await fetchAPIStream('/images/search/stream', options, event => {
              if (sequence === searchSequenceRef.current && !controller.signal.aborted) {
                setSearchResults(event);
              }
            });
          } catch (error) {
            // An older running backend still supports the original final-response API.
            if ([404, 405].includes(error?.status) && !controller.signal.aborted) await legacySearch();
            else throw error;
          }
        } else await legacySearch();
      } catch (e) {
        const aborted = controller.signal.aborted || e?.name === 'AbortError' || e?.details?.name === 'AbortError';
        if (!aborted && sequence === searchSequenceRef.current) {
          setSearchResults(previous => ({
            ...(previous || { query, results: [], sources: [] }), partial: true, interrupted: true,
            sources: (previous?.sources || []).map(source =>
              ['waiting', 'searching'].includes(source.status)
                ? { ...source, status: 'error', error_code: 'search_stream_interrupted' } : source),
          }));
          showToast(getErrorMessage(e, 'errors.searchFailed'), 'error');
        }
      } finally {
        if (sequence === searchSequenceRef.current) {
          setSearchLoading(false);
          if (searchAbortRef.current === controller) searchAbortRef.current = null;
        }
      }
    };
    const handleCloseSearchResults = () => {
      searchSequenceRef.current += 1;
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      setSearchLoading(false);
      setSearchResults(null);
      setSearchSource('all');
      setSearchMinimized(false);
    };
    const handleSelectSearchResult = async (game) => {
      const coverUrl = game.cover?.url || '';
      if (!coverUrl) {
        showToast(t('library.gameHasNoCover'), 'error');
        return;
      }
      const operationTemplateId = currentId;
      if (!operationTemplateId) {
        showToast(t('errors.template_not_found'), 'error');
        return;
      }
      if (downloadingRef.current) return; // Prevent double-click duplicate downloads
      try {
        downloadingRef.current = true;
        setLoading(true);
        const templateQuery = `?template_id=${encodeURIComponent(operationTemplateId)}`;
        await fetchAPI(`/images/download${templateQuery}`, {
          method: 'POST',
          body: JSON.stringify({
            url: coverUrl,
            game_name: game.name,
            game_id: String(game.source_game_id || game.id || ''),
            source: game.source || null,
            asset_id: String(game.asset_id || 'cover'),
          }),
        });
        await loadCurrentTemplate(operationTemplateId);
        showToast(t('library.coverDownloaded'), 'success');
      } catch (e) {
        console.error('下载失败:', e, {
          game: game.name,
          url: coverUrl,
        });
        showToast(getErrorMessage(e, 'errors.downloadFailed'), 'error');
      } finally {
        setLoading(false);
        downloadingRef.current = false;
      }
    };
    return {
      searchResults,
      searchSource,
      setSearchSource,
      searchLoading,
      searchMinimized,
      setSearchMinimized,
      searchQuery,
      setSearchQuery,
      handleSearch,
      handleCloseSearchResults,
      handleSelectSearchResult,
    };
  }
  Object.assign(window.GameTierApp, {
    useGameSearch,
  });
})();
