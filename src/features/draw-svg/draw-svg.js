import { UNDERLINE_WORD_SVGS, UNDERLINE_BLOCK_SVGS, CIRCLE_WORD_SVGS, ARROW_SVGS } from './svg-pools';

// ============================================
// DRAW SVG
// ============================================
// Draws an animated hand-drawn SVG (underline or, later, arrow) onto/around
// elements as they enter the viewport. Barba-proof: re-runs on
// `barba:pageVisible` scoped to the fresh page container, and cleans up
// stale instances (ScrollTriggers + ResizeObservers) whose DOM was removed.
//
// MODES — presence of any of these attributes activates that mode for the
// element. Use only one per element.
//
//   data-draw-underline-word="word"   Match a word (case-insensitive, whole
//                                     word) inside the element's text and
//                                     draw an underline beneath it. Multi-line
//                                     wraps get one underline per line.
//
//   data-draw-underline-block         Draw a single underline beneath the
//                                     element's last line of text. For a
//                                     one-line block that's the full width;
//                                     for a wrapped block only the last line
//                                     is underlined.
//
//   data-draw-circle-word="word"      Match a word (case-insensitive, whole
//                                     word) inside the element's text and
//                                     draw a hand-drawn oval around it.
//                                     Multi-line wraps get one oval per line.
//
//   data-draw-arrow                   Draw a scribbled arrow inside a
//                                     fixed-height container. Pass a numeric
//                                     value (`data-draw-arrow="2"`) to pick a
//                                     specific arrow from the pool (1-based).
//                                     Empty value = random pick (default).
//
// SHARED CONFIG — optional on any init element.
//
//   data-draw-scrub="true|false"      Draw progressively as the user scrolls.
//                                     Default false (one-shot draw when the
//                                     trigger hits 25% from bottom of vh).
//   data-draw-undraw="true|false"     Collapse the line to its end when
//                                     scrolling back above the trigger.
//   data-draw-color="#hex"            Override color (defaults to currentColor
//                                     so the drawing matches text color).
//   data-draw-height="1em"            Override underline thickness (any valid
//                                     CSS length). Defaults: 0.35em (word),
//                                     0.8em (block). Ignored for arrow mode.
//   data-draw-start="top 90%"         Override ScrollTrigger `start` position.
//   data-draw-end="top 40%"           Override ScrollTrigger `end` position
//                                     (only used when data-draw-scrub=true).
//
// ARROW NOTE
//   Arrow SVGs can contain multiple sub-paths (`M…M…`). The first sub-path is
//   treated as the "line", the remaining sub-paths as the "arrowhead". The
//   line draws first; the arrowhead starts at 90% of the line's duration.
//
// WORD-MODES ONLY (underline-word, circle-word)
//
//   data-draw-match-all="true|false"  Decorate every occurrence of the word
//                                     (default false = first match only).
// ============================================

const MODE = {
  UNDERLINE_WORD: 'underline-word',
  UNDERLINE_BLOCK: 'underline-block',
  CIRCLE_WORD: 'circle-word',
  ARROW: 'arrow'
};

const MODE_ATTRIBUTE = {
  [MODE.UNDERLINE_WORD]: 'data-draw-underline-word',
  [MODE.UNDERLINE_BLOCK]: 'data-draw-underline-block',
  [MODE.CIRCLE_WORD]: 'data-draw-circle-word',
  [MODE.ARROW]: 'data-draw-arrow'
};

const SVG_POOL = {
  [MODE.UNDERLINE_WORD]: UNDERLINE_WORD_SVGS,
  [MODE.UNDERLINE_BLOCK]: UNDERLINE_BLOCK_SVGS,
  [MODE.CIRCLE_WORD]: CIRCLE_WORD_SVGS,
  [MODE.ARROW]: ARROW_SVGS
};

// Modes that target word matches inside text (share wrap logic + per-line rects).
const WORD_MODES = new Set([MODE.UNDERLINE_WORD, MODE.CIRCLE_WORD]);

const INIT_SELECTOR = Object.values(MODE_ATTRIBUTE)
  .map(attr => `[${attr}]`)
  .join(', ');

const drawSvgInstances = new Set();


// --------------------------------------------
// Helpers
// --------------------------------------------
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decorateSvg(svg, mode) {
  if (!svg) return;
  // Arrows keep their aspect ratio; underlines stretch non-uniformly to the
  // width of the target line.
  svg.setAttribute(
    'preserveAspectRatio',
    mode === MODE.ARROW ? 'xMidYMid meet' : 'none'
  );
  svg.querySelectorAll('path').forEach(p => p.setAttribute('stroke', 'currentColor'));
}

