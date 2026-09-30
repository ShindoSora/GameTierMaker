(() => {
  'use strict';

  const REFRESH_NOTICE_STORAGE_KEY = 'game-tier-maker-refreshing';
  const UI_PREFERENCES_STORAGE_KEY = 'game-tier-maker-ui-preferences';
  const UI_PREFERENCES_DEFAULTS = Object.freeze({
    libraryOpen: true,
    libraryWidth: 280,
    settingsOpen: false,
    settingsWidth: 500,
    settingsActiveSection: 'search_settings',
  });
  const PERSISTED_SETTINGS_SECTIONS = Object.freeze([
    'search_settings',
    'language',
    'steam_accounts',
    'psn_accounts',
    'xbox_accounts',
    'nintendo_accounts',
    'download',
    'storage',
    'licenses',
  ]);
  function normalizeUiPreferences(saved) {
    const raw = saved && typeof saved === 'object' ? saved : {};
    const libraryWidth = Number(raw.libraryWidth);
    const settingsWidth = Number(raw.settingsWidth);
    return {
      libraryOpen:
        typeof raw.libraryOpen === 'boolean'
          ? raw.libraryOpen
          : UI_PREFERENCES_DEFAULTS.libraryOpen,
      libraryWidth: Number.isFinite(libraryWidth)
        ? Math.min(600, Math.max(180, libraryWidth))
        : UI_PREFERENCES_DEFAULTS.libraryWidth,
      settingsOpen:
        typeof raw.settingsOpen === 'boolean'
          ? raw.settingsOpen
          : UI_PREFERENCES_DEFAULTS.settingsOpen,
      settingsWidth: Number.isFinite(settingsWidth)
        ? Math.min(900, Math.max(320, settingsWidth))
        : UI_PREFERENCES_DEFAULTS.settingsWidth,
      settingsActiveSection: PERSISTED_SETTINGS_SECTIONS.includes(raw.settingsActiveSection)
        ? raw.settingsActiveSection
        : UI_PREFERENCES_DEFAULTS.settingsActiveSection,
    };
  }
  function readUiPreferences() {
    let saved = {};
    try {
      const raw = localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') saved = parsed;
    } catch (error) {
      // 使用默认布局，不能因为本地存储不可用阻塞页面加载。
    }
    return normalizeUiPreferences(saved);
  }
  function writeUiPreferences(preferences) {
    try {
      localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    } catch (error) {
      // 本地存储不可用时仍保持当前会话内的 UI 行为。
    }
  }
  function hasRefreshNotice() {
    try {
      return sessionStorage.getItem(REFRESH_NOTICE_STORAGE_KEY) === 'true';
    } catch (error) {
      return false;
    }
  }
  function clearRefreshNotice() {
    try {
      sessionStorage.removeItem(REFRESH_NOTICE_STORAGE_KEY);
    } catch (error) {
      // sessionStorage 不可用时只清理当前页面状态。
    }
  }
  Object.assign(window.GameTierApp, {
    REFRESH_NOTICE_STORAGE_KEY,
    UI_PREFERENCES_STORAGE_KEY,
    UI_PREFERENCES_DEFAULTS,
    PERSISTED_SETTINGS_SECTIONS,
    normalizeUiPreferences,
    readUiPreferences,
    writeUiPreferences,
    hasRefreshNotice,
    clearRefreshNotice,
  });
})();
