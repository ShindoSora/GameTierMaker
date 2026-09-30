(() => {
  'use strict';

  const { useState } = React;
  const { getErrorMessage, t } = window.GameTierI18n;
  const { fetchAPI, showToast, deepGet } = window.GameTierApp;
  function useSettings({
    loadDownloadSettings,
    setShowSettings,
    loadSteamAccounts,
    loadPsnAccounts,
  }) {
    const [igdbClientId, setIgdbClientId] = useState('');
    const [igdbClientSecret, setIgdbClientSecret] = useState('');
    const [bangumiUserAgent, setBangumiUserAgent] = useState('');
    const [bangumiToken, setBangumiToken] = useState('');
    const [steamKey, setSteamKey] = useState('');
    const [steamgriddbApiKey, setSteamgriddbApiKey] = useState('');
    const [settingsBaseline, setSettingsBaseline] = useState(null);
    const [openSourceLicenses, setOpenSourceLicenses] = useState([]);
    const [settingsOperation, setSettingsOperation] = useState(null);
    const [psnNpsso, setPsnNpsso] = useState('');
    const [configuredSecrets, setConfiguredSecrets] = useState({});
    const [secretTouched, setSecretTouched] = useState({});
    const [psnOnlineId, setPsnOnlineId] = useState('');
    const [psnCategories, setPsnCategories] = useState([]);
    const [psnMinPlayDuration, setPsnMinPlayDuration] = useState(0);
    const loadOpenSourceLicenses = async () => {
      try {
        const result = await fetchAPI('/settings/licenses');
        setOpenSourceLicenses(result.licenses || []);
      } catch (error) {
        showToast(getErrorMessage(error, 'errors.requestFailed'), 'error');
      }
    };
    const handleOpenSettings = async () => {
      try {
        const cfg = await fetchAPI('/settings');
        setIgdbClientId(deepGet(cfg, 'client_id') || '');
        setIgdbClientSecret('');
        setBangumiUserAgent(deepGet(cfg, 'bangumi_user_agent') || '');
        setBangumiToken('');
        setSteamKey('');
        setSteamgriddbApiKey('');
        setPsnNpsso('');
        const configured = cfg.configured_secrets || {};
        setConfiguredSecrets(configured);
        setSettingsBaseline({
          igdbClientId: deepGet(cfg, 'client_id') || '',
          bangumiUserAgent: deepGet(cfg, 'bangumi_user_agent') || '',
          configuredSecrets: configured,
        });
        setSecretTouched({});
        setPsnOnlineId(deepGet(cfg, 'psn_online_id') || '');
      } catch (e) {
        /* use defaults */
      }
      loadDownloadSettings();
      setShowSettings(true);
      loadSteamAccounts();
      loadPsnAccounts();
      loadPsnFilters();
    };
    const revealSettingSecret = async (field, setter) => {
      try {
        const result = await fetchAPI(`/settings/secret/${encodeURIComponent(field)}`);
        setter(result?.value || '');
      } catch (error) {
        showToast(getErrorMessage(error, 'errors.requestFailed'), 'error');
      }
    };
    const updateSettingSecret = (field, setter, value) => {
      setter(value);
      setSecretTouched((previous) => ({
        ...previous,
        [field]: true,
      }));
    };
    const handleSaveIgdb = async () => {
      if (
        !igdbClientId.trim() ||
        (!igdbClientSecret.trim() &&
          (secretTouched.client_secret || !configuredSecrets.client_secret))
      ) {
        return {
          ok: false,
          section: 'igdb',
          message: t('settings.igdbRequired'),
        };
      }
      try {
        await fetchAPI('/settings/igdb', {
          method: 'PUT',
          body: JSON.stringify({
            client_id: igdbClientId.trim(),
            client_secret: secretTouched.client_secret ? igdbClientSecret.trim() : null,
          }),
        });
        return {
          ok: true,
          section: 'igdb',
          message: t('settings.igdbSaved'),
        };
      } catch (e) {
        return {
          ok: false,
          section: 'igdb',
          message: getErrorMessage(e, 'errors.saveFailed'),
        };
      }
    };
    const handleSaveBangumi = async () => {
      try {
        await fetchAPI('/settings/bangumi', {
          method: 'PUT',
          body: JSON.stringify({
            bangumi_user_agent: bangumiUserAgent.trim(),
            bangumi_token: secretTouched.bangumi_token ? bangumiToken.trim() : null,
          }),
        });
        return {
          ok: true,
          section: 'bangumi',
          message: t('settings.bangumiSaved'),
        };
      } catch (e) {
        return {
          ok: false,
          section: 'bangumi',
          message: getErrorMessage(e, 'errors.saveFailed'),
        };
      }
    };
    const handleSaveSteamKey = async () => {
      try {
        await fetchAPI('/settings/steam', {
          method: 'PUT',
          body: JSON.stringify({
            steam_key: secretTouched.steam_key ? steamKey.trim() : null,
          }),
        });
        return {
          ok: true,
          section: 'steam',
          message: t('settings.steamKeySaved'),
        };
      } catch (e) {
        return {
          ok: false,
          section: 'steam',
          message: getErrorMessage(e, 'errors.saveFailed'),
        };
      }
    };
    const handleSaveSteamGridDB = async () => {
      try {
        await fetchAPI('/settings/steamgriddb', {
          method: 'PUT',
          body: JSON.stringify({
            steamgriddb_api_key: secretTouched.steamgriddb_api_key
              ? steamgriddbApiKey.trim()
              : null,
          }),
        });
        return {
          ok: true,
          section: 'steamgriddb',
          message: t('settings.steamgriddbSaved'),
        };
      } catch (e) {
        return {
          ok: false,
          section: 'steamgriddb',
          message: getErrorMessage(e, 'errors.saveFailed'),
        };
      }
    };
    const handleSaveSteamKeyFromPlatform = async () => {
      setSettingsOperation({
        key: 'steam-key-save',
        labelKey: 'settings.savingSteamKey',
      });
      try {
        const result = await handleSaveSteamKey();
        showToast(result.message, result.ok ? 'success' : 'error');
        if (result.ok) {
          setConfiguredSecrets((previous) => ({
            ...previous,
            steam_key: !!steamKey.trim(),
          }));
          setSecretTouched((previous) => ({
            ...previous,
            steam_key: false,
          }));
        }
      } finally {
        setSettingsOperation(null);
      }
    };
    const loadPsnFilters = async () => {
      try {
        const res = await fetchAPI('/settings/psn/filters');
        setPsnCategories(res.categories || []);
        setPsnMinPlayDuration(res.min_play_duration_hours || 0);
      } catch (e) {
        /* use defaults */
      }
    };
    const handleSavePsnSettings = async () => {
      try {
        await fetchAPI('/settings/psn', {
          method: 'PUT',
          body: JSON.stringify({
            psn_npsso: secretTouched.psn_npsso ? psnNpsso.trim() : null,
          }),
        });
        return {
          ok: true,
          section: 'psn',
          message: t('settings.npssoSaved'),
        };
      } catch (e) {
        return {
          ok: false,
          section: 'psn',
          message: getErrorMessage(e, 'errors.saveFailed'),
        };
      }
    };
    const handleSavePsnSettingsFromPlatform = async () => {
      setSettingsOperation({
        key: 'psn-npsso-save',
        labelKey: 'settings.savingPsnNpsso',
      });
      try {
        const result = await handleSavePsnSettings();
        showToast(result.message, result.ok ? 'success' : 'error');
        if (result.ok) {
          setConfiguredSecrets((previous) => ({
            ...previous,
            psn_npsso: !!psnNpsso.trim(),
          }));
          setSecretTouched((previous) => ({
            ...previous,
            psn_npsso: false,
          }));
        }
      } finally {
        setSettingsOperation(null);
      }
    };
    const handleSaveAllSettings = async () => {
      const baseline = settingsBaseline || {};
      const dirty = {
        igdb:
          !settingsBaseline ||
          igdbClientId.trim() !== String(baseline.igdbClientId || '').trim() ||
          !!secretTouched.client_secret,
        bangumi:
          !settingsBaseline ||
          bangumiUserAgent.trim() !== String(baseline.bangumiUserAgent || '').trim() ||
          !!secretTouched.bangumi_token,
        steamgriddb: !settingsBaseline || !!secretTouched.steamgriddb_api_key,
      };
      const tasks = [];
      if (dirty.igdb) tasks.push(handleSaveIgdb);
      if (dirty.bangumi) tasks.push(handleSaveBangumi);
      if (dirty.steamgriddb) tasks.push(handleSaveSteamGridDB);
      if (!tasks.length) return;
      const results = [];
      for (const task of tasks) results.push(await task());
      results.forEach((result) => showToast(result.message, result.ok ? 'success' : 'error'));
      const successful = new Set(
        results.filter((result) => result.ok).map((result) => result.section)
      );
      if (successful.size > 0) {
        setConfiguredSecrets((previous) => ({
          ...previous,
          ...(successful.has('igdb') && secretTouched.client_secret
            ? {
                client_secret: !!igdbClientSecret.trim(),
              }
            : {}),
          ...(successful.has('bangumi') && secretTouched.bangumi_token
            ? {
                bangumi_token: !!bangumiToken.trim(),
              }
            : {}),
          ...(successful.has('steam') && secretTouched.steam_key
            ? {
                steam_key: !!steamKey.trim(),
              }
            : {}),
          ...(successful.has('steamgriddb') && secretTouched.steamgriddb_api_key
            ? {
                steamgriddb_api_key: !!steamgriddbApiKey.trim(),
              }
            : {}),
          ...(successful.has('psn') && secretTouched.psn_npsso
            ? {
                psn_npsso: !!psnNpsso.trim(),
              }
            : {}),
        }));
        setSettingsBaseline((previous) => ({
          ...(previous || {}),
          igdbClientId: successful.has('igdb') ? igdbClientId.trim() : previous?.igdbClientId,
          bangumiUserAgent: successful.has('bangumi')
            ? bangumiUserAgent.trim()
            : previous?.bangumiUserAgent,
        }));
        setSecretTouched((previous) => ({
          ...previous,
          ...(successful.has('igdb')
            ? {
                client_secret: false,
              }
            : {}),
          ...(successful.has('bangumi')
            ? {
                bangumi_token: false,
              }
            : {}),
          ...(successful.has('steamgriddb')
            ? {
                steamgriddb_api_key: false,
              }
            : {}),
          ...(successful.has('steam')
            ? {
                steam_key: false,
              }
            : {}),
          ...(successful.has('psn')
            ? {
                psn_npsso: false,
              }
            : {}),
        }));
      }
    };
    const togglePsnCategory = (cat) => {
      setPsnCategories((prev) => {
        if (prev.includes(cat)) return prev.filter((c) => c !== cat);
        return [...prev, cat];
      });
    };
    return {
      igdbClientId,
      setIgdbClientId,
      igdbClientSecret,
      setIgdbClientSecret,
      bangumiUserAgent,
      setBangumiUserAgent,
      bangumiToken,
      setBangumiToken,
      steamKey,
      setSteamKey,
      steamgriddbApiKey,
      setSteamgriddbApiKey,
      openSourceLicenses,
      settingsOperation,
      setSettingsOperation,
      psnNpsso,
      setPsnNpsso,
      configuredSecrets,
      secretTouched,
      psnOnlineId,
      setPsnOnlineId,
      psnCategories,
      psnMinPlayDuration,
      setPsnMinPlayDuration,
      loadOpenSourceLicenses,
      handleOpenSettings,
      revealSettingSecret,
      updateSettingSecret,
      handleSaveSteamKeyFromPlatform,
      loadPsnFilters,
      handleSavePsnSettingsFromPlatform,
      handleSaveAllSettings,
      togglePsnCategory,
    };
  }
  Object.assign(window.GameTierApp, {
    useSettings,
  });
})();
