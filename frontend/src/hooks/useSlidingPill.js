(() => {
  'use strict';
  const {useRef, useLayoutEffect, useEffect} = React;
  const AXES = ['x', 'y', 'width', 'height'];

  function advancePillSpring(position, velocity, target, elapsed) {
    const duration = Math.max(0, Math.min(.064, elapsed));
    const steps = Math.max(1, Math.ceil(duration / (1 / 120)));
    const dt = duration / steps;
    for (let step = 0; step < steps; step++) {
      for (const axis of AXES) {
        velocity[axis] += (520 * (target[axis] - position[axis]) - 34 * velocity[axis]) * dt;
        position[axis] += velocity[axis] * dt;
      }
    }
  }

  function createSlidingPillController(host, pill, buttons) {
    if (typeof pill.animate === 'function') return createMorphPillController(host, pill, buttons);
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let key = null, position = null, target = null, frame = 0, lastTime = 0, disposed = false, paused = false;
    let observed = [];
    let velocity = {x:0, y:0, width:0, height:0}, pointer = null;
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => measure()) : null;
    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0; lastTime = 0;
    };
    const draw = () => {
      if (disposed || paused || !position) return;
      const energy = Math.min(1, (Math.abs(velocity.x) + Math.abs(velocity.y)
        + Math.abs(velocity.width) * .5) / 1600);
      pill.style.width = `${Math.max(1, position.width)}px`;
      pill.style.height = `${Math.max(1, position.height)}px`;
      pill.style.transform = `translate3d(${position.x}px, ${position.y}px, 0) scale(${1 + energy * .045}, ${1 - energy * .035})`;
      pill.style.setProperty('--pill-energy', energy.toFixed(3));
      let reflection = .35 + Math.max(-.25, Math.min(.35, velocity.x / 2400));
      if (pointer !== null && !media?.matches) {
        const bounds = pill.getBoundingClientRect();
        reflection = Math.max(0, Math.min(1, (pointer - bounds.left) / Math.max(1, bounds.width)));
      }
      pill.style.setProperty('--pill-reflection-x', `${reflection * 100}%`);
      pill.style.setProperty('--shine-x', `${reflection * 100}%`);
      pill.style.visibility = 'visible';
    };
    const snap = () => {
      stop();
      if (target) position = {...target};
      velocity = {x:0, y:0, width:0, height:0};
      draw();
    };
    const tick = now => {
      frame = 0;
      if (disposed || !position || !target) return;
      const elapsed = lastTime ? (now - lastTime) / 1000 : 1 / 60;
      lastTime = now;
      advancePillSpring(position, velocity, target, elapsed);
      const settled = AXES.every(axis => Math.abs(position[axis] - target[axis]) < .05
        && Math.abs(velocity[axis]) < .2);
      if (settled) snap();
      else { draw(); schedule(); }
    };
    function schedule() {
      if (!disposed && !paused && !frame) frame = window.requestAnimationFrame(tick);
    }
    function measure(instant = false) {
      if (disposed || paused) return;
      const button = buttons[key];
      if (!button || !button.offsetWidth || !button.offsetHeight) {
        stop(); pill.style.visibility = 'hidden'; return;
      }
      // Offset geometry is independent of the enclosing search-panel scale animation.
      target = {x:button.offsetLeft, y:button.offsetTop, width:button.offsetWidth, height:button.offsetHeight};
      if (instant || !position || media?.matches) snap();
      else schedule();
    }
    const motionChange = () => { if (media?.matches) snap(); };
    const resize = () => measure(true);
    window.addEventListener('resize', resize, {passive:true});
    media?.addEventListener?.('change', motionChange);
    return {
      select(nextKey, instant = false) {
        key = nextKey; paused = false;
        const nextObserved = [host, ...Object.values(buttons).filter(Boolean)];
        if (nextObserved.length !== observed.length || nextObserved.some((node,index) => node !== observed[index])) {
          observer?.disconnect(); nextObserved.forEach(node => observer?.observe(node));
          observed = nextObserved;
        }
        measure(instant);
      },
      pointerMove(event) {
        if (paused || media?.matches || event.pointerType === 'touch' || !position) return;
        pointer = event.clientX; schedule();
      },
      pointerLeave() { pointer = null; if (position) schedule(); },
      pause() { paused = true; stop(); pointer = null; velocity = {x:0, y:0, width:0, height:0}; pill.style.visibility = 'hidden'; },
      dispose() {
        disposed = true; stop(); observer?.disconnect();
        pill.style.visibility = 'hidden';
        window.removeEventListener('resize', resize);
        media?.removeEventListener?.('change', motionChange);
      },
    };
  }

  // React adaptation of the supplied indicator: native keyframes preserve the current
  // visual position on interruption; the spring above remains a fallback for older WebViews.
  function createMorphPillController(host, pill, buttons) {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const face = pill.querySelector?.('.search-pill-face');
    let key, target = null, position = null, moveAnimation = null, faceAnimation = null;
    let disposed = false, paused = false, observed = [], pointer = null, pointerFrame = 0;
    const lerp = (a,b,t) => a + (b-a)*t;
    const cancel = () => {
      if (moveAnimation) { moveAnimation.onfinish = null; moveAnimation.cancel(); moveAnimation = null; }
      faceAnimation?.cancel(); faceAnimation = null;
      pill.style.willChange = 'auto';
    };
    const readVisual = () => {
      if (moveAnimation && typeof getComputedStyle === 'function') {
        const style = getComputedStyle(pill);
        const number = (name,fallback) => Number.isFinite(parseFloat(style[name])) ? parseFloat(style[name]) : fallback;
        return {x:number('left',position.x), y:number('top',position.y),
          width:number('width',position.width), height:number('height',position.height),
          radius:style.borderRadius || '12px'};
      }
      return {...position, radius:'12px'};
    };
    const place = next => {
      if (disposed || paused) return;
      position = {...next};
      Object.assign(pill.style, {left:`${next.x}px`, top:`${next.y}px`, width:`${next.width}px`,
        height:`${next.height}px`, transform:'none', borderRadius:'12px', visibility:'visible'});
    };
    const snap = () => { cancel(); if (target) place(target); pill.style.setProperty('--pill-energy','0'); };
    const measure = (instant = false) => {
      if (disposed || paused) return;
      const button = buttons[key];
      if (!button?.offsetWidth || !button.offsetHeight) { cancel(); pill.style.visibility='hidden'; return; }
      const to = {x:button.offsetLeft,y:button.offsetTop,width:button.offsetWidth,height:button.offsetHeight};
      if (target && AXES.every(axis=>Math.abs(target[axis]-to[axis])<.1) && !instant) return;
      target = to;
      if (!position || instant || media?.matches) { snap(); return; }
      const from = readVisual();
      const faceFrom = faceAnimation && typeof getComputedStyle === 'function' ? getComputedStyle(face).transform : 'scale(1,1)';
      cancel();
      const dx=to.x-from.x, dy=to.y-from.y, distance=Math.hypot(dx,dy);
      const directionX=distance ? dx/distance : 1, directionY=distance ? dy/distance : 0;
      const stretch=Math.min(38,distance*.22);
      place(to);
      pill.style.willChange='left,top,width,border-radius';
      pill.style.setProperty('--pill-energy','1');
      const frames=[
        {left:`${from.x}px`,top:`${from.y}px`,width:`${from.width}px`,height:`${from.height}px`,borderRadius:from.radius,offset:0},
        {left:`${lerp(from.x,to.x,.35)-(directionX>0?stretch*.15:stretch*.45)}px`,
          top:`${lerp(from.y,to.y,.35)}px`,width:`${lerp(from.width,to.width,.35)+stretch}px`,
          height:`${lerp(from.height,to.height,.35)}px`,borderRadius:'19px',offset:.32},
        {left:`${to.x+directionX*9}px`,top:`${to.y+directionY*9}px`,width:`${to.width*.91}px`,height:`${to.height}px`,borderRadius:'13px',offset:.67},
        {left:`${to.x-directionX*4}px`,top:`${to.y-directionY*4}px`,width:`${to.width*1.04}px`,height:`${to.height}px`,borderRadius:'12px',offset:.84},
        {left:`${to.x}px`,top:`${to.y}px`,width:`${to.width}px`,height:`${to.height}px`,borderRadius:'12px',offset:1},
      ];
      try {
        const motion=pill.animate(frames,{duration:720,easing:'cubic-bezier(.22,.78,.24,1)',fill:'both'});
        moveAnimation=motion;
        if (face?.animate) faceAnimation=face.animate([
          {transform:faceFrom,offset:0}, {transform:'scale(1.12,.89)',offset:.3},
          {transform:'scale(.94,1.07)',offset:.7}, {transform:'scale(1.025,.98)',offset:.87},
          {transform:'scale(1,1)',offset:1},
        ],{duration:720,easing:'ease-in-out',fill:'both'});
        motion.onfinish=()=>{if(moveAnimation===motion) snap();};
      } catch (_) { snap(); }
    };
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>measure()):null;
    const motionChange=()=>{if(media?.matches) snap();};
    const resize=()=>measure(true);
    window.addEventListener('resize',resize,{passive:true});
    media?.addEventListener?.('change',motionChange);
    const stopPointer=()=>{if(pointerFrame)window.cancelAnimationFrame(pointerFrame);pointerFrame=0;};
    return {
      select(nextKey,instant=false){
        key=nextKey;paused=false;
        const next=[host,...Object.values(buttons).filter(Boolean)];
        if(next.length!==observed.length||next.some((node,index)=>node!==observed[index])){
          observer?.disconnect();next.forEach(node=>observer?.observe(node));observed=next;
        }
        measure(instant);
      },
      pointerMove(event){
        if(disposed||paused||media?.matches||event.pointerType==='touch')return;
        pointer=event.clientX;
        if(!pointerFrame)pointerFrame=window.requestAnimationFrame(()=>{
          pointerFrame=0;if(disposed||paused||media?.matches||pointer===null)return;
          const rect=pill.getBoundingClientRect();
          const percent=Math.max(0,Math.min(100,(pointer-rect.left)/Math.max(1,rect.width)*100));
          pill.style.setProperty('--shine-x',`${percent}%`);
        });
      },
      pointerLeave(){stopPointer();pointer=null;pill.style.setProperty('--shine-x','30%');},
      pause(){if(position)position=readVisual();paused=true;cancel();stopPointer();pointer=null;pill.style.visibility='hidden';},
      dispose(){disposed=true;cancel();stopPointer();pill.style.visibility='hidden';observer?.disconnect();window.removeEventListener('resize',resize);media?.removeEventListener?.('change',motionChange);},
    };
  }

  function useSlidingPill({selectedKey, layoutKey, visible, buttonsRef}) {
    const hostRef = useRef(null), pillRef = useRef(null), controllerRef = useRef(null);
    const previousHost = useRef(null), wasVisible = useRef(false);
    useLayoutEffect(() => {
      const host = hostRef.current, pill = pillRef.current;
      if (!visible || !host || !pill) {
        controllerRef.current?.dispose();
        controllerRef.current = null; previousHost.current = null; wasVisible.current = false;
        return;
      }
      if (host !== previousHost.current) {
        controllerRef.current?.dispose();
        controllerRef.current = createSlidingPillController(host, pill, buttonsRef.current);
        previousHost.current = host;
      }
      controllerRef.current.select(selectedKey, !wasVisible.current);
      wasVisible.current = true;
    }, [selectedKey, layoutKey, visible]);
    useEffect(() => () => controllerRef.current?.dispose(), []);
    return {hostRef, pillRef,
      onPointerMove:event => controllerRef.current?.pointerMove(event),
      onPointerLeave:() => controllerRef.current?.pointerLeave()};
  }
  Object.assign(window.GameTierApp, {advancePillSpring, createSlidingPillController, useSlidingPill});
})();
