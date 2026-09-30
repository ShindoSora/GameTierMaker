(() => {
  'use strict';

  const { API } = window.GameTierApp;
  const localSessionReady = (() => {
    const bootstrapMeta = document.querySelector('meta[name="gtm-session-bootstrap"]');
    const bootstrap = bootstrapMeta?.content || '';
    bootstrapMeta?.remove();
    if (!bootstrap || bootstrap.startsWith('__GTM_SESSION_')) {
      return Promise.reject(new Error('local_session_bootstrap_missing'));
    }
    return fetch(`${API}/session/bootstrap`, {
      method: 'POST',
      headers: {
        'X-GTM-Bootstrap': bootstrap,
      },
      credentials: 'same-origin',
      cache: 'no-store',
    }).then((response) => {
      if (!response.ok) throw new Error('local_session_bootstrap_failed');
    });
  })();
  Object.assign(window.GameTierApp, {
    localSessionReady,
  });
})();
