// ============================================
// SOCIAL PROOF WALL
// ============================================
// Builds a multi-row wall of round avatar tiles from a pool of image URLs.
// Each row holds a configurable number of avatars at randomized sizes (always
// even px) with no two equal sizes back-to-back. On scroll the avatars fade
// and scale in with a random-order stagger; once revealed they keep gently
// floating + pulsating, and rows can optionally marquee horizontally.
//
// Markup — minimal seed (image pool comes from any descendant `img` tags).
// The first wrapper is used as a template only; the wall is fully rebuilt.
//
//   <div data-socialproof-wall>
//     <div class="socialproof_avatar-wrapper">
//       <img src="…" alt="" />
//     </div>
//     <!-- one or many; only their URLs are kept -->
//   </div>
//
// All sizing/animation knobs live on the root element. Sensible defaults
// match the Figma source (5 rows × 8 avatars, 22–44px, etc.). Avatars in a
// row are always distributed across the wall's full width — no manual gap.
//
//   data-socialproof-lines="5"            Number of rows.
//   data-socialproof-per-line="8"         Avatars per row, distributed across
//                                         equal-width grid columns (uniform
//                                         center-to-center rhythm).
//   data-socialproof-min-size="22"        Smallest avatar px. Rounded to even.
//   data-socialproof-max-size="44"        Largest avatar px. Rounded to even.
//   data-socialproof-size-steps="0"       0 = use every even size between
//                                         min and max. N>0 = pick N evenly-
//                                         spaced sizes from that range.
//   data-socialproof-size-bias="2.2"      Distribution bias across the pool.
//                                         1 = uniform. >1 = larger sizes more
//                                         common (default). <1 = smaller sizes
//                                         more common.
//
//   data-socialproof-images="[url, …]"    Optional override of the image pool
//                                         (JSON array or CSV). When absent the
//                                         pool is harvested from descendant
//                                         <img src>.
//
//   data-socialproof-marquee="false"      Enable per-row horizontal scroll.
//   data-socialproof-marquee-speed="35"   Pixels per second.
//   data-socialproof-marquee-direction="alternate|left|right"
//                                         alternate = even rows left, odd
//                                         rows right (default).
//
//   data-socialproof-float="true"         Subtle infinite x/y drift on each
//                                         avatar (~3–6 px range).
//   data-socialproof-pulse="true"         Subtle infinite scale pulsation
//                                         (~3% amplitude).
//
//   data-socialproof-reveal-stagger="0.04"  Per-avatar stagger (seconds).
//   data-socialproof-reveal-duration="0.9"  Per-avatar reveal duration.
//   data-socialproof-reveal-start="top 90%" ScrollTrigger start.
//
//   data-socialproof-row-opacity-min="1"   Opacity gradient applied per row,
//   data-socialproof-row-opacity-max="1"   linearly interpolated between min
//                                          (first row) and max (last row).
//                                          Defaults to 1/1 = uniform.
//
//   data-socialproof-row-offset="auto"    Initial marquee phase offset between
//                                          rows. "auto" alternates a half-block
//                                          shift; a number = px. Only applies
//                                          when marquee is enabled.
//   data-socialproof-row-stagger="0.5"    Horizontal layout offset between
//                                          alternating rows, expressed as a
//                                          fraction of one column slot
//                                          (0 = disabled, 0.5 = half-slot
//                                          stagger so columns never align
//                                          vertically). Avatars on staggered
//                                          rows bleed off the row edges.
//
// Reduced motion: reveal becomes an instant set, float/pulse/marquee are
// skipped. Barba-safe via `barba:afterEnter` (re-inits on every page enter).
// ============================================

const ROOT_SELECTOR = '[data-socialproof-wall]';
const TEMPLATE_WRAPPER_SELECTOR = '.socialproof_avatar-wrapper';

const DEFAULTS = {
  lines: 5,
  perLine: 8,
  minSize: 22,
  maxSize: 44,
  sizeSteps: 6,
  sizeBias: 2.2,
  marquee: false,
  marqueeSpeed: 2,
  marqueeDirection: 'alternate',
  float: false,
  pulse: false,
  revealStagger: 0.02,
  revealDuration: 0.4,
  revealStart: 'top 90%',
  rowOpacityMin: 1,
  rowOpacityMax: 1,
  rowOffset: 'auto',
  rowStagger: 0.5
};

const socialProofInstances = new Set();


// --------------------------------------------
// Helpers
// --------------------------------------------
function parseBool(value, fallback) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}

