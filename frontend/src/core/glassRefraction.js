(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const GLASS_OPTICAL_SURFACES = '.settings-panel.island-panel, .log-sidebar.island-panel, '
    + '.tier-color-dialog, .context-menu, .confirm-dialog, .search-panel, '
    + '.search-source-pill, .glass-range-surface, .glass-slider-lens';
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  let filterSequence = 0;

  // CSS scales all corner radii together when adjacent curves overlap.
  function getGlassRadii(style, width, height) {
    const names = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'];
    const radii = names.map(name => {
      const parts = (style[name] || '0').split(/\s+/);
      const length = (part, extent) => (parseFloat(part) || 0) * (part?.endsWith('%') ? extent / 100 : 1);
      return [length(parts[0], width), length(parts[1] || parts[0], height)];
    });
    const [tl, tr, br, bl] = radii;
    const scale = Math.min(1, width / Math.max(1, tl[0] + tr[0]), width / Math.max(1, bl[0] + br[0]),
      height / Math.max(1, tl[1] + bl[1]), height / Math.max(1, tr[1] + br[1]));
    return radii.map(radius => radius.map(value => Math.max(0, value * scale)));
  }

  function getGlassEdgeSample(x, y, width, height, radii) {
    const [tl, tr, br, bl] = radii;
    let corner = null, cx = 0, cy = 0;
    if (x < tl[0] && y < tl[1]) { corner = tl; cx = tl[0]; cy = tl[1]; }
    else if (x > width - tr[0] && y < tr[1]) { corner = tr; cx = width - tr[0]; cy = tr[1]; }
    else if (x > width - br[0] && y > height - br[1]) { corner = br; cx = width - br[0]; cy = height - br[1]; }
    else if (x < bl[0] && y > height - bl[1]) { corner = bl; cx = bl[0]; cy = height - bl[1]; }
    if (corner && corner[0] > 0 && corner[1] > 0) {
      const px = (x - cx) / corner[0], py = (y - cy) / corner[1];
      const radius = Math.hypot(px, py);
      const gx = px / corner[0], gy = py / corner[1], gradient = Math.hypot(gx, gy);
      return {depth: (1 - radius) * radius / Math.max(1e-6, gradient),
        nx: gx / Math.max(1e-6, gradient), ny: gy / Math.max(1e-6, gradient)};
    }
    const distances = [x, width - x, y, height - y];
    const side = distances.indexOf(Math.min(...distances));
    return {depth: distances[side], nx: side === 0 ? -1 : side === 1 ? 1 : 0,
      ny: side === 2 ? -1 : side === 3 ? 1 : 0};
  }

  // A smooth lens shoulder: both displacement and its slope vanish at the band boundaries.
  function glassEdgeProfile(depth, band) {
    const t = clamp(depth / Math.max(1, band), 0, 1);
    return 16 * t * t * (1 - t) * (1 - t);
  }

  function buildGlassDisplacementMap(width, height, radii, scaleX = 1, scaleY = 1, bulged = false) {
    const sx = Math.max(.01, scaleX), sy = Math.max(.01, scaleY);
    const visualWidth = width * sx, visualHeight = height * sy;
    const band = clamp(Math.min(visualWidth, visualHeight) * .22, 5, 22);
    const strength = clamp(band * .62, 2.5, 13);
    const resolution = Math.min(1, Math.sqrt(100000 / Math.max(1, visualWidth * visualHeight)));
    const mapWidth = Math.max(4, Math.ceil(visualWidth * resolution));
    const mapHeight = Math.max(4, Math.ceil(visualHeight * resolution));
    const data = new Uint8ClampedArray(mapWidth * mapHeight * 4);
    const visualRadii = radii.map(([rx, ry]) => [rx * sx, ry * sy]);
    const filterScale = 2 * strength * 1.18 / Math.min(sx, sy);
    const skipDepth = Math.max(band, ...visualRadii.flat());
    for (let row = 0; row < mapHeight; row++) {
      const y = (row + .5) * visualHeight / mapHeight;
      for (let column = 0; column < mapWidth; column++) {
        const x = (column + .5) * visualWidth / mapWidth;
        const offset = (row * mapWidth + column) * 4;
        data[offset] = 128; data[offset + 1] = 128; data[offset + 2] = 128; data[offset + 3] = 255;
        if (!bulged && Math.min(x, visualWidth - x, y, visualHeight - y) > skipDepth) continue;
        const sample = getGlassEdgeSample(x, y, visualWidth, visualHeight, visualRadii);
        if (sample.depth <= 0) continue;
        const amount = sample.depth >= band ? 0 : strength * glassEdgeProfile(sample.depth, band)
          * (1 + .18 * Math.abs(sample.nx * sample.ny) * 2);
        let dx = sample.nx * amount, dy = sample.ny * amount;
        if (bulged) {
          const px = x / visualWidth * 2 - 1, py = y / visualHeight * 2 - 1;
          const shoulder = Math.max(0, 1 - px * px - py * py) ** 2 * strength * 1.2;
          dx += px * shoulder; dy += py * shoulder;
        }
        data[offset] = clamp(Math.round(128 - dx / sx / filterScale * 255), 0, 255);
        data[offset + 1] = clamp(Math.round(128 - dy / sy / filterScale * 255), 0, 255);
      }
    }
    return {data, mapWidth, mapHeight, filterScale, band, strength};
  }

  function createGlassRefractionController() {
    if (!document.createElementNS || !document.body || !window.CSS?.supports?.('backdrop-filter', 'url("#glass-probe")')) return () => {};
    const records = new Map(), cache = new Map();
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    if (!context) return () => {};
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    svg.style.cssText = 'position:fixed;pointer-events:none;overflow:hidden';
    const defs = document.createElementNS(SVG_NS, 'defs'); svg.appendChild(defs);
    document.body.appendChild(svg);
    let frame = 0, disposed = false, discovering = true;
    const forcedColors = window.matchMedia?.('(forced-colors: active)');
    const make = (name, attributes, parent) => {
      const node = document.createElementNS(SVG_NS, name);
      Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
      parent.appendChild(node); return node;
    };
    function schedule() {
      if (!disposed && !frame && !document.hidden) frame = window.requestAnimationFrame(update);
    }
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    const geometryStyle = element => ['width', 'height', 'left', 'top', 'right', 'bottom', 'transform', 'borderRadius']
      .map(name => element.style[name]).join('|');
    const remove = (element, record) => {
      resize?.unobserve(element); record.filter.remove();
      if (record.previousFilter) element.style.setProperty('--glass-refraction-filter', record.previousFilter);
      else element.style.removeProperty('--glass-refraction-filter');
      element.removeAttribute('data-glass-optics'); records.delete(element);
    };
    function discover() {
      const surfaces = new Set(document.querySelectorAll(GLASS_OPTICAL_SURFACES));
      records.forEach((record, element) => { if (!surfaces.has(element)) remove(element, record); });
      surfaces.forEach(element => {
        if (records.has(element)) return;
        const id = `glass-lens-${++filterSequence}`;
        const filter = make('filter', {id, x:0, y:0, width:1, height:1,
          filterUnits:'userSpaceOnUse', primitiveUnits:'userSpaceOnUse', 'color-interpolation-filters':'sRGB'}, defs);
        const image = make('feImage', {x:0, y:0, width:1, height:1, preserveAspectRatio:'none', result:'lens-map'}, filter);
        // 128/255 is not exactly .5. Correct it so the clear center has zero pixel drift.
        const transfer = make('feComponentTransfer', {in:'lens-map', result:'lens-vectors'}, filter);
        ['R', 'G'].forEach(channel => make(`feFunc${channel}`, {type:'linear', slope:1, intercept:-1/510}, transfer));
        const displacement = make('feDisplacementMap', {in:'SourceGraphic', in2:'lens-vectors',
          scale:0, xChannelSelector:'R', yChannelSelector:'G'}, filter);
        records.set(element, {filter, image, displacement, id, key:null, geometryStyle:geometryStyle(element),
          previousFilter:element.style.getPropertyValue('--glass-refraction-filter')});
        resize?.observe(element);
      });
    }
    function update() {
      frame = 0;
      if (disposed) return;
      if (discovering) { discovering = false; discover(); }
      let moving = false;
      records.forEach((record, element) => {
        if (!element.isConnected) { remove(element, record); return; }
        const rect = element.getBoundingClientRect();
        if (forcedColors?.matches || rect.width < 4 || rect.height < 4) {
          element.removeAttribute('data-glass-optics'); return;
        }
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        const width = element.offsetWidth, height = element.offsetHeight;
        if (!width || !height) return;
        const sx = rect.width / width, sy = rect.height / height;
        const radii = getGlassRadii(style, width, height);
        const bulged = element.classList.contains('glass-slider-lens');
        const key = [bulged ? 'knob' : 'panel', width, height, ...radii.flat().map(value => Math.round(value * 2) / 2),
          Math.round(sx * 64) / 64, Math.round(sy * 64) / 64].join(':');
        if (record.key !== key) {
          let map = cache.get(key);
          if (!map) {
            const field = buildGlassDisplacementMap(width, height, radii, sx, sy, bulged);
            canvas.width = field.mapWidth; canvas.height = field.mapHeight;
            const pixels = context.createImageData(field.mapWidth, field.mapHeight);
            pixels.data.set(field.data); context.putImageData(pixels, 0, 0);
            map = {url:canvas.toDataURL('image/png'), scale:field.filterScale};
            cache.set(key, map);
            if (cache.size > 16) cache.delete(cache.keys().next().value);
          }
          record.filter.setAttribute('width', width); record.filter.setAttribute('height', height);
          record.image.setAttribute('width', width); record.image.setAttribute('height', height);
          record.image.setAttribute('href', map.url); record.displacement.setAttribute('scale', map.scale);
          record.key = key;
        }
        element.style.setProperty('--glass-refraction-filter', `url("#${record.id}")`);
        element.setAttribute('data-glass-optics', 'ready');
        record.geometryStyle = geometryStyle(element);
        // WAAPI changes computed radii/scale without touching the style attribute.
        moving ||= ['opening', 'closing', 'expanding', 'collapsing', 'exiting'].includes(
          element.dataset.islandState || element.dataset.searchState || '')
          || (element.getAnimations?.() || []).some(animation => ['running', 'pending'].includes(animation.playState));
      });
      if (moving) schedule();
    }
    const mutations = typeof MutationObserver === 'function' ? new MutationObserver(changes => {
      let dirty = false;
      changes.forEach(change => {
        if (change.target === svg || svg.contains(change.target)) return;
        if (change.type === 'childList' || change.attributeName === 'class') { discovering = true; dirty = true; }
        else if (change.attributeName !== 'style') dirty = true;
        else {
          const record = records.get(change.target);
          // Ignore lighting/filter custom properties; only geometry needs a new lens map.
          if (record && record.geometryStyle !== geometryStyle(change.target)) dirty = true;
          else if (!record && change.target.querySelector?.(GLASS_OPTICAL_SURFACES)) dirty = true;
        }
      });
      if (dirty) schedule();
    }) : null;
    mutations?.observe(document.body, {subtree:true, childList:true, attributes:true,
      attributeFilter:['class', 'style', 'data-island-state', 'data-search-state']});
    document.addEventListener('pointermove', schedule, {passive:true});
    document.addEventListener('scroll', schedule, {capture:true, passive:true});
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('resize', schedule, {passive:true});
    forcedColors?.addEventListener?.('change', schedule);
    schedule();
    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      mutations?.disconnect(); resize?.disconnect();
      document.removeEventListener('pointermove', schedule);
      document.removeEventListener('scroll', schedule, true);
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('resize', schedule);
      forcedColors?.removeEventListener?.('change', schedule);
      records.forEach((record, element) => remove(element, record));
      cache.clear(); svg.remove();
    };
  }

  Object.assign(window.GameTierApp, {getGlassRadii, getGlassEdgeSample, glassEdgeProfile,
    buildGlassDisplacementMap, createGlassRefractionController, GLASS_OPTICAL_SURFACES});
})();
