(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
  function useDialogs() {
    const [confirmRequest, setConfirmRequest] = useState(null);
    const confirmQueueRef = useRef([]);
    const confirmActiveRef = useRef(null);
    const confirmSequenceRef = useRef(0);
    const [inputRequest, setInputRequest] = useState(null);
    const inputQueueRef = useRef([]);
    const inputActiveRef = useRef(null);
    const inputSequenceRef = useRef(0);
    const showNextConfirm = () => {
      if (confirmActiveRef.current || !confirmQueueRef.current.length) return;
      const next = confirmQueueRef.current.shift();
      confirmActiveRef.current = next;
      setConfirmRequest(next);
    };
    const confirmDialog = (options) =>
      new Promise((resolve) => {
        confirmQueueRef.current.push({
          id: ++confirmSequenceRef.current,
          message: options.message,
          tone: options.tone || 'danger',
          resolve,
          trigger: document.activeElement,
        });
        showNextConfirm();
      });
    const resolveConfirm = (result) => {
      const active = confirmActiveRef.current;
      if (!active) return;
      confirmActiveRef.current = null;
      setConfirmRequest(null);
      active.resolve(Boolean(result));
      const trigger = active.trigger;
      setTimeout(() => {
        if (trigger && typeof trigger.focus === 'function' && document.contains(trigger))
          trigger.focus();
        showNextConfirm();
      }, 0);
    };
    const confirmAction = (message, tone = 'danger') =>
      confirmDialog({
        message,
        tone,
      });
    const showNextInput = () => {
      if (inputActiveRef.current || !inputQueueRef.current.length) return;
      const next = inputQueueRef.current.shift();
      inputActiveRef.current = next;
      setInputRequest(next);
    };
    const inputDialog = (options) =>
      new Promise((resolve) => {
        inputQueueRef.current.push({
          id: ++inputSequenceRef.current,
          message: options.message,
          initialValue: options.initialValue || '',
          resolve,
          trigger: document.activeElement,
        });
        showNextInput();
      });
    const resolveInput = (value) => {
      const active = inputActiveRef.current;
      if (!active) return;
      inputActiveRef.current = null;
      setInputRequest(null);
      active.resolve(value);
      const trigger = active.trigger;
      setTimeout(() => {
        if (trigger && typeof trigger.focus === 'function' && document.contains(trigger))
          trigger.focus();
        showNextInput();
      }, 0);
    };
    useEffect(
      () => () => {
        const pending = confirmActiveRef.current;
        confirmActiveRef.current = null;
        if (pending) pending.resolve(false);
        confirmQueueRef.current.splice(0).forEach((item) => item.resolve(false));
        const pendingInput = inputActiveRef.current;
        inputActiveRef.current = null;
        if (pendingInput) pendingInput.resolve(null);
        inputQueueRef.current.splice(0).forEach((item) => item.resolve(null));
      },
      []
    );
    return {
      confirmRequest,
      inputRequest,
      resolveConfirm,
      confirmAction,
      inputDialog,
      resolveInput,
    };
  }
  Object.assign(window.GameTierApp, {
    useDialogs,
  });
})();
