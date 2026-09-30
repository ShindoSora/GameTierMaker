(() => {
  'use strict';

  const API = '/api';
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
  Object.assign(window.GameTierApp, {
    API,
    MAX_UPLOAD_BYTES,
  });
})();
