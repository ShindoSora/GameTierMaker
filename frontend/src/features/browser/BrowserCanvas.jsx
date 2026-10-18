(() => {
  'use strict';
  const { useRef, useState, useEffect } = React;
  const { t } = window.GameTierI18n;
  const modifiers = event => (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);

  function BrowserCanvas({ model, operationId, visible }) {
    const canvasRef = useRef(null), stageRef = useRef(null), inputRef = useRef(null);
    const latest = useRef({ model, visible });
    latest.current = { model, visible };
    const frameSize = useRef({ width: 1000, height: 700 });
    const socketRef = useRef(null), sendViewRef = useRef(null);
    const composing = useRef(false), compositionText = useRef(''), sentKeys = useRef(new Set());
    const [hasFrame, setHasFrame] = useState(false);
    const [connection, setConnection] = useState('connecting');
    const send = message => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };

    useEffect(() => {
      let disposed = false, reconnect = 0, resizeTimer = 0, attempts = 0, drawing = 0;
      setHasFrame(false);
      const updateConnection = value => {
        if (!disposed) { setConnection(value); latest.current.model.updateViewer({ connection: value }); }
      };
      const viewport = () => {
        if (!latest.current.visible) { send({ type: 'visibility', visible: false }); return; }
        const rect = stageRef.current?.getBoundingClientRect();
        if (!rect) return;
        send({ type: 'resize', width: Math.round(rect.width), height: Math.round(rect.height) });
        send({ type: 'visibility', visible: latest.current.visible });
      };
      sendViewRef.current = viewport;
      const open = () => {
        if (disposed) return;
        updateConnection('connecting');
        const url = new URL(`/api/settings/browser-auth/${encodeURIComponent(operationId)}/stream`, window.location.href);
        url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(url.href);
        socketRef.current = socket;
        latest.current.model.viewerSocket.current = socket;
        socket.onopen = () => { attempts = 0; updateConnection('connected'); viewport(); };
        socket.onmessage = event => {
          if (disposed) return;
          let message;
          try { message = JSON.parse(event.data); } catch (_) { return; }
          if (message.type === 'state') {
            latest.current.model.updateViewer({ host: message.host, canBack: message.canBack, canForward: message.canForward });
          } else if (message.type === 'frame' && typeof message.data === 'string') {
            const sequence = ++drawing;
            const image = new Image();
            image.onload = () => {
              if (disposed || sequence !== drawing || !canvasRef.current) return;
              const width = Math.max(1, Math.min(1920, message.width));
              const height = Math.max(1, Math.min(1200, message.height));
              const canvas = canvasRef.current;
              if (canvas.width !== width) canvas.width = width;
              if (canvas.height !== height) canvas.height = height;
              frameSize.current = { width, height };
              canvas.getContext('2d').drawImage(image, 0, 0, width, height);
              setHasFrame(true);
            };
            image.src = `data:image/jpeg;base64,${message.data}`;
          }
        };
        socket.onerror = () => updateConnection('connecting');
        socket.onclose = () => {
          if (disposed) return;
          updateConnection('connecting');
          if (++attempts <= 3) reconnect = setTimeout(open, attempts * 750);
          else updateConnection('failed');
        };
      };
      open();
      const observer = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(viewport, 120); });
      if (stageRef.current) observer.observe(stageRef.current);
      return () => {
        disposed = true; drawing++;
        clearTimeout(reconnect); clearTimeout(resizeTimer); observer.disconnect();
        send({ type: 'visibility', visible: false });
        socketRef.current?.close();
        latest.current.model.viewerSocket.current = null;
        sendViewRef.current = null;
      };
    }, [operationId]);

    useEffect(() => {
      sendViewRef.current?.();
      if (!visible) { sentKeys.current.clear(); inputRef.current?.blur(); }
    }, [visible]);

    const point = event => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const size = frameSize.current;
      const scale = Math.min(rect.width / size.width, rect.height / size.height);
      const x = (event.clientX - rect.left - (rect.width - size.width * scale) / 2) / scale;
      const y = (event.clientY - rect.top - (rect.height - size.height * scale) / 2) / scale;
      return { x, y, modifiers: modifiers(event) };
    };
    const pointer = (event, kind) => {
      if (!visible || !hasFrame) return;
      if (kind === 'down') {
        // Keep the text/IME receiver focused: the canvas's default mouse action
        // would otherwise blur it immediately after this pointer handler.
        event.preventDefault();
        inputRef.current?.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      const coordinates = point(event);
      if (coordinates) send({ type: 'pointer', event: kind, ...coordinates,
        button: event.button, buttons: event.buttons, clickCount: event.detail || 1 });
    };
    const key = (event, kind) => {
      if (event.isComposing || composing.current || event.key === 'Process') return;
      const paste = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v';
      if (paste) return; // The paste event supplies text without accessing the clipboard in the backend.
      const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (printable) return; // Native input/composition supplies Unicode text.
      event.preventDefault();
      if (kind === 'keydown') sentKeys.current.add(event.code);
      else if (!sentKeys.current.delete(event.code)) return;
      send({ type: 'key', event: kind, key: event.key, code: event.code, modifiers: modifiers(event) });
    };
    const textInput = event => {
      if (composing.current) return;
      const text = event.currentTarget.value;
      event.currentTarget.value = '';
      const inputType = event.nativeEvent?.inputType || '';
      const compositionInput = inputType === 'insertCompositionText' || inputType === 'insertFromComposition';
      if (compositionInput && compositionText.current === text) { compositionText.current = ''; return; }
      compositionText.current = '';
      if (text) send({ type: 'text', text: text.slice(0, 8192) });
    };
    return (
      <div ref={stageRef} className="browser-stream-stage" data-connection={connection}>
        <canvas ref={canvasRef} className="browser-stream-canvas" aria-label={t('browser.page')}
          onPointerDown={event => pointer(event, 'down')} onPointerUp={event => pointer(event, 'up')}
          onPointerMove={event => pointer(event, 'move')} onContextMenu={event => event.preventDefault()}
          onWheel={event => {
            if (!visible || !hasFrame) return;
            const coordinates = point(event);
            const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? frameSize.current.height : 1;
            send({ type: 'wheel', ...coordinates, deltaX: event.deltaX * factor, deltaY: event.deltaY * factor });
          }} />
        <textarea ref={inputRef} className="browser-keyboard-input" aria-label={t('browser.keyboard')}
          autoComplete="off" autoCapitalize="off" spellCheck={false}
          onKeyDown={event => key(event, 'keydown')} onKeyUp={event => key(event, 'keyup')}
          onInput={textInput} onCompositionStart={() => { composing.current = true; compositionText.current = ''; }}
          onCompositionEnd={event => {
            composing.current = false;
            const text = event.data || event.currentTarget.value;
            compositionText.current = text;
            event.currentTarget.value = '';
            if (text) send({ type: 'text', text: text.slice(0, 8192) });
          }}
          onPaste={event => {
            event.preventDefault();
            const text = event.clipboardData.getData('text');
            event.currentTarget.value = '';
            if (text) send({ type: 'text', text: text.slice(0, 8192) });
          }}
          onBlur={() => { sentKeys.current.clear(); send({ type: 'release' }); }} />
        {(!hasFrame || connection !== 'connected') && <div className="browser-stream-status" role="status">
          {connection !== 'failed' && <div className="loading-spinner" />}
          <span>{t(connection === 'failed' ? 'browser.connectionFailed' : 'browser.connecting')}</span>
        </div>}
      </div>
    );
  }
  Object.assign(window.GameTierApp, { BrowserCanvas });
})();
