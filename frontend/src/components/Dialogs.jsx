(() => {
  'use strict';

  const { useRef, useEffect, useState } = React;
  const { t } = window.GameTierI18n;
  function ConfirmDialog({ request, onResolve }) {
    const cancelRef = useRef(null);
    const confirmRef = useRef(null);
    useEffect(() => {
      if (!request) return undefined;
      cancelRef.current?.focus();
      const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onResolve(false);
        } else if (event.key === 'Tab') {
          const cancel = cancelRef.current;
          const confirm = confirmRef.current;
          if (!cancel || !confirm) return;
          if (event.shiftKey && document.activeElement === cancel) {
            event.preventDefault();
            confirm.focus();
          } else if (!event.shiftKey && document.activeElement === confirm) {
            event.preventDefault();
            cancel.focus();
          }
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [request, onResolve]);
    if (!request) return null;
    const messageId = `confirm-dialog-message-${request.id}`;
    return ReactDOM.createPortal(
      <div className="confirm-dialog-backdrop" role="presentation">
        <div
          className="confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t('dialogs.confirmation')}
          aria-describedby={messageId}
          onClick={(event) => event.stopPropagation()}
        >
          <p id={messageId} className="confirm-dialog-message">
            {request.message}
          </p>
          <div className="confirm-dialog-actions">
            <button ref={cancelRef} type="button" className="btn" onClick={() => onResolve(false)}>
              {t('actions.cancel')}
            </button>
            <button
              ref={confirmRef}
              type="button"
              className={`btn ${request.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => onResolve(true)}
            >
              {t('actions.confirm')}
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }
  function RefreshOverlay() {
    return (
      <div className="refresh-overlay" role="status" aria-live="polite">
        <div className="refresh-panel">
          <div className="loading-spinner" />
          <span>{t('common.refreshing')}</span>
        </div>
      </div>
    );
  }
  function InputDialog({ request, onResolve }) {
    const inputRef = useRef(null);
    const cancelRef = useRef(null);
    const confirmRef = useRef(null);
    const valueRef = useRef('');
    const resolveRef = useRef(onResolve);
    resolveRef.current = onResolve;
    const [value, setValue] = useState('');
    useEffect(() => {
      if (!request) return undefined;
      const initialValue = request.initialValue ?? '';
      valueRef.current = initialValue;
      setValue(initialValue);
      inputRef.current?.focus();
      inputRef.current?.select();
      const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          resolveRef.current(null);
          return;
        }
        if (event.key !== 'Tab') return;
        const focusables = [inputRef.current, cancelRef.current, confirmRef.current].filter(
          Boolean
        );
        if (!focusables.length) return;
        const activeIndex = focusables.indexOf(document.activeElement);
        if (activeIndex < 0) {
          event.preventDefault();
          focusables[0].focus();
        } else if (event.shiftKey && activeIndex === 0) {
          event.preventDefault();
          focusables[focusables.length - 1].focus();
        } else if (!event.shiftKey && activeIndex === focusables.length - 1) {
          event.preventDefault();
          focusables[0].focus();
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [request]);
    if (!request) return null;
    const messageId = `input-dialog-message-${request.id}`;
    const handleChange = (event) => {
      valueRef.current = event.target.value;
      setValue(event.target.value);
    };
    const resolveValue = () => resolveRef.current(valueRef.current);
    return ReactDOM.createPortal(
      <div className="confirm-dialog-backdrop" role="presentation">
        <div
          className="confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={messageId}
          onClick={(event) => event.stopPropagation()}
        >
          <p id={messageId} className="confirm-dialog-message">
            {request.message}
          </p>
          <input
            ref={inputRef}
            type="text"
            className="input input-dialog-field"
            aria-labelledby={messageId}
            value={value}
            onChange={handleChange}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.isComposing) {
                event.preventDefault();
                resolveValue();
              }
            }}
            autoComplete="off"
          />
          <div className="confirm-dialog-actions">
            <button
              ref={cancelRef}
              type="button"
              className="btn"
              onClick={() => resolveRef.current(null)}
            >
              {t('actions.cancel')}
            </button>
            <button
              ref={confirmRef}
              type="button"
              className="btn btn-primary"
              onClick={resolveValue}
            >
              {t('actions.confirm')}
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }
  Object.assign(window.GameTierApp, {
    ConfirmDialog,
    RefreshOverlay,
    InputDialog,
  });
})();
