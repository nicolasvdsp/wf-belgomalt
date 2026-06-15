// ============================================
// BUNNY STORIES
// ============================================
// Instagram-style stories viewer built on Bunny HLS streams. Multiple videos
// play sequentially in a SINGLE <video> element. A segmented progress bar
// (one segment per story) fills left → right while the active video plays.
// Clicking a segment jumps to that story; clicking the left/right nav zones
// steps backward/forward.
//
// Each story's data (video src + avatar + name + …) comes from CMS-driven
// DOM elements marked with [data-story-item]. The active story's values are
// pushed into matching [data-story-content="<slot>"] elements inside the
// player UI on every step change.
//
// HLS playback uses hls.js where supported, native HLS on Safari, with a
// stall-timer fallback that flips the player into an error state if the
// stream hangs. The video element is reused across stories — `hls.destroy()`
// + `loadSource(newSrc)` for the hls.js path, `video.src = newSrc` for the
// native path.
//
// ────────────────────────────────────────────────────────────────────────────
// MARKUP CONTRACT — read inside [data-stories-init]. Optional unless noted.
//
//   <section data-stories-init
//            data-stories-autoplay="true"
//            data-stories-loop="false">
//
//     <!-- (required) Story items are auto-detected from any Webflow
//          Collection List inside [data-stories-source] — each
//          .w-dyn-item / role="listitem" becomes one story. For non-
//          Webflow markup, mark each item element with [data-story-item]
//          explicitly.
//
//          Per slot, the JS resolves the value in this order:
//            a. data-story-<slot>="value" on the item itself        (text)
//            b. data-story-<slot>="value" on any descendant element (text)
//            c. descendant element's intrinsic value — <img>.src,
//               <a>.href, or trimmed textContent                    (image,
//                                                                    file,
//                                                                    rich
//                                                                    text)
//
//          Webflow CMS forces these multiple shapes: Plain Text / Link
//          fields can bind to a custom attribute's value (a/b), but Image
//          / File fields can ONLY bind to a real DOM property (c).
//          Elements with .w-dyn-bind-empty (Webflow's empty-bind marker)
//          are skipped so a missing CMS field doesn't render the
//          framework's placeholder. -->
//     <div data-stories-source class="w-dyn-list">
//       <div role="list" class="w-dyn-items">
//         <div role="listitem" class="w-dyn-item">
//           <!-- Plain Text / Link → attribute value on sub-divs -->
//           <div data-story-src="{{Video URL}}"></div>
//           <div data-story-name="{{Name}}"></div>
//           <div data-story-role="{{Role}}"></div>
//           <!-- Image → bound to <img src> with the slot marker as attr -->
//           <img data-story-avatar src="{{Avatar URL}}" alt="">
//         </div>
//         …
//       </div>
//     </div>
//
//     <!-- (required) The player. Reuses the bunny-bg structure but is
//          driven by THIS feature, not bunny-background. Do NOT also set
//          [data-bunny-background-init] on the same element. -->
//     <div data-stories-player class="bunny-bg">
//       <video class="bunny-bg__video" muted playsinline></video>
//       <img class="bunny-bg__placeholder">
//
//       <header class="card_head">
//         <div class="progress-bar_list">
//           <!-- ONE template segment; JS clones it once per story. -->
//           <div data-progress-bar>
//             <div data-progress-fill></div>
//           </div>
//         </div>
//
//         <!-- Content slots, populated when the active story changes. -->
//         <img data-story-content="avatar">
//         <div data-story-content="name"></div>
//         <div data-story-content="role"></div>
//
//         <!-- Player controls (reuses bunny-bg playback contract). -->
//         <div data-player-control="playpause">…</div>
//         <div data-player-control="mute">…</div>
//       </header>
//     </div>
//
//     <!-- (optional) Click zones for prev / next navigation. -->
//     <div data-story-nav="previous"></div>
//     <div data-story-nav="next"></div>
//
//   </section>
//
// Slot mapping — for each [data-story-content="<slot>"] element, the JS
// reads data-story-<slot> from the active source item and applies it:
//   <img>  → src           (srcset is cleared to prevent stale renditions)
//   <a>    → href
//   other  → textContent
//
// ────────────────────────────────────────────────────────────────────────────
// STATE ATTRIBUTES (written by JS, read by CSS):
//
//   On [data-stories-player]:
//     data-player-status="idle|loading|ready|playing|paused|ended|error"
//     data-player-activated="true|false"
//     data-player-muted="true|false"
//
//   On each cloned [data-progress-bar] segment:
//     data-progress-bar="active|past|future"
//     --progress: 0..1            (drives [data-progress-fill] scaleX)
//
//   On the progress-bar list container:
//     --story-count: <int>         For grid-template-columns: repeat(var(--story-count), 1fr)
//
// CONFIG OVERRIDES — attributes on [data-stories-init]:
//   data-stories-autoplay="true|false"        Auto-advance on video end (default true)
//   data-stories-loop="true|false"            Loop after last story (default false)
//   data-stories-active-index="0"             Index of the story to start on (default 0)
//   data-stories-max-quality="true|false"     Start at the top-bitrate variant for
//                                              every story (default true). If still
//                                              `loading` after the fallback window
//                                              below, drops to adaptive auto.
//   data-stories-quality-fallback-ms="5000"   How long to wait before downgrading
//                                              quality on a stuck `loading` state.
//
// BARBA — re-inits on barba:afterEnter, scoped to the incoming container.
// ============================================