function detectMode(el) {
  if (el.hasAttribute(MODE_ATTRIBUTE[MODE.UNDERLINE_WORD])) return MODE.UNDERLINE_WORD;
  if (el.hasAttribute(MODE_ATTRIBUTE[MODE.UNDERLINE_BLOCK])) return MODE.UNDERLINE_BLOCK;
  if (el.hasAttribute(MODE_ATTRIBUTE[MODE.CIRCLE_WORD])) return MODE.CIRCLE_WORD;
  if (el.hasAttribute(MODE_ATTRIBUTE[MODE.ARROW])) return MODE.ARROW;
  return null;
}

function pickRandomSvg(pool) {
  if (!pool || !pool.length) return '';
  return pool[Math.floor(Math.random() * pool.length)];
}

// Truthy attribute parser — accepts "true" / "True" / "TRUE" / "1" / "yes".
function isTruthyAttr(value) {
  if (value == null) return false;
  const v = String(value).trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

// Splits a <path> whose `d` contains multiple sub-paths (`M…M…`) into
// individual <path> siblings, each containing a single sub-path. All path
// attributes (stroke, stroke-width, etc.) are preserved via cloneNode.
// If there's only one sub-path, returns the original path unchanged.
function splitSubpaths(pathEl) {
  const d = pathEl.getAttribute('d') || '';
  const subs = d.match(/[Mm][^Mm]*/g);
  if (!subs || subs.length <= 1) return [pathEl];

  const parent = pathEl.parentNode;
  const results = [];
  subs.forEach((sub, i) => {
    if (i === 0) {
      pathEl.setAttribute('d', sub.trim());
      results.push(pathEl);
    } else {
      const clone = pathEl.cloneNode(false);
      clone.setAttribute('d', sub.trim());
      parent.appendChild(clone);
      results.push(clone);
    }
  });
  return results;
}

// How far into the lead animation the trail (arrowhead) starts.
// 0.9 = arrowhead begins when line is 90% drawn.
const ARROW_TRAIL_OFFSET = 0.9;


// --------------------------------------------
// Word-mode: wrap matches in a span
// --------------------------------------------
function wrapWordMatches(root, word, matchAll) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (node.parentElement && node.parentElement.closest('.draw-svg__target, .draw-svg__overlay')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);

  const wrappers = [];

  for (const textNode of textNodes) {
    if (!matchAll && wrappers.length > 0) break;

    const value = textNode.nodeValue;
    const re = new RegExp(`\\b${escapeRegex(word)}\\b`, matchAll ? 'gi' : 'i');
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    let found = false;

    while ((match = re.exec(value)) !== null) {
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
      }
      const span = document.createElement('span');
      span.className = 'draw-svg__target';
      span.textContent = match[0];
      frag.appendChild(span);
      wrappers.push(span);
      lastIndex = match.index + match[0].length;
      found = true;
      if (!matchAll) break;
    }
    if (!found) continue;

    if (lastIndex < value.length) {
      frag.appendChild(document.createTextNode(value.slice(lastIndex)));
    }
    textNode.parentNode.replaceChild(frag, textNode);
  }

  return wrappers;
}


// --------------------------------------------
// Get rects to draw under (per mode)
// --------------------------------------------
// Returns an array of rects (DOMRect-like) in viewport coordinates.
// Word mode: one rect per line of each wrapped match.
// Block mode: only the last line rect of the element's contents.
// Arrow mode: the element's own bounding rect.
function getDrawRects(mode, element, wordSpans) {
  if (WORD_MODES.has(mode)) {
    const rects = [];
    wordSpans.forEach(span => {
      Array.from(span.getClientRects()).forEach(rect => {
        if (rect.width > 0 && rect.height > 0) rects.push(rect);
      });
    });
    return rects;
  }

  if (mode === MODE.UNDERLINE_BLOCK || mode === MODE.ARROW) {
    const r = element.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return [];
    return [r];
  }

  return [];
}


// --------------------------------------------
// Instance lifecycle
// --------------------------------------------
function destroyInstance(inst) {
  if (typeof inst.destroy === 'function') inst.destroy();
  if (inst.st) inst.st.kill();
  if (inst.ro) inst.ro.disconnect();
  if (inst.overlay && inst.overlay.parentNode) {
    inst.overlay.parentNode.removeChild(inst.overlay);
  }
  drawSvgInstances.delete(inst);
}

