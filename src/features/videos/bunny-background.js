function initBunnyPlayerBackground(container) {
  container = container || document;
  container.querySelectorAll('[data-bunny-background-init]').forEach(function (player) {
    var src = player.getAttribute('data-player-src');
    if (!src) return;

    var video = player.querySelector('video');
    if (!video) return;

    try { video.pause(); } catch (_) { }
    try { video.removeAttribute('src'); video.load(); } catch (_) { }

    // Attribute helpers
    function setStatus(s) {
      if (player.getAttribute('data-player-status') !== s) {
        player.setAttribute('data-player-status', s);
      }
    }
    function setActivated(v) { player.setAttribute('data-player-activated', v ? 'true' : 'false'); }
    if (!player.hasAttribute('data-player-activated')) setActivated(false);

    // Flags
    var lazyMode = player.getAttribute('data-player-lazy'); // "true" | "false" (no meta)
    var isLazyTrue = lazyMode === 'true';
    var autoplay = player.getAttribute('data-player-autoplay') === 'true';
    var initialMuted = player.getAttribute('data-player-muted') === 'true';
    var maxQuality = player.getAttribute('data-player-max-quality') === 'true';

    // Used to suppress 'ready' flicker when user just pressed play in lazy modes
    var pendingPlay = false;
    var hasFailed = false;
    var stallTimer = null;
    var STALL_MS = 15000;

    function clearStallTimer() {
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    }

    function startStallTimer() {
      clearStallTimer();
      if (hasFailed) return;
      stallTimer = setTimeout(function () {
        if (hasFailed) return;
        if (player.getAttribute('data-player-status') === 'loading') handleError();
      }, STALL_MS);
    }

    function handleError() {
      if (hasFailed) return;
      hasFailed = true;
      pendingPlay = false;
      clearStallTimer();
      try { video.pause(); } catch (_) { }
      if (player._hls) { try { player._hls.destroy(); } catch (_) { } player._hls = null; }
      setActivated(false);
      setStatus('error');
    }

    function wireHlsErrors(hls) {
      if (!hls || !window.Hls) return;
      hls.on(Hls.Events.ERROR, function (event, data) {
        if (data && data.fatal) handleError();
      });
    }

    function bestLevelIndex(levels) {
      if (!levels || !levels.length) return -1;
      var bestIdx = 0;
      var bestScore = -1;
      for (var i = 0; i < levels.length; i++) {
        var l = levels[i] || {};
        var score = (l.height || 0) * 1e7 + (l.bitrate || 0);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
      return bestIdx;
    }

    function wireMaxQuality(hls) {
      if (!maxQuality || !window.Hls) return;
      hls.on(Hls.Events.MANIFEST_LOADED, function (e, data) {
        if (data && data.levels && data.levels.length > 1) {
          hls.startLevel = bestLevelIndex(data.levels);
        }
      });
      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        if (hls.levels && hls.levels.length > 1) {
          var max = bestLevelIndex(hls.levels);
          hls.autoLevelCapping = max;
          hls.nextLevel = max;
          hls.loadLevel = max;
          hls.currentLevel = max;
        }
      });
    }

    // Safari (native HLS) has no hls.js APIs. To force max quality we resolve
    // the master playlist, pick the highest-bitrate variant, and point the
    // <video> directly at that single-rendition sub-playlist.
    function resolveMaxQualityVariant(masterUrl, done) {
      fetch(masterUrl, { credentials: 'omit' })
        .then(function (r) { if (!r.ok) throw new Error(); return r.text(); })
        .then(function (txt) {
          var lines = txt.split(/\r?\n/);
          var bestBw = 0;
          var bestUri = null;
          var lastInf = null;
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf('#EXT-X-STREAM-INF:') === 0) {
              lastInf = line;
            } else if (lastInf && line && line[0] !== '#') {
              var bw = 0;
              var bwMatch = /BANDWIDTH=(\d+)/.exec(lastInf);
              if (bwMatch) bw = parseInt(bwMatch[1], 10) || 0;
              if (bw > bestBw) { bestBw = bw; bestUri = line; }
              lastInf = null;
            }
          }
          if (bestUri) done(new URL(bestUri, masterUrl).href);
          else done(masterUrl);
        })
        .catch(function () { done(masterUrl); });
    }

    function wireLoopStartFlush(hls) {
      if (!video.loop || !hls || !window.Hls) return;
      var loopFlushDone = false;
      var LOOP_FLUSH_LEAD = 1.5;

      video.addEventListener('timeupdate', function () {
        if (hasFailed || !video.duration || !player._hls) return;
        var remaining = video.duration - video.currentTime;
        if (remaining <= LOOP_FLUSH_LEAD && remaining > 0 && !loopFlushDone) {
          loopFlushDone = true;
          var flushEnd = Math.min(3, video.duration * 0.15);
          if (flushEnd > 0) {
            hls.trigger(Hls.Events.BUFFER_FLUSHING, {
              startOffset: 0,
              endOffset: flushEnd,
              type: 'video',
            });
          }
        }
        if (video.currentTime < 0.5) loopFlushDone = false;
      });
    }

    function onLoadProgress() {
      clearStallTimer();
    }

    // Autoplay forces muted + loop; IO will drive play/pause
    if (autoplay) { video.muted = true; video.loop = true; }
    else { video.muted = initialMuted; }

    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.playsInline = true;
    if (typeof video.disableRemotePlayback !== 'undefined') video.disableRemotePlayback = true;
    if (autoplay) video.autoplay = false;

    var isSafariNative = !!video.canPlayType('application/vnd.apple.mpegurl');
    var canUseHlsJs = !!(window.Hls && Hls.isSupported()) && !isSafariNative;

    // Attach media only once (for actual playback)
    var isAttached = false;
    var userInteracted = false;
    var lastPauseBy = ''; // 'io' | 'manual' | ''
    function attachMediaOnce() {
      if (isAttached) return;
      isAttached = true;

      if (player._hls) { try { player._hls.destroy(); } catch (_) { } player._hls = null; }

      if (isSafariNative) {
        video.preload = isLazyTrue ? 'none' : 'auto';
        video.addEventListener('loadedmetadata', function () {
          onLoadProgress();
          readyIfIdle(player, pendingPlay);
        }, { once: true });
        if (maxQuality) {
          resolveMaxQualityVariant(src, function (resolved) { video.src = resolved; });
        } else {
          video.src = src;
        }
      } else if (canUseHlsJs) {
        var hls = new Hls({ maxBufferLength: 10 });
        wireHlsErrors(hls);
        wireMaxQuality(hls);
        wireLoopStartFlush(hls);
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, function () { hls.loadSource(src); });
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
          onLoadProgress();
          readyIfIdle(player, pendingPlay);
        });
        player._hls = hls;
      } else {
        video.src = src;
      }
    }

    // Initialize based on lazy mode
    if (isLazyTrue) {
      video.preload = 'none';
    } else {
      attachMediaOnce();
    }

    // Toggle play/pause
    function togglePlay() {
      if (hasFailed) return;
      userInteracted = true;
      if (video.paused || video.ended) {
        if (isLazyTrue && !isAttached) attachMediaOnce();
        pendingPlay = true;
        lastPauseBy = '';
        setStatus('loading');
        startStallTimer();
        safePlay(video);
      } else {
        lastPauseBy = 'manual';
        video.pause();
      }
    }

    // Toggle mute
    function toggleMute() {
      if (hasFailed) return;
      video.muted = !video.muted;
      player.setAttribute('data-player-muted', video.muted ? 'true' : 'false');
    }

    video.addEventListener('error', handleError);
    video.addEventListener('loadedmetadata', onLoadProgress);

    // Controls (delegated)
    player.addEventListener('click', function (e) {
      if (hasFailed) return;
      var btn = e.target.closest('[data-player-control]');
      if (!btn || !player.contains(btn)) return;
      var type = btn.getAttribute('data-player-control');
      if (type === 'play' || type === 'pause' || type === 'playpause') togglePlay();
      else if (type === 'mute') toggleMute();
    });

    // Media event wiring
    video.addEventListener('play', function () { if (hasFailed) return; setActivated(true); setStatus('playing'); });
    video.addEventListener('playing', function () { if (hasFailed) return; pendingPlay = false; clearStallTimer(); setStatus('playing'); });
    video.addEventListener('pause', function () { if (hasFailed) return; pendingPlay = false; setStatus('paused'); });
    video.addEventListener('waiting', function () { if (hasFailed) return; setStatus('loading'); startStallTimer(); });
    video.addEventListener('canplay', function () {
      if (hasFailed) return;
      onLoadProgress();
      readyIfIdle(player, pendingPlay);
    });
    video.addEventListener('ended', function () { pendingPlay = false; setStatus('paused'); setActivated(false); });

    // In-view auto play/pause (only when autoplay is true)
    if (autoplay) {
      if (player._io) { try { player._io.disconnect(); } catch (_) { } }
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (hasFailed) return;
          var inView = entry.isIntersecting && entry.intersectionRatio > 0;
          if (inView) {
            if (isLazyTrue && !isAttached) attachMediaOnce();
            if ((lastPauseBy === 'io') || (video.paused && lastPauseBy !== 'manual')) {
              setStatus('loading');
              startStallTimer();
              if (video.paused) togglePlay();
              lastPauseBy = '';
            }
          } else {
            if (!video.paused && !video.ended) {
              lastPauseBy = 'io';
              video.pause();
            }
          }
        });
      }, { threshold: 0.1 });
      io.observe(player);
      player._io = io;
    }
  });

  // Helper: Ready status guard
  function readyIfIdle(player, pendingPlay) {
    if (player.getAttribute('data-player-status') === 'error') return;
    if (!pendingPlay &&
      player.getAttribute('data-player-activated') !== 'true' &&
      player.getAttribute('data-player-status') === 'idle') {
      player.setAttribute('data-player-status', 'ready');
    }
  }

  // Helper: safe programmatic play
  function safePlay(video) {
    var p = video.play();
    if (p && typeof p.then === 'function') p.catch(function () { });
  }
}

// Initialize Bunny HTML HLS Player (Background)
function bunnyBackground() {
  document.addEventListener('barba:afterEnter', (e) => {
    initBunnyPlayerBackground(e.detail.container);
  });
}

export default bunnyBackground;