function parseNumberAttr(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

// Coerce any positive integer to an even number ≥2 (avatars are always even px).
function toEven(n) {
  const i = Math.max(2, Math.round(n));
  return i % 2 === 0 ? i : i + 1;
}

// "[\"a\",\"b\"]" or "a, b, c" or null → string[].
function parseImageListAttr(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      // fall through to CSV parsing
    }
  }
  return trimmed.split(',').map(s => s.trim()).filter(Boolean);
}

// Build the pool of allowed even sizes between min and max.
// If sizeSteps > 0 we pick that many evenly-spaced sizes from the full pool.
function buildSizePool(minSize, maxSize, sizeSteps) {
  const min = toEven(Math.min(minSize, maxSize));
  const max = toEven(Math.max(minSize, maxSize));
  const full = [];
  for (let s = min; s <= max; s += 2) full.push(s);

  if (sizeSteps <= 0 || sizeSteps >= full.length) return full;
  if (sizeSteps === 1) return [Math.round((min + max) / 2 / 2) * 2];

  const out = [];
  for (let i = 0; i < sizeSteps; i++) {
    const t = i / (sizeSteps - 1);
    const raw = min + (max - min) * t;
    out.push(toEven(raw));
  }
  // Dedupe while preserving order.
  return Array.from(new Set(out));
}

// Pick one size from a sorted-ascending pool, weighted by `bias`:
//   bias === 1  → uniform
//   bias  >  1  → larger sizes more likely
//   bias  <  1  → smaller sizes more likely
// The transform `t = r^(1/bias)` skews uniform random toward 1 (high end)
// for bias>1 and toward 0 (low end) for bias<1. Picks the candidate at the
// resulting index.
function pickBiasedSize(candidates, bias) {
  if (candidates.length === 1) return candidates[0];
  const safeBias = Math.max(0.05, bias);
  const t = Math.pow(Math.random(), 1 / safeBias);
  const idx = Math.min(candidates.length - 1, Math.floor(t * candidates.length));
  return candidates[idx];
}

// Generate `count` sizes from `pool` such that no two adjacent picks are
// equal. When the pool only has one size we silently drop the constraint.
// `pool` is expected to be sorted ascending so the bias has a stable meaning.
function generateRowSizes(count, pool, bias, lastSizeOfPreviousRow) {
  if (pool.length === 0) return [];
  if (pool.length === 1) return Array(count).fill(pool[0]);

  const out = [];
  let prev = null;
  for (let i = 0; i < count; i++) {
    const forbidden = i === 0 ? lastSizeOfPreviousRow : prev;
    const candidates = forbidden == null ? pool : pool.filter(s => s !== forbidden);
    const pick = pickBiasedSize(candidates, bias);
    out.push(pick);
    prev = pick;
  }
  return out;
}

// Pull image URLs from the wall's existing descendants. Falls back to an
// explicit `data-socialproof-images` attribute when no <img> seeds exist.
function collectImagePool(root) {
  const explicit = parseImageListAttr(root.getAttribute('data-socialproof-images'));
  if (explicit && explicit.length) return explicit;

  const urls = [];
  root.querySelectorAll('img').forEach(img => {
    const src = img.currentSrc || img.getAttribute('src');
    if (src) urls.push(src);
  });
  return urls;
}

// Read the current pixel width of the wall, with safe fallbacks for elements
// that haven't fully laid out yet (e.g. hidden parents during init).
function measureWallWidth(root) {
  return root.clientWidth || root.getBoundingClientRect().width || window.innerWidth;
}