const SELECTOR = '[data-stories-init]';
const INIT_FLAG = 'storiesInit'; // → wrapper.dataset.storiesInit = 'initialized'
const storyInstances = new Set();

const DEFAULTS = {
  autoplay: true,
  loop: false,
  activeIndex: 0,
  stallMs: 15000,
  // Try to start every story at the top-bitrate variant; if the player is
  // still in `loading` after this many ms, downgrade to adaptive auto so
  // the user isn't staring at a spinner on a slow connection.
  maxQuality: true,
  qualityFallbackMs: 5000
};


// --------------------------------------------
// Attribute helpers
// --------------------------------------------
function readNumberAttr(el, attr, fallback) {
  const raw = el.getAttribute(attr);
  if (raw == null || raw.trim() === '') return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function readBoolAttr(el, attr, fallback) {
  const raw = el.getAttribute(attr);
  if (raw == null) return fallback;
  const v = String(raw).trim().toLowerCase();
  if (v === '' || v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}


// --------------------------------------------
// Story collection — parse the source items
// --------------------------------------------
// Finds the story items in the wrapper and turns each into a
// `{ src, name, avatar, … }` object. The parser is intentionally permissive
// so the same JS works for both raw markup and Webflow Collection Lists
// without designer effort.
//
// Item discovery — first match wins:
//   1. Any element explicitly marked [data-story-item]
//   2. (fallback) Inside [data-stories-source], every [role="listitem"] /
//      .w-dyn-item — Webflow's stable Collection Item shape. This means
//      designers don't need to "Add Attribute…" to the Collection Item
//      itself; just binding fields inside it is enough.
//
// Slot resolution per story — first non-empty wins, in this order:
//   a. data-story-<slot>="value" on the item itself          (text CMS field
//                                                             bound to attr)
//   b. data-story-<slot>="value" on any descendant element    (text CMS field
//                                                             bound to a
//                                                             sub-div's attr)
//   c. descendant element's intrinsic value — img.src,        (Image / File
//      anchor.href, source[srcset|src], else textContent       CMS field, only
//                                                              bindable to a
//                                                              real DOM
//                                                              property)
//
// Elements carrying Webflow's `.w-dyn-bind-empty` class (added by Webflow
// when a CMS field is empty for this item) are treated as legitimately
// empty so the slot doesn't get filled with framework placeholders.
//
// Items that resolve to no `src` are skipped — we have no video to play.
function findStoryItemNodes(wrapper) {
  const explicit = wrapper.querySelectorAll('[data-story-item]');
  if (explicit.length > 0) return Array.from(explicit);

  // Auto-detect Webflow Collection List items inside [data-stories-source].
  // role="listitem" and .w-dyn-item live on the same element in Webflow's
  // output — Set dedupes the overlap.
  const implicit = new Set();
  wrapper
    .querySelectorAll('[data-stories-source] [role="listitem"], [data-stories-source] .w-dyn-item')
    .forEach((el) => implicit.add(el));
  return Array.from(implicit);
}

function readStoryItems(wrapper) {
  const itemNodes = findStoryItemNodes(wrapper);
  const stories = [];

  itemNodes.forEach((el) => {
    const data = {};

    // (a) Item-level attribute values.
    collectDataStoryAttrs(el, data, /* allowAttrValue */ true, /* allowDomValue */ false);

    // (b)/(c) Descendant attribute values, then descendant DOM values.
    //         Skip descendants that are themselves another item so multi-
    //         instance setups don't cross-contaminate.
    el.querySelectorAll('*').forEach((child) => {
      if (child.hasAttribute('data-story-item')) return;
      collectDataStoryAttrs(child, data, true, true);
    });

    if (!data.src) return;
    stories.push(data);
  });

  return stories;
}

function collectDataStoryAttrs(el, data, allowAttrValue, allowDomValue) {
  // Webflow's empty-bind marker — treat this element as having no usable
  // value, regardless of what its src/href ended up as.
  const isEmptyBind = !!(el.classList && el.classList.contains('w-dyn-bind-empty'));

  Array.from(el.attributes).forEach((attr) => {
    if (attr.name === 'data-story-item') return;
    if (attr.name.indexOf('data-story-') !== 0) return;
    const key = attr.name.slice('data-story-'.length);
    if (data[key]) return;

    if (allowAttrValue) {
      const v = (attr.value || '').trim();
      if (v) { data[key] = v; return; }
    }
    if (allowDomValue && !isEmptyBind) {
      const v = readElementValue(el);
      if (v) { data[key] = v; }
    }
  });
}

function readElementValue(el) {
  if (el.tagName === 'IMG') return (el.getAttribute('src') || '').trim();
  if (el.tagName === 'A') return (el.getAttribute('href') || '').trim();
  if (el.tagName === 'SOURCE') return (el.getAttribute('srcset') || el.getAttribute('src') || '').trim();
  return (el.textContent || '').trim();
}


// --------------------------------------------
// Progress bar
// --------------------------------------------
// Designer builds ONE [data-progress-bar] inside the player; we clone it
// once per story into the template's parent. Each clone gets a state
// attribute ("active" / "past" / "future") and a `--progress: 0..1` CSS
// variable updated each animation frame so the designer's fill rule
// renders smoothly.
//
// We write the inner [data-progress-fill] transform DIRECTLY on the element
// (rather than relying on the CSS var alone), because Webflow Designer
// often sets `transform:` and/or `transition:` on the underlying class —
// both of which silently kill the per-frame scaleX animation we drive from
// RAF. Inline styles dodge that.
function buildProgressBar(player, count) {
  const template = player.querySelector('[data-progress-bar]');
  if (!template) {
    console.warn('[bunny-stories] No [data-progress-bar] template inside [data-stories-player]; progress bar skipped.');
    return [];
  }

  const container = template.parentNode;
  if (!container) return [];

  container.style.setProperty('--story-count', String(count));

  const segments = [];
  for (let i = 0; i < count; i++) {
    const element = template.cloneNode(true);
    element.setAttribute('data-progress-bar', i === 0 ? 'active' : 'future');
    element.style.setProperty('--progress', '0');

    const progressEl = element.querySelector('[data-progress-fill]');
    if (progressEl) {
      progressEl.style.transformOrigin = 'left center';
      progressEl.style.transform = 'scaleX(0)';
      progressEl.style.transition = 'none';
    }

    // No locked state in v1 — hide the lock icon on every segment.
    const lockEl = element.querySelector('[data-progress-icon]');
    if (lockEl) lockEl.style.display = 'none';

    segments.push({ element, progressEl, index: i });
  }

  segments.forEach((seg) => container.insertBefore(seg.element, template));
  template.parentNode.removeChild(template);
  return segments;
}

function setBarProgress(instance, index, value) {
  const seg = instance.progressSegments[index];
  if (!seg) return;
  const v = Math.max(0, Math.min(1, value));
  seg.element.style.setProperty('--progress', v.toFixed(4));
  if (seg.progressEl) {
    seg.progressEl.style.transform = `scaleX(${v.toFixed(4)})`;
  }
}

function setBarStates(instance, activeIndex) {
  instance.progressSegments.forEach((seg, i) => {
    let state;
    if (i < activeIndex) {
      state = 'past';
      setBarProgress(instance, i, 1);
    } else if (i === activeIndex) {
      state = 'active';
      setBarProgress(instance, i, 0);
    } else {
      state = 'future';
      setBarProgress(instance, i, 0);
    }
    seg.element.setAttribute('data-progress-bar', state);
  });
}


// --------------------------------------------
// Content slots
// --------------------------------------------
// For each [data-story-content="<slot>"] element inside the wrapper, look
// up `data-story-<slot>` on the active story and write it. The element
// type determines the target property:
//   <img>  → src       (srcset is cleared so a CMS-rendered srcset doesn't
//                       override our newly-set src with a stale rendition)
//   <a>    → href
//   other  → textContent
function updateContentSlots(wrapper, story) {
  wrapper.querySelectorAll('[data-story-content]').forEach((el) => {
    const slot = (el.getAttribute('data-story-content') || '').trim().toLowerCase();
    if (!slot) return;
    applyContentSlot(el, story[slot] || '');
  });
}

function applyContentSlot(el, value) {
  if (el.tagName === 'IMG') {
    if (value) {
      el.setAttribute('src', value);
      el.removeAttribute('srcset');
      el.removeAttribute('sizes');
      el.style.display = '';
    } else {
      el.removeAttribute('src');
    }
    return;
  }

  if (el.tagName === 'A') {
    el.setAttribute('href', value || '#');
    return;
  }

  el.textContent = value;
}


// --------------------------------------------
// Player status helpers
// --------------------------------------------
function setPlayerStatus(player, s) {
  if (player.getAttribute('data-player-status') !== s) {
    player.setAttribute('data-player-status', s);
  }
}

function setActivated(player, v) {
  player.setAttribute('data-player-activated', v ? 'true' : 'false');
}

function safePlay(video) {
  const p = video.play();
  if (p && typeof p.then === 'function') p.catch(() => { });
}


// --------------------------------------------
// Stall detection
// --------------------------------------------
// If the stream sits in "loading" for too long without producing a
// canplay/loadedmetadata, treat it as a hard error (mirrors bunny-background.js
// behaviour). Without this, a bad CDN or a broken playlist would leave the
// UI stuck on the spinner forever.
function clearStallTimer(instance) {
  if (instance.stallTimer) {
    clearTimeout(instance.stallTimer);
    instance.stallTimer = null;
  }
}

function startStallTimer(instance) {
  clearStallTimer(instance);
  if (instance.hasFailed) return;
  instance.stallTimer = setTimeout(() => {
    if (instance.hasFailed) return;
    if (instance.player.getAttribute('data-player-status') === 'loading') {
      handleError(instance);
    }
  }, instance.opts.stallMs);
}

function handleError(instance) {
  if (instance.hasFailed) return;
  instance.hasFailed = true;
  instance.pendingPlay = false;
  clearStallTimer(instance);
  clearQualityFallbackTimer(instance);
  cancelProgressLoop(instance);
  try { instance.video.pause(); } catch (_) { /* ignore */ }
  if (instance.hls) {
    try { instance.hls.destroy(); } catch (_) { /* ignore */ }
    instance.hls = null;
  }
  setActivated(instance.player, false);
  setPlayerStatus(instance.player, 'error');
}


// --------------------------------------------
// HLS loading
// --------------------------------------------
// Tears down the previous attachment (pause + destroy hls + clear src) and
// re-attaches the new src using the best available transport. We always set
// `pendingPlay = true` so the first `canplay` / `loadedmetadata` of the new
// source triggers `safePlay(video)` automatically — no separate "play after
// load" plumbing needed.
//
// When `maxQuality` is on (default), we open every story at the top-bitrate
// variant:
//   - hls.js: pin currentLevel / loadLevel / autoLevelCapping to the highest
//     level after MANIFEST_PARSED.
//   - Safari native: fetch the master playlist, pick the highest-bandwidth
//     variant URL, and point <video>.src at THAT sub-playlist directly.
//
// If the player is still stuck in `loading` after `qualityFallbackMs`, we
// fall back to adaptive auto so a slow connection doesn't get stuck on a
// spinner. See `downgradeQuality` for the per-transport fallback strategy.
function loadVideoSrc(instance, src) {
  const { video, player } = instance;
  if (!video || !src) return;

  cancelProgressLoop(instance);
  clearStallTimer(instance);
  clearQualityFallbackTimer(instance);
  instance.pendingPlay = true;
  instance.hasFailed = false;
  instance.qualityDowngraded = false;
  instance.currentMasterUrl = src;
  setPlayerStatus(player, 'loading');
  startStallTimer(instance);
  startQualityFallbackTimer(instance);

  try { video.pause(); } catch (_) { /* ignore */ }
  if (instance.hls) {
    try { instance.hls.destroy(); } catch (_) { /* ignore */ }
    instance.hls = null;
  }
  try { video.removeAttribute('src'); video.load(); } catch (_) { /* ignore */ }

  const isSafariNative = !!video.canPlayType('application/vnd.apple.mpegurl');
  const canUseHlsJs = !!(window.Hls && window.Hls.isSupported()) && !isSafariNative;
  const useMaxQuality = !!instance.opts.maxQuality;

  if (isSafariNative) {
    if (useMaxQuality) {
      resolveMaxQualityVariant(src, (resolvedUrl) => {
        // Bail if another goTo() has already moved on to a different story.
        if (instance.currentMasterUrl !== src) return;
        video.src = resolvedUrl;
        try { video.load(); } catch (_) { /* ignore */ }
      });
    } else {
      video.src = src;
      try { video.load(); } catch (_) { /* ignore */ }
    }
  } else if (canUseHlsJs) {
    const hls = new window.Hls({ maxBufferLength: 30 });
    hls.on(window.Hls.Events.ERROR, (event, data) => {
      if (data && data.fatal) handleError(instance);
    });
    if (useMaxQuality) wireMaxQuality(hls);
    hls.attachMedia(video);
    hls.on(window.Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(src));
    instance.hls = hls;
  } else {
    // Last-resort fallback: hope the browser/codec understands the URL.
    video.src = src;
    try { video.load(); } catch (_) { /* ignore */ }
  }
}


// --------------------------------------------
// Quality control (max-quality startup + 5s fallback)
// --------------------------------------------
// hls.js path — pin every relevant level field to the top variant.
// MANIFEST_LOADED runs before the player picks an initial level, so we set
// `startLevel` there too; MANIFEST_PARSED is the cross-version-safe place
// to actually clamp playback. We keep references on `instance` so the
// fallback timer can flip them back to -1 (auto) without re-attaching.
function bestLevelIndex(levels) {
  if (!levels || !levels.length) return -1;
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < levels.length; i++) {
    const l = levels[i] || {};
    const score = (l.height || 0) * 1e7 + (l.bitrate || 0);
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

function wireMaxQuality(hls) {
  if (!window.Hls) return;
  hls.on(window.Hls.Events.MANIFEST_LOADED, (e, data) => {
    if (data && data.levels && data.levels.length > 1) {
      hls.startLevel = bestLevelIndex(data.levels);
    }
  });
  hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
    if (hls.levels && hls.levels.length > 1) {
      const max = bestLevelIndex(hls.levels);
      hls.autoLevelCapping = max;
      hls.nextLevel = max;
      hls.loadLevel = max;
      hls.currentLevel = max;
    }
  });
}

// Safari (native HLS) has no per-level API. To force max quality we have
// to resolve the master playlist ourselves, pick the highest-bitrate
// variant, and point <video>.src at that single-rendition sub-playlist.
function resolveMaxQualityVariant(masterUrl, done) {
  fetch(masterUrl, { credentials: 'omit' })
    .then((r) => { if (!r.ok) throw new Error(); return r.text(); })
    .then((txt) => {
      const lines = txt.split(/\r?\n/);
      let bestBw = 0;
      let bestUri = null;
      let lastInf = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.indexOf('#EXT-X-STREAM-INF:') === 0) {
          lastInf = line;
        } else if (lastInf && line && line[0] !== '#') {
          let bw = 0;
          const bwMatch = /BANDWIDTH=(\d+)/.exec(lastInf);
          if (bwMatch) bw = parseInt(bwMatch[1], 10) || 0;
          if (bw > bestBw) { bestBw = bw; bestUri = line; }
          lastInf = null;
        }
      }
      done(bestUri ? new URL(bestUri, masterUrl).href : masterUrl);
    })
    .catch(() => done(masterUrl));
}

