(() => {
  'use strict';

  const { useState, useRef } = React;
  const { getLocale, setLocale, t, getErrorMessage } = window.GameTierI18n;
  const { fetchAPI, showToast } = window.GameTierApp;
  function useLanguage() {
    const [uiLanguage, setUiLanguage] = useState(getLocale());
    const [languageReady, setLanguageReady] = useState(false);
    const [languageSaving, setLanguageSaving] = useState(false);
    const languageSaveInFlightRef = useRef(false);
    const loadLanguage = async () => {
      try {
        const result = await fetchAPI('/settings/language');
        const language = result?.language === 'en-US' ? 'en-US' : 'zh-CN';
        setLocale(language);
        setUiLanguage(language);
      } catch (error) {
        setLocale('zh-CN');
        setUiLanguage('zh-CN');
      } finally {
        setLanguageReady(true);
      }
    };
    const handleLanguageChange = async (nextLanguage) => {
      if (languageSaveInFlightRef.current) return;
      const previousLanguage = uiLanguage;
      if (nextLanguage === previousLanguage) return;
      languageSaveInFlightRef.current = true;
      setLanguageSaving(true);
      setLocale(nextLanguage);
      setUiLanguage(nextLanguage);
      try {
        await fetchAPI('/settings/language', {
          method: 'PUT',
          body: JSON.stringify({
            language: nextLanguage,
          }),
        });
        showToast(t('settings.languageSaved'), 'success');
      } catch (error) {
        setLocale(previousLanguage);
        setUiLanguage(previousLanguage);
        showToast(getErrorMessage(error, 'settings.languageSaveFailed'), 'error');
      } finally {
        languageSaveInFlightRef.current = false;
        setLanguageSaving(false);
      }
    };
    return {
      uiLanguage,
      languageReady,
      languageSaving,
      loadLanguage,
      handleLanguageChange,
    };
  }
  Object.assign(window.GameTierApp, {
    useLanguage,
  });
})();
