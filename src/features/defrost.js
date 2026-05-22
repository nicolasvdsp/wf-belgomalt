// ============================================
// DEFROST
// ============================================
// A single <canvas> sits on top of the card, painted with a heavily blurred
// silhouette of the card's own children — text rows + icon boxes in their
// real colors. Swiping erases canvas pixels via `destination-out`, revealing
// the sharp Webflow content underneath.
//
// We avoid foreignObject / DOM-rasterisation entirely: instead we walk the
// card's child elements ourselves, draw each one as a colored rectangle
// (background fills + approximate text bars), then blur the whole composition
// onto the main canvas. Reliable across browsers, no CORS issues, no font
// concerns.
//
// Markup (Webflow):
//   data-defrost-element                   on the card root
//
// Optional config attributes (on the card root):
//   data-defrost-brush="48"                Eraser radius in px (default 48).
//   data-defrost-brush-blur="0.55"         Feather amount on the trail edges,
//                                          0–1 (default 0.55). 0 = hard-edged
//                                          disc, 1 = fully soft falloff from
//                                          center outward.
//   data-defrost-blur="26"                 Blur strength of the frost (default 26).
//   data-defrost-base="rgba(...)"          Override the auto-detected base color.
//                                          Default = card's own background-color.
//   data-defrost-glaze="rgba(...)"         Translucent tint layered on top of
//                                          the blurred silhouette.
//   data-defrost-text-alpha="0.45"         How visible text silhouettes are.
//
// ZONES — Track how much a specific area has been defrosted (e.g. a button).
//   data-defrost-zone="my-button"          On a child of the card. Value is an
//                                          optional name (used in events).
//   data-defrost-zone-threshold="0.6"      0–1, default 0.7. When the cleared
//                                          % inside the zone crosses this,
//                                          we fire `defrost:zone-cleared`.
//   data-defrost-zone-cleared="passthrough"
//                                          Space-separated list of behaviors
//                                          to apply when the zone is cleared.
//                                          Absent / empty = events only, no
//                                          side-effects.
//                                          Supported behaviors:
//                                            passthrough — punch a clip-path
//                                              hole in the canvas so events
//                                              reach the underlying content.
//                                          (Easy to add more later: just check
//                                          `zone.behaviors.has('your-flag')`.)
//   data-defrost-zone-padding="8"          Extra px the cutout extends beyond
//                                          the zone's bounds (default 6).
//   data-defrost-zone-radius="20"          Cutout corner radius in px, or
//                                          "auto" to read border-radius from
//                                          the zone element (default auto).
//   data-defrost-zone-duration="600"       Reveal-animation length in ms.
//                                          0 = no animation (default 500).
//
// Events (dispatched on the card element):
//   defrost:zone-progress  detail = { name, percent, element }
//   defrost:zone-cleared   detail = { name, percent, element } (once)
//
// Barba-proof: re-inits on `barba:afterEnter`, cleans up old instances.

const SELECTOR = '[data-defrost-element]';
const defrostInstances = new Set();

const DEFAULT_BRUSH = 66;
const DEFAULT_BLUR = 26;
const DEFAULT_GLAZE = 'rgba(255, 255, 255, 0.06)';
const DEFAULT_TEXT_ALPHA = 0.45;
const DEFAULT_ZONE_THRESHOLD = 0.7;
const DEFAULT_ZONE_PADDING = 6;       // px extension beyond the zone bounds
const DEFAULT_ZONE_DURATION = 500;    // ms reveal animation
const DEFAULT_ZONE_RADIUS_FALLBACK = 16; // px if no border-radius detected
// Stride between sampled pixels when measuring zone clearance — every 8th
// pixel keeps the math fast enough to run every drag frame.
const ZONE_SAMPLE_STRIDE = 8;
// Alpha value below which a canvas pixel is considered "cleared".
const ZONE_CLEAR_ALPHA = 32;