function clearQualityFallbackTimer(instance) {
  if (instance.qualityFallbackTimer) {
    clearTimeout(instance.qualityFallbackTimer);
    instance.qualityFallbackTimer = null;
  }
}

function startQualityFallbackTimer(instance) {
  clearQualityFallbackTimer(instance);
  if (!instance.opts.maxQuality) return;
  if (instance.qualityDowngraded || instance.hasFailed) return;
  instance.qualityFallbackTimer = setTimeout(() => {
    if (instance.qualityDowngraded || instance.hasFailed) return;
    // Only intervene if we're still stuck loading — any other status
    // means the stream is fine (or has failed for an unrelated reason).
    if (instance.player.getAttribute('data-player-status') !== 'loading') return;
    downgradeQuality(instance);
  }, instance.opts.qualityFallbackMs);
}

// One-shot downgrade for the CURRENT story. hls.js can switch levels in
// flight without a reload; Safari has to be reloaded with the master
// playlist (no per-level API). We refresh the stall timer because both
// paths effectively restart the buffering clock.
function downgradeQuality(instance) {
  if (instance.qualityDowngraded || instance.hasFailed) return;
  instance.qualityDowngraded = true;
  clearQualityFallbackTimer(instance);

  if (instance.hls) {
    try {
      instance.hls.autoLevelCapping = -1;
      instance.hls.nextLevel = -1;
      instance.hls.loadLevel = -1;
      instance.hls.currentLevel = -1;
    } catch (_) { /* ignore */ }
    startStallTimer(instance);
    return;
  }

  // Safari native — swap back to the master playlist so the browser can
  // adapt. <video>.src reload restarts buffering; the next
  // canplay/loadedmetadata will trigger safePlay via the pending flag.
  if (instance.currentMasterUrl && instance.video) {
    instance.pendingPlay = true;
    try { instance.video.src = instance.currentMasterUrl; } catch (_) { /* ignore */ }
    try { instance.video.load(); } catch (_) { /* ignore */ }
    startStallTimer(instance);
  }
}


