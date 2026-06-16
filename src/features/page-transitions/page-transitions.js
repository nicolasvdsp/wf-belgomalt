function initPageTransitions() {
  // ------------------------------------------
  // BARBA PAGE TRANSITION BOILERPLATE, by osmo
  // ------------------------------------------


  history.scrollRestoration = "manual";

  let lenis = null;
  let nextPage = document;
  let onceFunctionsInitialized = false;
  let isFirstEnter = true;

  let flipState = null;
  let flippedThumbnail = null;
  let savedBodyColor = null;

  const hasLenis = typeof window.Lenis !== "undefined";
  const hasScrollTrigger = typeof window.ScrollTrigger !== "undefined";

  const rmMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = rmMQ.matches;
  rmMQ.addEventListener?.("change", e => (reducedMotion = e.matches));
  rmMQ.addListener?.(e => (reducedMotion = e.matches));

  const has = (s) => !!nextPage.querySelector(s);

  let staggerDefault = 0.05;
  let durationDefault = 0.6;

  CustomEase.create("osmo", "0.625, 0.05, 0, 1");
  CustomEase.create("loader", "0.65, 0.01, 0.05, 0.99");
  gsap.defaults({ ease: "osmo", duration: durationDefault });



  // -----------------------------------------
  // FUNCTION REGISTRY
  // -----------------------------------------

  function initOnceFunctions() {
    initLenis();
    if (onceFunctionsInitialized) return;
    onceFunctionsInitialized = true;

    // Runs once on first load
    // if (has('[data-something]')) initSomething();
  }
  function initBeforeEnterFunctions(next) {
    nextPage = next || document;

    // Runs before the enter animation
    // if (has('[data-something]')) initSomething();
  }
  function dispatchPageVisible(container) {
    document.dispatchEvent(new CustomEvent('barba:pageVisible', { detail: { container } }));
  }

  function initAfterEnterFunctions(next) {
    nextPage = next || document;
    const scope = isFirstEnter ? document : nextPage;
    isFirstEnter = false;

    dispatchPageVisible(scope);
    document.dispatchEvent(new CustomEvent('barba:afterEnter', { detail: { container: scope } }));

    // Runs after enter animation completes
    // if (has('[data-something]')) initSomething();
    // if (has('[data-overlap-slider-init]')) initOverlappingSlider();



    if (lenis) {
      lenis.resize();
    }

    if (hasScrollTrigger) {
      ScrollTrigger.refresh();
    }
  }


  // -----------------------------------------
  // SECTION & ELEMENT REVEALS
  // -----------------------------------------

  const radialStops = Array.from({ length: 17 }, (_, i) => {
    const t = i / 16;
    return { a: (t * t * (3 - 2 * t)).toFixed(3), d: t * 50 };
  });
  const textRevealConfig = {
    lines: { duration: 0.8, stagger: 0.08 },
    words: { duration: 0.6, stagger: 0.06 },
    chars: { duration: 0.4, stagger: 0.01 }
  };
  const textRevealTypeMap = {
    'stagger-lines': 'lines',
    'stagger-words': 'words',
    'stagger-chars': 'chars'
  };

  function addSectionReveal(tl, next, position) {
    const overlay = next.querySelector('[data-reveal-section]');
    if (!overlay) return;

    const type = overlay.getAttribute('data-reveal-section');

    if (type === "radial") {
      const siblings = [...overlay.parentElement.children].filter(el => el !== overlay);
      const setMask = (v) => { overlay.style.maskImage = overlay.style.webkitMaskImage = v; };

      tl.set(overlay, { autoAlpha: 1 }, position);
      tl.fromTo(siblings, { filter: "blur(12px)" }, { filter: "blur(0px)", duration: 1.2, ease: "power2.out" }, position + "+=0.2");
      tl.to({ size: 0 }, {
        size: 150, duration: 1.8, ease: "easeOut",
        onUpdate() {
          const s = this.targets()[0].size;
          setMask(`radial-gradient(ellipse, transparent ${s}%, ${radialStops.map(({ a, d }) => `rgba(0,0,0,${a}) ${(s + d).toFixed(1)}%`).join(",")})`);
        },
        onComplete() {
          gsap.set(overlay, { autoAlpha: 0 });
          setMask("");
        }
      }, position);
    }
  }

  function addTextReveals(tl, next, position) {
    const elements = next.querySelectorAll('[data-reveal-text]');
    if (!elements.length) return;

    elements.forEach((el, i) => {
      const type = textRevealTypeMap[el.getAttribute('data-reveal-text')] || 'lines';
      const typesToSplit =
        type === 'lines' ? 'lines' :
          type === 'words' ? 'lines, words' :
            'lines, words, chars';
      const config = textRevealConfig[type];

      const split = SplitText.create(el, {
        type: typesToSplit,
        mask: 'lines',
        linesClass: 'line',
        wordsClass: 'word',
        charsClass: 'char'
      });

      gsap.set(split.lines, { paddingBottom: '0.15em', marginBottom: '-0.15em' });
      gsap.set(el, { autoAlpha: 1 });
      tl.from(split[type], {
        yPercent: 110,
        duration: config.duration,
        stagger: config.stagger,
        ease: 'expo.out'
      }, position + "+=" + (i * .5));
    });
  }

  function addElementReveals(tl, next, position) {
    const elements = next.querySelectorAll('[data-reveal-element]');
    if (!elements.length) return;

    gsap.set(elements, { autoAlpha: 0, yPercent: 12.5 });
    tl.to(elements, {
      autoAlpha: 1,
      yPercent: 0,
      stagger: 0.15,
      duration: 1.5,
      ease: 'loader'
    }, position);
  }

  // -----------------------------------------
  // PAGE TRANSITIONS
  // -----------------------------------------

  function runLogoPreloader(next) {
    // -----------VARIABLES--------------
    const wrap = document.querySelector("[data-load-wrap]");
    if (!wrap) return;

    const container = wrap.querySelector("[data-load-container]");
    const bg = wrap.querySelector("[data-load-bg]");
    const progressBar = wrap.querySelector("[data-load-progress]");
    const progressBars = Array.from(wrap.querySelectorAll("[data-load-progress]"));
    const logo = wrap.querySelector("[data-load-logo]");
    const textElements = Array.from(wrap.querySelectorAll("[data-load-text]"));

    // Reset targets that are * not * split text targets
    const resetTargets = Array.from(
      wrap.querySelectorAll('[data-load-reset]:not([data-load-text])')
    );
    // ------------var_end---------------
    // -----------TIMELINE---------------

    // Main loader timeline
    const loadTimeline = gsap.timeline({
      defaults: {
        ease: "loader",
        duration: 3.5
      }
    })
      .set(wrap, { display: "block" })
      // .to(progressBars, { scaleX: 1 })
      .to(logo, { clipPath: "inset(0% 0% 0% 0%)" }, "<")
      .to(container, { autoAlpha: 0, duration: 0.5 })
      .to(progressBars, { scaleX: 0, transformOrigin: "right center", duration: 0.5 }, "<")
      .add("hideContent", "<")
      // .to(bg, { yPercent: -101, duration: 1 }, "hideContent")
      .to(bg, { autoAlpha: 0, duration: 1 }, "hideContent")
      .set(wrap, { display: "none" });

    // If there are items to hide FOUC for, reset them at the start
    if (resetTargets.length) {
      loadTimeline.set(resetTargets, { autoAlpha: 1 }, 0);
    }

    // If there's text items, split them, and add to load timeline
    if (textElements.length >= 2) {
      const firstWord = new SplitText(textElements[0], { type: "lines,chars", mask: "lines" });
      const secondWord = new SplitText(textElements[1], { type: "lines,chars", mask: "lines" });

      gsap.set([firstWord.chars, secondWord.chars], { autoAlpha: 0, yPercent: 125 });
      gsap.set(textElements, { autoAlpha: 1 });

      // "( 0% )" stagger in
      loadTimeline.to(firstWord.chars, {
        autoAlpha: 1,
        yPercent: 0,
        duration: 0.6,
        stagger: { each: 0.02 }
      }, 0);

      // revert split, count, then re-split and transition to second text
      loadTimeline.call(() => {
        firstWord.revert();
        gsap.to({ val: 0 }, {
          val: 100,
          duration: 1,
          snap: { val: 100 / 6 },
          ease: "none",
          onUpdate() {
            textElements[0].textContent = "( " + Math.round(this.targets()[0].val) + "% )";
          },
          onComplete() {
            const exitSplit = new SplitText(textElements[0], { type: "lines,chars", mask: "lines" });
            gsap.timeline({ delay: 0.4 })
              .to(exitSplit.chars, {
                autoAlpha: 0,
                yPercent: -125,
                duration: 0.4,
                stagger: { each: 0.02 }
              }, 0)
              .to(secondWord.chars, {
                autoAlpha: 1,
                yPercent: 0,
                duration: 0.6,
                stagger: { each: 0.02 }
              }, 0);
          }
        });
      }, null, ">");

      // second text out
      loadTimeline.to(secondWord.chars, {
        autoAlpha: 0,
        yPercent: -125,
        duration: 0.4,
        stagger: { each: 0.02 }
      }, "hideContent-=0.5");
    }

    loadTimeline.call(() => dispatchPageVisible(next), null, "hideContent");
    addSectionReveal(loadTimeline, next, "hideContent-=.05");
    addTextReveals(loadTimeline, next, "hideContent+=0.3");
    addElementReveals(loadTimeline, next, "hideContent+=0.6");


    // ------------tl_end----------------

    loadTimeline.call(() => {
      resetPage(next)
    }, null, 0);

    return loadTimeline;
  }
  function runLogoPreloaderFast(next) {
    // -----------VARIABLES--------------
    const wrap = document.querySelector("[data-load-wrap]");

    const container = wrap.querySelector("[data-load-container]");
    const bg = wrap.querySelector("[data-load-bg]");
    const progressBar = wrap.querySelector("[data-load-progress]");
    const progressBars = Array.from(wrap.querySelectorAll("[data-load-progress]"));
    const logo = wrap.querySelector("[data-load-logo]");
    const textElements = Array.from(wrap.querySelectorAll("[data-load-text]"));

    // Reset targets that are * not * split text targets
    const resetTargets = Array.from(
      wrap.querySelectorAll('[data-load-reset]:not([data-load-text])')
    );
    // ------------var_end---------------
    // -----------TIMELINE---------------

    // Main loader timeline
    const loadTimeline = gsap.timeline({
      defaults: {
        ease: "loader",
        duration: .5
      }
    })
      .set(wrap, { display: "block" })
      // .to(progressBars, { scaleX: 1 })
      .to(logo, { clipPath: "inset(0% 0% 0% 0%)" }, "<")
      .to(container, { autoAlpha: 0, duration: .5 })
      // .to(progressBars, { scaleX: 0, transformOrigin: "right center", duration: 0.5 }, "<")
      .add("hideContent", "<")
      // .to(bg, { yPercent: -101, duration: 1 }, "hideContent")
      .to(bg, { autoAlpha: 0, duration: .5 }, "hideContent")
      .set(wrap, { display: "none" });

    // If there are items to hide FOUC for, reset them at the start
    if (resetTargets.length) {
      loadTimeline.set(resetTargets, { autoAlpha: 1 }, 0);
    }

    // If there's text items, split them, and add to load timeline
    if (textElements.length >= 2) {
      const firstWord = new SplitText(textElements[0], { type: "lines,chars", mask: "lines" });
      const secondWord = new SplitText(textElements[1], { type: "lines,chars", mask: "lines" });

      gsap.set([firstWord.chars, secondWord.chars], { autoAlpha: 0, yPercent: 125 });
      gsap.set(textElements, { autoAlpha: 1 });

      // "( 0% )" stagger in
      loadTimeline.to(firstWord.chars, {
        autoAlpha: 1,
        yPercent: 0,
        duration: 0.6,
        stagger: { each: 0.02 }
      }, 0);

      // revert split, count, then re-split and transition to second text
      loadTimeline.call(() => {
        firstWord.revert();
        gsap.to({ val: 0 }, {
          val: 100,
          duration: 1,
          snap: { val: 100 / 6 },
          ease: "none",
          onUpdate() {
            textElements[0].textContent = "( " + Math.round(this.targets()[0].val) + "% )";
          },
          onComplete() {
            const exitSplit = new SplitText(textElements[0], { type: "lines,chars", mask: "lines" });
            gsap.timeline({ delay: 0.4 })
              .to(exitSplit.chars, {
                autoAlpha: 0,
                yPercent: -125,
                duration: 0.4,
                stagger: { each: 0.02 }
              }, 0)
              .to(secondWord.chars, {
                autoAlpha: 1,
                yPercent: 0,
                duration: 0.6,
                stagger: { each: 0.02 }
              }, 0);
          }
        });
      }, null, ">");

      // second text out
      loadTimeline.to(secondWord.chars, {
        autoAlpha: 0,
        yPercent: -125,
        duration: 0.4,
        stagger: { each: 0.02 }
      }, "hideContent-=0.5");
    }

    loadTimeline.call(() => dispatchPageVisible(next), null, "hideContent");
    addSectionReveal(loadTimeline, next, "hideContent-=.05");
    addTextReveals(loadTimeline, next, "hideContent+=0.3");
    addElementReveals(loadTimeline, next, "hideContent+=0.6");


    // ------------tl_end----------------

    loadTimeline.call(() => {
      resetPage(next)
    }, null, 0);

    return loadTimeline;
  }

  function runCoinPreloader(next) {
    // -----------VARIABLES--------------
    const wrap = document.querySelector("[data-preloader-wrap]");
    if (!wrap) return;

    const bg = wrap.querySelector("[data-preloader-bg]");
    const content = wrap.querySelector("[data-preloader-content]");
    const coinTemplate = wrap.querySelector("[data-preloader-maltcoin]");
    const counter =
      next.querySelector("[data-preloader-counter]") ||
      document.querySelector("[data-preloader-counter]");

    if (!counter || !coinTemplate) return;
    counter.classList.add("z-99999");

    // Resolve the text-bearing child inside the counter (preserve icon sibling)
    const counterValueEl =
      counter.querySelector("[data-preloader-counter-value]") ||
      Array.from(counter.children).find(
        (c) => c.tagName !== "SVG" && !c.querySelector("svg")
      ) ||
      counter;

    const resetTargets = Array.from(
      wrap.querySelectorAll('[data-load-reset]:not([data-load-text])')
    );

    // Hide template coin immediately (before wrap is shown)
    gsap.set(coinTemplate, { autoAlpha: 0 });

    // Capture counter's natural size/position BEFORE detaching
    counter.offsetHeight;
    const naturalRect = counter.getBoundingClientRect();

    // The top-bar (position:sticky + z-index) creates a stacking context that
    // clamps the counter's z-index below the preloader. Detach the counter and
    // move it to <body> so it escapes the stacking context entirely. A sized
    // placeholder keeps the top-bar's flex slot intact so layout doesn't shift.
    const placeholder = document.createElement("div");
    placeholder.style.width = naturalRect.width + "px";
    placeholder.style.height = naturalRect.height + "px";
    placeholder.style.flex = "0 0 auto";
    counter.parentNode.insertBefore(placeholder, counter);
    document.body.appendChild(counter);

    // Calculate center in pixels so the move animation is a clean straight line
    const centerX = (window.innerWidth - naturalRect.width) / 2;
    const centerY = (window.innerHeight - naturalRect.height) / 2;

    // Clone the maltcoin template to create falling badges
    const COIN_COUNT = 28;
    const coins = [];
    for (let i = 0; i < COIN_COUNT; i++) {
      const clone = coinTemplate.cloneNode(true);
      clone.removeAttribute("data-preloader-maltcoin");
      content.appendChild(clone);
      coins.push(clone);
    }

    // Position each coin off-screen at a random horizontal position (all px)
    const vw = window.innerWidth;
    coins.forEach((coin) => {
      gsap.set(coin, {
        position: "fixed",
        left: gsap.utils.random(0.05, 0.95) * vw,
        top: gsap.utils.random(-100, -50),
        xPercent: -50,
        yPercent: -50,
        opacity: 0,
        visibility: "hidden",
        scale: gsap.utils.random(0.6, 1.2),
        rotation: gsap.utils.random(-25, 25),
        pointerEvents: "none",
        zIndex: 9999,
      });
    });

    // Position counter at viewport center using pixels (not % + xPercent)
    gsap.set(counter, {
      position: "fixed",
      left: centerX,
      top: centerY,
      zIndex: 10000,
    });
    counterValueEl.textContent = "0";
    // ------------var_end---------------
    // -----------TIMELINE---------------

    const loadTimeline = gsap.timeline({
      defaults: { ease: "osmo" },
    }).set(wrap, { display: "block" });

    if (resetTargets.length) {
      loadTimeline.set(resetTargets, { autoAlpha: 1 }, 0);
    }

    // --- PHASE 1: Count 0→50 + falling coin badges ---
    loadTimeline.add("counting", 0.3);

    loadTimeline.to(
      { val: 0 },
      {
        val: 50,
        duration: 2.5,
        ease: "power2.out",
        onUpdate() {
          counterValueEl.textContent = Math.round(this.targets()[0].val);
        },
      },
      "counting"
    );

    // Staggered coin rain — each coin arrives at the counter center on a curved path.
    // Timing is based on ARRIVAL: last coin lands when counter reaches 50.
    const countingDuration = 2.5;
    const coinTargetX = centerX + naturalRect.width / 2;
    const coinTargetY = centerY + naturalRect.height / 2;

    coins.forEach((coin, i) => {
      const t = i / (COIN_COUNT - 1);
      const arrivalTime = gsap.utils.interpolate(0.4, countingDuration, t);
      const flightTime = gsap.utils.random(1.0, 1.6);
      const startTime = Math.max(0, arrivalTime - flightTime);
      const duration = arrivalTime - startTime;

      loadTimeline.set(
        coin,
        { display: "flex", visibility: "visible", opacity: 1 },
        `counting+=${startTime}`
      );

      // Horizontal: smooth S-curve towards counter center
      loadTimeline.to(
        coin,
        { left: coinTargetX, duration, ease: "sine.inOut" },
        `counting+=${startTime}`
      );

      // Vertical: gravity-like drop into counter
      loadTimeline.to(
        coin,
        { top: coinTargetY, duration, ease: "power2.in" },
        `counting+=${startTime}`
      );

      // Scale + rotation: shrink as it reaches
      loadTimeline.to(
        coin,
        {
          scale: 0,
          rotation: `+=${gsap.utils.random(-60, 60)}`,
          duration,
          ease: "power3.in",
        },
        `counting+=${startTime}`
      );
    });

    // --- PHASE 2: Counter slides to its natural position (top-right) ---
    loadTimeline.add("moveCounter", "counting+=2.7");

    loadTimeline.call(() => {
      // Measure the placeholder's live position — it sits in the top-bar's
      // flex slot and reflects where the counter will return to.
      const destRect = placeholder
        ? placeholder.getBoundingClientRect()
        : naturalRect;

      gsap.to(counter, {
        left: destRect.left,
        top: destRect.top,
        duration: 0.8,
        ease: "osmo",
      });
    }, null, "moveCounter");

    // --- PHASE 3: Fade out preloader ---
    loadTimeline.add("hideContent", "moveCounter+=0.6");

    loadTimeline.call(
      () => {
        coins.forEach((c) => c.remove());
        gsap.set(coinTemplate, { clearProps: "autoAlpha" });
      },
      null,
      "hideContent"
    );

    loadTimeline.to(bg, { autoAlpha: 0, duration: 0.5 }, "hideContent");
    loadTimeline.to(content, { autoAlpha: 0, duration: 0.5 }, "hideContent");
    loadTimeline.set(wrap, { display: "none" });
    loadTimeline.call(() => {
      if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.insertBefore(counter, placeholder);
        placeholder.remove();
      }
      gsap.set(counter, {
        clearProps: "position,left,top,zIndex,transform",
      });
    });

    loadTimeline.call(() => dispatchPageVisible(next), null, "hideContent");
    addSectionReveal(loadTimeline, next, "hideContent-=.05");
    addTextReveals(loadTimeline, next, "hideContent+=0.3");
    addElementReveals(loadTimeline, next, "hideContent+=0.6");

    // ------------tl_end----------------

    loadTimeline.call(() => {
      resetPage(next);
    }, null, 0);

    return loadTimeline;
  }

  function runPageEnterSelf(next) {
    // -----------VARIABLES--------------

    // ------------var_end---------------

    const tl = gsap.timeline();

    if (reducedMotion) {
      // Immediate swap behavior if user prefers reduced motion
      tl.set(next, { autoAlpha: 1 });
      tl.add("pageReady")
      tl.call(resetPage, [next], "pageReady");
      return new Promise(resolve => tl.call(resolve, null, "pageReady"));
    }

    // -----------TIMELINE---------------
    //gsap marker: marks the start of the animation
    tl.add("startEnter", 0);

    tl.fromTo(next, {
      autoAlpha: 0,
    }, {
      autoAlpha: 1,
    }, "startEnter");

    tl.call(() => dispatchPageVisible(next), null, "startEnter");

    //gsap marker: marks the end of the animation
    tl.add("pageReady");

    addSectionReveal(tl, next, "pageReady-=0.6");
    addTextReveals(tl, next, "pageReady+=0.2");
    addElementReveals(tl, next, "pageReady+=0.2");
    // ------------tl_end----------------

    tl.call(resetPage, [next], "pageReady");

    return new Promise(resolve => {
      tl.call(resolve, null, "pageReady");
    });
  }


  function pageLeaveCrossFade(current, next) {
    // -----------VARIABLES--------------

    // ------------var_end---------------

    const tl = gsap.timeline({
      onComplete: () => { current.remove() }
    });

    if (reducedMotion) {
      // Immediate swap behavior if user prefers reduced motion
      return tl.set(current, { autoAlpha: 0 });
    }

    // -----------TIMELINE---------------

    tl.to(current, {
      autoAlpha: 0,
      duration: .6
    });

    // ------------tl_end----------------
    return tl;
  }

  function pageEnterCrossFade(next) {
    // -----------VARIABLES--------------

    // ------------var_end---------------

    const tl = gsap.timeline();

    if (reducedMotion) {
      // Immediate swap behavior if user prefers reduced motion
      tl.set(next, { autoAlpha: 1 });
      tl.add("pageReady")
      tl.call(resetPage, [next], "pageReady");
      return new Promise(resolve => tl.call(resolve, null, "pageReady"));
    }

    // -----------TIMELINE---------------
    //gsap marker: marks the start of the animation
    tl.add("startEnter", 0);

    tl.fromTo(next, {
      autoAlpha: 0,
    }, {
      autoAlpha: 1,
    }, "startEnter");

    tl.call(() => dispatchPageVisible(next), null, "startEnter");

    //gsap marker: marks the end of the animation
    tl.add("pageReady");

    addSectionReveal(tl, next, "pageReady+=0.05");
    addTextReveals(tl, next, "pageReady+=0.2");
    addElementReveals(tl, next, "pageReady+=0.2");
    // ------------tl_end----------------

    tl.call(resetPage, [next], "pageReady");

    return new Promise(resolve => {
      tl.call(resolve, null, "pageReady");
    });
  }

  function pageLeaveParallaxOver(current, next) {
    // -----------VARIABLES--------------
    const transitionWrap = document.querySelector("[data-transition-wrap]");
    const transitionDark = transitionWrap.querySelector("[data-transition-dark]");
    CustomEase.create("parallax", "0.7, 0.05, 0.13, 1");
    // ------------var_end---------------

    const tl = gsap.timeline({
      onComplete: () => { current.remove() }
    });

    if (reducedMotion) {
      // Immediate swap behavior if user prefers reduced motion
      return tl.set(current, { autoAlpha: 0 });
    }

    // -----------TIMELINE---------------

    tl.set(transitionWrap, {
      zIndex: 2
    })

    tl.fromTo(transitionDark, {
      autoAlpha: 0,
    }, {
      autoAlpha: .8,
      duration: 1.2,
      ease: "parallax"
    }, 0)

    tl.fromTo(current, {
      y: "0vh",
    },
      {
        y: "-25vh",
        duration: 1.2,
        ease: "parallax"
      }, 0);

    tl.set(transitionDark, {
      autoAlpha: 0,
    })
    // ------------tl_end----------------
    return tl;
  }

  function pageEnterParallaxOver(next) {
    // -----------VARIABLES--------------

    // ------------var_end---------------

    const tl = gsap.timeline();

    if (reducedMotion) {
      // Immediate swap behavior if user prefers reduced motion
      tl.set(next, { autoAlpha: 1 });
      tl.add("pageReady")
      tl.call(resetPage, [next], "pageReady");
      return new Promise(resolve => tl.call(resolve, null, "pageReady"));
    }

    // -----------TIMELINE---------------
    //gsap marker: marks the start of the animation
    tl.add("startEnter", 0);

    tl.set(next, {
      zIndex: 3,
    });

    tl.fromTo(next, {
      y: "100vh",
    }, {
      y: "0vh",
      duration: 1.2,
      clearProps: "all",
      ease: "parallax"
    }, "startEnter");

    tl.call(() => dispatchPageVisible(next), null, "startEnter");

    //gsap marker: marks the end of the animation
    tl.add("pageReady");

    addSectionReveal(tl, next, "startEnter-=-5");
    addTextReveals(tl, next, "pageReady-=0");
    addElementReveals(tl, next, "pageReady-=0");
    // ------------tl_end----------------

    tl.call(resetPage, [next], "pageReady");

    return new Promise(resolve => {
      tl.call(resolve, null, "pageReady");
    });
  }

  function pageLeaveParallaxUnder(current, next) {
    // -----------VARIABLES--------------
    const transitionWrap = document.querySelector("[data-transition-wrap]");
    const transitionDark = transitionWrap.querySelector("[data-transition-dark]");
    CustomEase.create("parallax", "0.7, 0.05, 0.13, 1");
    // ------------var_end---------------

    const tl = gsap.timeline({
      onComplete: () => { current.remove() }
    });

    if (reducedMotion) {
      // Immediate swap behavior if user prefers reduced motion
      return tl.set(current, { autoAlpha: 0 });
    }

    // -----------TIMELINE---------------

    tl.set(transitionWrap, {
      zIndex: 2
    })

    tl.set(current, {
      zIndex: 3,
    });

    tl.fromTo(transitionDark, {
      autoAlpha: 0.8,
    }, {
      autoAlpha: 0,
      duration: 1.2,
      ease: "parallax"
    }, 0)

    tl.fromTo(current, {
      y: "0vh",
    },
      {
        y: "100vh",
        duration: 1.2,
        ease: "parallax"
      }, 0);

    tl.set(transitionDark, {
      autoAlpha: 0,
    })
    // ------------tl_end----------------
    return tl;
  }

  function pageEnterParallaxUnder(next) {
    // -----------VARIABLES--------------

    // ------------var_end---------------

    const tl = gsap.timeline();

    if (reducedMotion) {
      // Immediate swap behavior if user prefers reduced motion
      tl.set(next, { autoAlpha: 1 });
      tl.add("pageReady")
      tl.call(resetPage, [next], "pageReady");
      return new Promise(resolve => tl.call(resolve, null, "pageReady"));
    }

    // -----------TIMELINE---------------
    //gsap marker: marks the start of the animation
    tl.add("startEnter", 0);

    tl.fromTo(next, {
      y: "-25vh",
    }, {
      y: "0vh",
      duration: 1.2,
      clearProps: "all",
      ease: "parallax"
    }, "startEnter");

    tl.call(() => dispatchPageVisible(next), null, "startEnter");

    //gsap marker: marks the end of the animation
    tl.add("pageReady");

    addSectionReveal(tl, next, "startEnter-=-5");
    addTextReveals(tl, next, "pageReady-=0");
    addElementReveals(tl, next, "pageReady-=0");
    // ------------tl_end----------------

    tl.call(resetPage, [next], "pageReady");

    return new Promise(resolve => {
      tl.call(resolve, null, "pageReady");
    });
  }

  function leaveItemToDetailTransition(current, next, trigger) {
    const clicked = trigger.closest("[data-pagetransition-trigger]");
    if (!clicked) return pageLeaveCrossFade(current, next);

    // -----------VARIABLES--------------
    const thumbnail = clicked.querySelector("[data-pagetransition-target]");
    const nextBody = next.ownerDocument.body;

    flipState = Flip.getState(thumbnail);
    flippedThumbnail = thumbnail;

    // ------------var_end---------------

    const tl = gsap.timeline({
      onComplete: () => { current.remove() }
    });

    if (reducedMotion) {
      // Immediate swap behavior if user prefers reduced motion
      return tl.set(current, { autoAlpha: 0 });
    }

    // -----------TIMELINE---------------
    tl.to(current, {
      autoAlpha: 0,
      duration: .6
    }, 0);

    // ------------tl_end----------------

    return tl;
  }

  function enterDetailFromItemTransition(next) {
    if (!flipState || !flippedThumbnail) return pageEnterCrossFade(next);

    console.log(next);

    // -----------VARIABLES--------------
    const nextHero = next.querySelector("section"); // or nextBody, nextMain,... depending on what you want to target
    const nextBody = next.ownerDocument.body;
    nextBody.style.removeProperty('background-color');
    const nextBodyColor = getComputedStyle(nextBody).backgroundColor;
    nextBody.style.backgroundColor = savedBodyColor;

    // ------------var_end---------------

    next.style.backgroundColor = 'transparent';

    const tl = gsap.timeline();

    if (reducedMotion) {
      // Immediate swap behavior if user prefers reduced motion
      tl.set(next, { autoAlpha: 1 });
      tl.add("pageReady")
      tl.call(resetPage, [next], "pageReady");
      return new Promise(resolve => tl.call(resolve, null, "pageReady"));
    }

    const placeholder = next.querySelector("[data-pagetransition-target]");
    placeholder.parentNode.insertBefore(flippedThumbnail, placeholder);
    placeholder.remove();

    // -----------TIMELINE---------------
    //gsap marker: marks the start of the animation
    tl.add("startEnter", .6);

    tl.add(Flip.from(flipState, {
    }), "startEnter");

    tl.fromTo(nextBody, {
      backgroundColor: savedBodyColor,
    }, {
      backgroundColor: nextBodyColor,
    }, "startEnter");


    //gsap marker: marks the end of the animation
    tl.add("pageReady");

    addSectionReveal(tl, next, "pageReady+=0.05");
    addTextReveals(tl, next, "pageReady+=0.1.5");
    addElementReveals(tl, next, "pageReady+=0.2");
    // ------------tl_end----------------


    tl.call(resetPage, [next], "pageReady");
    tl.call(() => {
      flippedThumbnail = null;
      flipState = null;
      savedBodyColor = null;
      gsap.set(nextBody, { clearProps: "backgroundColor" });
      next.style.removeProperty('background-color');
    })

    return new Promise(resolve => {
      tl.call(resolve, null, "pageReady");
    });
  }
  // -----------------------------------------
  // BARBA HOOKS + INIT
  // -----------------------------------------

  barba.hooks.beforeEnter(data => {
    if (lenis) lenis.stop();

    const current = data.current?.container;
    const next = data.next?.container;

    // Pin + clip the leaving container so only the currently-visible
    // viewport slice is rendered during the transition. This way the
    // animation looks the same regardless of scroll position, and no
    // previously-scrolled content leaks back into view.
    if (current && current !== next) {
      const rect = current.getBoundingClientRect();
      const insetTop = Math.max(0, -rect.top);
      const insetBottom = Math.max(0, rect.bottom - window.innerHeight);

      gsap.set(current, {
        position: "fixed",
        top: rect.top,
        left: 0,
        right: 0,
        clipPath: `inset(${insetTop}px 0 ${insetBottom}px 0)`,
      });
      window.scrollTo(0, 0);
    }

    // Position the incoming container at the top of the viewport, always
    // starting from the top of its own scroll.
    gsap.set(next, {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
    });

    initBeforeEnterFunctions(next);
    applyThemeFrom(next);
  });

  barba.hooks.afterLeave(() => {
    if (hasScrollTrigger) {
      ScrollTrigger.getAll().forEach(trigger => trigger.kill());
    }
  });

  barba.hooks.enter(data => {
    initBarbaNavUpdate(data);
  })

  barba.hooks.afterEnter(data => {
    // Run page functions
    initAfterEnterFunctions(data.next.container);

    // Settle
    if (lenis) {
      lenis.resize();
      lenis.start();
    }

    if (hasScrollTrigger) {
      ScrollTrigger.refresh();
    }
  });

  barba.init({
    debug: true, // Set to 'false' in production
    timeout: 7000,
    preventRunning: true,
    prevent: ({ el }) => {
      if (el?.hash && el.pathname.replace(/\/$/, '') === window.location.pathname.replace(/\/$/, '')) return true;
      return !!el?.closest('[data-counter-add], [data-anchor-target], [data-dialog-open], [data-dialog-close], [data-journey-overlay-action]');
    },
    transitions: [
      { //item to detail page
        name: "item to detail page",
        sync: true,
        from: { namespace: ["page-b"] },
        to: { namespace: ["page-c"] },
        custom: ({ trigger }) => trigger.hasAttribute("data-pagetransition-trigger"),

        beforeLeave(data) {
          savedBodyColor = getComputedStyle(data.current.container).backgroundColor;
          document.body.style.backgroundColor = savedBodyColor;
        },

        // Current page leaves
        async leave(data) {
          return leaveItemToDetailTransition(data.current.container, data.next.container, data.trigger);
        },

        // New page enters
        async enter(data) {
          return enterDetailFromItemTransition(data.next.container);
        }
      },
      { //parallax over
        name: "parallax over",
        custom: () => true,
        sync: true,

        // First load
        async once(data) {
          initOnceFunctions();
          return runCoinPreloader(data.next.container);
        },
        async leave(data) { return pageLeaveParallaxOver(data.current.container, data.next.container); },
        async enter(data) { return pageEnterParallaxOver(data.next.container); }
      },
      { //self
        name: "self",
        custom: () => true,
        sync: true,

        // First load
        async once(data) {
          initOnceFunctions();

          return runCoinPreloader(data.next.container);
        },

        // Current page leaves
        async leave(data) {
          return pageLeaveCrossFade(data.current.container, data.next.container);
        },

        // New page enters
        async enter(data) {
          return runPageEnterSelf(data.next.container);
        }
      },
      { //parallax under
        name: "parallax under",
        custom: ({ trigger }) => trigger?.hasAttribute?.("data-transition-back"),
        sync: true,
        async leave(data) { return pageLeaveParallaxUnder(data.current.container, data.next.container); },
        async enter(data) { return pageEnterParallaxUnder(data.next.container); }
      },
      { //crossfade
        name: "crossfade",
        custom: () => false,
        sync: true,

        // First load
        async once(data) {
          initOnceFunctions();

          return runCoinPreloader(data.next.container);
        },

        // Current page leaves
        async leave(data) {
          return pageLeaveCrossFade(data.current.container, data.next.container);
        },

        // New page enters
        async enter(data) {
          return pageEnterCrossFade(data.next.container);
        }
      }

    ],
  });



  // -----------------------------------------
  // GENERIC + HELPERS
  // -----------------------------------------

  const themeConfig = {
    light: {
      nav: "dark",
      transition: "light"
    },
    dark: {
      nav: "light",
      transition: "dark"
    },
    red: {
      nav: "dark",
      transition: "light"
    }
  };

  function applyThemeFrom(container) {
    const pageTheme = container?.dataset?.pageTheme || "light";
    const config = themeConfig[pageTheme] || themeConfig.light;

    document.body.dataset.pageTheme = pageTheme;
    const transitionEl = document.querySelector('[data-theme-transition]');
    if (transitionEl) {
      transitionEl.dataset.themeTransition = config.transition;
    }

    const nav = document.querySelector('[data-theme-nav]');
    if (nav) {
      nav.dataset.themeNav = config.nav;
    }
  }

  function initLenis() {
    if (lenis) return; // already created
    if (!hasLenis) return;

    lenis = new Lenis({
      lerp: 0.165,
      wheelMultiplier: 1.25,
    });
    window.lenis = lenis;

    if (hasScrollTrigger) {
      lenis.on("scroll", ScrollTrigger.update);
    }

    gsap.ticker.add((time) => {
      lenis.raf(time * 1000);
    });

    gsap.ticker.lagSmoothing(0);
  }

  function resetPage(container) {
    window.scrollTo(0, 0);
    gsap.set(container, { clearProps: "position,top,left,right" });

    if (lenis) {
      lenis.resize();
      lenis.start();
    }
  }

  function debounceOnWidthChange(fn, ms) {
    let last = innerWidth,
      timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (innerWidth !== last) {
          last = innerWidth;
          fn.apply(this, args);
        }
      }, ms);
    };
  }

  function initBarbaNavUpdate(data) {
    const tpl = document.createElement('template');
    tpl.innerHTML = data.next.html.trim();

    // Nav links: sync aria-current + full class list (paired by document order).
    const currentLinks = document.querySelectorAll('[data-barba-update]:not([data-barba-update="variant"])');
    const nextLinks = tpl.content.querySelectorAll('[data-barba-update]:not([data-barba-update="variant"])');

    currentLinks.forEach((curr, i) => {
      const next = nextLinks[i];
      if (!next) return;

      const status = next.getAttribute('aria-current');
      if (status !== null) curr.setAttribute('aria-current', status);
      else curr.removeAttribute('aria-current');

      curr.setAttribute('class', next.getAttribute('class') || '');
    });

    // Webflow component variants: inside [data-barba-update="variant"],
    // sync only the w-variant-* classes on matching descendants.
    const currentScopes = document.querySelectorAll('[data-barba-update="variant"]');
    const nextScopes = tpl.content.querySelectorAll('[data-barba-update="variant"]');

    currentScopes.forEach((scope, i) => {
      const nextScope = nextScopes[i];
      if (!nextScope) return;

      const currEls = scope.querySelectorAll('*');
      const nextEls = nextScope.querySelectorAll('*');

      currEls.forEach((curr, j) => {
        const next = nextEls[j];
        if (!next) return;

        [...curr.classList].filter(c => c.startsWith('w-variant-')).forEach(c => curr.classList.remove(c));
        [...next.classList].filter(c => c.startsWith('w-variant-')).forEach(c => curr.classList.add(c));
      });
    });
  }


  // -----------------------------------------
  // YOUR FUNCTIONS GO BELOW HERE
  // -----------------------------------------


}

function pageTransitions() {
  initPageTransitions();
}

export default pageTransitions;