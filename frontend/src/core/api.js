(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const { localSessionReady, API } = window.GameTierApp;
  class ApiError extends Error {
    constructor(code, message, status = 0, details = null) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.status = status;
      this.details = details;
    }
  }
  async function readResponseBody(res) {
    if (res.status === 204 || res.status === 205) return null;
    const rawBody = await res.text();
    if (!rawBody) return null;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const isJson = contentType.includes('application/json') || contentType.includes('+json');
    if (!isJson) return rawBody;
    try {
      return JSON.parse(rawBody);
    } catch (error) {
      if (!res.ok) return rawBody;
      throw new ApiError('invalid_response', t('errors.invalidResponse'), res.status, rawBody);
    }
  }
  async function fetchAPI(path, options = {}) {
    let res;
    const headers = new Headers(options.headers || {});
    const hasBody = options.body !== undefined && options.body !== null;
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (hasBody && !isFormData && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    try {
      await localSessionReady;
      res = await fetch(API + path, {
        ...options,
        headers,
        credentials: 'same-origin',
      });
    } catch (error) {
      throw new ApiError('network_error', t('errors.networkError'), 0, error);
    }
    const body = await readResponseBody(res);
    if (!res.ok) {
      const isObject = body !== null && typeof body === 'object' && !Array.isArray(body);
      const code = isObject && typeof body.error === 'string' ? body.error : 'request_failed';
      const message =
        isObject && typeof body.message === 'string'
          ? body.message
          : isObject && typeof body.detail === 'string'
            ? body.detail
            : typeof body === 'string' && body.trim()
              ? body
              : t('errors.requestFailed');
      throw new ApiError(code, message, res.status, body);
    }
    return body;
  }
  Object.assign(window.GameTierApp, {
    ApiError,
    readResponseBody,
    fetchAPI,
  });
})();