// --------------------------------------------
// Progress animation
// --------------------------------------------
// One RAF loop, running only while the active video is playing. Reads
// `currentTime / duration` and writes the active bar's `--progress` each
// frame. Bars for past stories stay at 1, bars for future stories stay at 0
// — `setBarStates` handles those on every step change.
function cancelProgressLoop(instance) {
  if (instance.rafId != null) {
    cancelAnimationFrame(instance.rafId);
    instance.rafId = null;
  }
}

function startProgressLoop(instance) {
  cancelProgressLoop(instance);
  const tick = () => {
    const video = instance.video;
    if (!video || video.paused || video.ended) {
      instance.rafId = null;
      return;
    }
    const dur = video.duration;
    if (Number.isFinite(dur) && dur > 0) {
      setBarProgress(instance, instance.activeIndex, video.currentTime / dur);
    }
    instance.rafId = requestAnimationFrame(tick);
  };
  instance.rafId = requestAnimationFrame(tick);
}


// --------------------------------------------
// Navigation
// --------------------------------------------
// `goTo` is the single entry point for any step change — click on a bar,
// click on a nav zone, auto-advance on video end, initial visibility
// activation. All of them funnel through here so the bar state, content
// slots, video src, and pendingPlay flag stay in lockstep.
function goTo(instance, index, opts) {
  opts = opts || {};
  const count = instance.stories.length;
  if (count === 0) return;

  let normalized = index;
  if (instance.opts.loop) {
    normalized = ((index % count) + count) % count;
  } else {
    normalized = Math.max(0, Math.min(count - 1, index));
  }

  if (normalized === instance.activeIndex && !opts.force) return;

  instance.activeIndex = normalized;
  // Any explicit navigation cancels a sticky user-pause: the user asked for
  // this story to play, so respect that intent on the next visibility cycle.
  instance.userPaused = false;

  const story = instance.stories[normalized];
  setBarStates(instance, normalized);
  updateContentSlots(instance.wrapper, story);
  loadVideoSrc(instance, story.src);
}

