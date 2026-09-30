(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  const { SettingsSectionHeading, PasswordField, AccountAvatar } = window.GameTierApp;
  function PsnSettings({ preferencesModel, settingsModel, psnModel }) {
    const { settingsActiveSection } = preferencesModel;
    const {
      psnNpsso,
      updateSettingSecret,
      setPsnNpsso,
      revealSettingSecret,
      handleSavePsnSettingsFromPlatform,
      settingsOperation,
      psnCategories,
      togglePsnCategory,
      psnMinPlayDuration,
      setPsnMinPlayDuration,
      psnOnlineId,
      setPsnOnlineId,
    } = settingsModel;
    const {
      handlePsnBind,
      loadPsnAccounts,
      psnAccounts,
      handlePsnSync,
      handlePsnDeleteImages,
      handlePsnUnbind,
    } = psnModel;
    return (
      settingsActiveSection === 'psn_accounts' && (
        <div>
          <SettingsSectionHeading title="PSN" />
          <div
            style={{
              marginBottom: 16,
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 4,
                color: 'var(--text-secondary)',
              }}
            >
              {t('settings.psnNpssoLabel')}
            </label>
            <PasswordField
              value={psnNpsso}
              onChange={(e) => updateSettingSecret('psn_npsso', setPsnNpsso, e.target.value)}
              onReveal={() => revealSettingSecret('psn_npsso', setPsnNpsso)}
              placeholder={t('settings.npssoPlaceholder')}
            />
            <p
              style={{
                marginTop: 6,
                fontSize: 11,
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
              }}
            >
              {t('settings.npssoHelpStart')}{' '}
              <a
                href="https://store.playstation.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--accent)',
                }}
              >
                https://store.playstation.com
              </a>{' '}
              {t('settings.npssoHelpMiddle')}{' '}
              <a
                href="https://ca.account.sony.com/api/v1/ssocookie"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--accent)',
                }}
              >
                https://ca.account.sony.com/api/v1/ssocookie
              </a>{' '}
              {t('settings.npssoHelpEnd')}
            </p>
            <button
              className="btn btn-sm btn-primary"
              onClick={handleSavePsnSettingsFromPlatform}
              disabled={!!settingsOperation}
            >
              {t('actions.save')}
            </button>
          </div>
          <div
            style={{
              height: 1,
              background: 'var(--divider)',
              marginBottom: 20,
            }}
          ></div>

          {/* 平台筛选 */}
          <div
            style={{
              marginBottom: 12,
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                color: 'var(--text-secondary)',
              }}
            >
              {t('psn.platformFilterBind')}
            </label>
            <div
              style={{
                display: 'flex',
                gap: 16,
              }}
            >
              {[
                {
                  key: 'ps4_game',
                  label: t('psn.onlyPs4'),
                },
                {
                  key: 'ps5_native_game',
                  label: t('psn.onlyPs5'),
                },
                {
                  key: 'pspc_game',
                  label: t('psn.onlyPspc'),
                },
              ].map((cat) => (
                <label
                  key={cat.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 13,
                    cursor: 'pointer',
                    color: 'var(--text-primary)',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: psnCategories.includes(cat.key)
                      ? 'var(--accent-glow)'
                      : 'var(--surface)',
                    border: psnCategories.includes(cat.key)
                      ? '1px solid var(--accent)'
                      : '1px solid var(--border)',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  <input
                    type="checkbox"
                    style={{
                      accentColor: 'var(--accent)',
                    }}
                    checked={psnCategories.includes(cat.key)}
                    onChange={() => togglePsnCategory(cat.key)}
                  />
                  {cat.label}
                </label>
              ))}
            </div>
          </div>

          {/* 时长筛选 */}
          <div
            style={{
              marginBottom: 20,
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 4,
                color: 'var(--text-secondary)',
              }}
            >
              {t('psn.minimumPlaytime')}
            </label>
            <input
              className="input"
              style={{
                width: '100%',
              }}
              type="number"
              min="0"
              step="0.1"
              value={psnMinPlayDuration}
              onChange={(e) => setPsnMinPlayDuration(parseFloat(e.target.value) || 0)}
              placeholder={t('psn.noPlaytimeFilter')}
            />
          </div>

          {/* 在线 ID + 绑定 */}
          <div
            style={{
              marginBottom: 14,
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 4,
                color: 'var(--text-secondary)',
              }}
            >
              {t('psn.onlineId')}
            </label>
            <div
              style={{
                display: 'flex',
                gap: 8,
              }}
            >
              <input
                className="input"
                style={{
                  flex: 1,
                }}
                value={psnOnlineId}
                onChange={(e) => setPsnOnlineId(e.target.value)}
                placeholder={t('psn.onlineIdPlaceholder')}
              />
              <button
                className="btn btn-sm btn-primary"
                onClick={handlePsnBind}
                disabled={!!settingsOperation}
                style={{
                  flexShrink: 0,
                  padding: '6px 20px',
                }}
              >
                {t('actions.bind')}
              </button>
            </div>
          </div>

          <div
            style={{
              height: 1,
              background: 'var(--divider)',
              margin: '16px 0',
            }}
          ></div>

          {/* 平台筛选 */}
          <div
            style={{
              marginBottom: 12,
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                color: 'var(--text-secondary)',
              }}
            >
              {t('psn.platformFilterSync')}
            </label>
            <div
              style={{
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              {[
                {
                  key: 'ps4_game',
                  label: t('psn.onlyPs4'),
                },
                {
                  key: 'ps5_native_game',
                  label: t('psn.onlyPs5'),
                },
                {
                  key: 'pspc_game',
                  label: t('psn.onlyPspc'),
                },
              ].map((cat) => (
                <label
                  key={cat.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 12,
                    cursor: 'pointer',
                    color: 'var(--text-primary)',
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: psnCategories.includes(cat.key)
                      ? 'var(--accent-glow)'
                      : 'var(--surface)',
                    border: psnCategories.includes(cat.key)
                      ? '1px solid var(--accent)'
                      : '1px solid var(--border)',
                  }}
                >
                  <input
                    type="checkbox"
                    style={{
                      accentColor: 'var(--accent)',
                    }}
                    checked={psnCategories.includes(cat.key)}
                    onChange={() => togglePsnCategory(cat.key)}
                  />
                  {cat.label}
                </label>
              ))}
            </div>
          </div>

          <div
            style={{
              marginBottom: 14,
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 4,
                color: 'var(--text-secondary)',
              }}
            >
              {t('psn.minimumPlaytime')}
            </label>
            <input
              className="input"
              style={{
                width: '100%',
              }}
              type="number"
              min="0"
              step="0.1"
              value={psnMinPlayDuration}
              onChange={(e) => setPsnMinPlayDuration(parseFloat(e.target.value) || 0)}
              placeholder={t('psn.noPlaytimeFilter')}
            />
          </div>

          <div
            style={{
              height: 1,
              background: 'var(--divider)',
              marginBottom: 16,
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
            <button className="btn btn-xs" onClick={loadPsnAccounts}>
              {t('actions.refresh')}
            </button>
          </div>

          {Object.keys(psnAccounts).length === 0 ? (
            <p
              style={{
                textAlign: 'center',
                color: 'var(--text-secondary)',
                padding: 20,
                fontSize: 13,
              }}
            >
              {t('psn.noAccounts')}
            </p>
          ) : (
            Object.entries(psnAccounts).map(([accountId, info]) => (
              <div key={accountId} className="steam-account-row">
                <AccountAvatar src={info.avatarfull || ''} name={info.onlineId || accountId} />
                <div className="name">{info.onlineId || accountId}</div>
                <div className="actions">
                  <button
                    className="btn btn-xs btn-primary"
                    onClick={() => handlePsnSync(accountId)}
                    disabled={!!settingsOperation}
                  >
                    {t('actions.sync')}
                  </button>
                  <button
                    className="btn btn-xs"
                    style={{
                      color: 'var(--danger)',
                    }}
                    onClick={() => handlePsnDeleteImages(accountId)}
                  >
                    {t('actions.deleteImages')}
                  </button>
                  <button
                    className="btn btn-xs btn-danger"
                    onClick={() => handlePsnUnbind(accountId)}
                  >
                    {t('actions.unbind')}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )
    );
  }
  Object.assign(window.GameTierApp, {
    PsnSettings,
  });
})();