// Cubic ease-out — quick splash that settles softly. Easy to swap if needed.
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// One-time feature test for `ctx.filter` (canvas 2D context blur). Chrome and
// modern Safari (17+) support it; older WebKit / iOS Safari silently no-op,
// leaving the silhouette sharp ("skeleton frost"). Cached on first call.
let _canvasFilterSupport = null;
function canvasFilterSupported() {
  if (_canvasFilterSupport !== null) return _canvasFilterSupport;
  try {
    const src = document.createElement('canvas');
    src.width = 8;
    src.height = 1;
    const sctx = src.getContext('2d');
    sctx.fillStyle = '#fff';
    sctx.fillRect(0, 0, 4, 1);
    sctx.fillStyle = '#000';
    sctx.fillRect(4, 0, 4, 1);

    const dst = document.createElement('canvas');
    dst.width = 8;
    dst.height = 1;
    const dctx = dst.getContext('2d');
    dctx.filter = 'blur(2px)';
    dctx.drawImage(src, 0, 0);
    // If blur ran, the pixel straddling the b/w boundary should fall between.
    const px = dctx.getImageData(4, 0, 1, 1).data;
    _canvasFilterSupport = px[0] > 20 && px[0] < 235;
  } catch (_) {
    _canvasFilterSupport = false;
  }
  return _canvasFilterSupport;
}

// Cross-browser fallback blur using the downscale + upscale trick: shrink the
// source to a tiny intermediate canvas, then draw it back at full size with
// bilinear filtering. Browsers apply the smoothing for free, which produces a
// soft gaussian-ish smear. Quality is lower than `ctx.filter` but the look is
// uniform enough that the eraser trail stays visibly circular.
function drawBlurredFallback(dstCtx, srcCanvas, w, h, radius) {
  const scale = Math.max(2, Math.round(radius / 2));
  const dw = Math.max(1, Math.floor(w / scale));
  const dh = Math.max(1, Math.floor(h / scale));

  const tmp = document.createElement('canvas');
  tmp.width = dw;
  tmp.height = dh;
  const tctx = tmp.getContext('2d');
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(srcCanvas, 0, 0, dw, dh);

  dstCtx.imageSmoothingEnabled = true;
  dstCtx.imageSmoothingQuality = 'high';
  dstCtx.drawImage(tmp, 0, 0, w, h);
}

function parseNumber(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Like parseNumber but allows 0 and clamps to [0, 1]. Used for normalized
// fader-style values (e.g. brush feather amount).
function parseUnit(value, fallback) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n > 1 ? 1 : n;
}

// Like parseNumber but 0 is a valid input (e.g. padding/duration of 0).
function parseNonNegative(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Parses a space-separated list of zone behaviors. Missing attribute falls
// back to the supplied default (so existing markup keeps working).
// Setting the attribute to "" explicitly clears all behaviors.
function parseBehaviorSet(value, defaultValue) {
  if (value == null) return new Set(defaultValue);
  return new Set(value.trim().split(/\s+/).filter(Boolean));
}

// --------------------------------------------
// Color helpers
// --------------------------------------------
function isTransparentColor(color) {
  if (!color) return true;
  const v = color.trim().toLowerCase();
  if (v === 'transparent') return true;
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (!m) return false;
  const parts = m[1].split(',').map(s => parseFloat(s.trim()));
  return parts.length >= 4 && parts[3] === 0;
}

// Walks up ancestors until it finds a non-transparent background color.
// Falls back to a near-black charcoal if nothing's reachable.
function findBaseColor(element) {
  let el = element;
  let attempts = 0;
  while (el && el !== document.documentElement && attempts < 12) {
    const bg = getComputedStyle(el).backgroundColor;
    if (!isTransparentColor(bg)) return bg;
    el = el.parentElement;
    attempts++;
  }
  return 'rgb(20, 20, 20)';
}


// --------------------------------------------
// Silhouette renderer
// --------------------------------------------
// Returns a temp canvas the size of (w x h) containing a colored
// approximation of the card's content. Heavy blur of this canvas produces
// the "smudged condensation" look without needing DOM rasterisation.
function renderSilhouette(element, w, h, baseColor, textAlpha) {
  const temp = document.createElement('canvas');
  temp.width = Math.max(1, Math.round(w));
  temp.height = Math.max(1, Math.round(h));
  const tctx = temp.getContext('2d');

  tctx.fillStyle = baseColor;
  tctx.fillRect(0, 0, temp.width, temp.height);

  const rootRect = element.getBoundingClientRect();

  function paintNode(node) {
    if (node.nodeType !== 1) return;
    if (node.classList && node.classList.contains('defrost__overlay')) return;

    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = rect.left - rootRect.left;
    const y = rect.top - rootRect.top;

    // Clipped out of card bounds?
    if (x + rect.width <= 0 || y + rect.height <= 0) return;
    if (x >= temp.width || y >= temp.height) return;

    const cs = getComputedStyle(node);

    // Element's own background (only if it's non-transparent and not the
    // root — root's bg is already filling the temp canvas).
    if (node !== element) {
      const bg = cs.backgroundColor;
      if (!isTransparentColor(bg)) {
        const radius = parseFloat(cs.borderRadius) || 0;
        drawRoundedRect(tctx, x, y, rect.width, rect.height, radius, bg);
      }
    }

    // Text leaves — represent each line as a translucent colored bar so
    // the blur smears them into the kind of fuzzy lines you'd see through
    // condensation.
    const hasDirectText = Array.from(node.childNodes).some(
      c => c.nodeType === 3 && c.textContent.trim()
    );
    if (hasDirectText) {
      const color = cs.color;
      const fontSize = parseFloat(cs.fontSize) || 16;
      const lineHeight =
        parseFloat(cs.lineHeight) > 0 ? parseFloat(cs.lineHeight) : fontSize * 1.25;

      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const padT = parseFloat(cs.paddingTop) || 0;
      const usableW = Math.max(0, rect.width - padL - padR);
      const usableH = Math.max(0, rect.height - padT - (parseFloat(cs.paddingBottom) || 0));
      const lines = Math.max(1, Math.round(usableH / lineHeight));

      tctx.save();
      tctx.globalAlpha = textAlpha;
      tctx.fillStyle = color;

      for (let i = 0; i < lines; i++) {
        const ratio = i === lines - 1 ? 0.55 + Math.random() * 0.3 : 0.92;
        const lineW = usableW * ratio;
        const lineX = x + padL;
        const lineY = y + padT + i * lineHeight + fontSize * 0.15;
        tctx.fillRect(lineX, lineY, lineW, fontSize * 0.7);
      }
      tctx.restore();
    }

    // Recurse.
    for (const child of node.children) paintNode(child);
  }

  paintNode(element);
  return temp;
}

function drawRoundedRect(ctx, x, y, w, h, r, color) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
  ctx.fill();
}