// --------------------------------------------
// DOM build
// --------------------------------------------
function buildWall(root, settings, imagePool) {
  // Cache the original template's wrapper + img classNames so the Webflow
  // styles (`.socialproof_avatar-wrapper`, `.image-2`, etc.) stay attached
  // to every rebuilt element.
  const template = root.querySelector(TEMPLATE_WRAPPER_SELECTOR);
  const wrapperClassName = template ? template.className : 'socialproof_avatar-wrapper';
  const templateImg = template ? template.querySelector('img') : null;
  const imgClassName = templateImg ? templateImg.className : '';
  root.innerHTML = '';

  const sizePool = buildSizePool(settings.minSize, settings.maxSize, settings.sizeSteps);
  const perLine = settings.perLine;
  const stagger = Math.max(0, Math.min(1, settings.rowStagger));
  // When staggering, we render one extra column per block. That extra column
  // is what makes alternating rows bleed off the opposite edge — odd rows
  // shift the block left by `stagger * slotW`, putting their cells halfway
  // between the cells of even rows.
  const useExtraCell = stagger > 0;
  const cellsPerBlock = useExtraCell ? perLine + 1 : perLine;
  const wallWidth = measureWallWidth(root);
  const slotW = wallWidth / perLine;
  const blockWidth = cellsPerBlock * slotW;

  const rows = [];
  const blocks = [];
  let seamSize = null;

  for (let lineIndex = 0; lineIndex < settings.lines; lineIndex++) {
    const row = document.createElement('div');
    row.className = 'socialproof_row';
    row.setAttribute('data-socialproof-row', String(lineIndex));

    if (settings.lines > 1) {
      const t = lineIndex / (settings.lines - 1);
      const opacity = settings.rowOpacityMin + (settings.rowOpacityMax - settings.rowOpacityMin) * t;
      row.style.opacity = String(opacity);
    }

    const track = document.createElement('div');
    track.className = 'socialproof_row-track';
    row.appendChild(track);

    const blockCount = settings.marquee ? 2 : 1;
    const blockSizes = generateRowSizes(cellsPerBlock, sizePool, settings.sizeBias, seamSize);
    seamSize = blockSizes[blockSizes.length - 1];

    const offsetX = useExtraCell && lineIndex % 2 === 1 ? -stagger * slotW : 0;

    const rowBlocks = [];
    for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
      const block = document.createElement('div');
      block.className = 'socialproof_row-block';
      // Each block is `(perLine + extra) * slotW` wide. Odd rows translate
      // the block left so their cells fall between the cells of even rows
      // (the extra column ensures the right edge still bleeds across the
      // wall). CSS grid (`_social-proof.scss`) splits the block into
      // equal-width columns so center-to-center spacing stays uniform.
      // With marquee on, two identical blocks tile the track and the track
      // translates -50% for a seamless loop.
      block.style.width = `${blockWidth}px`;
      if (offsetX) block.style.transform = `translate3d(${offsetX}px, 0, 0)`;
      if (blockIndex > 0) block.setAttribute('aria-hidden', 'true');

      blockSizes.forEach((size, slotIndex) => {
        const wrapper = document.createElement('div');
        wrapper.className = wrapperClassName;
        wrapper.style.width = `${size}px`;
        wrapper.style.height = `${size}px`;
        wrapper.setAttribute('data-socialproof-avatar', '');
        if (blockIndex > 0) wrapper.setAttribute('aria-hidden', 'true');

        const img = document.createElement('img');
        if (imgClassName) img.className = imgClassName;
        const src = imagePool[(lineIndex * cellsPerBlock + slotIndex + blockIndex * cellsPerBlock) % imagePool.length];
        img.src = src;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        wrapper.appendChild(img);

        block.appendChild(wrapper);
      });

      track.appendChild(block);
      rowBlocks.push(block);
    }

    root.appendChild(row);
    rows.push({ row, track });
    blocks.push(rowBlocks);
  }

  return { rows, blocks, perLine, cellsPerBlock, useExtraCell, stagger, wallWidth, blockWidth };
}

// Re-flow block widths and per-row offsets when the wall resizes. Slot width
// scales with wallWidth so we recompute both, then re-apply the staggered
// transforms.
function reflowLayout(blocks, perLine, useExtraCell, stagger, wallWidth) {
  const cellsPerBlock = useExtraCell ? perLine + 1 : perLine;
  const slotW = wallWidth / perLine;
  const blockWidth = cellsPerBlock * slotW;
  blocks.forEach((rowBlocks, lineIndex) => {
    const offsetX = useExtraCell && lineIndex % 2 === 1 ? -stagger * slotW : 0;
    rowBlocks.forEach(block => {
      block.style.width = `${blockWidth}px`;
      block.style.transform = offsetX ? `translate3d(${offsetX}px, 0, 0)` : '';
    });
  });
  return blockWidth;
}


// --------------------------------------------
// Animations
// --------------------------------------------
// Resolve a normalized [0, 1) progress offset for each marquee row, based on
// `data-socialproof-row-offset`. Falls back to a random offset so rows never
// look locked together on first paint.
function rowPhaseResolver(rowOffset, wallWidth) {
  if (rowOffset === 'auto') {
    return (i) => (i % 2 === 0 ? 0 : 0.5);
  }
  const px = parseNumberAttr(rowOffset, NaN);
  if (Number.isFinite(px) && wallWidth > 0) {
    const norm = ((px % wallWidth) + wallWidth) % wallWidth / wallWidth;
    return (i) => (i % 2 === 0 ? 0 : norm);
  }
  return () => Math.random();
}

