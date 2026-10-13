(() => {
  'use strict';

  const { useRef, useState, useLayoutEffect, useCallback } = React;
  const HEADER_HEIGHT = 52;
  const KEYS = ['left', 'top', 'width', 'height', 'radius'];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  // Offset coordinates stay correct while the whole library has an island transform.
  function getSearchPanelBounds(host, dock, minimized) {
    let left = 0, top = 0, node = dock;
    while (node && node !== host) {
      left += node.offsetLeft || 0;
      top += node.offsetTop || 0;
      node = node.offsetParent;
    }
    if (node !== host || !dock.offsetWidth || !host.clientHeight) return null;
    const fullHeight = Math.max(HEADER_HEIGHT, host.clientHeight - top - 16);
    return { left, top, width: dock.offsetWidth,
      height: minimized ? HEADER_HEIGHT : fullHeight,
      radius: minimized ? 26 : 18, fullHeight };
  }

  function createSearchPanelMorphController(panel, host, dock, onPhase = () => {}, initialGeometry = null) {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let current = initialGeometry, target = null, minimized = true, frame = 0;
    let lastTime = null, elapsed = 0, disposed = false, suspended = false;
    const velocity = Object.fromEntries(KEYS.map(key => [key, 0]));
    const cancel = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0; lastTime = null;
    };
    const paint = (energy = 0) => {
      // A few pixels of lateral tension, never a scale transform on text or icons.
      const tension = Math.min(2.4, current.width * .006) * energy;
      panel.style.left = `${current.left + tension / 2}px`;
      panel.style.top = `${current.top}px`;
      panel.style.width = `${Math.max(1, current.width - tension)}px`;
      panel.style.height = `${Math.max(HEADER_HEIGHT, current.height)}px`;
      panel.style.borderRadius = `${current.radius}px`;
      panel.style.setProperty('--search-morph-energy', energy.toFixed(3));
      const progress = clamp((current.height - HEADER_HEIGHT) /
        Math.max(1, target.fullHeight - HEADER_HEIGHT), 0, 1);
      // Clip the content as the shell shrinks; retain the inner scroll viewport size.
      panel.style.setProperty('--search-content-opacity',
        clamp((progress - .12) / .6, 0, 1).toFixed(3));
      panel.style.setProperty('--search-content-height', `${target.fullHeight - HEADER_HEIGHT}px`);
      panel.style.setProperty('--search-radius', `${current.radius}px`);
    };
    const snap = () => {
      cancel();
      if (!target) return;
      current = { ...target };
      KEYS.forEach(key => { velocity[key] = 0; });
      paint(); panel.style.willChange = 'auto';
      onPhase(minimized ? 'collapsed' : 'expanded');
    };
    const step = time => {
      frame = 0;
      if (disposed || !target) return;
      const dt = clamp(lastTime === null ? 1 / 60 : (time - lastTime) / 1000, .001, .032);
      lastTime = time; elapsed += dt;
      // Substeps keep the physical spring stable on low refresh rate displays.
      const count = Math.ceil(dt / (1 / 120)), h = dt / count;
      for (let i = 0; i < count; i++) KEYS.forEach(key => {
        velocity[key] += (360 * (target[key] - current[key]) - 30 * velocity[key]) * h;
        current[key] += velocity[key] * h;
      });
      const energy = clamp(Math.abs(velocity.height) /
        Math.max(1, target.fullHeight - HEADER_HEIGHT) / 7, 0, 1);
      paint(energy);
      const settled = KEYS.every(key => Math.abs(target[key] - current[key]) < .2 && Math.abs(velocity[key]) < 2);
      if (settled || elapsed > 1.2) snap();
      else frame = window.requestAnimationFrame(step);
    };
    const measure = (instant = false) => {
      if (disposed) return;
      const next = getSearchPanelBounds(host, dock, minimized);
      if (!next) return;
      target = next;
      if (!current) {
        current = getSearchPanelBounds(host, dock, true);
        paint();
      }
      if (instant || suspended || media?.matches) { snap(); return; }
      onPhase(minimized ? 'closing' : 'opening');
      elapsed = 0;
      panel.style.willChange = 'left, top, width, height, border-radius';
      // A reversal keeps both the visible geometry and spring velocity intact.
      if (!frame) { lastTime = null; frame = window.requestAnimationFrame(step); }
    };
    const resize = () => measure(!frame);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(host); observer?.observe(dock);
    window.addEventListener('resize', resize, { passive: true });
    const motionChange = () => { if (media?.matches) snap(); };
    media?.addEventListener?.('change', motionChange);
    return {
      select(nextMinimized, instant = false) {
        minimized = !!nextMinimized; suspended = instant; measure(instant);
      },
      pointerMove(event) {
        if (disposed || media?.matches || event.pointerType === 'touch') return;
        const rect = panel.getBoundingClientRect();
        panel.style.setProperty('--search-light-x', `${clamp((event.clientX - rect.left) / Math.max(1, rect.width) * 100, 0, 100)}%`);
        panel.style.setProperty('--search-light-y', `${clamp((event.clientY - rect.top) / Math.max(1, rect.height) * 100, 0, 100)}%`);
        panel.style.setProperty('--search-light-presence', '1');
      },
      pointerLeave() { panel.style.setProperty('--search-light-presence', '0'); },
      dispose() {
        disposed = true; cancel(); observer?.disconnect();
        window.removeEventListener('resize', resize);
        media?.removeEventListener?.('change', motionChange);
        panel.style.willChange = 'auto';
      },
    };
  }

  function useSearchPresentation({ data, loading, minimized, source }) {
    const snapshot = useRef(null), activeRef = useRef(false);
    const [, render] = useState(0);
    const active = !!(data || loading);
    activeRef.current = active;
    if (active) snapshot.current = { data, loading, minimized, source };
    const onExitComplete = useCallback(() => {
      if (!activeRef.current && snapshot.current) {
        snapshot.current = null;
        render(value => value + 1);
      }
    }, []);
    return { ...(snapshot.current || { data: null, loading: false, minimized: false, source: 'all' }),
      visible: !!snapshot.current, exiting: !active && !!snapshot.current, onExitComplete };
  }

  function createSearchExitTransition(panel, dock, onComplete, instant = false) {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let finished = false;
    const motions = [];
    const stop = () => {
      motions.forEach(motion => { motion.onfinish = null; motion.cancel(); });
      media?.removeEventListener?.('change', motionChange);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      if (dock) { dock.style.height = '0px'; dock.style.marginTop = '0px'; }
      if (panel) { panel.style.opacity = '0'; panel.style.willChange = 'auto'; }
      stop(); onComplete?.();
    };
    const motionChange = () => { if (media?.matches) finish(); };
    if (instant || media?.matches || !panel?.animate || !dock?.animate) {
      finish();
    } else {
      const shell = getComputedStyle(panel), slot = getComputedStyle(dock);
      const width = parseFloat(shell.width), height = parseFloat(shell.height), left = parseFloat(shell.left);
      const slotHeight = slot.height, slotMargin = slot.marginTop;
      // Animate actual flow space, so the groups below move without a final layout jump.
      dock.style.height = '0px'; dock.style.marginTop = '0px';
      const options = { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' };
      motions.push(panel.animate([
        { opacity: shell.opacity, transform: shell.transform },
        { opacity: 0, transform: 'translateY(-6px)', width: `${Math.max(1, width - 8)}px`,
          left: `${left + 4}px`, height: `${Math.max(0, height - 8)}px` },
      ], options));
      motions.push(dock.animate([
        { height: slotHeight, marginTop: slotMargin }, { height: '0px', marginTop: '0px' },
      ], options));
      panel.style.willChange = 'opacity, transform, width, height';
      // Removal follows the layout animation, not a timer or the opacity fade.
      motions[1].onfinish = finish;
      media?.addEventListener?.('change', motionChange);
    }
    return {
      interrupt() {
        if (finished || !panel || !dock) return null;
        const shell = getComputedStyle(panel), slot = getComputedStyle(dock);
        const visual = { opacity: shell.opacity, transform: shell.transform,
          slotHeight: slot.height, slotMargin: slot.marginTop,
          geometry: { left: parseFloat(shell.left), top: parseFloat(shell.top),
            width: parseFloat(shell.width), height: parseFloat(shell.height), radius: parseFloat(shell.borderRadius) } };
        finished = true; stop();
        Object.assign(panel.style, { opacity: visual.opacity, transform: visual.transform,
          left: `${visual.geometry.left}px`, top: `${visual.geometry.top}px`,
          width: `${visual.geometry.width}px`, height: `${visual.geometry.height}px` });
        Object.assign(dock.style, { height: visual.slotHeight, marginTop: visual.slotMargin });
        return visual;
      },
      dispose() { finished = true; stop(); },
    };
  }

  function useSearchPanelMorph({ active, minimized, covered, hostRef, dockRef, exiting = false, onExitComplete }) {
    const panelRef = useRef(null), toggleRef = useRef(null), controllerRef = useRef(null);
    const exitRef = useRef(null), restoreRef = useRef([]), completeRef = useRef(onExitComplete);
    completeRef.current = onExitComplete;
    const [phase, setPhase] = useState(minimized ? 'collapsed' : 'expanded');
    useLayoutEffect(() => {
      if (!active) {
        controllerRef.current?.dispose(); controllerRef.current = null;
        exitRef.current?.dispose(); exitRef.current = null;
        restoreRef.current.forEach(motion => { motion.onfinish = null; motion.cancel(); });
        restoreRef.current = [];
        return;
      }
      if (exiting) {
        controllerRef.current?.dispose(); controllerRef.current = null;
        restoreRef.current.forEach(motion => { motion.onfinish = null; motion.cancel(); });
        restoreRef.current = [];
        if (!exitRef.current) exitRef.current = createSearchExitTransition(
          panelRef.current, dockRef?.current, () => completeRef.current?.(), covered);
        return;
      }
      const resume = exitRef.current?.interrupt();
      exitRef.current = null;
      if (resume) {
        const panel = panelRef.current, dock = dockRef.current;
        panel.style.opacity = '1'; panel.style.transform = 'none';
        dock.style.height = '52px'; dock.style.marginTop = '10px';
        const options = { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' };
        restoreRef.current = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? [] : [
          panel.animate([{ opacity: resume.opacity, transform: resume.transform }, { opacity: 1, transform: 'none' }], options),
          dock.animate([{ height: resume.slotHeight, marginTop: resume.slotMargin }, { height: '52px', marginTop: '10px' }], options),
        ];
        restoreRef.current.forEach(motion => { motion.onfinish = () => {
          motion.onfinish = null; motion.cancel();
          restoreRef.current = restoreRef.current.filter(item => item !== motion);
        }; });
      }
      // The ancestor's React ref can attach after this child's layout effect.
      const host = hostRef?.current || panelRef.current?.parentElement;
      if (!controllerRef.current && panelRef.current && host && dockRef?.current) {
        controllerRef.current = createSearchPanelMorphController(
          panelRef.current, host, dockRef.current, setPhase, resume?.geometry);
      }
      if (minimized && panelRef.current?.contains(document.activeElement)) {
        toggleRef.current?.focus({ preventScroll: true });
      }
      if (controllerRef.current) controllerRef.current.select(minimized, covered);
      else setPhase(minimized ? 'collapsed' : 'expanded');
    }, [active, minimized, covered, hostRef, dockRef, exiting]);
    useLayoutEffect(() => () => {
      controllerRef.current?.dispose(); controllerRef.current = null;
      exitRef.current?.dispose();
      restoreRef.current.forEach(motion => { motion.onfinish = null; motion.cancel(); });
    }, []);
    return { panelRef, toggleRef, phase,
      onPointerMove: event => controllerRef.current?.pointerMove(event),
      onPointerLeave: () => controllerRef.current?.pointerLeave() };
  }
  Object.assign(window.GameTierApp, { getSearchPanelBounds, createSearchPanelMorphController,
    createSearchExitTransition, useSearchPresentation, useSearchPanelMorph });
})();
