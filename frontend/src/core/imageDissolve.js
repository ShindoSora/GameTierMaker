(() => {
  'use strict';

  // Snapshot before DELETE: a successful global deletion also removes the image file.
  function prepareImageElementsDissolve(elements) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
    const targets = elements
      .map(element => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({element, rect}) => getComputedStyle(element).visibility !== 'hidden'
        && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
        && rect.top < window.innerHeight && rect.left < window.innerWidth);
    if (!targets.length) return null;
    const snapshots = targets.map(({element, rect}) => {
      const bitmap = document.createElement('canvas');
      bitmap.width = Math.ceil(rect.width);
      bitmap.height = Math.ceil(rect.height);
      const context = bitmap.getContext('2d');
      if (!context) return null;
      const radius = parseFloat(getComputedStyle(element).borderRadius) || 8;
      context.beginPath();
      if (context.roundRect) context.roundRect(0, 0, rect.width, rect.height, radius);
      else context.rect(0, 0, rect.width, rect.height);
      context.clip();
      const image = element.querySelector('img');
      if (image?.complete && image.naturalWidth) {
        const scale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
        // Covers use object-fit:cover and object-position:center top.
        context.drawImage(image, (rect.width - width) / 2, 0, width, height);
      } else {
        context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#5b9cf5';
        context.fillRect(0, 0, rect.width, rect.height);
      }
      const pieces = [];
      const budget = Math.max(25, Math.floor(4500 / targets.length));
      const size = Math.max(3, Math.ceil(Math.sqrt(rect.width * rect.height / budget)));
      for (let y = 0; y < bitmap.height; y += size) {
        for (let x = 0; x < bitmap.width; x += size) {
          pieces.push({x, y, size, delay: x / bitmap.width * 230 + Math.random() * 110,
            driftX: 32 + Math.random() * 90, driftY: -60 + Math.random() * 80,
            rotation: (Math.random() - .5) * 2.2});
        }
      }
      return {element, rect, bitmap, pieces, visibility: element.style.visibility};
    }).filter(Boolean);
    return createParticleEffect(snapshots);
  }

  function createParticleEffect(snapshots) {
    let canvas = null, frame = 0, timer = 0, settle = null;
    const finish = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      canvas?.remove();
      canvas = null;
      if (settle) { const resolve = settle; settle = null; resolve(); }
    };
    const dispose = () => {
      finish();
      snapshots.forEach(item => { item.element.style.visibility = item.visibility; });
    };
    const play = () => new Promise(resolve => {
      if (!snapshots.length || !snapshots.some(item => item.element.isConnected)) { resolve(); return; }
      canvas = document.createElement('canvas');
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = window.innerWidth, height = window.innerHeight;
      canvas.width = Math.ceil(width * ratio); canvas.height = Math.ceil(height * ratio);
      Object.assign(canvas.style, {position:'fixed', inset:'0', width:`${width}px`, height:`${height}px`,
        pointerEvents:'none', zIndex:'4900'});
      canvas.setAttribute('aria-hidden', 'true');
      canvas.className = 'image-dissolve-particles';
      const context = canvas.getContext('2d');
      if (!context) { canvas = null; resolve(); return; }
      document.body.appendChild(canvas);
      context.scale(ratio, ratio);
      snapshots.forEach(item => { item.element.style.visibility = 'hidden'; });
      settle = resolve;
      const start = performance.now();
      const render = time => {
        try {
          context.clearRect(0, 0, width, height);
          let active = false;
          snapshots.forEach(({element, rect, bitmap, pieces}) => {
            if (!element.isConnected) return;
            pieces.forEach(piece => {
              const progress = Math.max(0, Math.min(1, (time - start - piece.delay) / 620));
              if (progress === 1) return;
              active = true;
              context.save();
              context.globalAlpha = 1 - progress;
              context.translate(rect.left + piece.x + piece.driftX * progress,
                rect.top + piece.y + piece.driftY * progress - 18 * progress * progress);
              context.rotate(piece.rotation * progress);
              const scale = 1 - progress * .7;
              context.scale(scale, scale);
              context.drawImage(bitmap, piece.x, piece.y, piece.size, piece.size, 0, 0, piece.size, piece.size);
              context.restore();
            });
          });
          if (active) frame = requestAnimationFrame(render);
          else finish();
        } catch (_) { finish(); }
      };
      frame = requestAnimationFrame(render);
      // Backgrounded windows can stop rAF; deletion must still refresh and release UI state.
      timer = setTimeout(finish, 1400);
    });
    return { play, dispose };
  }
  function prepareImageDissolve(imageId) {
    return prepareImageElementsDissolve([...document.querySelectorAll('.drag-image[data-image-id]')]
      .filter(element => element.dataset.imageId === String(imageId)));
  }

  function findGroupPanel(groupId) {
    const candidates = [...document.querySelectorAll('[data-library-group-id]')]
      .filter(element => element.dataset.libraryGroupId === String(groupId));
    return candidates.find(element => element.classList.contains('group-island-overlay'))
      || candidates.find(element => element.getBoundingClientRect().width > 0);
  }

  function prepareGroupImagesDissolve(groupId) {
    const panel = findGroupPanel(groupId);
    if (!panel) return null;
    // Only visible covers in this group's panel, not the whole board or other groups.
    const covers = [...panel.querySelectorAll('.drag-image[data-image-id]')].filter(element => {
      const rect = element.getBoundingClientRect();
      const grid = element.closest('.library-group-overlay-grid');
      const clip = (grid || panel).getBoundingClientRect();
      return rect.bottom > clip.top && rect.top < clip.bottom && rect.right > clip.left && rect.left < clip.right;
    });
    return prepareImageElementsDissolve(covers);
  }

  async function prepareGroupPanelDissolve(groupId) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
    const element = findGroupPanel(groupId);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    let bitmap;
    if (typeof html2canvas === 'function') {
      try {
        bitmap = await html2canvas(element, {
          backgroundColor: null, scale: 1, useCORS: true, logging: false, imageTimeout: 1200,
          onclone: clonedDocument => {
            const panel = [...clonedDocument.querySelectorAll('[data-library-group-id]')]
              .find(node => node.dataset.libraryGroupId === String(groupId)
                && node.classList.contains('group-island-overlay'));
            if (!panel) return;
            // html2canvas does not parse CSS Color 4 emitted by color-mix().
            const pixel = clonedDocument.createElement('canvas');
            pixel.width = pixel.height = 1;
            const paint = pixel.getContext('2d');
            const rgb = color => {
              paint.clearRect(0, 0, 1, 1); paint.fillStyle = color; paint.fillRect(0, 0, 1, 1);
              const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data;
              return `rgba(${r},${g},${b},${a / 255})`;
            };
            [panel, ...panel.querySelectorAll('*')].forEach(node => {
              const style = clonedDocument.defaultView.getComputedStyle(node);
              const values = {};
              for (const key of ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor']) {
                if (style[key].includes('color(')) values[key] = rgb(style[key]);
              }
              if (style.backgroundImage.includes('color(')) {
                values.backgroundImage = style.backgroundImage.replace(/color\([^)]*\)/g, rgb);
              }
              Object.assign(node.style, values, {animation:'none', transition:'none'});
            });
          },
        });
      } catch (_) { /* Keep a panel-colored fallback when rasterization is unavailable. */ }
    }
    if (!bitmap) {
      bitmap = document.createElement('canvas');
      bitmap.width = Math.ceil(rect.width); bitmap.height = Math.ceil(rect.height);
      const paint = bitmap.getContext('2d');
      if (!paint) return null;
      paint.fillStyle = getComputedStyle(element).backgroundColor;
      paint.fillRect(0, 0, bitmap.width, bitmap.height);
    }
    const pieces = [], size = Math.max(4, Math.ceil(Math.sqrt(bitmap.width * bitmap.height / 4500)));
    for (let y = 0; y < bitmap.height; y += size) {
      for (let x = 0; x < bitmap.width; x += size) {
        pieces.push({x, y, size, delay:x / bitmap.width * 230 + Math.random() * 110,
          driftX:32 + Math.random() * 90, driftY:-60 + Math.random() * 80,
          rotation:(Math.random() - .5) * 2.2});
      }
    }
    return createParticleEffect([{element, rect, bitmap, pieces, visibility:element.style.visibility}]);
  }
  Object.assign(window.GameTierApp, { prepareImageDissolve, prepareGroupImagesDissolve, prepareGroupPanelDissolve });
})();