function setupReveal(gsap, ScrollTrigger, root, avatars, settings, onComplete) {
  if (!avatars.length) {
    onComplete();
    return null;
  }

  gsap.set(avatars, { opacity: 0, scale: 0.4, transformOrigin: '50% 50%' });

  return ScrollTrigger.create({
    trigger: root,
    start: settings.revealStart,
    once: true,
    onEnter() {
      gsap.to(avatars, {
        opacity: 1,
        scale: 1,
        duration: settings.revealDuration,
        ease: 'power3.out',
        stagger: {
          each: settings.revealStagger,
          from: 'random',
          ease: 'power2.out'
        },
        onComplete
      });
    }
  });
}

// Each avatar gets its own infinite, randomized drift/pulse timeline so the
// wall keeps breathing without any two avatars looking synchronized.
function startAvatarMicroLoop(gsap, avatar, settings) {
  const tl = gsap.timeline({ defaults: { ease: 'sine.inOut' } });

  if (settings.float) {
    const range = 4 + Math.random() * 3;          // 4–7 px
    const dx = (Math.random() * 2 - 1) * range;
    const dy = (Math.random() * 2 - 1) * range;
    const dur = 2.6 + Math.random() * 2.4;        // 2.6–5.0 s
    tl.to(avatar, {
      x: dx,
      y: dy,
      duration: dur,
      repeat: -1,
      yoyo: true,
      delay: Math.random() * dur
    }, 0);
  }

  if (settings.pulse) {
    const amp = 0.018 + Math.random() * 0.022;    // 1.8–4.0%
    const dur = 1.8 + Math.random() * 1.6;        // 1.8–3.4 s
    tl.to(avatar, {
      scale: 1 + amp,
      duration: dur,
      repeat: -1,
      yoyo: true,
      delay: Math.random() * dur
    }, 0);
  }

  return tl;
}

function setupMarquees(gsap, rows, settings, blockWidth) {
  if (!settings.marquee) return [];

  const phaseFor = rowPhaseResolver(settings.rowOffset, blockWidth);
  const duration = blockWidth > 0 ? blockWidth / settings.marqueeSpeed : 30;

  const timelines = [];
  rows.forEach(({ track }, i) => {
    const dir = settings.marqueeDirection;
    const goLeft = dir === 'left' || (dir === 'alternate' && i % 2 === 0);
    const from = goLeft ? 0 : -50;
    const to = goLeft ? -50 : 0;

    const tl = gsap.timeline({ repeat: -1, defaults: { ease: 'none' } });
    tl.fromTo(track, { xPercent: from }, { xPercent: to, duration }, 0);
    tl.progress(phaseFor(i));
    timelines.push(tl);
  });
  return timelines;
}


// --------------------------------------------
// Lifecycle
// --------------------------------------------
function readSettings(root) {
  const get = (name, parser, fallback) => parser(root.getAttribute(name), fallback);

  return {
    lines: Math.max(1, Math.round(get('data-socialproof-lines', parseNumberAttr, DEFAULTS.lines))),
    perLine: Math.max(1, Math.round(get('data-socialproof-per-line', parseNumberAttr, DEFAULTS.perLine))),
    minSize: toEven(get('data-socialproof-min-size', parseNumberAttr, DEFAULTS.minSize)),
    maxSize: toEven(get('data-socialproof-max-size', parseNumberAttr, DEFAULTS.maxSize)),
    sizeSteps: Math.max(0, Math.round(get('data-socialproof-size-steps', parseNumberAttr, DEFAULTS.sizeSteps))),
    sizeBias: Math.max(0.05, get('data-socialproof-size-bias', parseNumberAttr, DEFAULTS.sizeBias)),
    marquee: parseBool(root.getAttribute('data-socialproof-marquee'), DEFAULTS.marquee),
    marqueeSpeed: Math.max(1, get('data-socialproof-marquee-speed', parseNumberAttr, DEFAULTS.marqueeSpeed)),
    marqueeDirection: (root.getAttribute('data-socialproof-marquee-direction') || DEFAULTS.marqueeDirection).toLowerCase(),
    float: parseBool(root.getAttribute('data-socialproof-float'), DEFAULTS.float),
    pulse: parseBool(root.getAttribute('data-socialproof-pulse'), DEFAULTS.pulse),
    revealStagger: Math.max(0, get('data-socialproof-reveal-stagger', parseNumberAttr, DEFAULTS.revealStagger)),
    revealDuration: Math.max(0.05, get('data-socialproof-reveal-duration', parseNumberAttr, DEFAULTS.revealDuration)),
    revealStart: root.getAttribute('data-socialproof-reveal-start') || DEFAULTS.revealStart,
    rowOpacityMin: get('data-socialproof-row-opacity-min', parseNumberAttr, DEFAULTS.rowOpacityMin),
    rowOpacityMax: get('data-socialproof-row-opacity-max', parseNumberAttr, DEFAULTS.rowOpacityMax),
    rowOffset: root.getAttribute('data-socialproof-row-offset') || DEFAULTS.rowOffset,
    rowStagger: Math.max(0, Math.min(1, get('data-socialproof-row-stagger', parseNumberAttr, DEFAULTS.rowStagger)))
  };
}

