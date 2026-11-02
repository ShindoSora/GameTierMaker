(() => {
  'use strict';
  const splash = document.getElementById('startup-splash');
  const root = document.getElementById('root');
  if (!splash || !root) return;
  const started = performance.now();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animations = [];
  const timers = new Set();
  let closed = false, finishing = false, failed = false;
  let english = false;
  try {
    splash.dataset.theme = localStorage.getItem('theme') === 'light' ? 'light' : 'dark';
  } catch (_) { /* Storage may be unavailable during first launch. */ }
  root.inert = true;
  const later = (fn, delay) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, delay);
    timers.add(id);
    return id;
  };
  const copy = () => {
    english = window.GameTierI18n?.getLocale?.() === 'en-US';
    document.getElementById('startup-status').textContent = failed
      ? (english ? 'Loading is taking longer than expected' : '加载时间较长，可以重试')
      : (english ? 'Preparing your gaming universe' : '正在准备你的游戏世界');
    document.getElementById('startup-reload').textContent = english ? 'Reload' : '重新加载';
    document.getElementById('startup-continue').textContent = english ? 'Continue' : '进入界面';
  };
  const release = () => { root.inert = false; };
  const dismiss = (immediate = false) => {
    if (closed) return;
    closed = true;
    timers.forEach(clearTimeout); timers.clear();
    window.removeEventListener('error', resourceError, true);
    window.removeEventListener('pagehide', cleanup);
    release();
    splash.setAttribute('aria-busy', 'false');
    splash.setAttribute('aria-hidden', 'true');
    splash.dataset.leaving = '';
    const remove = () => { animations.forEach(a => a.cancel()); splash.remove(); };
    if (immediate) remove(); else setTimeout(remove, reduced ? 120 : 400);
  };
  const cleanup = () => dismiss(true);
  const fail = () => {
    if (closed) return;
    failed = true; copy();
    splash.dataset.failed = '';
    splash.setAttribute('aria-busy', 'false');
    splash.querySelector('.startup-actions').hidden = false;
    document.getElementById('startup-continue').hidden = !root.querySelector('.app-layout');
  };
  const resourceError = event => {
    if (event.target?.tagName === 'SCRIPT') fail();
  };
  window.addEventListener('error', resourceError, true);
  window.addEventListener('pagehide', cleanup);
  document.getElementById('startup-reload').onclick = () => window.location.reload();
  document.getElementById('startup-continue').onclick = () => dismiss(true);
  // Keep a failed script/request from trapping the user behind an endless animation.
  later(fail, 15000);

  const ready = () => {
    if (closed || finishing) return;
    finishing = true; copy();
    // Wait for React's committed layout and visible covers, with a bounded image wait.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (closed) return;
      const images = [...root.querySelectorAll('img')].filter(img => {
        const rect = img.getBoundingClientRect();
        return !img.complete && rect.width > 0 && rect.height > 0 &&
          rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
      });
      const pending = images.map(img => img.decode ? img.decode().catch(() => {}) : Promise.resolve());
      Promise.race([Promise.all(pending), new Promise(resolve => later(resolve, 1200))]).then(() => {
        if (!closed) later(() => dismiss(), Math.max(0, (reduced ? 0 : 2350) - (performance.now() - started)));
      });
    }));
  };
  window.GameTierStartup = { ready, dismiss: () => dismiss(true), fail };

  const platforms = [
    ['steam', 'Steam', '#66c0f4', -1, -1],
    ['playstation', 'PlayStation', '#4e84ff', 1, -1],
    ['xbox', 'Xbox', '#62c650', -1, 1],
    ['nintendoswitch', 'Nintendo Switch', '#ff5264', 1, 1],
  ];
  const animate = (node, frames, options) => {
    const animation = node.animate(frames, options); animations.push(animation); return animation;
  };
  const dot = (className, color) => {
    const node = document.createElement('span'); node.className = className;
    node.setAttribute('aria-hidden', 'true'); node.style.setProperty('--platform-color', color);
    splash.appendChild(node); return node;
  };
  platforms.forEach(([slug, label, color, sx, sy]) => {
    const logo = dot('startup-logo', color);
    const img = document.createElement('img'); img.src = `/assets/platforms/${slug}.svg`;
    img.alt = label; logo.appendChild(img);
    const ex = sx * 99, ey = sy * 67;
    logo.style.transform = `translate(${ex}px, ${ey}px)`;
    if (reduced || !logo.animate) return;
    const frames = [];
    for (let i = 0; i <= 80; i++) {
      const time = i / 80;
      let x, y, scale;
      if (time < .52) {
        const t = time / .52, ease = t * t * (3 - 2 * t);
        x = sx * ((innerWidth / 2 - 68) * (1 - ease) + 15 * ease);
        y = sy * ((innerHeight * (sy < 0 ? .44 : .56) - 64) * (1 - ease) + 12 * ease) - 42 * Math.sin(t * Math.PI);
        scale = .8 + .15 * Math.sin(t * Math.PI);
      } else {
        const t = (time - .52) / .48, ease = 1 - Math.pow(1 - t, 3);
        x = sx * 15 + (ex - sx * 15) * ease;
        y = sy * 12 + (ey - sy * 12) * ease - 64 * Math.sin(t * Math.PI);
        scale = .78 + .22 * ease;
      }
      frames.push({offset:time,transform:`translate(${x}px, ${y}px) scale(${scale})`,opacity:Math.min(1,time*12)});
    }
    // Transform-only keyframes keep moving while Babel is busy on the main thread.
    for (let j = 0; j < 9; j++) {
      const tail = dot('startup-trail', color);
      animate(tail, frames.map(f => ({...f,opacity:f.offset > .85 ? 0 : (1-j/10)*.5,
        transform:f.transform.replace(/scale\([^)]+\)/, `scale(${1-j*.08})`)})),
        {duration:2100,delay:j*19,fill:'both',easing:'linear'});
    }
    animate(logo, frames, {duration:2100,fill:'both',easing:'linear'});
    for (let j = 0; j < 8; j++) {
      const spark = dot('startup-spark', color), angle = (j/8)*Math.PI*2 + sx*.3;
      const distance = 66 + j*10;
      animate(spark, [
        {transform:'translate(0px, 0px) scale(.8)',opacity:0},
        {offset:.1,opacity:.85},
        {offset:.65,transform:`translate(${Math.cos(angle)*distance}px, ${Math.sin(angle)*distance-28}px) scale(.6)`,opacity:.5},
        {transform:`translate(${Math.cos(angle)*distance*1.2}px, ${Math.sin(angle)*distance+48}px) scale(0)`,opacity:0},
      ], {duration:850+j*30,delay:1060,fill:'both',easing:'cubic-bezier(.16,.7,.3,1)'});
    }
  });
  if (!reduced && splash.animate) {
    const flash = dot('startup-flash', '#b4d2ff');
    animate(flash, [{transform:'scale(.1)',opacity:0},{offset:.15,opacity:.65},
      {transform:'scale(2.6)',opacity:0}], {delay:1060,duration:800,fill:'both'});
  }
})();
