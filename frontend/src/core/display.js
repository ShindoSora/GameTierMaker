(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  function deepGet(obj, key) {
    if (obj == null || typeof obj !== 'object') return undefined;
    if (key in obj) return obj[key];
    for (const v of Object.values(obj)) {
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        const result = deepGet(v, key);
        if (result !== undefined) return result;
      }
    }
    return undefined;
  }
  function getTemplateDisplayName(name) {
    const value = String(name || '');
    const defaultName = value.match(/^(?:模板|Template)\s*\((\d+)\)$/i);
    return defaultName
      ? t('template.defaultName', {
          number: defaultName[1],
        })
      : value;
  }
  Object.assign(window.GameTierApp, {
    deepGet,
    getTemplateDisplayName,
  });
})();