function goNext(instance) {
  const next = instance.activeIndex + 1;
  if (next >= instance.stories.length) {
    if (instance.opts.loop) {
      goTo(instance, 0, { force: true });
    } else {
      // End of the list: hold on the final frame.
      cancelProgressLoop(instance);
      setBarProgress(instance, instance.activeIndex, 1);
      setPlayerStatus(instance.player, 'ended');
    }
    return;
  }
  goTo(instance, next);
}

function goPrev(instance) {
  const prev = instance.activeIndex - 1;
  if (prev < 0) {
    // Before the first story: re-start the first story (Instagram behaviour).
    goTo(instance, 0, { force: true });
    return;
  }
  goTo(instance, prev);
}


// --------------------------------------------
// Play / pause / mute
// --------------------------------------------
function togglePlay(instance) {
  if (instance.hasFailed) return;
  const { video, player } = instance;
  if (video.paused || video.ended) {
    instance.userPaused = false;
    instance.pendingPlay = true;
    setPlayerStatus(player, 'loading');
    startStallTimer(instance);
    safePlay(video);
  } else {
    instance.userPaused = true;
    video.pause();
  }
}

function toggleMute(instance) {
  if (instance.hasFailed) return;
  const { video, player } = instance;
  video.muted = !video.muted;
  player.setAttribute('data-player-muted', video.muted ? 'true' : 'false');
}


