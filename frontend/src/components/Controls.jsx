(() => {
  'use strict';

  const { useState, useEffect } = React;
  const { t } = window.GameTierI18n;
  function GlowCard({ children, className, style, ...props }) {
    return (
      <div
        className={className}
        style={{
          position: 'relative',
          overflow: 'hidden',
          ...style,
        }}
        {...props}
      >
        {children}
      </div>
    );
  }
  function AccountAvatar({ src, name }) {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [src]);
    if (!src || failed) {
      const initial =
        String(name || '?')
          .trim()
          .charAt(0) || '?';
      return (
        <div
          className="avatar avatar-fallback"
          aria-label={t('account.defaultAvatar', {
            name: name || t('account.generic'),
          })}
        >
          {initial}
        </div>
      );
    }
    return (
      <img
        className="avatar"
        src={src}
        onError={() => setFailed(true)}
        alt={t('account.avatar', {
          name: name || t('account.generic'),
        })}
      />
    );
  }
  function PasswordField({ value, onChange, placeholder, onReveal }) {
    const [visible, setVisible] = useState(false);
    const [revealing, setRevealing] = useState(false);
    const toggleVisibility = async () => {
      if (!visible && !value && onReveal) {
        setRevealing(true);
        try {
          await onReveal();
        } finally {
          setRevealing(false);
        }
      }
      setVisible((current) => !current);
    };
    return (
      <div
        style={{
          position: 'relative',
        }}
      >
        <input
          className="input"
          style={{
            width: '100%',
            paddingRight: 42,
          }}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete="off"
        />
        <button
          type="button"
          className="btn btn-icon btn-xs"
          onClick={toggleVisibility}
          disabled={revealing}
          aria-label={visible ? t('password.hide') : t('password.show')}
          aria-pressed={visible}
          title={visible ? t('password.hide') : t('password.show')}
          style={{
            position: 'absolute',
            right: 5,
            top: '50%',
            transform: 'translateY(-50%)',
            padding: 4,
            minWidth: 28,
          }}
        >
          {visible ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a2 2 0 002.8 2.8" />
              <path d="M9.9 4.2A10.5 10.5 0 0112 4c5.5 0 9 8 9 8a16 16 0 01-2.1 3.2" />
              <path d="M6.6 6.6C4.2 8.2 3 12 3 12s3.5 8 9 8a9.7 9.7 0 004.1-.9" />
            </svg>
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M3 12s3.5-8 9-8 9 8 9 8-3.5 8-9 8-9-8-9-8z" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          )}
        </button>
      </div>
    );
  }
  function SettingsSectionHeading({ title, description }) {
    return (
      <div className="settings-section-heading">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
    );
  }
  Object.assign(window.GameTierApp, {
    GlowCard,
    AccountAvatar,
    PasswordField,
    SettingsSectionHeading,
  });
})();
