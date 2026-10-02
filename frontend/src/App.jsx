(() => {
  'use strict';

  const { useEffect, useRef } = React;
  const { t } = window.GameTierI18n;
  const {
    useDialogs,
    useBusy,
    useUiPreferences,
    useLanguage,
    useTemplates,
    useGameSearch,
    useLibraryActions,
    useTierActions,
    useLiveLogs,
    useSettings,
    useDownloadSettings,
    useImageActions,
    useSteamAccount,
    usePsnAccount,
    useXboxAccount,
    useNintendoAccount,
    useImageBackfill,
    useStorageActions,
    useIslandPanel,
    clearRefreshNotice,
    RefreshOverlay,
    ConfirmDialog,
    InputDialog,
    LibraryPanel,
    TopToolbar,
    TierBoard,
    LogSidebar,
    SettingsPanel,
    ColorPicker,
    TierContextMenu,
    PresetsDialog,
  } = window.GameTierApp;
  function App() {
    const dialogsModel = useDialogs();
    const busyModel = useBusy();
    const preferencesModel = useUiPreferences();
    const languageModel = useLanguage();
    const templatesModel = useTemplates({
      setLoading: (...args) => busyModel.setLoading(...args),
      confirmAction: (...args) => dialogsModel.confirmAction(...args),
    });
    const searchModel = useGameSearch({
      currentId: templatesModel.currentId,
      setLoading: (...args) => busyModel.setLoading(...args),
      loadCurrentTemplate: (...args) => templatesModel.loadCurrentTemplate(...args),
    });
    const libraryModel = useLibraryActions({
      confirmAction: (...args) => dialogsModel.confirmAction(...args),
      currentId: templatesModel.currentId,
      loadCurrentTemplate: (...args) => templatesModel.loadCurrentTemplate(...args),
      refreshSelectedTemplate: (...args) => templatesModel.refreshSelectedTemplate(...args),
      inputDialog: (...args) => dialogsModel.inputDialog(...args),
      libraryGroups: templatesModel.libraryGroups,
    });
    const tierBoardModel = useTierActions({
      currentId: templatesModel.currentId,
      loadCurrentTemplate: (...args) => templatesModel.loadCurrentTemplate(...args),
      confirmAction: (...args) => dialogsModel.confirmAction(...args),
    });
    const logsModel = useLiveLogs({
      confirmAction: (...args) => dialogsModel.confirmAction(...args),
    });
    const settingsModel = useSettings({
      loadDownloadSettings: (...args) => downloadsModel.loadDownloadSettings(...args),
      setShowSettings: (...args) => preferencesModel.setShowSettings(...args),
      loadSteamAccounts: (...args) => steamModel.loadSteamAccounts(...args),
      loadPsnAccounts: (...args) => psnModel.loadPsnAccounts(...args),
    });
    const downloadsModel = useDownloadSettings();
    const imagesModel = useImageActions({
      confirmAction: (...args) => dialogsModel.confirmAction(...args),
      currentId: templatesModel.currentId,
      refreshSelectedTemplate: (...args) => templatesModel.refreshSelectedTemplate(...args),
      loadCurrentTemplate: (...args) => templatesModel.loadCurrentTemplate(...args),
      setLoading: (...args) => busyModel.setLoading(...args),
      templateName: templatesModel.templateName,
      downloadSettings: downloadsModel.downloadSettings,
      loadDownloadSettings: (...args) => downloadsModel.loadDownloadSettings(...args),
    });
    const steamModel = useSteamAccount({
      getCurrentTemplate: templatesModel.getCurrentTemplate,
      runBackfill: (...args) => backfillModel.runBackfill(...args),
      currentId: templatesModel.currentId,
      setSettingsOperation: (...args) => settingsModel.setSettingsOperation(...args),
      refreshSelectedTemplate: (...args) => templatesModel.refreshSelectedTemplate(...args),
      confirmAction: (...args) => dialogsModel.confirmAction(...args),
    });
    const psnModel = usePsnAccount({
      psnOnlineId: settingsModel.psnOnlineId,
      psnNpsso: settingsModel.psnNpsso,
      secretTouched: settingsModel.secretTouched,
      configuredSecrets: settingsModel.configuredSecrets,
      setSettingsOperation: (...args) => settingsModel.setSettingsOperation(...args),
      psnCategories: settingsModel.psnCategories,
      psnMinPlayDuration: settingsModel.psnMinPlayDuration,
      currentId: templatesModel.currentId,
      setPsnOnlineId: (...args) => settingsModel.setPsnOnlineId(...args),
      loadCurrentTemplate: (...args) => templatesModel.loadCurrentTemplate(...args),
      runBackfill: (...args) => backfillModel.runBackfill(...args),
      confirmAction: (...args) => dialogsModel.confirmAction(...args),
      refreshSelectedTemplate: (...args) => templatesModel.refreshSelectedTemplate(...args),
    });
    const xboxModel = useXboxAccount({
      setSettingsOperation: (...args) => settingsModel.setSettingsOperation(...args),
      currentId: templatesModel.currentId,
      loadCurrentTemplate: (...args) => templatesModel.loadCurrentTemplate(...args),
      runBackfill: (...args) => backfillModel.runBackfill(...args),
      confirmAction: (...args) => dialogsModel.confirmAction(...args),
      refreshSelectedTemplate: (...args) => templatesModel.refreshSelectedTemplate(...args),
    });
    const nintendoModel = useNintendoAccount({
      setSettingsOperation: (...args) => settingsModel.setSettingsOperation(...args),
      currentId: templatesModel.currentId,
      refreshSelectedTemplate: (...args) => templatesModel.refreshSelectedTemplate(...args),
      runBackfill: (...args) => backfillModel.runBackfill(...args),
      confirmAction: (...args) => dialogsModel.confirmAction(...args),
    });
    const backfillModel = useImageBackfill({
      getCurrentTemplate: templatesModel.getCurrentTemplate,
    });
    const storageModel = useStorageActions({
      confirmAction: (...args) => dialogsModel.confirmAction(...args),
      setLoading: (...args) => busyModel.setLoading(...args),
      loadCurrentTemplate: (...args) => templatesModel.loadCurrentTemplate(...args),
      currentId: templatesModel.currentId,
    });
    const settingsAnchorRef = useRef(null), logAnchorRef = useRef(null), logToolbarRef = useRef(null);
    const settingsIsland = useIslandPanel({ open: preferencesModel.showSettings,
      width: preferencesModel.settingsWidth, anchorRef: settingsAnchorRef });
    const logIsland = useIslandPanel({ open: logsModel.logOpen,
      width: logsModel.logWidth, anchorRef: logAnchorRef, fallbackRef: logToolbarRef });
    useEffect(() => {
      const overlayWidth =
        (logIsland.visible ? logsModel.logWidth : 0) +
        (settingsIsland.visible ? preferencesModel.settingsWidth : 0);
      document.documentElement.style.setProperty('--right-overlay-width', `${overlayWidth}px`);
      return () => document.documentElement.style.removeProperty('--right-overlay-width');
    }, [
      logIsland.visible,
      logsModel.logWidth,
      settingsIsland.visible,
      preferencesModel.settingsWidth,
    ]);
    useEffect(() => {
      let disposed = false;
      const initialize = async () => {
        const serverUiPreferences = await preferencesModel.loadDesktopUiPreferences();
        if (disposed) return;
        await languageModel.loadLanguage();
        if (disposed) return;
        await templatesModel.loadData();
        if (disposed) return;
        const settingsShouldOpen = serverUiPreferences
          ? serverUiPreferences.settingsOpen
          : preferencesModel.initialUiPreferences.settingsOpen;
        if (settingsShouldOpen) await settingsModel.handleOpenSettings();
        else downloadsModel.loadDownloadSettings();
        if (preferencesModel.refreshing) {
          clearRefreshNotice();
          preferencesModel.setRefreshing(false);
        }
      };
      initialize();
      return () => {
        disposed = true;
      };
    }, []);
    useEffect(() => {
      if (preferencesModel.settingsActiveSection === 'steam_accounts')
        steamModel.loadSteamAccounts();
      if (preferencesModel.settingsActiveSection === 'psn_accounts') {
        psnModel.loadPsnAccounts();
        settingsModel.loadPsnFilters();
      }
      if (preferencesModel.settingsActiveSection === 'xbox_accounts') xboxModel.loadXboxAccounts();
      if (preferencesModel.settingsActiveSection === 'nintendo_accounts')
        nintendoModel.loadNintendoAccounts();
      if (preferencesModel.settingsActiveSection === 'download')
        downloadsModel.loadDownloadSettings();
      if (preferencesModel.settingsActiveSection === 'licenses')
        settingsModel.loadOpenSourceLicenses();
    }, [preferencesModel.settingsActiveSection]);
    if (!languageModel.languageReady || (busyModel.loading && templatesModel.tiers.length === 0)) {
      return (
        <>
          <div className="loading-overlay">
            <div className="loading-spinner" />
          </div>
          {preferencesModel.refreshing && <RefreshOverlay />}
          <ConfirmDialog
            request={dialogsModel.confirmRequest}
            onResolve={dialogsModel.resolveConfirm}
          />
          <InputDialog request={dialogsModel.inputRequest} onResolve={dialogsModel.resolveInput} />
        </>
      );
    }
    const loadingMask = busyModel.loading ? (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          right: logsModel.logOpen ? logsModel.logWidth : 0,
          zIndex: 3500,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'none',
        }}
      >
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-xl)',
            padding: '32px 48px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          }}
        >
          <div className="loading-spinner" />
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            {t('common.pleaseWait')}
          </span>
        </div>
      </div>
    ) : null;
    return (
      <div
        style={{
          width: '100%',
          height: '100vh',
        }}
      >
        <ConfirmDialog
          request={dialogsModel.confirmRequest}
          onResolve={dialogsModel.resolveConfirm}
        />
        <InputDialog request={dialogsModel.inputRequest} onResolve={dialogsModel.resolveInput} />
        {preferencesModel.refreshing && <RefreshOverlay />}
        {loadingMask}
        <div className="app-layout">
          <LibraryPanel
            preferencesModel={preferencesModel}
            searchModel={searchModel}
            imagesModel={imagesModel}
            libraryModel={libraryModel}
            tierBoardModel={tierBoardModel}
            templatesModel={templatesModel}
          />
          {/* Main */}
          <div className="app-main">
            {/* Top Bar */}
            <TopToolbar
              templatesModel={templatesModel}
              tierBoardModel={tierBoardModel}
              imagesModel={imagesModel}
              preferencesModel={preferencesModel}
              backfillModel={backfillModel}
              settingsModel={settingsModel}
              logsModel={logsModel}
              settingsAnchorRef={settingsAnchorRef}
              logAnchorRef={logAnchorRef}
              logToolbarRef={logToolbarRef}
            />

            {/* Tier List */}
            <TierBoard
              templatesModel={templatesModel}
              tierBoardModel={tierBoardModel}
              imagesModel={imagesModel}
            />
          </div>
        </div>

        {logIsland.visible && (
          <LogSidebar
            island={logIsland}
            width={logsModel.logWidth}
            entries={logsModel.logEntries}
            connection={logsModel.logConnection}
            sessionId={logsModel.logSessionId}
            source={logsModel.logSource}
            sourceCounts={logsModel.logSourceCounts}
            onSourceChange={logsModel.setLogSource}
            onResize={logsModel.handleLogResize}
            onClose={() => logsModel.setLogOpen(false)}
            onClear={logsModel.handleClearLogs}
            onCopy={logsModel.handleCopyLogs}
          />
        )}

        {/* Settings Sidebar — right overlay */}
        {
          <SettingsPanel
            island={settingsIsland}
            logVisible={logIsland.visible}
            logAnchorRef={logAnchorRef}
            preferencesModel={preferencesModel}
            logsModel={logsModel}
            settingsModel={settingsModel}
            languageModel={languageModel}
            steamModel={steamModel}
            psnModel={psnModel}
            xboxModel={xboxModel}
            nintendoModel={nintendoModel}
            downloadsModel={downloadsModel}
            storageModel={storageModel}
          />
        }

        {/* 颜色选择器 */}
        {<ColorPicker tierBoardModel={tierBoardModel} />}

        {/* 等级行右键菜单（顶层渲染，避免被 GlowCard transform 影响定位） */}
        {<TierContextMenu tierBoardModel={tierBoardModel} />}

        {/* Import Presets Modal */}
        {<PresetsDialog libraryModel={libraryModel} />}
      </div>
    );
  }
  Object.assign(window.GameTierApp, {
    App,
  });
})();
