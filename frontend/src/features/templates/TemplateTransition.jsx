(() => {
  'use strict';

  const { useRef, useState, useLayoutEffect, useEffect } = React;
  const DURATION = 620;
  const EASING = 'cubic-bezier(.22,.68,.18,1)';

  function getTemplateSlideDirection(templates, fromId, toId, previousOrder = []) {
    if (fromId === toId) return 0;
    const from = templates.findIndex(template => template.id === fromId);
    const to = templates.findIndex(template => template.id === toId);
    if (from >= 0 && to >= 0) return to > from ? 1 : -1;
    if (from < 0 && to >= 0) {
      const oldFrom = previousOrder.findIndex(template => template.id === fromId);
      const oldTo = previousOrder.findIndex(template => template.id === toId);
      // Deletion removes the old ID before its replacement snapshot arrives.
      // A fresh replacement for the sole template enters from below.
      if (oldFrom >= 0) return oldTo < 0 || oldTo > oldFrom ? 1 : -1;
    }
    return 0;
  }

  function createTemplateSlideController(stage) {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const active = new Map();
    let revision = 0, disposed = false, complete = null;
    const sample = element => active.has(element) ? {
      transform: getComputedStyle(element).transform,
      opacity: getComputedStyle(element).opacity,
    } : null;
    const cancel = () => {
      active.forEach((animation, element) => {
        animation.onfinish = null;
        animation.cancel();
        element.style.willChange = 'auto';
      });
      active.clear();
    };
    const finish = () => {
      revision += 1;
      cancel();
      const callback = complete;
      complete = null;
      callback?.();
    };
    const reducedMotion = () => { if (media?.matches) finish(); };
    window.addEventListener('resize', finish);
    media?.addEventListener?.('change', reducedMotion);
    return {
      transition(outgoing, incoming, direction, onComplete) {
        if (disposed) return;
        const oldDepth = outgoing?.querySelector('.template-parallax-content');
        const newDepth = incoming?.querySelector('.template-parallax-content');
        // Read native animation positions before cancellation, including a reversal
        // that reuses the still-visible outgoing page as the new incoming page.
        const samples = new Map([outgoing, incoming, oldDepth, newDepth]
          .filter(Boolean).map(element => [element, sample(element)]));
        const token = ++revision;
        complete = null;
        cancel();
        complete = onComplete;
        if (!direction || media?.matches || !stage.clientHeight || !outgoing?.animate || !incoming?.animate) {
          finish();
          return;
        }
        const distance = stage.clientHeight;
        const translate = (y, scale = 1) => `translate3d(0, ${y}px, 0) scale(${scale})`;
        const animate = (element, from, to) => {
          if (!element?.animate) return null;
          element.style.willChange = 'transform,opacity';
          const motion = element.animate([samples.get(element) || from, to],
            { duration: DURATION, easing: EASING, fill: 'both' });
          active.set(element, motion);
          return motion;
        };
        try {
          // Identical page timing keeps their edges together; only the inner
          // content lags slightly, giving depth without a gap between templates.
          animate(outgoing, { transform: translate(0), opacity: 1 },
            { transform: translate(-direction * distance), opacity: 1 });
          const incomingMotion = animate(incoming,
            { transform: translate(direction * distance), opacity: 1 },
            { transform: translate(0), opacity: 1 });
          animate(oldDepth, { transform: translate(0), opacity: 1 },
            { transform: translate(-direction * 18, .98), opacity: .74 });
          animate(newDepth, { transform: translate(direction * 26, .985), opacity: .96 },
            { transform: translate(0), opacity: 1 });
          incomingMotion.onfinish = () => { if (!disposed && token === revision) finish(); };
        } catch (_) { finish(); }
      },
      dispose() {
        disposed = true;
        revision += 1;
        complete = null;
        cancel();
        window.removeEventListener('resize', finish);
        media?.removeEventListener?.('change', reducedMotion);
      },
    };
  }

  const CONSUME_DURATION = 2200;
  // These match the hole drawn in template-transition.css: a 260px box whose core is inset 78px,
  // and an accretion disk tilted by -18deg and squashed to 32% of its height.
  const HORIZON = 52;
  const DISK_TILT = -18 * Math.PI / 180;
  const DISK_FLATTEN = .32;
  // Timeline, as a share of the consume duration.
  const PLANET_FORMED = .26;
  const DISRUPTION = .42;
  // Same look as deleting a cover or a group: square pieces cut from a snapshot.
  const PIECE_COUNT = 2600;
  const GAS_COUNT = 160;
  const jitter = amount => (Math.random() * 2 - 1) * amount;
  const clamp01 = value => Math.min(1, Math.max(0, value));
  const smooth = value => { const x = clamp01(value); return x * x * (3 - 2 * x); };
  const mix = (from, to, amount) => from + (to - from) * amount;

  // The orbit the planet falls along. It starts as a round orbit and settles into the plane
  // of the accretion disk as it closes in, winding faster the deeper it goes (as in a real orbit).
  function createInfallOrbit(width, height) {
    const cx = width / 2, cy = height / 2;
    const shortSide = Math.min(width, height);
    const startRadius = Math.max(Math.min(190, shortSide * .42), Math.min(width * .34, height * .4));
    // Starts on the left: the log sidebar may cover the right edge of the board.
    const startAngle = Math.PI + jitter(.22);
    const sweep = Math.PI * 2.15;
    const cos = Math.cos(DISK_TILT), sin = Math.sin(DISK_TILT);
    const at = (q, spread = 0, lag = 0) => {
      const radius = mix(HORIZON * .85, startRadius, Math.pow(1 - clamp01(q), 1.25)) * (1 + spread);
      const angle = startAngle + sweep * Math.pow(clamp01(q), 1.5) + lag;
      const flatten = mix(DISK_FLATTEN, 1, smooth((radius - 110) / (startRadius - 110)));
      const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius * flatten;
      return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos, radius, angle };
    };
    // Direction of travel on screen, in degrees.
    const heading = q => {
      const a = at(q - .004), b = at(q + .004);
      return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    };
    return { cx, cy, startRadius, at, heading };
  }

  // Same function list in every frame, so the browser interpolates each part on its own:
  // move, then stretch along an axis, then scale back from that axis.
  const stretchTransform = (x, y, axis, along, across) =>
    `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${axis.toFixed(2)}deg) `
    + `scale(${along.toFixed(4)}, ${across.toFixed(4)}) rotate(${(-axis).toFixed(2)}deg)`;

  // Keeps an angle within half a turn of the previous one so rotations take the short way.
  const nearAngle = (angle, previous) => angle + Math.round((previous - angle) / 360) * 360;

  function gasColor(q) {
    // Infalling gas heats up: dull red, orange, yellow-white, then blue-white near the horizon.
    const stops = [[0, 255, 84, 36], [.45, 255, 156, 64], [.78, 255, 232, 178], [1, 214, 230, 255]];
    const upper = stops.findIndex(stop => stop[0] >= q);
    const [p0, r0, g0, b0] = stops[Math.max(0, upper - 1)], [p1, r1, g1, b1] = stops[Math.max(0, upper)];
    const amount = p1 === p0 ? 0 : (q - p0) / (p1 - p0);
    return [mix(r0, r1, amount), mix(g0, g1, amount), mix(b0, b1, amount)].map(Math.round);
  }

  const parseColor = value => {
    const parts = String(value || '').match(/[\d.]+/g);
    if (!parts || parts.length < 3) return null;
    return { r: +parts[0], g: +parts[1], b: +parts[2], a: parts.length > 3 ? +parts[3] : 1 };
  };

  // Paints the part of the board that becomes the planet, close to how it looks on screen
  // (rounded backgrounds, covers, text), so its pieces carry the real picture like the cover
  // and group dissolves do. Layout is read straight away; covers are decoded off the main
  // thread, since full-size covers would otherwise stall the first frames.
  async function paintBoardSnapshot(page, region, scale) {
    const box = page.getBoundingClientRect();
    const pageFill = parseColor(getComputedStyle(page).backgroundColor);
    const steps = [{ fill: pageFill?.a ? getComputedStyle(page).backgroundColor : getComputedStyle(document.body).backgroundColor,
      x: region.x, y: region.y, w: region.w, h: region.h, radius: 0, alpha: 1 }];
    page.querySelectorAll('*').forEach(element => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      const rect = element.getBoundingClientRect();
      const x = rect.left - box.left, y = rect.top - box.top;
      if (!rect.width || !rect.height || x > region.x + region.w || y > region.y + region.h
        || x + rect.width < region.x || y + rect.height < region.y) return;
      const step = { x, y, w: rect.width, h: rect.height, radius: parseFloat(style.borderTopLeftRadius) || 0,
        alpha: Math.min(1, parseFloat(style.opacity) || 1) };
      if (element instanceof HTMLImageElement) {
        // The outgoing board is freshly rendered, so its images may not have loaded yet;
        // the snapshot decodes them from their URL instead of waiting for the element.
        const url = element.currentSrc || element.getAttribute('src');
        if (url) steps.push({ ...step, image: element, url });
        return;
      }
      // Gradient backgrounds use their first colour, which is close enough at this size.
      const fill = parseColor(style.backgroundColor)?.a ? style.backgroundColor
        : (style.backgroundImage.match(/rgba?\([^)]*\)/) || [])[0];
      if (fill && parseColor(fill)?.a) steps.push({ ...step, fill });
      const text = [...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join('').trim();
      if (text && parseFloat(style.fontSize) >= 11) {
        steps.push({ ...step, text, color: style.color, centred: style.textAlign === 'center',
          inset: parseFloat(style.paddingLeft) || 0, font: `${style.fontWeight} ${style.fontSize} ${style.fontFamily}` });
      }
    });
    // Covers use object-fit: cover with object-position: center top.
    const coverFit = (step, imageWidth, imageHeight) => {
      const fit = Math.max(step.w / imageWidth, step.h / imageHeight);
      return { w: imageWidth * fit, h: imageHeight * fit };
    };
    // Decoding from a blob runs off the main thread; decoding straight from an <img> does not.
    const bitmaps = await Promise.all(steps.map(step => step.image && window.createImageBitmap
      ? fetch(step.url)
        .then(response => response.blob())
        .then(blob => {
          // Shrink while decoding when the size is already known; otherwise decode at full size.
          if (!step.image.naturalWidth) return createImageBitmap(blob);
          const size = coverFit(step, step.image.naturalWidth, step.image.naturalHeight);
          return createImageBitmap(blob, { resizeWidth: Math.max(1, Math.round(size.w * scale)),
            resizeHeight: Math.max(1, Math.round(size.h * scale)), resizeQuality: 'medium' });
        })
        .catch(() => null)
      : null));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(region.w * scale));
    canvas.height = Math.max(1, Math.round(region.h * scale));
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.translate(-region.x, -region.y);
    const shape = step => {
      ctx.beginPath();
      if (step.radius && ctx.roundRect) ctx.roundRect(step.x, step.y, step.w, step.h, step.radius);
      else ctx.rect(step.x, step.y, step.w, step.h);
    };
    steps.forEach((step, index) => {
      ctx.globalAlpha = step.alpha;
      if (step.image) {
        if (!bitmaps[index]) return;
        const size = coverFit(step, bitmaps[index].width, bitmaps[index].height);
        ctx.save();
        shape(step);
        ctx.clip();
        ctx.drawImage(bitmaps[index], step.x + (step.w - size.w) / 2, step.y, size.w, size.h);
        ctx.restore();
        bitmaps[index].close?.();
      } else if (step.text) {
        ctx.fillStyle = step.color;
        ctx.font = step.font;
        ctx.textBaseline = 'middle';
        ctx.textAlign = step.centred ? 'center' : 'left';
        ctx.fillText(step.text, step.centred ? step.x + step.w / 2 : step.x + step.inset, step.y + step.h / 2);
      } else {
        ctx.fillStyle = step.fill;
        shape(step);
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
    return canvas;
  }

  function createTemplateDeleteController() {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const active = new Set();
    let disposed = false, stageRef = null, gasFrame = 0;
    const clearStage = () => {
      cancelAnimationFrame(gasFrame);
      gasFrame = 0;
      stageRef?.layer?.replaceChildren();
      const front = stageRef?.front;
      front?.getContext?.('2d')?.clearRect(0, 0, front.width, front.height);
    };
    const animate = (element, frames, options, done) => {
      if (!element?.animate || media?.matches) { done?.(); return null; }
      try {
        const motion = element.animate(frames, { fill: 'both', ...options });
        active.add(motion);
        motion.onfinish = () => { if (!disposed) { motion.onfinish = null; done?.(); } };
        return motion;
      } catch (_) { done?.(); return null; }
    };
    const cancel = () => {
      active.forEach(motion => { motion.onfinish = null; motion.cancel(); });
      active.clear();
    };
    const reduce = () => { if (media?.matches) active.forEach(motion => motion.finish()); };
    media?.addEventListener?.('change', reduce);

    // The board collapses into a planet, is stretched by the tides, then torn into a stream
    // that winds into the accretion disk while its gas heats up and falls in.
    const devour = (outgoing, stage, done) => {
      const layer = stage?.layer, front = stage?.front;
      const width = outgoing?.clientWidth, height = outgoing?.clientHeight;
      if (!layer?.animate || !front?.getContext || !width || !height) return false;
      const orbit = createInfallOrbit(width, height);
      const { cx, cy } = orbit;
      const shortSide = Math.min(width, height);
      // Small windows get a smaller planet so it never ends up larger than the board it came from.
      const planetRadius = Math.min(96, Math.max(shortSide * .11, Math.min(58, shortSide * .2)));
      const pageRadius = shortSide * .32;
      const planetScale = planetRadius / pageRadius;
      // Centre the planet on the covers so it shows the board's content, not empty rows.
      const box = outgoing.getBoundingClientRect();
      const covers = [...outgoing.querySelectorAll('img')].map(img => img.getBoundingClientRect())
        .filter(rect => rect.width && rect.bottom > box.top && rect.top < box.bottom && rect.right > box.left && rect.left < box.right);
      const fit = (value, size) => size > pageRadius * 2 ? Math.min(size - pageRadius, Math.max(pageRadius, value)) : size / 2;
      const px = fit(covers.length ? covers.reduce((sum, rect) => sum + (rect.left + rect.right) / 2, 0) / covers.length - box.left : cx, width);
      const py = fit(covers.length ? covers.reduce((sum, rect) => sum + (rect.top + rect.bottom) / 2, 0) / covers.length - box.top : cy, height);
      const fullRadius = Math.hypot(Math.max(px, width - px), Math.max(py, height - py)) + 2;
      const planetClip = radius => `circle(${radius.toFixed(1)}px at ${px.toFixed(1)}px ${py.toFixed(1)}px)`;
      // Moves the planet's centre to a screen point; the board scales around its own centre.
      const shift = (targetX, targetY, axis, along, across) => {
        const a = axis * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        const dx = px - cx, dy = py - cy;
        const u = (dx * c + dy * s) * along, v = (-dx * s + dy * c) * across;
        return [targetX - cx - (u * c - v * s), targetY - cy - (u * s + v * c)];
      };
      const start = orbit.at(0);
      const toHole = (x, y) => Math.atan2(cy - y, cx - x) * 180 / Math.PI;
      const timing = { duration: CONSUME_DURATION, easing: 'linear' };

      // Planet keyframes, shared by the board and its shading so the two stay together.
      const planetFrames = [];
      let axis = toHole(start.x, start.y);
      const formSteps = 6;
      for (let step = 0; step <= formSteps; step += 1) {
        const k = step / formSteps, eased = k * k * (3 - 2 * k), size = mix(1, planetScale, eased);
        const [x, y] = shift(mix(px, start.x, eased), mix(py, start.y, eased), axis, size, size);
        planetFrames.push({
          offset: PLANET_FORMED * k,
          transform: stretchTransform(x, y, axis, size, size),
          clipPath: planetClip(mix(fullRadius, pageRadius, Math.pow(eased, .8))),
        });
      }
      const tidalReach = .055, tidalSteps = 5;
      let disruption = null;
      for (let step = 1; step <= tidalSteps; step += 1) {
        const k = step / tidalSteps, at = orbit.at(tidalReach * k);
        axis = nearAngle(toHole(at.x, at.y), axis);
        const pull = Math.pow(k, 1.6);
        const pose = { axis, along: planetScale * (1 + .42 * pull), across: planetScale * (1 - .16 * pull) };
        const [x, y] = shift(at.x, at.y, axis, pose.along, pose.across);
        planetFrames.push({
          offset: mix(PLANET_FORMED, DISRUPTION, k),
          transform: stretchTransform(x, y, pose.axis, pose.along, pose.across),
          clipPath: planetClip(pageRadius),
        });
        disruption = pose;
      }
      // The DOM planet fades out over a few frames while its particles take over at the same spot.
      const last = planetFrames[planetFrames.length - 1];
      const gone = [{ ...last, offset: DISRUPTION + .035 }, { ...last, offset: 1 }];

      const parts = document.createDocumentFragment();
      // Sphere shading: lit by the disk on the side facing the hole, dark on the far side.
      const lightAngle = Math.atan2(cy - start.y, cx - start.x);
      const planetShade = document.createElement('div');
      planetShade.className = 'template-devour-shade';
      planetShade.style.cssText = `left:${(px - pageRadius).toFixed(1)}px;top:${(py - pageRadius).toFixed(1)}px;`
        + `width:${(pageRadius * 2).toFixed(1)}px;height:${(pageRadius * 2).toFixed(1)}px;`
        + `background:radial-gradient(circle at ${(50 + Math.cos(lightAngle) * 30).toFixed(1)}% ${(50 + Math.sin(lightAngle) * 30).toFixed(1)}%, `
        + '#ffdcae55 0%, #ffad6a22 26%, #0000 46%, #05050c8c 76%, #020207e6 100%);'
        + `--rim:${(pageRadius * .1).toFixed(1)}px;`
        // Same pivot as the board (its centre), so both follow the same keyframes.
        + `transform-origin:${(cx - px + pageRadius).toFixed(1)}px ${(cy - py + pageRadius).toFixed(1)}px`;
      parts.append(planetShade);


      // The planet as square pieces cut from a snapshot of the board, like the cover and group
      // dissolves. Each piece keeps its own patch of the picture as it is pulled in.
      const axisRad = disruption.axis * Math.PI / 180;
      const ux = Math.cos(axisRad), uy = Math.sin(axisRad), vx = -uy, vy = ux;
      const along0 = disruption.along, across0 = disruption.across;
      // The planet's stretch at break-up, as a canvas matrix: R(axis) * scale(along, across) * R(-axis).
      const m11 = along0 * ux * ux + across0 * uy * uy, m22 = along0 * uy * uy + across0 * ux * ux;
      const m12 = (along0 - across0) * ux * uy, m21 = m12;
      const screenRadius = pageRadius * along0;
      const pieceSize = Math.sqrt(Math.PI * pageRadius * pageRadius / PIECE_COUNT);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const snapshotScale = Math.min(1, Math.max(along0, across0) * dpr * 1.25);
      const pieces = [];
      for (let gy = -pageRadius + pieceSize / 2; gy < pageRadius; gy += pieceSize) {
        for (let gx = -pageRadius + pieceSize / 2; gx < pageRadius; gx += pieceSize) {
          if (gx * gx + gy * gy > pageRadius * pageRadius) continue;
          // Offset from the planet's centre on screen at the moment it breaks up.
          const along = (gx * ux + gy * uy) * along0, across = (gx * vx + gy * vy) * across0;
          // The side nearest the hole goes first; the edge of the peel is ragged.
          const rank = clamp01((screenRadius - along) / (screenRadius * 2) + jitter(.05));
          const begin = Math.min(.9, DISRUPTION + .3 * rank + jitter(.03));
          pieces.push({
            sx: (gx - pieceSize / 2 + pageRadius) * snapshotScale, sy: (gy - pieceSize / 2 + pageRadius) * snapshotScale,
            offsetX: ux * along + vx * across, offsetY: uy * along + vy * across,
            begin, span: Math.max(.06, Math.min(.35 + Math.random() * .25, .985 - begin)),
            spread: across / orbit.startRadius * .9 + jitter(.1), lag: jitter(.22),
            rotation: (Math.random() - .5) * 4.4,
            // Some pieces dissolve on the way in, so the stream thins out instead of piling up.
            burns: Math.random() < .45,
            rest: null,
          });
        }
      }
      if (!pieces.length) return false;
      let source = null;
      paintBoardSnapshot(outgoing, { x: px - pageRadius, y: py - pageRadius, w: pageRadius * 2, h: pageRadius * 2 }, snapshotScale)
        .then(canvas => {
          if (disposed || !canvas) return;
          // Bake in the same sphere shading the DOM planet shows, so the hand-over is seamless.
          const paint = canvas.getContext('2d');
          paint.setTransform(snapshotScale, 0, 0, snapshotScale, 0, 0);
          const hx = pageRadius + Math.cos(lightAngle) * pageRadius * .6, hy = pageRadius + Math.sin(lightAngle) * pageRadius * .6;
          const reach = Math.hypot(Math.max(hx, pageRadius * 2 - hx), Math.max(hy, pageRadius * 2 - hy));
          const shade = paint.createRadialGradient(hx, hy, 0, hx, hy, reach);
          shade.addColorStop(0, 'rgba(255,220,174,.33)');
          shade.addColorStop(.26, 'rgba(255,173,106,.13)');
          shade.addColorStop(.46, 'rgba(0,0,0,0)');
          shade.addColorStop(.76, 'rgba(5,5,12,.55)');
          shade.addColorStop(1, 'rgba(2,2,7,.9)');
          paint.fillStyle = shade;
          paint.fillRect(0, 0, pageRadius * 2, pageRadius * 2);
          source = canvas;
        })
        .catch(() => {});

      const back = document.createElement('canvas');
      back.className = 'template-devour-gas';
      [back, front].forEach(canvas => { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); });
      parts.append(back);

      layer.replaceChildren(parts);
      outgoing.dataset.devoured = 'true';

      // Board and shading collapse into the planet, then hand over to the pieces.
      animate(outgoing, [
        ...planetFrames.map(frame => ({ ...frame, opacity: 1 })),
        ...gone.map(frame => ({ ...frame, opacity: 0 })),
      ], timing);
      const shadeFrom = PLANET_FORMED * .45;
      animate(planetShade, [
        ...planetFrames.map(({ offset, transform }) => ({
          offset, transform, opacity: clamp01((offset - shadeFrom) / (PLANET_FORMED - shadeFrom)),
        })),
        ...gone.map(({ offset, transform }) => ({ offset, transform, opacity: 0 })),
      ], timing);
      // What is left of the planet keeps drifting along its orbit while it is being stripped.
      const remnant = t => tidalReach + .03 * clamp01((t - DISRUPTION) / .22);

      // Glowing gas pulled off the stream; drawn on two canvases so gas in front of the hole
      // covers it and gas behind the hole is hidden by it.
      const gas = Array.from({ length: GAS_COUNT }, () => {
        // Only near the hole, as a glow where the pieces are swallowed, not along the whole stream.
        const born = DISRUPTION + .1 + Math.pow(Math.random(), 1.2) * .38;
        const life = Math.min(.16 + Math.random() * .18, .995 - born);
        return {
          born, life,
          from: .4 + Math.random() * .25,
          spread: jitter(.1), lag: jitter(.16), size: .6 + Math.random() * 1.6, glow: .35 + Math.random() * .65,
        };
      });
      const backCtx = back.getContext('2d'), frontCtx = front.getContext('2d');
      const cos = Math.cos(DISK_TILT), sin = Math.sin(DISK_TILT);
      const normal = { x: Math.sin(DISK_TILT), y: -Math.cos(DISK_TILT) };
      const drawDiskGlow = (ctx, strength, frontHalf) => {
        if (strength <= .01) return;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(DISK_TILT);
        ctx.scale(1, DISK_FLATTEN);
        if (frontHalf) { ctx.beginPath(); ctx.rect(-400, 0, 800, 400); ctx.clip(); }
        const ring = ctx.createRadialGradient(0, 0, HORIZON * .9, 0, 0, 200);
        ring.addColorStop(0, `rgba(255,236,200,0)`);
        ring.addColorStop(.06, `rgba(255,236,200,${(.75 * strength).toFixed(3)})`);
        ring.addColorStop(.35, `rgba(255,150,70,${(.35 * strength).toFixed(3)})`);
        ring.addColorStop(1, 'rgba(255,90,40,0)');
        ctx.fillStyle = ring;
        ctx.beginPath();
        ctx.arc(0, 0, 200, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };
      const drawJets = (ctx, strength) => {
        if (strength <= .01) return;
        [1, -1].forEach(side => {
          const x0 = cx + normal.x * side * (HORIZON + 6), y0 = cy + normal.y * side * (HORIZON + 6);
          const length = 60 + 170 * strength;
          const x1 = x0 + normal.x * side * length, y1 = y0 + normal.y * side * length;
          const beam = ctx.createLinearGradient(x0, y0, x1, y1);
          beam.addColorStop(0, `rgba(235,244,255,${(.9 * strength).toFixed(3)})`);
          beam.addColorStop(.35, `rgba(150,190,255,${(.45 * strength).toFixed(3)})`);
          beam.addColorStop(1, 'rgba(120,160,255,0)');
          ctx.strokeStyle = beam;
          ctx.lineCap = 'round';
          [[9, .25], [2.4, 1]].forEach(([lineWidth, alpha]) => {
            ctx.globalAlpha = alpha;
            ctx.lineWidth = lineWidth;
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          });
          ctx.globalAlpha = 1;
        });
      };
      // Colour strings are cached (5 bits per channel) rather than built for every streak each frame.
      const colours = new Map();
      const colour = (r, g, b) => {
        const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
        let value = colours.get(key);
        if (!value) { value = `rgb(${(r >> 3) << 3},${(g >> 3) << 3},${(b >> 3) << 3})`; colours.set(key, value); }
        return value;
      };
      const lensed = (head, size, alpha) => {
        // Gas behind the hole is also seen bent over its top by the hole's gravity.
        const bend = HORIZON + 7 + (head.radius - HORIZON * .85) * .3;
        const lx = Math.cos(head.angle) * bend, ly = Math.sin(head.angle) * bend;
        frontCtx.globalAlpha = alpha * .45;
        frontCtx.fillRect(cx + lx * cos - ly * sin - size / 2, cy + lx * sin + ly * cos - size / 2, size, size);
      };
      // Position of one piece at time t.
      const pieceAt = (piece, t) => {
        if (t < piece.begin) {
          const centre = orbit.at(remnant(t));
          return { x: centre.x + piece.offsetX, y: centre.y + piece.offsetY, falling: 0 };
        }
        if (!piece.rest) {
          const from = remnant(piece.begin), centre = orbit.at(from);
          piece.rest = { from, x: centre.x + piece.offsetX, y: centre.y + piece.offsetY };
        }
        const x = clamp01((t - piece.begin) / piece.span);
        const q = mix(piece.rest.from, 1, Math.pow(x, 1.7));
        const thin = 1 - q;
        const target = orbit.at(q, piece.spread * thin, piece.lag * thin);
        const follow = smooth(x * 2.4);
        return { x: mix(piece.rest.x, target.x, follow), y: mix(piece.rest.y, target.y, follow), falling: x, target };
      };
      // Pieces turn and shrink to 30% as they go, like the cover and group dissolves; the ones
      // that dissolve on the way fade out early, the rest vanish into the hole.
      const tile = pieceSize * 1.04, half = tile / 2, sourceSize = pieceSize * snapshotScale;
      const drawPieces = t => {
        if (t < DISRUPTION) return;
        [backCtx, frontCtx].forEach(ctx => { ctx.globalCompositeOperation = 'source-over'; });
        pieces.forEach(piece => {
          const head = pieceAt(piece, t);
          const x = head.falling;
          if (x >= 1) return;
          const alpha = piece.burns ? 1 - smooth((x - .12) / .45) : 1 - smooth((x - .7) / .3);
          if (alpha <= .01) return;
          const ctx = x && Math.sin(head.target.angle) > 0 && head.target.radius < 200 ? frontCtx : backCtx;
          const turn = piece.rotation * x, size = 1 - .7 * x;
          const cr = Math.cos(turn) * size, sr = Math.sin(turn) * size;
          ctx.globalAlpha = alpha;
          ctx.setTransform(dpr * (m11 * cr + m12 * sr), dpr * (m21 * cr + m22 * sr),
            dpr * (m12 * cr - m11 * sr), dpr * (m22 * cr - m21 * sr), dpr * head.x, dpr * head.y);
          if (source) ctx.drawImage(source, piece.sx, piece.sy, sourceSize, sourceSize, -half, -half, tile, tile);
          else { ctx.fillStyle = '#464a58'; ctx.fillRect(-half, -half, tile, tile); }
        });
        [backCtx, frontCtx].forEach(ctx => {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'lighter';
        });
      };
      const render = t => {
        [backCtx, frontCtx].forEach(ctx => {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, back.width, back.height);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1;
        });
        // Brightens as matter reaches the hole, then fades once the planet is gone.
        const flare = smooth((t - .55) / .3) * (1 - .55 * smooth((t - .9) / .1));
        drawDiskGlow(backCtx, flare, false);
        drawDiskGlow(frontCtx, flare * .8, true);
        drawJets(frontCtx, smooth((t - .68) / .14) * (1 - smooth((t - .9) / .1)));
        drawPieces(t);
        // A little glowing gas along the stream, kept light so the pieces stay the main effect.
        gas.forEach(particle => {
          const x = (t - particle.born) / particle.life;
          if (x <= 0 || x >= 1) return;
          const q = mix(particle.from, 1, Math.pow(x, 1.6));
          const thin = 1 - q;
          const head = orbit.at(q, particle.spread * thin, particle.lag * thin);
          const tail = orbit.at(Math.max(particle.from, q - .014 - .022 * q), particle.spread * thin, particle.lag * thin);
          const [r, g, b] = gasColor(q);
          const alpha = smooth(x / .12) * (1 - smooth((x - .82) / .18)) * particle.glow * .45;
          const inFront = Math.sin(head.angle) > 0;
          const ctx = inFront ? frontCtx : backCtx;
          ctx.strokeStyle = colour(r, g, b);
          ctx.globalAlpha = alpha;
          ctx.lineWidth = particle.size * (1.2 + q);
          ctx.beginPath(); ctx.moveTo(tail.x, tail.y); ctx.lineTo(head.x, head.y); ctx.stroke();
          if (!inFront && head.radius < 175) { frontCtx.fillStyle = ctx.strokeStyle; lensed(head, particle.size * 1.4, alpha); }
        });
        [backCtx, frontCtx].forEach(ctx => { ctx.globalAlpha = 1; });
      };
      const clock = animate(layer, [{ opacity: 1 }, { opacity: 1 }], timing, () => {
        outgoing.style.visibility = 'hidden';
        clearStage();
        done?.();
      });
      if (!clock) return false;
      const tick = () => {
        if (disposed || !clock || clock.playState === 'idle') return;
        render(clamp01((clock.currentTime || 0) / CONSUME_DURATION));
        gasFrame = requestAnimationFrame(tick);
      };
      tick();
      return true;
    };
    return {
      consume(outgoing, hole, done, stage) {
        stageRef = stage;
        animate(hole, [
          { transform: 'scale(.05)', opacity: 0 },
          { transform: 'scale(.94)', opacity: 1, offset: .2 },
          { transform: 'scale(1)', opacity: 1, offset: .55 },
          { transform: 'scale(1.14)', opacity: 1, offset: .86 },
          { transform: 'scale(1)', opacity: 1 },
        ], { duration: CONSUME_DURATION, easing: 'cubic-bezier(.2,.65,.3,1)' });
        if (media?.matches) { done?.(); return; }
        let devoured = false;
        try { devoured = devour(outgoing, stage, done); } catch (_) { devoured = false; }
        if (devoured) return;
        cancel();
        clearStage();
        delete outgoing.dataset.devoured;
        outgoing.style.visibility = '';
        animate(hole, [{ transform: 'scale(.05)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
          { duration: 420, easing: 'cubic-bezier(.2,.65,.3,1)' });
        // Fallback when the board cannot be copied: the whole board spirals in.
        animate(outgoing, [
          { transform: 'rotate(0deg) scale(1)', opacity: 1, borderRadius: '0', offset: 0 },
          { transform: 'rotate(-3deg) scale(.96)', opacity: 1, borderRadius: '8%', offset: .22 },
          { transform: 'rotate(-20deg) scale(.72,.83)', opacity: 1, borderRadius: '28%', offset: .48 },
          { transform: 'rotate(-65deg) scale(.28,.48)', opacity: .9, borderRadius: '50%', offset: .76 },
          { transform: 'rotate(-150deg) scale(0.01,.025)', opacity: 0, borderRadius: '50%' },
        ], { duration: 1400, easing: 'cubic-bezier(.55,.02,.8,.45)' }, done);
      },
      reveal(incoming, hole, done) {
        incoming.style.visibility = 'visible';
        animate(hole, [
          { transform: 'scale(1)', opacity: 1 },
          { transform: 'scale(.16)', opacity: 1, offset: .6 },
          { transform: 'scale(.015)', opacity: 0 },
        ], { duration: 520, easing: 'cubic-bezier(.5,0,.6,1)' });
        animate(incoming, [
          { transform: 'rotate(18deg) scale(.025)', opacity: 0, borderRadius: '50%' },
          { transform: 'rotate(7deg) scale(.3)', opacity: 1, borderRadius: '32%', offset: .22 },
          { transform: 'rotate(-.5deg) scale(1.015)', opacity: 1, borderRadius: '2%', offset: .8 },
          { transform: 'rotate(0deg) scale(1)', opacity: 1, borderRadius: '0' },
        ], { delay: 210, duration: 760, easing: 'cubic-bezier(.18,.7,.2,1)' }, done);
      },
      restore(outgoing, hole, done) {
        const visible = getComputedStyle(outgoing);
        // A devoured board is already gone, so it grows back out of the hole.
        const from = outgoing.dataset.devoured
          ? { transform: 'rotate(-40deg) scale(.2)', opacity: 0, borderRadius: '50%' }
          : { transform: visible.transform, opacity: visible.opacity, borderRadius: visible.borderRadius };
        cancel();
        clearStage();
        delete outgoing.dataset.devoured;
        outgoing.style.visibility = '';
        animate(hole, [{ opacity: 1 }, { opacity: 0 }], { duration: 260 });
        animate(outgoing, [from, { transform: 'none', opacity: 1, borderRadius: '0' }],
          { duration: 420, easing: EASING }, done);
      },
      dispose() {
        disposed = true;
        cancel();
        clearStage();
        media?.removeEventListener?.('change', reduce);
      },
    };
  }

  function TemplateDeletion({ snapshot, deletion, templateId, onComplete, onRetry, children }) {
    const outgoingRef = useRef(null), incomingRef = useRef(null), holeRef = useRef(null);
    const stageRef = useRef(null), frontRef = useRef(null);
    const motionRef = useRef(null), completeRef = useRef(onComplete);
    const [consumed, setConsumed] = useState(false);
    completeRef.current = onComplete;
    useLayoutEffect(() => {
      const motion = createTemplateDeleteController();
      motionRef.current = motion;
      const scrollArea = outgoingRef.current.querySelector('.tier-list-area');
      if (scrollArea) scrollArea.scrollTop = snapshot.scrollTop;
      motion.consume(outgoingRef.current, holeRef.current, () => setConsumed(true),
        { layer: stageRef.current, front: frontRef.current });
      return () => { motion.dispose(); motionRef.current = null; };
    }, []);
    useLayoutEffect(() => {
      const finish = () => completeRef.current?.(deletion.id);
      if (deletion.phase === 'cancelled') {
        motionRef.current.restore(outgoingRef.current, holeRef.current, finish);
      } else if (consumed && deletion.phase === 'ready' && templateId !== snapshot.templateId) {
        motionRef.current.reveal(incomingRef.current, holeRef.current, finish);
      }
    }, [consumed, deletion.phase, templateId]);
    const revealing = consumed && deletion.phase === 'ready';
    const failed = consumed && deletion.phase === 'error';
    return <div className="template-viewport template-deleting" aria-busy="true"
      data-template-transition={revealing ? 'blackhole-reveal' : consumed ? 'blackhole-wait' : 'blackhole-consume'}>
      <div ref={outgoingRef} className="template-page template-delete-outgoing" aria-hidden="true" inert="">
        <div className="template-parallax-content">{React.cloneElement(snapshot.content, { inactive: true })}</div>
      </div>
      <div ref={incomingRef} className="template-page template-delete-incoming" data-template-id={templateId} inert="">
        <div className="template-parallax-content">{children}</div>
      </div>
      <div ref={stageRef} className="template-devour" aria-hidden="true" />
      <div className="template-blackhole-anchor" aria-hidden="true">
        <div className="template-blackhole" ref={holeRef}>
          <div className="template-blackhole-halo" />
          <div className="template-blackhole-orbit"><div /></div>
          <div className="template-blackhole-core" />
          <div className="template-blackhole-front"><div /></div>
          {Array.from({ length: 18 }, (_, index) => <i key={index} className="template-blackhole-dust"
            style={{ '--angle': `${index * 137.5}deg`, '--radius': `${100 + index % 5 * 21}px`, '--delay': `${-index * .13}s` }} />)}
        </div>
      </div>
      <canvas ref={frontRef} className="template-devour-front" aria-hidden="true" />
      {failed && <div className="template-delete-retry" role="alert">
        <p>{window.GameTierI18n.t('template.loadFailed')}</p>
        <button className="btn" onClick={onRetry}>{window.GameTierI18n.t('template.retryLoad')}</button>
      </div>}
    </div>;
  }

  function TemplateTransition({ templateId, templates, pending = false, deletion = null, onDeletionComplete, onDeletionRetry, children }) {
    const hostRef = useRef(null), enteringRef = useRef(null), exitingRef = useRef(null);
    const controllerRef = useRef(null);
    const previous = useRef({ id: templateId, content: children, order: templates });
    const deletionSnapshot = useRef(null);
    const [transition, setTransition] = useState(null);
    if (deletion && deletionSnapshot.current?.id !== deletion.id) {
      deletionSnapshot.current = { id: deletion.id, templateId: previous.current.id, content: previous.current.content,
        scrollTop: enteringRef.current?.querySelector('.tier-list-area')?.scrollTop || 0 };
      if (transition) setTransition(null);
    } else if (!deletion) deletionSnapshot.current = null;
    if (previous.current.id !== templateId) {
      const old = previous.current;
      previous.current = { id: templateId, content: children, order: templates };
      const direction = getTemplateSlideDirection(templates, old.id, templateId, old.order);
      setTransition(!deletion && direction ? { from: old, to: templateId, direction } : null);
    } else {
      previous.current.content = children;
      // Keep the pre-delete order during the list-only intermediate render.
      if (templates.some(template => template.id === templateId)) previous.current.order = templates;
    }
    useLayoutEffect(() => {
      if (deletion) {
        controllerRef.current?.dispose();
        controllerRef.current = null;
        return;
      }
      if (!controllerRef.current) controllerRef.current = createTemplateSlideController(hostRef.current);
      controllerRef.current.transition(exitingRef.current, enteringRef.current,
        transition?.direction || 0, () => setTransition(null));
    }, [templateId, !!deletion]);
    useEffect(() => () => controllerRef.current?.dispose(), []);
    if (deletion) return <TemplateDeletion key={deletion.id} snapshot={deletionSnapshot.current}
      deletion={deletion} templateId={templateId} onComplete={onDeletionComplete} onRetry={onDeletionRetry}>
      {children}
    </TemplateDeletion>;
    const moving = !!transition;
    return (
      <div ref={hostRef} className="template-viewport" aria-busy={pending || moving}
        data-template-transition={moving ? transition.direction > 0 ? 'forward' : 'backward' : 'idle'}>
        {transition && <div key={transition.from.id} ref={exitingRef}
          className="template-page template-page-outgoing" aria-hidden="true" inert="">
          <div className="template-parallax-content">
            {React.cloneElement(transition.from.content, { inactive: true })}
          </div>
        </div>}
        <div key={templateId} ref={enteringRef} className="template-page template-page-current"
          data-template-id={templateId} inert={pending || moving ? '' : undefined}>
          <div className="template-parallax-content">{children}</div>
        </div>
      </div>
    );
  }

  Object.assign(window.GameTierApp, { getTemplateSlideDirection, createTemplateSlideController, createTemplateDeleteController, TemplateTransition });
})();