// --------------------------------------------
// Instance lifecycle
// --------------------------------------------
function destroyInstance(inst) {
  if (inst.ro) inst.ro.disconnect();
  if (inst.zoneRaf) cancelAnimationFrame(inst.zoneRaf);
  if (inst.cancelClipAnim) inst.cancelClipAnim();
  inst.canvas.removeEventListener('pointerdown', inst.onPointerDown);
  inst.canvas.removeEventListener('pointermove', inst.onPointerMove);
  inst.canvas.removeEventListener('pointerup', inst.onPointerUp);
  inst.canvas.removeEventListener('pointercancel', inst.onPointerUp);
  inst.canvas.removeEventListener('pointerleave', inst.onPointerLeave);
  if (inst.canvas.parentNode) inst.canvas.remove();
  delete inst.element.dataset.defrostInited;
  defrostInstances.delete(inst);
}

function purgeStaleInstances() {
  defrostInstances.forEach(inst => {
    if (!inst.element || !document.contains(inst.element)) destroyInstance(inst);
  });
}


// --------------------------------------------
// Init
// --------------------------------------------
function initDefrost(container) {
  container = container || document;
  purgeStaleInstances();

  const elements = container.querySelectorAll(SELECTOR);
  if (!elements.length) return;

  elements.forEach(element => {
    if (element.dataset.defrostInited === 'true') return;

    const brush = parseNumber(element.getAttribute('data-defrost-brush'), DEFAULT_BRUSH);
    // 0 = hard-edged eraser disc, 1 = fully soft falloff from center outward.
    // Default 0.55 matches the previous hardcoded gradient feel.
    const brushBlur = parseUnit(
      element.getAttribute('data-defrost-brush-blur'),
      0.55
    );
    const blurPx = parseNumber(element.getAttribute('data-defrost-blur'), DEFAULT_BLUR);
    const baseOverride = element.getAttribute('data-defrost-base');
    const glaze = element.getAttribute('data-defrost-glaze') || DEFAULT_GLAZE;
    const textAlpha = parseNumber(
      element.getAttribute('data-defrost-text-alpha'),
      DEFAULT_TEXT_ALPHA
    );

    element.dataset.defrostInited = 'true';

    const canvas = document.createElement('canvas');
    canvas.className = 'defrost__overlay';
    canvas.setAttribute('aria-hidden', 'true');
    element.appendChild(canvas);

    // `willReadFrequently: true` opts the canvas into a CPU-backed buffer so
    // repeated `getImageData` calls (for zone sampling) stay fast.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let width = 0;
    let height = 0;
    let dpr = 1;
    let painting = false;
    let lastX = null;
    let lastY = null;
    let zoneRaf = null;
    let clipAnimRaf = null;
    let zones = [];

    function paintFrost() {
      const base = baseOverride || findBaseColor(element);

      // Render silhouette to a temp canvas at logical size, then blur-blit
      // it onto our DPR-aware main canvas.
      const silhouette = renderSilhouette(element, width, height, base, textAlpha);

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      ctx.globalCompositeOperation = 'source-over';

      // Pre-blur the silhouette into condensation-like haze BEFORE drawing it
      // to the main canvas. The eraser then carves crisp circular holes into
      // already-smooth frost — surrounding pixels can't "bleed" rectangular
      // text-bar shapes into the trail. `ctx.filter` is the high-quality path
      // (Chrome / Safari 17+); older WebKit silently no-ops it so we fall back
      // to a downscale-upscale blur that works everywhere.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (canvasFilterSupported()) {
        ctx.filter = `blur(${blurPx}px)`;
        ctx.drawImage(silhouette, 0, 0, width, height);
        ctx.filter = 'none';
      } else {
        drawBlurredFallback(ctx, silhouette, width, height, blurPx);
      }

      // Light glaze on top to give it a wet glass feel.
      if (glaze) {
        ctx.fillStyle = glaze;
        ctx.fillRect(0, 0, width, height);
      }

      // Diagonal sheen — subtle, gives the surface a curved-glass hint.
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
      g.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
      g.addColorStop(1, 'rgba(255, 255, 255, 0.06)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    }

    // ----------------------------------------
    // Zones
    // ----------------------------------------
    function indexZones() {
      // `querySelectorAll` only matches descendants, so the root element
      // itself (when it carries `data-defrost-zone`) needs to be added
      // explicitly. Useful when the whole card counts as a "full unlock" zone.
      const found = Array.from(element.querySelectorAll('[data-defrost-zone]'));
      if (element.hasAttribute('data-defrost-zone')) found.unshift(element);

      zones = found.map(zoneEl => {
        const radiusAttr = zoneEl.getAttribute('data-defrost-zone-radius');
        const radiusOverride =
          radiusAttr != null && radiusAttr !== '' && radiusAttr !== 'auto'
            ? parseFloat(radiusAttr)
            : null;

        return {
          element: zoneEl,
          name: zoneEl.getAttribute('data-defrost-zone') || '',
          threshold: parseNumber(
            zoneEl.getAttribute('data-defrost-zone-threshold'),
            DEFAULT_ZONE_THRESHOLD
          ),
          behaviors: parseBehaviorSet(
            zoneEl.getAttribute('data-defrost-zone-cleared'),
            []
          ),
          padding: parseNonNegative(
            zoneEl.getAttribute('data-defrost-zone-padding'),
            DEFAULT_ZONE_PADDING
          ),
          duration: parseNonNegative(
            zoneEl.getAttribute('data-defrost-zone-duration'),
            DEFAULT_ZONE_DURATION
          ),
          radiusOverride: Number.isFinite(radiusOverride) && radiusOverride >= 0
            ? radiusOverride
            : null,
          cleared: false,
          lastPercent: 0,
          // Reveal animation state — `progress` goes 0 → 1 over `duration` ms
          // after the zone first crosses its clearance threshold.
          progress: 0,
          animationStart: 0
        };
      });
    }

    function getZoneRect(zone) {
      const elRect = element.getBoundingClientRect();
      const r = zone.element.getBoundingClientRect();
      let x = r.left - elRect.left;
      let y = r.top - elRect.top;
      let w = r.width;
      let h = r.height;

      // Clip to canvas bounds.
      if (x < 0) { w += x; x = 0; }
      if (y < 0) { h += y; y = 0; }
      if (x + w > width) w = width - x;
      if (y + h > height) h = height - y;
      return { x, y, w, h };
    }

    function sampleZoneProgress(zone) {
      const { x, y, w, h } = getZoneRect(zone);
      if (w <= 0 || h <= 0) return 0;

      const px = Math.max(0, Math.floor(x * dpr));
      const py = Math.max(0, Math.floor(y * dpr));
      const pw = Math.max(1, Math.floor(w * dpr));
      const ph = Math.max(1, Math.floor(h * dpr));

      let cleared = 0;
      let total = 0;
      try {
        const data = ctx.getImageData(px, py, pw, ph).data;
        // Read every Nth alpha byte for speed; data is RGBA so stride * 4.
        for (let i = 3; i < data.length; i += ZONE_SAMPLE_STRIDE * 4) {
          total++;
          if (data[i] < ZONE_CLEAR_ALPHA) cleared++;
        }
      } catch (_) {
        return 0;
      }
      return total > 0 ? cleared / total : 0;
    }

    // Resolves a zone's cutout radius — explicit override > computed
    // border-radius on the element > sensible fallback.
    function getZoneRadius(zone) {
      if (zone.radiusOverride != null) return zone.radiusOverride;
      const cs = getComputedStyle(zone.element);
      const r = parseFloat(cs.borderTopLeftRadius);
      return Number.isFinite(r) && r > 0 ? r : DEFAULT_ZONE_RADIUS_FALLBACK;
    }

    // Build the SVG path for one zone's cutout, accounting for padding,
    // rounded corners, and the in/out scale animation from the center.
    function buildZoneCutoutPath(zone) {
      const base = getZoneRect(zone);
      if (base.w <= 0 || base.h <= 0) return '';

      const pad = zone.padding;
      const px = base.x - pad;
      const py = base.y - pad;
      const pw = base.w + pad * 2;
      const ph = base.h + pad * 2;

      // Center & scale by `progress` so the cutout grows outward from the
      // zone's middle.
      const cx = px + pw / 2;
      const cy = py + ph / 2;
      const p = Math.max(0.0001, zone.progress);
      const sw = pw * p;
      const sh = ph * p;
      const x = cx - sw / 2;
      const y = cy - sh / 2;

      // Corner radius also scales with progress so the splash looks smooth
      // at any size. Clamp to half-side so we don't get inverted arcs.
      let r = getZoneRadius(zone) + pad * 0.5;
      r = Math.max(0, Math.min(r * p, sw / 2, sh / 2));

      if (r <= 0.5) {
        // Plain rect (no rounded corners) — small visual win at sub-px radii.
        return `M ${x},${y} L ${x + sw},${y} L ${x + sw},${y + sh} L ${x},${y + sh} Z`;
      }

      return (
        `M ${x + r},${y} ` +
        `L ${x + sw - r},${y} ` +
        `A ${r},${r} 0 0 1 ${x + sw},${y + r} ` +
        `L ${x + sw},${y + sh - r} ` +
        `A ${r},${r} 0 0 1 ${x + sw - r},${y + sh} ` +
        `L ${x + r},${y + sh} ` +
        `A ${r},${r} 0 0 1 ${x},${y + sh - r} ` +
        `L ${x},${y + r} ` +
        `A ${r},${r} 0 0 1 ${x + r},${y} ` +
        `Z`
      );
    }

    function updateClipPath() {
      const cutouts = zones
        .filter(z => z.cleared && z.behaviors.has('passthrough') && z.progress > 0)
        .map(buildZoneCutoutPath)
        .filter(Boolean);

      if (!cutouts.length) {
        canvas.style.clipPath = '';
        canvas.style.webkitClipPath = '';
        return;
      }

      const outer = `M 0,0 L ${width},0 L ${width},${height} L 0,${height} Z`;
      const d = [outer, ...cutouts].join(' ');
      const clip = `path(evenodd, '${d}')`;
      canvas.style.clipPath = clip;
      canvas.style.webkitClipPath = clip;
    }

    // Drives the reveal animation for any zone whose `progress` < 1.
    function tickClipAnimation() {
      clipAnimRaf = null;
      const now = performance.now();
      let stillAnimating = false;

      zones.forEach(zone => {
        if (!zone.cleared || !zone.behaviors.has('passthrough')) return;
        if (zone.progress >= 1) return;

        if (zone.duration <= 0) {
          zone.progress = 1;
          return;
        }

        const t = (now - zone.animationStart) / zone.duration;
        if (t >= 1) {
          zone.progress = 1;
        } else {
          zone.progress = easeOutCubic(Math.max(0, t));
          stillAnimating = true;
        }
      });

      updateClipPath();
      if (stillAnimating) clipAnimRaf = requestAnimationFrame(tickClipAnimation);
    }

    function startZoneAnimation(zone) {
      zone.progress = 0;
      zone.animationStart = performance.now();
      if (!clipAnimRaf) clipAnimRaf = requestAnimationFrame(tickClipAnimation);
    }

    function checkZones() {
      if (!zones.length) return;
      if (zoneRaf) return;
      zoneRaf = requestAnimationFrame(() => {
        zoneRaf = null;
        let clipDirty = false;
        zones.forEach(zone => {
          const pct = sampleZoneProgress(zone);
          zone.lastPercent = pct;
          element.dispatchEvent(
            new CustomEvent('defrost:zone-progress', {
              detail: { name: zone.name, percent: pct, element: zone.element }
            })
          );
          if (!zone.cleared && pct >= zone.threshold) {
            zone.cleared = true;
            if (zone.behaviors.has('passthrough')) {
              startZoneAnimation(zone);
              clipDirty = true;
            }
            element.dispatchEvent(
              new CustomEvent('defrost:zone-cleared', {
                detail: { name: zone.name, percent: pct, element: zone.element }
              })
            );
          }
        });
        if (clipDirty) updateClipPath();
      });
    }

    function resize() {
      const rect = element.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const nextDpr = window.devicePixelRatio || 1;
      if (w === width && h === height && nextDpr === dpr) return;

      width = w;
      height = h;
      dpr = nextDpr;

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      paintFrost();
      // Cleared zones move with layout — refresh the clip cutouts.
      updateClipPath();
    }

    function localCoords(clientX, clientY) {
      const rect = element.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function stamp(x, y) {
      const r = brush / 2;
      ctx.globalCompositeOperation = 'destination-out';

      if (brushBlur <= 0) {
        // Hard edge — skip the gradient altogether for crispness.
        ctx.fillStyle = '#000';
      } else {
        // Solid core stays fully opaque until `(1 - brushBlur)` of the radius,
        // then ramps to alpha 0 at the edge. Bigger brushBlur = softer feather.
        const solidEnd = Math.max(0, Math.min(1, 1 - brushBlur));
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(0, 0, 0, 1)');
        g.addColorStop(solidEnd, 'rgba(0, 0, 0, 1)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
      }

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawSegment(x0, y0, x1, y1) {
      const dist = Math.hypot(x1 - x0, y1 - y0);
      const step = Math.max(brush * 0.25, 2);
      const steps = Math.max(1, Math.ceil(dist / step));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        stamp(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      }
    }

    function paintAt(clientX, clientY) {
      const { x, y } = localCoords(clientX, clientY);
      if (x < 0 || y < 0 || x > width || y > height) return;
      if (lastX != null && lastY != null) {
        drawSegment(lastX, lastY, x, y);
      } else {
        stamp(x, y);
      }
      lastX = x;
      lastY = y;
      checkZones();
    }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      painting = true;
      lastX = null;
      lastY = null;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      paintAt(e.clientX, e.clientY);
    }

    function onPointerMove(e) {
      if (!painting) return;
      e.preventDefault();
      paintAt(e.clientX, e.clientY);
    }

    function endPaint(e) {
      if (!painting) return;
      painting = false;
      lastX = null;
      lastY = null;
      try {
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      } catch (_) { /* ignore */ }
      // One final sample on release, in case the threshold was crossed by
      // the last few stamps and the rAF for it had just fired.
      checkZones();
    }

    function onPointerLeave(e) {
      if (painting) endPaint(e);
    }

    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', endPaint);
    canvas.addEventListener('pointercancel', endPaint);
    canvas.addEventListener('pointerleave', onPointerLeave);

    const inst = {
      element,
      canvas,
      ro: null,
      onPointerDown,
      onPointerMove,
      onPointerUp: endPaint,
      onPointerLeave,
      cancelClipAnim: () => {
        if (clipAnimRaf) {
          cancelAnimationFrame(clipAnimRaf);
          clipAnimRaf = null;
        }
      }
    };

    const ro = new ResizeObserver(() => {
      if (painting) return;
      resize();
    });
    ro.observe(element);
    inst.ro = ro;

    indexZones();
    resize();
    defrostInstances.add(inst);
  });
}


function defrost() {
  document.addEventListener('barba:afterEnter', (e) => {
    requestAnimationFrame(() => initDefrost(e.detail.container));
  });
}

export default defrost;
