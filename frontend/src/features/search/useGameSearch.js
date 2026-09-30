(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
  const { getErrorMessage, t } = window.GameTierI18n;
  const { fetchAPI, showToast } = window.GameTierApp;
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
        const res = await fetchAPI('/images/search', {
          method: 'POST',
          body: JSON.stringify({
            query,
          }),
          signal: controller.signal,
        });
        if (sequence === searchSequenceRef.current) setSearchResults(res);
      } catch (e) {
        const aborted = e?.details?.name === 'AbortError';
        if (!aborted && sequence === searchSequenceRef.current) {
          showToast(getErrorMessage(e, 'errors.searchFailed'), 'error');
        }
      } finally {
        if (sequence === searchSequenceRef.current) setSearchLoading(false);
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
