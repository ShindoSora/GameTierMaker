(() => {
  'use strict';

  const GLASS_SURFACES = '.settings-panel.island-panel, .log-sidebar.island-panel, '
    + '.tier-color-dialog, .context-menu, .confirm-dialog, .settings-nav, .glass-range-surface, .search-panel, .search-source-pill';
  const LIGHT_PROPERTIES = ['--glass-light-x', '--glass-light-y', '--glass-light-angle', '--glass-presence'];

  function getGlassLight(bounds, clientX, clientY) {
    const x = Math.max(0, Math.min(1, (clientX - bounds.left) / Math.max(1, bounds.width)));
    const y = Math.max(0, Math.min(1, (clientY - bounds.top) / Math.max(1, bounds.height)));
    return { x, y, angle: Math.atan2(y - .5, x - .5) * 180 / Math.PI + 90 };
  }

  function createLiquidGlassController() {
    const stopRefraction = window.GameTierApp.createGlassRefractionController?.();
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const touched = new Set(), positions = new Map();
    let active = [], point = null, frame = 0, disposed = false;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null;
    const reset = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      active.forEach(element => element.style.setProperty('--glass-presence', '0'));
      active = []; point = null; observer?.disconnect();
    };
    const update = () => {
      frame = 0;
      if (disposed || media?.matches || !point) return;
      let settling = false;
      active.forEach(element => {
        if (!element.isConnected) return;
        const target = getGlassLight(element.getBoundingClientRect(), point.x, point.y);
        const previous = positions.get(element) || {x:.35, y:.15};
        const next = {x:previous.x + (target.x - previous.x) * .24,
          y:previous.y + (target.y - previous.y) * .24};
        const distance = Math.abs(next.x - target.x) + Math.abs(next.y - target.y);
        if (distance < .002) { next.x = target.x; next.y = target.y; }
        else settling = true;
        positions.set(element, next); touched.add(element);
        element.style.setProperty('--glass-light-x', `${(next.x * 100).toFixed(2)}%`);
        element.style.setProperty('--glass-light-y', `${(next.y * 100).toFixed(2)}%`);
        element.style.setProperty('--glass-light-angle', `${target.angle.toFixed(2)}deg`);
        element.style.setProperty('--glass-presence', '1');
      });
      if (settling) schedule();
    };
    function schedule() {
      if (!disposed && !media?.matches && !frame && point) frame = window.requestAnimationFrame(update);
    }
    const move = event => {
      if (media?.matches || event.pointerType === 'touch') return;
      touched.forEach(element => {
        if (!element.isConnected) { touched.delete(element); positions.delete(element); }
      });
      const next = [];
      let element = event.target?.closest?.(GLASS_SURFACES);
      while (element) {
        next.push(element);
        element = element.parentElement?.closest?.(GLASS_SURFACES);
      }
      if (!next.length) { reset(); return; }
      active.filter(element => !next.includes(element))
        .forEach(element => element.style.setProperty('--glass-presence', '0'));
      if (active.length !== next.length || active.some((element, index) => element !== next[index])) {
        observer?.disconnect(); next.forEach(element => observer?.observe(element));
      }
      next.forEach(element => touched.add(element));
      active = next; point = {x:event.clientX, y:event.clientY}; schedule();
    };
    const leave = event => { if (!event.relatedTarget) reset(); };
    const motionChange = () => { if (media?.matches) reset(); };
    document.addEventListener('pointermove', move, {passive:true});
    document.addEventListener('pointerout', leave, {passive:true});
    document.addEventListener('scroll', schedule, {capture:true, passive:true});
    window.addEventListener('resize', schedule, {passive:true});
    window.addEventListener('blur', reset);
    media?.addEventListener?.('change', motionChange);
    return () => {
      stopRefraction?.();
      disposed = true; reset();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('blur', reset);
      media?.removeEventListener?.('change', motionChange);
      touched.forEach(element => LIGHT_PROPERTIES.forEach(name => element.style.removeProperty(name)));
      positions.clear(); touched.clear();
    };
  }

  function LiquidGlassEffects({enabled}) {
    React.useEffect(() => enabled ? createLiquidGlassController() : undefined, [enabled]);
    return null;
  }

  Object.assign(window.GameTierApp, {getGlassLight, createLiquidGlassController, LiquidGlassEffects});
})();
