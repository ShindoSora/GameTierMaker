(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
  const { t } = window.GameTierI18n;
  const { getTemplateDisplayName } = window.GameTierApp;
  function TemplateSelector({ templates, currentId, onSelect }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const selectedTemplate =
      templates.find((template) => template.id === currentId) || templates[0];
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
    const chooseTemplate = (templateId) => {
      setOpen(false);
      if (templateId !== currentId) onSelect(templateId);
    };
    return (
      <div className="template-selector" ref={rootRef}>
        <button
          type="button"
          className="template-select-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={t('template.select')}
          onClick={() => setOpen((previous) => !previous)}
        >
          <span className="template-select-label">
            {selectedTemplate
              ? getTemplateDisplayName(selectedTemplate.name)
              : t('template.select')}
          </span>
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
          <div className="template-select-menu" role="listbox" aria-label={t('template.select')}>
            {templates.map((template) => {
              const selected = template.id === currentId;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`template-select-option ${selected ? 'selected' : ''}`}
                  key={template.id}
                  onClick={() => chooseTemplate(template.id)}
                >
                  <span className="template-select-check">{selected ? '✓' : ''}</span>
                  <span>{getTemplateDisplayName(template.name)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  Object.assign(window.GameTierApp, {
    TemplateSelector,
  });
})();
