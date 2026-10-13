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
  async function fetchAPIStream(path, options, onEvent, config = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Content-Type', 'application/json');
    headers.set('Accept', 'application/x-ndjson');
    await localSessionReady;
    const res = await fetch(API + path, { ...options, headers, credentials: 'same-origin' });
    if (!res.ok) {
      const body = await readResponseBody(res);
      throw new ApiError(body?.error || 'request_failed', body?.message || t('errors.requestFailed'), res.status, body);
    }
    if (!res.body?.getReader) throw new ApiError('invalid_response', t('errors.invalidResponse'));
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let buffer = '', complete = false;
    const consume = line => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (config.validate && event.event === 'error') {
        throw new ApiError(event.error || 'request_failed', t('backfill.interrupted'));
      }
      if (!['start', 'update', 'done'].includes(event.event) ||
          !(config.validate ? config.validate(event) : Array.isArray(event.results) && Array.isArray(event.sources))) {
        throw new ApiError('invalid_response', t('errors.invalidResponse'));
      }
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      onEvent(event);
      if (event.event === 'done') complete = true;
    };
    try {
      while (!complete) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        if (buffer.length > 8 * 1024 * 1024) throw new ApiError('invalid_response', t('errors.invalidResponse'));
        let newline;
        while (!complete && (newline = buffer.indexOf('\n')) >= 0) {
          consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
        }
        if (done) { if (!complete && buffer.trim()) consume(buffer); break; }
      }
      if (!complete) throw new ApiError(config.interruptedCode || 'search_stream_interrupted',
        t(config.interruptedMessage || 'errors.searchFailed'));
    } finally {
      try { await reader.cancel(); } catch (_) { /* An aborted fetch already closed the reader. */ }
      reader.releaseLock();
    }
  }
  function fetchBackfillStream(path, options, onEvent) {
    return fetchAPIStream(path, options, onEvent, {
      validate: event => ['ok', 'fail', 'deferred', 'remaining', 'retry_pending']
        .every(key => Number.isInteger(event[key]) && event[key] >= 0)
        && (event.event !== 'done' || event.remaining === 0),
      interruptedCode: 'backfill_stream_interrupted', interruptedMessage: 'backfill.interrupted',
    });
  }
  Object.assign(window.GameTierApp, {
    ApiError,
    readResponseBody,
    fetchAPI,
    fetchAPIStream,
    fetchBackfillStream,
  });
})();