function destroyInstance(inst) {
  if (inst.scrollTrigger) inst.scrollTrigger.kill();
  inst.microTimelines.forEach(tl => tl.kill());
  inst.marqueeTimelines.forEach(tl => tl.kill());
  if (inst.intersectionObserver) inst.intersectionObserver.disconnect();
  if (inst.resizeObserver) inst.resizeObserver.disconnect();
  socialProofInstances.delete(inst);
}

function purgeStaleInstances() {
  socialProofInstances.forEach(inst => {
    if (!inst.root || !document.contains(inst.root)) destroyInstance(inst);
  });
}

function initSocialProof(container) {
  container = container || document;

  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) return;

  purgeStaleInstances();

  const roots = container.querySelectorAll(ROOT_SELECTOR);
  if (!roots.length) return;

  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  roots.forEach(root => {
    if (root.dataset.socialproofInited === 'true') return;

    const imagePool = collectImagePool(root);
    if (!imagePool.length) return;

    const settings = readSettings(root);
    const built = buildWall(root, settings, imagePool);
    const { rows, blocks, perLine, useExtraCell, stagger } = built;
    if (!rows.length) return;

    const avatars = Array.from(root.querySelectorAll('[data-socialproof-avatar]'));

    const instance = {
      root,
      rows,
      blocks,
      avatars,
      wallWidth: built.wallWidth,
      blockWidth: built.blockWidth,
      scrollTrigger: null,
      microTimelines: [],
      marqueeTimelines: [],
      intersectionObserver: null,
      resizeObserver: null,
      isVisible: true
    };
    socialProofInstances.add(instance);

    const startMicroLoops = () => {
      if (reducedMotion) return;
      if (!settings.float && !settings.pulse) return;
      avatars.forEach(avatar => {
        instance.microTimelines.push(startAvatarMicroLoop(gsap, avatar, settings));
      });
    };

    const startMarquees = () => {
      if (reducedMotion) return;
      instance.marqueeTimelines = setupMarquees(gsap, rows, settings, instance.blockWidth);
      if (!instance.isVisible) instance.marqueeTimelines.forEach(tl => tl.pause());
    };

    if (reducedMotion) {
      gsap.set(avatars, { opacity: 1, scale: 1 });
    } else {
      instance.scrollTrigger = setupReveal(gsap, ScrollTrigger, root, avatars, settings, () => {
        startMicroLoops();
      });
    }

    // Marquees start immediately (they're slow, no reveal dependency) — but
    // pause when offscreen to save cycles.
    startMarquees();

    if (instance.marqueeTimelines.length) {
      instance.intersectionObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          instance.isVisible = entry.isIntersecting;
          instance.marqueeTimelines.forEach(tl => {
            if (entry.isIntersecting) tl.play();
            else tl.pause();
          });
        });
      }, { threshold: 0 });
      instance.intersectionObserver.observe(root);
    }

    // Keep block widths + row stagger in sync with the wall. When the wall
    // width changes, re-flow the layout and recreate the marquee timelines so
    // the visual speed stays consistent (we keep the previous progress to
    // avoid jumps).
    let lastWidth = instance.wallWidth;
    instance.resizeObserver = new ResizeObserver(() => {
      const next = measureWallWidth(root);
      if (next <= 0 || Math.abs(next - lastWidth) < 0.5) return;
      lastWidth = next;
      instance.wallWidth = next;
      instance.blockWidth = reflowLayout(blocks, perLine, useExtraCell, stagger, next);
      if (instance.marqueeTimelines.length) {
        const progresses = instance.marqueeTimelines.map(tl => tl.progress());
        instance.marqueeTimelines.forEach(tl => tl.kill());
        instance.marqueeTimelines = setupMarquees(gsap, rows, settings, instance.blockWidth);
        instance.marqueeTimelines.forEach((tl, idx) => tl.progress(progresses[idx] || 0));
        if (!instance.isVisible) instance.marqueeTimelines.forEach(tl => tl.pause());
      }
    });
    instance.resizeObserver.observe(root);

    root.dataset.socialproofInited = 'true';
  });
}


function socialProof() {
  document.addEventListener('barba:afterEnter', (e) => {
    initSocialProof(e.detail.container);
  });
}

export default socialProof;
