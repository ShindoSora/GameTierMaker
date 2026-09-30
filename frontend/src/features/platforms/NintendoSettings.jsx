(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const { SettingsSectionHeading } = window.GameTierApp;
  function NintendoSettings({ preferencesModel, nintendoModel, settingsModel }) {
    const { settingsActiveSection } = preferencesModel;
    const {
      handleNintendoStart,
      nintendoAuthOperation,
      nintendoAuthorizeUrl,
      nintendoCallback,
      setNintendoCallback,
      handleNintendoComplete,
      loadNintendoAccounts,
      nintendoAccounts,
      handleNintendoSync,
      handleNintendoDeleteImages,
      handleNintendoUnbind,
      nintendoPreview,
      nintendoSelected,
      setNintendoSelected,
      handleNintendoImport,
      setNintendoPreview,
      setNintendoImportRequestId,
    } = nintendoModel;
    const { settingsOperation } = settingsModel;
    return (
      settingsActiveSection === 'nintendo_accounts' && (
        <div>
          <SettingsSectionHeading title="Nintendo" />
          <p
            style={{
              margin: '0 0 12px',
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.7,
            }}
          >
            {t('nintendo.bindHelp')}
          </p>
          <button
            className="btn btn-sm btn-primary"
            onClick={handleNintendoStart}
            disabled={!!settingsOperation}
          >
            {t('nintendo.openLogin')}
          </button>

          {nintendoAuthOperation && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface)',
              }}
            >
              <p
                style={{
                  margin: '0 0 8px',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.6,
                }}
              >
                {t('nintendo.callbackHelp')}
              </p>
              <input
                className="input"
                style={{
                  width: '100%',
                  marginBottom: 8,
                  fontSize: 11,
                }}
                value={nintendoAuthorizeUrl}
                readOnly
                onFocus={(e) => e.target.select()}
              />
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 600,
                  marginBottom: 5,
                  color: 'var(--text-secondary)',
                }}
              >
                {t('nintendo.callbackLabel')}
              </label>
              <textarea
                className="input"
                rows="3"
                style={{
                  width: '100%',
                  resize: 'vertical',
                }}
                value={nintendoCallback}
                onChange={(e) => setNintendoCallback(e.target.value)}
                placeholder={t('nintendo.callbackPlaceholder')}
              />
              <button
                className="btn btn-sm btn-primary"
                style={{
                  marginTop: 8,
                }}
                onClick={handleNintendoComplete}
                disabled={!!settingsOperation}
              >
                {t('nintendo.verifyCallback')}
              </button>
            </div>
          )}

          <div
            style={{
              height: 1,
              background: 'var(--divider)',
              margin: '16px 0',
            }}
          ></div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {t('account.boundAccounts')}
            </span>
            <button className="btn btn-xs" onClick={loadNintendoAccounts}>
              {t('actions.refresh')}
            </button>
          </div>

          {Object.keys(nintendoAccounts).length === 0 ? (
            <p
              style={{
                textAlign: 'center',
                color: 'var(--text-secondary)',
                padding: 20,
                fontSize: 13,
              }}
            >
              {t('nintendo.noAccounts')}
            </p>
          ) : (
            Object.entries(nintendoAccounts).map(([accountId, info]) => (
              <div key={accountId} className="steam-account-row">
                <div
                  className="avatar-fallback"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--accent-glow)',
                    color: 'var(--accent)',
                    flexShrink: 0,
                  }}
                >
                  N
                </div>
                <div
                  className="name"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <span>{info.display_name || accountId}</span>
                  <small
                    style={{
                      fontSize: 10,
                      color: info.needs_reauth ? 'var(--danger)' : 'var(--text-secondary)',
                    }}
                  >
                    {info.needs_reauth
                      ? t('nintendo.reauthRequired')
                      : info.last_sync_at
                        ? t('nintendo.lastSynced')
                        : t('nintendo.notSynced')}
                  </small>
                </div>
                <div className="actions">
                  <button
                    className="btn btn-xs btn-primary"
                    onClick={() => handleNintendoSync(accountId)}
                    disabled={!!settingsOperation}
                  >
                    {t('actions.sync')}
                  </button>
                  <button
                    className="btn btn-xs"
                    style={{
                      color: 'var(--danger)',
                    }}
                    onClick={() => handleNintendoDeleteImages(accountId)}
                  >
                    {t('actions.deleteImages')}
                  </button>
                  <button
                    className="btn btn-xs btn-danger"
                    onClick={() => handleNintendoUnbind(accountId)}
                  >
                    {t('actions.unbind')}
                  </button>
                </div>
              </div>
            ))
          )}

          {nintendoPreview && (
            <div
              style={{
                marginTop: 16,
                borderTop: '1px solid var(--divider)',
                paddingTop: 14,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {t('nintendo.previewTitle', {
                    count: nintendoPreview.received || 0,
                  })}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {t('nintendo.selectedCount', {
                    count: nintendoSelected.size,
                  })}
                </span>
              </div>
              <div
                style={{
                  maxHeight: 280,
                  overflowY: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                {(nintendoPreview.titles || []).map((title) => (
                  <label
                    key={title.record_key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 9px',
                      borderBottom: '1px solid var(--divider)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      style={{
                        accentColor: 'var(--accent)',
                      }}
                      checked={nintendoSelected.has(title.record_key)}
                      onChange={() =>
                        setNintendoSelected((previous) => {
                          const next = new Set(previous);
                          next.has(title.record_key)
                            ? next.delete(title.record_key)
                            : next.add(title.record_key);
                          return next;
                        })
                      }
                    />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {title.title_name}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--text-secondary)',
                        flexShrink: 0,
                      }}
                    >
                      {title.total_played_minutes == null
                        ? t('nintendo.unknownTime')
                        : t('nintendo.minutes', {
                            count: title.total_played_minutes,
                          })}
                    </span>
                  </label>
                ))}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  marginTop: 10,
                }}
              >
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleNintendoImport}
                  disabled={!!settingsOperation || !nintendoSelected.size}
                >
                  {t('nintendo.importSelected')}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setNintendoPreview(null);
                    setNintendoSelected(new Set());
                    setNintendoImportRequestId('');
                  }}
                  disabled={!!settingsOperation}
                >
                  {t('actions.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      )
    );
  }
  Object.assign(window.GameTierApp, {
    NintendoSettings,
  });
})();
