(() => {
  'use strict';

  const { useRef, useState, useEffect } = React;
  const {
    readUiPreferences,
    hasRefreshNotice,
    fetchAPI,
    normalizeUiPreferences,
    writeUiPreferences,
    REFRESH_NOTICE_STORAGE_KEY,
  } = window.GameTierApp;
  function useUiPreferences() {
    const uiPreferencesRef = useRef(null);
    if (!uiPreferencesRef.current) uiPreferencesRef.current = readUiPreferences();
    const initialUiPreferences = uiPreferencesRef.current;
    const [libraryOpen, setLibraryOpen] = useState(initialUiPreferences.libraryOpen);
    const [libraryWidth, setLibraryWidth] = useState(initialUiPreferences.libraryWidth);
    const [refreshing, setRefreshing] = useState(hasRefreshNotice);
    const refreshInFlightRef = useRef(false);
    const [runtimeMode, setRuntimeMode] = useState(() =>
      window.pywebview?.api ? 'desktop' : 'browser'
    );
    const desktopUiPreferencesLoadedRef = useRef(false);
    const uiPreferencesSaveTimerRef = useRef(null);
    const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
    const [showSettings, setShowSettings] = useState(initialUiPreferences.settingsOpen);
    const [settingsActiveSection, setSettingsActiveSection] = useState(
      initialUiPreferences.settingsActiveSection
    );
    const [settingsWidth, setSettingsWidth] = useState(initialUiPreferences.settingsWidth);
    const getCurrentUiPreferences = () => ({
      libraryOpen,
      libraryWidth,
      settingsOpen: showSettings,
      settingsWidth,
      settingsActiveSection,
    });
    const applyUiPreferences = (preferences) => {
      setLibraryOpen(preferences.libraryOpen);
      setLibraryWidth(preferences.libraryWidth);
      setShowSettings(preferences.settingsOpen);
      setSettingsWidth(preferences.settingsWidth);
      setSettingsActiveSection(preferences.settingsActiveSection);
    };
    const toServerUiPreferences = (preferences) => ({
      library_open: preferences.libraryOpen,
      library_width: preferences.libraryWidth,
      settings_open: preferences.settingsOpen,
      settings_width: preferences.settingsWidth,
      settings_active_section: preferences.settingsActiveSection,
    });
    const saveDesktopUiPreferences = async (preferences) => {
      if (runtimeMode !== 'desktop' || !desktopUiPreferencesLoadedRef.current) return;
      try {
        await fetchAPI('/settings/ui-preferences', {
          method: 'PUT',
          body: JSON.stringify(toServerUiPreferences(preferences)),
        });
      } catch (error) {
        // localStorage 仍保留当前会话的回退值，桌面端下次启动再尝试同步。
      }
    };
    const loadDesktopUiPreferences = async () => {
      let detectedMode = window.pywebview?.api ? 'desktop' : 'browser';
      try {
        const health = await fetchAPI('/health');
        detectedMode = health?.runtime_mode === 'desktop' ? 'desktop' : 'browser';
      } catch (error) {
        // 保留 pywebview 的本地判断，避免健康检查失败阻塞页面启动。
      }
      setRuntimeMode(detectedMode);
      if (detectedMode !== 'desktop') return null;
      try {
        const saved = await fetchAPI('/settings/ui-preferences');
        const preferences = normalizeUiPreferences({
          libraryOpen: saved?.library_open,
          libraryWidth: saved?.library_width,
          settingsOpen: saved?.settings_open,
          settingsWidth: saved?.settings_width,
          settingsActiveSection: saved?.settings_active_section,
        });
        desktopUiPreferencesLoadedRef.current = true;
        applyUiPreferences(preferences);
        writeUiPreferences(preferences);
        return preferences;
      } catch (error) {
        return null;
      }
    };
    useEffect(() => {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
    }, [theme]);
    useEffect(() => {
      const preferences = getCurrentUiPreferences();
      writeUiPreferences(preferences);
      if (runtimeMode !== 'desktop' || !desktopUiPreferencesLoadedRef.current) return undefined;
      if (uiPreferencesSaveTimerRef.current) clearTimeout(uiPreferencesSaveTimerRef.current);
      uiPreferencesSaveTimerRef.current = setTimeout(() => {
        uiPreferencesSaveTimerRef.current = null;
        saveDesktopUiPreferences(preferences);
      }, 200);
      return () => {
        if (uiPreferencesSaveTimerRef.current) {
          clearTimeout(uiPreferencesSaveTimerRef.current);
          uiPreferencesSaveTimerRef.current = null;
        }
      };
    }, [
      libraryOpen,
      libraryWidth,
      showSettings,
      settingsWidth,
      settingsActiveSection,
      runtimeMode,
    ]);
    const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
    const persistCurrentUiPreferences = () => {
      const preferences = getCurrentUiPreferences();
      writeUiPreferences(preferences);
      return preferences;
    };
    const handleGlobalRefresh = () => {
      if (refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      const preferences = persistCurrentUiPreferences();
      if (uiPreferencesSaveTimerRef.current) {
        clearTimeout(uiPreferencesSaveTimerRef.current);
        uiPreferencesSaveTimerRef.current = null;
      }
      try {
        sessionStorage.setItem(REFRESH_NOTICE_STORAGE_KEY, 'true');
      } catch (error) {
        /* 页面刷新仍可继续 */
      }
      setRefreshing(true);
      saveDesktopUiPreferences(preferences).finally(() => {
        window.setTimeout(() => window.location.reload(), 300);
      });
    };
    return {
      initialUiPreferences,
      libraryOpen,
      setLibraryOpen,
      libraryWidth,
      setLibraryWidth,
      refreshing,
      setRefreshing,
      theme,
      showSettings,
      setShowSettings,
      settingsActiveSection,
      setSettingsActiveSection,
      settingsWidth,
      setSettingsWidth,
      loadDesktopUiPreferences,
      toggleTheme,
      handleGlobalRefresh,
    };
  }
  Object.assign(window.GameTierApp, {
    useUiPreferences,
  });
})();
