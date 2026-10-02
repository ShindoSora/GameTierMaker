(() => {
  'use strict';

  const { useState, useRef, useEffect, useLayoutEffect } = React;
  const { getIslandOrigin, ISLAND_DURATION, ISLAND_OPEN_EASING, ISLAND_CLOSE_EASING } = window.GameTierApp;
  function useIslandPanel({ open, width, anchorRef, fallbackRef }) {
    const [phase, setPhase] = useState(open ? 'open' : 'closed');
    const panelRef = useRef(null), contentRef = useRef(null), backdropRef = useRef(null);
    const motions = useRef([]), previousOpen = useRef(open);
    const cancel = () => {
      for (const motion of motions.current) { motion.onfinish = null; motion.cancel(); }
      motions.current = [];
    };
    useEffect(() => () => cancel(), []);
    useEffect(() => {
      const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      const onChange = () => {
        if (!media?.matches) return;
        cancel(); setPhase(previousOpen.current ? 'open' : 'closed');
      };
      media?.addEventListener?.('change', onChange);
      return () => media?.removeEventListener?.('change', onChange);
    }, []);
    useLayoutEffect(() => {
      const changed = previousOpen.current !== open;
      previousOpen.current = open;
      const panel = panelRef.current, content = contentRef.current, backdrop = backdropRef.current;
      const anchor = anchorRef?.current?.isConnected ? anchorRef.current : fallbackRef?.current;
      const moving = motions.current[0] && ['running', 'pending'].includes(motions.current[0].playState);
      const computed = moving && panel ? getComputedStyle(panel) : null;
      const from = computed ? { transform: computed.transform, borderRadius: computed.borderRadius, opacity: computed.opacity } : null;
      const contentOpacity = moving && content ? Number(getComputedStyle(content).opacity) : open ? 0 : 1;
      const backdropOpacity = moving && backdrop ? Number(getComputedStyle(backdrop).opacity) : open ? 0 : 1;
      cancel();
      if (!changed || !panel?.animate || !content?.animate || !anchor ||
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        setPhase(open ? 'open' : 'closed'); return;
      }
      const bounds = panel.getBoundingClientRect(), originBounds = anchor.getBoundingClientRect();
      if (!bounds.width || !bounds.height || !originBounds.width || !originBounds.height) {
        setPhase(open ? 'open' : 'closed'); return;
      }
      const origin = getIslandOrigin(bounds, originBounds, parseFloat(getComputedStyle(anchor).borderRadius) || 12);
      const full = { transform: 'none', borderRadius: getComputedStyle(panel).borderRadius, opacity: 1 };
      const options = { duration: ISLAND_DURATION, easing: open ? ISLAND_OPEN_EASING : ISLAND_CLOSE_EASING, fill: 'both' };
      const shell = panel.animate(open ? [from || origin, full]
        : [from || full, { opacity: 1, offset: 0.85 }, { ...origin, opacity: 0 }], options);
      motions.current = [shell, content.animate(open
        ? [{ opacity: contentOpacity }, { opacity: contentOpacity, offset: 0.2 }, { opacity: 1 }]
        : [{ opacity: contentOpacity }, { opacity: 0, offset: 0.3 }, { opacity: 0 }], { ...options, easing: 'linear' })];
      if (backdrop?.animate) motions.current.push(backdrop.animate(
        [{ opacity: backdropOpacity }, { opacity: open ? 1 : 0 }], { ...options, easing: 'linear' }));
      setPhase(open ? 'opening' : 'closing');
      if (!open && panel.contains(document.activeElement)) anchor.focus?.({ preventScroll: true });
      shell.onfinish = () => {
        if (motions.current[0] !== shell) return;
        setPhase(open ? 'open' : 'closed');
      };
    }, [open, width]);
    useLayoutEffect(() => {
      if ((phase === 'open' || phase === 'closed') && motions.current[0]?.playState === 'finished') cancel();
    }, [phase]);
    return { visible: open || phase !== 'closed', phase, panelRef, contentRef, backdropRef };
  }
  Object.assign(window.GameTierApp, { useIslandPanel });
})();