function purgeStaleInstances() {
  drawSvgInstances.forEach(inst => {
    if (!inst.element || !document.contains(inst.element)) destroyInstance(inst);
  });
}


// --------------------------------------------
// Init
// --------------------------------------------
function initDrawSvg(container) {
  container = container || document;

  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) return;

  purgeStaleInstances();

  const elements = container.querySelectorAll(INIT_SELECTOR);
  if (!elements.length) return;

  elements.forEach(element => {
    if (element.dataset.drawSvgInited === 'true') return;

    const mode = detectMode(element);
    if (!mode) return;

    const pool = SVG_POOL[mode];
    if (!pool || !pool.length) return;

    // Mode-specific prep
    let wordSpans = [];
    if (WORD_MODES.has(mode)) {
      const rawWord = element.getAttribute(MODE_ATTRIBUTE[mode]);
      const word = rawWord && rawWord.trim();
      if (!word) return;
      const matchAll = isTruthyAttr(element.getAttribute('data-draw-match-all'));
      wordSpans = wrapWordMatches(element, word, matchAll);
      if (!wordSpans.length) return;
    }

    const undraw = isTruthyAttr(element.getAttribute('data-draw-undraw'));
    const scrub = isTruthyAttr(element.getAttribute('data-draw-scrub'));
    const colorOverride = element.getAttribute('data-draw-color');
    const heightOverride = element.getAttribute('data-draw-height');

    element.dataset.drawSvgInited = 'true';

    const overlay = document.createElement('span');
    overlay.className = 'draw-svg__overlay';
    overlay.setAttribute('aria-hidden', 'true');
    if (colorOverride) overlay.style.color = colorOverride;
    element.appendChild(overlay);

    // Arrow mode can pin a specific SVG via `data-draw-arrow="N"` (1-based);
    // empty value = random. Underline modes always randomize from their pool.
    let forcedSvgIndex = null;
    if (mode === MODE.ARROW) {
      const rawIdx = element.getAttribute(MODE_ATTRIBUTE[MODE.ARROW]);
      if (rawIdx != null && rawIdx.trim() !== '') {
        const parsed = parseInt(rawIdx.trim(), 10);
        if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= pool.length) {
          forcedSvgIndex = parsed - 1;
        }
      }
    }

    // One stable SVG per instance (per line) so resize doesn't reshuffle.
    const svgCache = new Map();
    function svgFor(key) {
      if (!svgCache.has(key)) {
        const svg = forcedSvgIndex != null ? pool[forcedSvgIndex] : pickRandomSvg(pool);
        svgCache.set(key, svg);
      }
      return svgCache.get(key);
    }

    // leadPaths = primary stroke (the "line" for arrows, the whole underline
    // for word/block modes). trailPaths = arrowhead sub-paths — only populated
    // in arrow mode when the SVG's `d` attribute contains multiple `M` commands.
    let leadPaths = [];
    let trailPaths = [];
    let currentTween = null;
    let scrubTl = null;
    let st = null;

    const instance = { element, overlay, st: null, ro: null, destroy: null };
    drawSvgInstances.add(instance);

    const allPaths = () => [...leadPaths, ...trailPaths];

    function layoutBoxes() {
      overlay.innerHTML = '';
      leadPaths = [];
      trailPaths = [];

      const rects = getDrawRects(mode, element, wordSpans);
      if (!rects.length) return;

      const rootRect = element.getBoundingClientRect();

      rects.forEach((rect, idx) => {
        const box = document.createElement('span');
        box.className = `draw-svg__box draw-svg__box--${mode}`;

        if (mode === MODE.ARROW) {
          // Fill the entire container — height is controlled by the user's CSS.
          box.style.left = '0';
          box.style.top = '0';
          box.style.right = '0';
          box.style.bottom = '0';
        } else if (mode === MODE.CIRCLE_WORD) {
          // Enclose the word with a little breathing room so the oval
          // doesn't kiss the letters. Padding scales with line-height.
          const padX = rect.height * 0.25;
          const padY = rect.height * 0.08;
          box.style.left = `${rect.left - rootRect.left - padX}px`;
          box.style.top = `${rect.top - rootRect.top - padY}px`;
          box.style.width = `${rect.width + 2 * padX}px`;
          box.style.height = `${rect.height + 2 * padY}px`;
        } else {
          // Underline: sit just under the target line.
          box.style.left = `${rect.left - rootRect.left}px`;
          box.style.top = `${rect.bottom - rootRect.top}px`;
          box.style.width = `${rect.width}px`;
          if (heightOverride) box.style.height = heightOverride;
        }

        box.innerHTML = svgFor(idx);
        const svg = box.querySelector('svg');
        decorateSvg(svg, mode);
        overlay.appendChild(box);
        const path = svg && svg.querySelector('path');
        if (!path) return;

        if (mode === MODE.ARROW) {
          const subs = splitSubpaths(path);
          leadPaths.push(subs[0]);
          if (subs.length > 1) trailPaths.push(...subs.slice(1));
        } else {
          leadPaths.push(path);
        }
      });
    }

    function drawIn() {
      if (!leadPaths.length) return;
      if (currentTween) currentTween.kill();

      if (trailPaths.length) {
        const leadDur = 0.8;
        const trailDur = 0.25;
        const tl = gsap.timeline();
        tl.to(leadPaths, {
          drawSVG: '0% 100%',
          duration: leadDur,
          ease: 'power2.out'
        }, 0);
        tl.to(trailPaths, {
          drawSVG: '0% 100%',
          duration: trailDur,
          ease: 'power2.out'
        }, leadDur * ARROW_TRAIL_OFFSET);
        currentTween = tl;
      } else {
        currentTween = gsap.to(leadPaths, {
          drawSVG: '0% 100%',
          duration: 0.6,
          ease: 'power2.inOut'
        });
      }
    }

    function collapseToEnd() {
      const all = allPaths();
      if (!all.length) return;
      if (currentTween) currentTween.kill();
      currentTween = gsap.to(all, {
        drawSVG: '100% 100%',
        duration: 0.5,
        ease: 'power2.inOut'
      });
    }

    // Trigger element for ScrollTrigger: first matched word (word modes)
    // or the element itself (block / arrow).
    const triggerEl = WORD_MODES.has(mode) ? wordSpans[0] : element;

    // Default trigger positions per mode — arrow fires earlier because it
    // sits as a large decorative asset and should feel like it "draws itself
    // in" as the user approaches rather than once it's dead center.
    const defaultStart = mode === MODE.ARROW ? 'top 80%' : 'bottom 75%';
    const defaultEnd = mode === MODE.ARROW ? 'top 30%' : 'bottom 50%';
    const startPos = element.getAttribute('data-draw-start') || defaultStart;
    const endPos = element.getAttribute('data-draw-end') || defaultEnd;

    function build() {
      if (currentTween) { currentTween.kill(); currentTween = null; }
      if (scrubTl) { scrubTl.kill(); scrubTl = null; }
      if (st) { st.kill(); st = null; }

      layoutBoxes();
      const all = allPaths();
      if (!all.length) return;

      gsap.set(all, { drawSVG: '0% 0%' });

      if (scrub) {
        scrubTl = gsap.timeline({ paused: true });
        if (trailPaths.length) {
          // Scrub timeline: lead covers 0 → 0.9, trail covers 0.9 → 1.0.
          scrubTl.fromTo(leadPaths,
            { drawSVG: '0% 0%' },
            { drawSVG: '0% 100%', duration: ARROW_TRAIL_OFFSET, ease: 'none' }, 0);
          scrubTl.fromTo(trailPaths,
            { drawSVG: '0% 0%' },
            { drawSVG: '0% 100%', duration: 1 - ARROW_TRAIL_OFFSET, ease: 'none' }, ARROW_TRAIL_OFFSET);
        } else {
          scrubTl.fromTo(leadPaths,
            { drawSVG: '0% 0%' },
            { drawSVG: '0% 100%', duration: 1, ease: 'none' });
        }
        st = ScrollTrigger.create({
          trigger: triggerEl,
          start: startPos,
          end: endPos,
          scrub: true,
          animation: scrubTl
        });
      } else {
        st = ScrollTrigger.create({
          trigger: triggerEl,
          start: startPos,
          onEnter: drawIn,
          onEnterBack: undraw ? drawIn : undefined,
          onLeaveBack: undraw ? collapseToEnd : undefined
        });
      }

      instance.st = st;
    }

    build();

    let resizeRaf = null;
    const ro = new ResizeObserver(() => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        build();
        ScrollTrigger.refresh();
      });
    });
    ro.observe(element);
    instance.ro = ro;

    instance.destroy = () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      if (currentTween) currentTween.kill();
      if (scrubTl) scrubTl.kill();
      if (st) st.kill();
    };
  });
}


function drawSvg() {
  document.addEventListener('barba:pageVisible', (e) => {
    initDrawSvg(e.detail.container);
  });
}

export default drawSvg;
