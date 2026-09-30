(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
  const { t } = window.GameTierI18n;
  function LanguageSelector({ value, onChange, disabled }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const options = [
      {
        value: 'zh-CN',
        label: t('settings.languageChinese'),
      },
      {
        value: 'en-US',
        label: t('settings.languageEnglish'),
      },
    ];
    const selectedOption = options.find((option) => option.value === value) || options[0];
    useEffect(() => {
      if (!open) return;
      const closeOnOutsideClick = (event) => {
        if (!rootRef.current?.contains(event.target)) setOpen(false);
      };
      const closeOnEscape = (event) => {
        if (event.key === 'Escape') setOpen(false);
      };
      document.addEventListener('mousedown', closeOnOutsideClick);
      document.addEventListener('keydown', closeOnEscape);
      return () => {
        document.removeEventListener('mousedown', closeOnOutsideClick);
        document.removeEventListener('keydown', closeOnEscape);
      };
    }, [open]);
    useEffect(() => {
      if (disabled) setOpen(false);
    }, [disabled]);
    const chooseLanguage = (nextLanguage) => {
      setOpen(false);
      if (nextLanguage !== value) onChange(nextLanguage);
    };
    return (
      <div className="template-selector language-selector" ref={rootRef}>
        <button
          type="button"
          className="template-select-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={t('settings.language')}
          disabled={disabled}
          onClick={() => setOpen((previous) => !previous)}
        >
          <span className="template-select-label">{selectedOption.label}</span>
          <svg
            className="template-select-chevron"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {open && (
          <div className="template-select-menu" role="listbox" aria-label={t('settings.language')}>
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`template-select-option ${selected ? 'selected' : ''}`}
                  key={option.value}
                  onClick={() => chooseLanguage(option.value)}
                >
                  <span className="template-select-check">{selected ? '\u2713' : ''}</span>
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  Object.assign(window.GameTierApp, {
    LanguageSelector,
  });
})();