// --------------------------------------------
// Instance lifecycle
// --------------------------------------------
function destroyInstance(inst) {
  if (typeof inst.destroy === 'function') {
    try { inst.destroy(); } catch (_) { /* ignore */ }
  }
  storyInstances.delete(inst);
}

function purgeStaleInstances() {
  storyInstances.forEach((inst) => {
    if (!inst.wrapper || !document.contains(inst.wrapper)) destroyInstance(inst);
  });
}


// --------------------------------------------
// Per-element init
// --------------------------------------------
function initInstance(wrapper) {
  if (wrapper.dataset[INIT_FLAG] === 'initialized') return;

  const player = wrapper.querySelector('[data-stories-player]');
  if (!player) {
    console.warn('[bunny-stories] No [data-stories-player] inside [data-stories-init].');
    return;
  }

  const video = player.querySelector('video');
  if (!video) {
    console.warn('[bunny-stories] No <video> inside [data-stories-player].');
    return;
  }

  const stories = readStoryItems(wrapper);
  if (stories.length === 0) {
    console.warn('[bunny-stories] No [data-story-item] sources found; player skipped.');
    return;
  }

  const opts = {
    autoplay: readBoolAttr(wrapper, 'data-stories-autoplay', DEFAULTS.autoplay),
    loop: readBoolAttr(wrapper, 'data-stories-loop', DEFAULTS.loop),
    activeIndex: readNumberAttr(wrapper, 'data-stories-active-index', DEFAULTS.activeIndex),
    maxQuality: readBoolAttr(wrapper, 'data-stories-max-quality', DEFAULTS.maxQuality),
    qualityFallbackMs: readNumberAttr(wrapper, 'data-stories-quality-fallback-ms', DEFAULTS.qualityFallbackMs),
    stallMs: DEFAULTS.stallMs
  };

  // Stories must start muted to satisfy autoplay policies. The mute button
  // unmutes on user gesture, which browsers always allow.
  video.muted = true;
  video.loop = false;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.playsInline = true;
  if (typeof video.disableRemotePlayback !== 'undefined') {
    video.disableRemotePlayback = true;
  }
  video.autoplay = false;
  video.preload = 'auto';

  player.setAttribute('data-player-muted', 'true');
  setPlayerStatus(player, 'idle');
  setActivated(player, false);

  wrapper.dataset[INIT_FLAG] = 'initialized';

  const progressSegments = buildProgressBar(player, stories.length);

  const instance = {
    wrapper,
    player,
    video,
    stories,
    progressSegments,
    opts,
    activeIndex: -1,
    hls: null,
    rafId: null,
    stallTimer: null,
    qualityFallbackTimer: null,
    qualityDowngraded: false,
    currentMasterUrl: null,
    pendingPlay: false,
    hasFailed: false,
    visibilityPaused: true,
    userPaused: false,
    io: null,
    handlers: [],
    destroy: null
  };
  storyInstances.add(instance);

  // ----- Media event wiring -----
  const onPlay = () => {
    if (instance.hasFailed) return;
    setActivated(player, true);
    setPlayerStatus(player, 'playing');
    startProgressLoop(instance);
  };
  const onPlaying = () => {
    if (instance.hasFailed) return;
    instance.pendingPlay = false;
    clearStallTimer(instance);
    // Reaching `playing` means the high-quality variant arrived in time —
    // no need to downgrade. (Pre-emptively clearing on `canplay` would be
    // racey: the stream can advance past canplay but rebuffer immediately.)
    clearQualityFallbackTimer(instance);
    setPlayerStatus(player, 'playing');
    startProgressLoop(instance);
  };
  const onPause = () => {
    if (instance.hasFailed) return;
    instance.pendingPlay = false;
    cancelProgressLoop(instance);
    if (video.ended) return;
    // Skip the status flip while we're tearing down to load a new src — the
    // very next call to loadVideoSrc has already set status='loading' and
    // we'd otherwise overwrite that with 'paused' for a single frame.
    if (player.getAttribute('data-player-status') === 'loading') return;
    setPlayerStatus(player, 'paused');
  };
  const onWaiting = () => {
    if (instance.hasFailed) return;
    setPlayerStatus(player, 'loading');
    startStallTimer(instance);
  };
  const onCanPlay = () => {
    if (instance.hasFailed) return;
    clearStallTimer(instance);
    if (instance.pendingPlay && !instance.visibilityPaused && !instance.userPaused) {
      safePlay(video);
    }
  };
  const onLoadedMeta = () => {
    if (instance.hasFailed) return;
    clearStallTimer(instance);
    if (instance.pendingPlay && !instance.visibilityPaused && !instance.userPaused) {
      safePlay(video);
    }
  };
  const onEnded = () => {
    if (instance.hasFailed) return;
    instance.pendingPlay = false;
    cancelProgressLoop(instance);
    setBarProgress(instance, instance.activeIndex, 1);
    if (instance.opts.autoplay) {
      goNext(instance);
    } else {
      setPlayerStatus(player, 'ended');
    }
  };
  const onError = () => handleError(instance);

  video.addEventListener('play', onPlay);
  video.addEventListener('playing', onPlaying);
  video.addEventListener('pause', onPause);
  video.addEventListener('waiting', onWaiting);
  video.addEventListener('canplay', onCanPlay);
  video.addEventListener('loadedmetadata', onLoadedMeta);
  video.addEventListener('ended', onEnded);
  video.addEventListener('error', onError);

  // ----- Click wiring -----
  // Delegated handler for player controls (playpause / mute icons inside the
  // player UI). We delegate so designers can swap or wrap the icon DOM
  // without re-binding listeners.
  const onPlayerClick = (e) => {
    if (instance.hasFailed) return;
    const btn = e.target.closest('[data-player-control]');
    if (!btn || !player.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    const type = btn.getAttribute('data-player-control');
    if (type === 'play' || type === 'pause' || type === 'playpause') togglePlay(instance);
    else if (type === 'mute') toggleMute(instance);
  };
  player.addEventListener('click', onPlayerClick);
  instance.handlers.push({ el: player, type: 'click', fn: onPlayerClick });

  // Progress bar segments: clicking any segment jumps to that story and
  // restarts playback for it (`force: true` so it re-loads even if we're
  // already on that index — useful for "replay current story").
  instance.progressSegments.forEach((seg) => {
    seg.element.style.cursor = 'pointer';
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      goTo(instance, seg.index, { force: true });
    };
    seg.element.addEventListener('click', handler);
    instance.handlers.push({ el: seg.element, type: 'click', fn: handler });
  });

  // Prev / next nav zones — accept "previous" and "prev" for ergonomics.
  wrapper.querySelectorAll('[data-story-nav]').forEach((el) => {
    const dir = (el.getAttribute('data-story-nav') || '').trim().toLowerCase();
    if (dir !== 'next' && dir !== 'previous' && dir !== 'prev') return;
    el.style.cursor = 'pointer';
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (dir === 'next') goNext(instance);
      else goPrev(instance);
    };
    el.addEventListener('click', handler);
    instance.handlers.push({ el, type: 'click', fn: handler });
  });

  // ----- Visibility / autoplay gate -----
  // Defer the FIRST goTo until the wrapper enters the viewport — keeps off-
  // screen instances cheap on init and avoids autoplay penalties from Chrome
  // when a tab loads with a stories component below the fold.
  instance.io = new IntersectionObserver((entries) => {
    const visible = entries.some((e) => e.isIntersecting);
    if (visible) {
      if (instance.activeIndex === -1) {
        instance.visibilityPaused = false;
        goTo(instance, opts.activeIndex, { force: true });
      } else if (instance.visibilityPaused) {
        instance.visibilityPaused = false;
        if (!instance.userPaused && !instance.hasFailed) {
          instance.pendingPlay = true;
          if (video.readyState >= 2) safePlay(video);
        }
      }
    } else {
      instance.visibilityPaused = true;
      if (!video.paused) {
        try { video.pause(); } catch (_) { /* ignore */ }
      }
    }
  }, { threshold: 0.15 });
  instance.io.observe(wrapper);

  instance.destroy = () => {
    cancelProgressLoop(instance);
    clearStallTimer(instance);
    clearQualityFallbackTimer(instance);
    try { video.pause(); } catch (_) { /* ignore */ }
    if (instance.hls) {
      try { instance.hls.destroy(); } catch (_) { /* ignore */ }
      instance.hls = null;
    }
    if (instance.io) {
      try { instance.io.disconnect(); } catch (_) { /* ignore */ }
    }
    video.removeEventListener('play', onPlay);
    video.removeEventListener('playing', onPlaying);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('waiting', onWaiting);
    video.removeEventListener('canplay', onCanPlay);
    video.removeEventListener('loadedmetadata', onLoadedMeta);
    video.removeEventListener('ended', onEnded);
    video.removeEventListener('error', onError);
    instance.handlers.forEach(({ el, type, fn }) => el.removeEventListener(type, fn));
    delete wrapper.dataset[INIT_FLAG];
  };
}


// --------------------------------------------
// Entry
// --------------------------------------------
function initBunnyStories(container) {
  container = container || document;
  purgeStaleInstances();
  container.querySelectorAll(SELECTOR).forEach(initInstance);
}

function bunnyStories() {
  document.addEventListener('barba:afterEnter', (e) => {
    initBunnyStories(e.detail.container);
  });
  initBunnyStories();
}

export default bunnyStories;
