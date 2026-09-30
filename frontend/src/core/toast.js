(() => {
  'use strict';

  const { t } = window.GameTierI18n;
  let toastId = 0;
  function showToast(input, type = '') {
    const id = ++toastId;
    const options =
      input && typeof input === 'object'
        ? input
        : {
            message: String(input ?? ''),
            type,
          };
    const toastType = options.type || type || '';
    const actionText =
      options.actionText || (toastType === 'error' ? t('toast.action.openLogs') : '');
    const onAction =
      options.onAction || (() => window.dispatchEvent(new CustomEvent('open-log-panel')));
    const el = document.createElement('div');
    el.className = `toast toast-${toastType}`;
    el.dataset.toastId = id;
    const copy = document.createElement('div');
    copy.className = 'toast-copy';
    const message = document.createElement('div');
    message.className = 'toast-message';
    message.textContent = options.message || '';
    copy.appendChild(message);
    if (options.detail) {
      const detail = document.createElement('div');
      detail.className = 'toast-detail';
      detail.textContent = options.detail;
      copy.appendChild(detail);
    }
    el.appendChild(copy);
    if (actionText) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'btn btn-sm toast-action';
      action.textContent = actionText;
      action.addEventListener('click', () => {
        onAction();
        el.remove();
      });
      el.appendChild(action);
    }
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    container.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 5000);
  }
  Object.assign(window.GameTierApp, {
    toastId,
    showToast,
  });
})();
