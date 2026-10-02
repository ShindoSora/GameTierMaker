(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const ISLAND_DURATION = 480;
  const ISLAND_OPEN_EASING = 'cubic-bezier(0.18, 1.18, 0.35, 1)';
  const ISLAND_CLOSE_EASING = 'cubic-bezier(0.22, 0.8, 0.25, 1)';
  function getIslandOrigin(panel, button, radius = 12) {
    const scaleX = button.width / Math.max(1, panel.width);
    const scaleY = button.height / Math.max(1, panel.height);
    return {
      transform: `translate(${button.left - panel.left}px, ${button.top - panel.top}px) scale(${scaleX}, ${scaleY})`,
      borderRadius: `${radius / scaleX}px / ${radius / scaleY}px`,
      opacity: 1,
    };
  }
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
    ISLAND_DURATION,
    ISLAND_OPEN_EASING,
    ISLAND_CLOSE_EASING,
    getIslandOrigin,
    deepGet,
    getTemplateDisplayName,
  });
})();
