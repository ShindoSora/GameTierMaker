(() => {
  'use strict';

  const { useState, useRef, useLayoutEffect, useCallback } = React;
  const { getTierTheme } = window.GameTierApp;
  const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

  function reconcileTierRows(previous, tiers) {
    const byId = new Map(previous.map(entry => [entry.tier.id, entry]));
    const ids = new Set(tiers.map(tier => tier.id));
    const next = tiers.map(tier => ({ tier,
      phase: byId.has(tier.id) && byId.get(tier.id).phase !== 'exiting'
        ? byId.get(tier.id).phase : 'entering' }));
    previous.forEach((entry, index) => {
      if (!ids.has(entry.tier.id)) next.splice(Math.min(index, next.length), 0, { ...entry, phase: 'exiting' });
    });
    return next;
  }

  function useTierPresence(templateId, tiers) {
    const [state, setState] = useState(() => ({ templateId, tiers,
      entries: tiers.map(tier => ({ tier, phase: 'stable' })) }));
    // Derive presence before committing children, avoiding one frame of full-sized new rows.
    if (state.templateId !== templateId || state.tiers !== tiers) {
      setState({ templateId, tiers, entries: state.templateId !== templateId
        ? tiers.map(tier => ({ tier, phase: 'stable' })) : reconcileTierRows(state.entries, tiers) });
    }
    const complete = useCallback((id, phase) => {
      setState(value => value.templateId !== templateId ? value : ({ ...value, entries: value.entries.flatMap(entry => {
        if (entry.tier.id !== id || entry.phase !== phase) return [entry];
        return phase === 'exiting' ? [] : [{ ...entry, phase: 'stable' }];
      }) }));
    }, [templateId]);
    return { entries: state.entries, complete };
  }

  // Quadratic corners keep the seed's six sides rounded as the bevel becomes a rectangle.
  function getTierSeedPath(fullWidth, height, progress) {
    const p = clamp(progress), width = Math.min(fullWidth, 48 + (fullWidth - 48) * p);
    const left = (fullWidth - width) / 2, right = left + width;
    const bevel = Math.min(11, height * .28) * (1 - p);
    const radius = 8 + 16 * p;
    const points = [[left + bevel, 0], [right - bevel, 0], [right, height / 2],
      [right - bevel, height], [left + bevel, height], [left, height / 2]];
    const corners = points.map((point, index) => {
      const before = points[(index + 5) % 6], after = points[(index + 1) % 6];
      const a = Math.hypot(point[0] - before[0], point[1] - before[1]);
      const b = Math.hypot(after[0] - point[0], after[1] - point[1]);
      const r = Math.min(radius, a / 2, b / 2);
      return { point, start: [point[0] + (before[0] - point[0]) * r / Math.max(a, .001),
        point[1] + (before[1] - point[1]) * r / Math.max(a, .001)],
      end: [point[0] + (after[0] - point[0]) * r / Math.max(b, .001),
        point[1] + (after[1] - point[1]) * r / Math.max(b, .001)] };
    });
    return corners.map((corner, index) => `${index ? 'L' : 'M'}${corner.start.join(',')} Q${corner.point.join(',')} ${corner.end.join(',')}`).join(' ') + ' Z';
  }

  function createTierSlotMotion(slot, body, row, outline, initialPhase, onComplete) {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let phase = initialPhase, progress = phase === 'entering' ? 0 : 1, speed = 0;
    let height = phase === 'entering' ? 0 : body.offsetHeight, heightSpeed = 0;
    let frame = 0, timer = 0, last = null, elapsed = 0, disposed = false;
    const cancel = () => {
      if (frame) window.cancelAnimationFrame(frame);
      clearTimeout(timer); frame = 0; timer = 0; last = null;
    };
    const resetRow = () => {
      row.style.clipPath = ''; row.style.transform = ''; row.style.opacity = '';
      outline.style.display = 'none';
    };
    const complete = () => {
      if (disposed) return;
      cancel(); slot.style.willChange = 'auto';
      if (phase !== 'exiting') { slot.style.height = 'auto'; resetRow(); slot.dataset.tierStage = 'stable'; }
      onComplete(phase);
    };
    const paint = () => {
      slot.style.height = `${Math.max(0, height)}px`;
      if (phase !== 'entering') return;
      const p = clamp(progress), rowHeight = row.offsetHeight;
      // The shell grows; text and images retain their real dimensions throughout.
      const path = getTierSeedPath(slot.clientWidth, 32 + (rowHeight - 32) * p, p);
      row.style.clipPath = `path('${path}')`;
      row.style.opacity = String(clamp(elapsed / .1));
      row.style.transform = `translateY(${-5 * (1 - clamp(elapsed / .14))}px)`;
      outline.style.height = `${rowHeight}px`;
      outline.style.opacity = row.style.opacity;
      outline.style.transform = row.style.transform;
      outline.querySelector('path').setAttribute('d', path);
    };
    const shapeDone = () => {
      if (phase === 'exiting') { complete(); return; }
      progress = 1; height = body.offsetHeight; paint(); resetRow();
      slot.style.willChange = 'auto'; slot.dataset.tierStage = 'revealing';
      timer = setTimeout(complete, 340);
    };
    const step = now => {
      frame = 0;
      if (disposed) return;
      const dt = clamp(last === null ? 1 / 60 : (now - last) / 1000, .001, .032);
      last = now; elapsed += dt;
      const target = phase === 'exiting' ? 0 : 1, targetHeight = phase === 'exiting' ? 0 : body.offsetHeight;
      const count = Math.ceil(dt * 120), h = dt / count;
      for (let i = 0; i < count; i++) {
        if (phase !== 'entering' || elapsed > .075) {
          speed += (360 * (target - progress) - 28 * speed) * h;
          progress += speed * h;
        }
        heightSpeed += (360 * (targetHeight - height) - 28 * heightSpeed) * h;
        height += heightSpeed * h;
      }
      paint();
      if ((Math.abs(progress - target) < .001 && Math.abs(speed) < .015
        && Math.abs(height - targetHeight) < .15 && Math.abs(heightSpeed) < 1) || elapsed > 1.2) shapeDone();
      else frame = window.requestAnimationFrame(step);
    };
    const resize = () => { if (phase === 'entering' && frame) paint(); };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(body);
    window.addEventListener('resize', resize, { passive: true });
    const motionChange = () => { if (media?.matches && phase !== 'stable') complete(); };
    media?.addEventListener?.('change', motionChange);
    return {
      select(nextPhase) {
        if (phase === 'stable' || timer) { height = body.offsetHeight; heightSpeed = 0; progress = 1; speed = 0; }
        cancel(); phase = nextPhase; elapsed = 0;
        slot.dataset.tierStage = phase;
        if (phase === 'stable') { slot.style.height = 'auto'; slot.style.willChange = 'auto'; resetRow(); return; }
        if (media?.matches || !slot.clientWidth || !row.offsetHeight) { complete(); return; }
        outline.style.display = phase === 'entering' ? 'block' : 'none';
        slot.style.willChange = 'height'; paint(); frame = window.requestAnimationFrame(step);
      },
      dispose() {
        disposed = true; cancel(); observer?.disconnect(); resetRow();
        slot.style.willChange = 'auto';
        window.removeEventListener('resize', resize);
        media?.removeEventListener?.('change', motionChange);
      },
    };
  }

  function TierMotionSlot({ tier, phase, onComplete, children }) {
    const slotRef = useRef(null), bodyRef = useRef(null), outlineRef = useRef(null), motionRef = useRef(null);
    const completeRef = useRef(onComplete); completeRef.current = onComplete;
    useLayoutEffect(() => {
      motionRef.current = createTierSlotMotion(slotRef.current, bodyRef.current,
        bodyRef.current.querySelector('[data-tier-row-id]'), outlineRef.current, phase,
        completedPhase => completeRef.current(tier.id, completedPhase));
      return () => motionRef.current.dispose();
    }, []);
    useLayoutEffect(() => { motionRef.current.select(phase); }, [phase]);
    return (
      <div ref={slotRef} className="tier-motion-slot" data-tier-presence={phase}
        inert={phase === 'stable' ? undefined : ''} aria-hidden={phase === 'exiting' || undefined}
        style={getTierTheme(tier.color)}>
        <div ref={bodyRef} className="tier-motion-body">
          {children}
          <svg ref={outlineRef} className="tier-entry-outline" aria-hidden="true"><path /></svg>
        </div>
      </div>
    );
  }

  function createUnassignedMotion(outer, inner) {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let height = inner.offsetHeight, target = height, speed = 0, frame = 0, last = null, elapsed = 0, disposed = false;
    const settle = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0; last = null; height = target; speed = 0;
      outer.style.height = 'auto'; outer.style.overflow = ''; outer.style.willChange = 'auto';
    };
    const step = now => {
      frame = 0; if (disposed) return;
      const dt = clamp(last === null ? 1 / 60 : (now - last) / 1000, .001, .032);
      last = now; elapsed += dt;
      const count = Math.ceil(dt * 120), h = dt / count;
      for (let i = 0; i < count; i++) {
        speed += (360 * (target - height) - 28 * speed) * h; height += speed * h;
      }
      outer.style.height = `${Math.max(0, height)}px`;
      if ((Math.abs(height - target) < .15 && Math.abs(speed) < 1) || elapsed > 1.2) settle();
      else frame = window.requestAnimationFrame(step);
    };
    const measure = () => {
      if (disposed || inner.offsetHeight === target) return;
      target = inner.offsetHeight; elapsed = 0;
      if (media?.matches) { settle(); return; }
      outer.style.height = `${height}px`; outer.style.overflow = 'clip'; outer.style.willChange = 'height';
      if (!frame) { last = null; frame = window.requestAnimationFrame(step); }
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(inner);
    const motionChange = () => { if (media?.matches) settle(); };
    media?.addEventListener?.('change', motionChange);
    window.addEventListener('resize', measure, { passive: true });
    return { measure, dispose() { disposed = true; settle(); observer?.disconnect();
      media?.removeEventListener?.('change', motionChange); window.removeEventListener('resize', measure); } };
  }

  function UnassignedMotion({ children }) {
    const outerRef = useRef(null), innerRef = useRef(null), motionRef = useRef(null);
    useLayoutEffect(() => {
      motionRef.current = createUnassignedMotion(outerRef.current, innerRef.current);
      return () => motionRef.current.dispose();
    }, []);
    useLayoutEffect(() => { motionRef.current.measure(); });
    return <div ref={outerRef} className="unsorted-section"><div ref={innerRef} className="unsorted-motion-body">{children}</div></div>;
  }

  Object.assign(window.GameTierApp, { reconcileTierRows, useTierPresence, getTierSeedPath,
    createTierSlotMotion, TierMotionSlot, createUnassignedMotion, UnassignedMotion });
})();
