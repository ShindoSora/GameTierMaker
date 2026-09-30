(() => {
  'use strict';

  const { useState } = React;
  function useBusy() {
    const [loadingCount, setLoadingCount] = useState(0);
    const loading = loadingCount > 0;
    const setLoading = (active) =>
      setLoadingCount((count) => (active ? count + 1 : Math.max(0, count - 1)));
    return {
      loading,
      setLoading,
    };
  }
  Object.assign(window.GameTierApp, {
    useBusy,
  });
})();
