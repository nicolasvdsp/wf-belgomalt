const QUESTIONS = [
  {
    question: "How far does barley usually travel before becoming beer?",
    answers: ["200 - 500 km", "<50 km", "500 - 1000 km", "> 1000 km"],
    correctIndex: 0,
    explication:
      "Barley grown on Belgian fields has a journey to travel before it reaches the brewing process. This journey often takes between 200-500 km, ensuring that the grain retains its freshness and sustainable journey. By linking local farms and breweries, the environmental footprint of beer production is reduced.",
  },
  {
    question: "What percentage of Belgian barley is used for brewing?",
    answers: ["About 70%", "About 30%", "About 50%", "About 90%"],
    correctIndex: 0,
    explication:
      "Approximately 70% of barley grown in Belgium is destined for the brewing industry. This high proportion reflects Belgium's deep-rooted brewing heritage and the quality of its local grain production.",
  },
  {
    question: "How many varieties of barley are commonly used in Belgian malt?",
    answers: ["Around 10", "Around 3", "Around 25", "Around 50"],
    correctIndex: 0,
    explication:
      "Belgian maltsters typically work with around 10 approved barley varieties, each selected for specific qualities like enzyme activity, protein content, and yield that contribute to the final malt character.",
  },
  {
    question: "What is the ideal moisture content for storing malting barley?",
    answers: ["Below 14%", "Below 8%", "Below 20%", "Below 25%"],
    correctIndex: 0,
    explication:
      "Barley must be stored at moisture levels below 14% to prevent mold growth and preserve germination capacity. Proper drying right after harvest is critical to maintaining grain quality for malting.",
  },
  {
    question: "How long does the malting process typically take?",
    answers: ["About 8 days", "About 2 days", "About 21 days", "About 45 days"],
    correctIndex: 0,
    explication:
      "The malting process — steeping, germination, and kilning — takes approximately 8 days from start to finish. Each stage is carefully controlled to develop the enzymes and flavors needed for brewing.",
  },
];

function initGameQuiz(container) {
  container = container || document;
  const game = container.querySelector(".game-component");
  if (!game) return;
  if (game.dataset.gameInitialized) return;
  game.dataset.gameInitialized = "true";

  const questionEl = game.querySelector("[data-game-question]");
  const explicationEl = game.querySelector("[data-game-explication]");
  const currentEl = game.querySelector('[data-game-question-number="current"]');
  const maxEl = game.querySelector('[data-game-question-number="max"]');
  const livesEl = game.querySelector("[data-counter-lifes]");
  const progressBarTemplate = game.querySelector("[data-progress-bar]");
  const allButtons = Array.from(game.querySelectorAll("[data-game-button]"));

  if (!questionEl || !allButtons.length) return;

  const answerButtons = allButtons;

  let currentIndex = 0;
  let lives = livesEl ? parseInt(livesEl.textContent, 10) || 3 : 3;
  const answeredState = new Array(QUESTIONS.length).fill(null);

  // --- Progress bars: one per question ---
  // Same mechanics as journey-map: clone [data-progress-bar] template once per
  // question, remove the original, drive fill via scaleX + --progress CSS var.
  let progressSegments = [];

  function buildProgressBars() {
    if (!progressBarTemplate) return;

    const barContainer = progressBarTemplate.parentNode;
    if (!barContainer) return;

    const stepCount = String(QUESTIONS.length);
    barContainer.style.setProperty("--step-count", stepCount);
    game.querySelectorAll("[data-journey-progress]").forEach((el) => {
      el.style.setProperty("--step-count", stepCount);
    });

    progressSegments = QUESTIONS.map((_, i) => {
      const element = progressBarTemplate.cloneNode(true);
      element.setAttribute("data-progress-bar", "");
      element.removeAttribute("data-reveal-element");
      element.style.setProperty("--progress", "0");

      const progressEl = element.querySelector("[data-progress-fill]");
      if (progressEl) {
        progressEl.style.transformOrigin = "left center";
        progressEl.style.transform = "scaleX(0)";
        progressEl.style.transition = "none";
      }

      element.style.cursor = "pointer";
      element.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (answeredState[i] !== null && i !== currentIndex) {
          // Force-cancel any in-progress state
          if (contentEl) gsap.killTweensOf(contentEl);
          gsap.set(contentEl, { clearProps: "xPercent,opacity" });
          promotedBtn = null;
          isBusy = false;
          slideToQuestion(i);
        }
      });

      return { element, progressEl, index: i };
    });

    progressSegments.forEach((seg) => {
      barContainer.insertBefore(seg.element, progressBarTemplate);
    });
    progressBarTemplate.parentNode.removeChild(progressBarTemplate);

    // Reveal progress bars with a stagger
    const barEls = progressSegments.map((s) => s.element);
    gsap.set(barEls, { autoAlpha: 0, yPercent: 12.5 });
    gsap.to(barEls, {
      autoAlpha: 1,
      yPercent: 0,
      stagger: 0.08,
      duration: 0.8,
      delay: 0.8,
      ease: "power2.out",
    });
  }

  function updateProgressBars() {
    progressSegments.forEach((seg, i) => {
      const isActive = i === currentIndex;
      const isAnswered = answeredState[i] !== null;
      const fillValue = isAnswered ? 1 : 0;

      let state;
      if (isActive) state = "active";
      else if (isAnswered) state = "unlocked";
      else state = "";

      seg.element.setAttribute("data-progress-bar", state);
      seg.element.style.setProperty("--progress", fillValue.toFixed(4));

      if (seg.progressEl) {
        seg.progressEl.style.transform = `scaleX(${fillValue})`;
      }
    });
  }

  // --- Barba interception ---
  function interceptBarba(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  allButtons.forEach((btn) => {
    btn.addEventListener("click", interceptBarba);
  });

  // --- State ---
  let promotedBtn = null;
  let isBusy = false;

  // --- Slide transition ---
  const contentEl = game.querySelector(".game-content");
  const cardEl = game.querySelector(".game-card") || contentEl?.parentElement;

  function slideToQuestion(newIndex) {
    if (isBusy) return;
    if (newIndex === currentIndex) return;

    const direction = newIndex > currentIndex ? 1 : -1;
    currentIndex = newIndex;

    if (!contentEl) {
      renderQuestion();
      return;
    }

    isBusy = true;
    if (cardEl) cardEl.style.overflow = "hidden";
    const xOut = direction * -100;
    const xIn = direction * 100;

    gsap.to(contentEl, {
      xPercent: xOut,
      opacity: 0,
      duration: 0.25,
      ease: "power2.in",
      onComplete() {
        renderQuestion();
        gsap.set(contentEl, { xPercent: xIn, opacity: 0 });
        gsap.to(contentEl, {
          xPercent: 0,
          opacity: 1,
          duration: 0.35,
          ease: "power2.out",
          onComplete() {
            if (cardEl) cardEl.style.overflow = "";
            isBusy = false;
          },
        });
      },
    });
  }

  // --- Explication reveal (height + fade so layout shifts smoothly) ---
  function revealExplication() {
    if (!explicationEl) return;
    gsap.set(explicationEl, { autoAlpha: 0, height: 0, overflow: "hidden" });
    const naturalHeight = explicationEl.scrollHeight;
    gsap.to(explicationEl, {
      height: naturalHeight,
      duration: 0.5,
      ease: "power2.out",
      onComplete() {
        gsap.set(explicationEl, { height: "auto", overflow: "" });
      },
    });
    gsap.to(explicationEl, {
      autoAlpha: 1,
      duration: 0.5,
      delay: 0.15,
      ease: "power2.out",
    });
  }

  // --- Rendering ---
  function renderQuestion() {
    const q = QUESTIONS[currentIndex];
    const state = answeredState[currentIndex];

    if (currentEl) currentEl.textContent = currentIndex + 1;
    if (maxEl) maxEl.textContent = QUESTIONS.length;

    if (state !== null) {
      renderAnsweredState(q, state);
    } else {
      renderFreshQuestion(q);
    }

    updateProgressBars();
  }

  function renderFreshQuestion(q) {
    questionEl.textContent = q.question;

    if (explicationEl) {
      explicationEl.textContent = q.explication;
      explicationEl.style.display = "none";
    }

    promotedBtn = null;

    answerButtons.forEach((btn, i) => {
      gsap.set(btn, { clearProps: "all" });
      btn.classList.remove("is-pressed", "is-success", "is-error");
      const textEl = btn.querySelector(".button-new_text") || btn;
      if (i < q.answers.length) {
        textEl.textContent = q.answers[i];
        btn.style.display = "";
        btn.style.gridColumn = "";
        btn.style.pointerEvents = "";
      } else {
        btn.style.display = "none";
      }
    });
  }

  function renderAnsweredState(q, state) {
    questionEl.textContent = state.correct ? "Correct answer!" : "Wrong answer!";

    if (explicationEl) {
      explicationEl.textContent = q.explication;
      explicationEl.style.display = "";
      revealExplication();
    }

    // Show one button as the "next question" in full-width mode
    answerButtons.forEach((btn, i) => {
      gsap.set(btn, { clearProps: "all" });
      btn.classList.remove("is-pressed", "is-success", "is-error");
      if (i === 0) {
        const textEl = btn.querySelector(".button-new_text") || btn;
        textEl.textContent = "Next question";
        btn.style.display = "";
        btn.style.gridColumn = "1 / -1";
        btn.style.pointerEvents = "";
        promotedBtn = btn;
      } else {
        btn.style.display = "none";
        btn.style.gridColumn = "";
        btn.style.pointerEvents = "none";
      }
    });
  }

  // --- Navigation ---
  function goToQuestion(idx) {
    slideToQuestion(idx);
  }

  // --- Lives ---
  function updateLives() {
    if (livesEl) livesEl.textContent = lives;
  }

  // --- Coin reward ---
  const POINTS_PER_CORRECT = 50;
  const COIN_COUNT = 8;

  function getCounter() {
    const el = document.querySelector("[data-preloader-counter]");
    if (!el) return { el: null, valueEl: null };
    const valueEl =
      el.querySelector("[data-preloader-counter-value]") ||
      Array.from(el.children).find(
        (c) => c.tagName !== "SVG" && !c.querySelector("svg")
      ) ||
      el;
    return { el, valueEl };
  }

  function getCoinTemplate() {
    return document.querySelector("[data-preloader-maltcoin]");
  }

  function getCounterValue() {
    const { valueEl } = getCounter();
    if (!valueEl) return 0;
    return parseInt(valueEl.textContent, 10) || 0;
  }

  function getCoinAnimationDuration() {
    return (COIN_COUNT - 1) * 0.2 + 1.2;
  }

  function animateCounterTo(target) {
    const { valueEl } = getCounter();
    if (!valueEl) return;
    const start = parseInt(valueEl.textContent, 10) || 0;
    gsap.to({ val: start }, {
      val: target,
      duration: getCoinAnimationDuration(),
      ease: "power2.out",
      onUpdate() {
        valueEl.textContent = Math.round(this.targets()[0].val);
      },
    });
  }

  function burstCoinsToCounter(originEl) {
    const { el: counterEl } = getCounter();
    const coinTemplate = getCoinTemplate();
    if (!counterEl || !coinTemplate) return;

    const originRect = originEl.getBoundingClientRect();
    const destRect = counterEl.getBoundingClientRect();
    const destX = destRect.left + destRect.width / 2;
    const destY = destRect.top + destRect.height / 2;

    for (let i = 0; i < COIN_COUNT; i++) {
      const coin = coinTemplate.cloneNode(true);
      coin.removeAttribute("data-preloader-maltcoin");
      document.body.appendChild(coin);

      // Random start position scattered around the button
      const startX = originRect.left + gsap.utils.random(0, originRect.width);
      const startY = originRect.top + gsap.utils.random(0, originRect.height);
      const coinScale = gsap.utils.random(0.6, 1);

      gsap.set(coin, {
        position: "fixed",
        display: "flex",
        left: startX,
        top: startY,
        xPercent: -50,
        yPercent: -50,
        scale: coinScale,
        rotation: gsap.utils.random(-15, 15),
        autoAlpha: 0,
        zIndex: 99999,
        pointerEvents: "none",
      });

      const delay = i * 0.2;
      const duration = 1.2;

      // Staggered appearance — smooth fade in
      gsap.to(coin, {
        autoAlpha: 1,
        duration: 0.4,
        delay: delay,
        ease: "power2.out",
      });

      // Animate X and Y separately with different easings to create a curve
      gsap.to(coin, {
        left: destX,
        rotation: gsap.utils.random(-60, 60),
        duration: duration,
        delay: delay,
        ease: "sine.inOut",
      });

      gsap.to(coin, {
        top: destY,
        scale: coinScale * 0.5,
        duration: duration,
        delay: delay,
        ease: "power3.in",
        onComplete() {
          coin.remove();
        },
      });

      gsap.to(coin, {
        opacity: 0,
        duration: 0.2,
        delay: delay + duration - 0.2,
      });
    }

    // Animate the counter value in sync with the coin flight
    const newValue = getCounterValue() + POINTS_PER_CORRECT;
    animateCounterTo(newValue);
  }

  // --- Confetti ---
  const confettiColors = ["#C9A84C", "#E5C76B", "#A68A3A", "#D4AF37", "#F2D675"];

  function burstConfetti() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const count = gsap.utils.random(25, 40, 1);

    for (let i = 0; i < count; i++) {
      const ribbon = document.createElement("div");
      ribbon.style.cssText = `
        position: fixed;
        width: ${gsap.utils.random(4, 8)}px;
        height: ${gsap.utils.random(12, 22)}px;
        background: ${gsap.utils.random(confettiColors)};
        border-radius: 1px;
        pointer-events: none;
        will-change: transform, opacity;
        z-index: 99999;
      `;
      document.body.appendChild(ribbon);

      const startX = gsap.utils.random(0, vw);
      const delay = gsap.utils.random(0, 0.8);
      const duration = gsap.utils.random(2, 3.5);

      gsap.set(ribbon, {
        top: gsap.utils.random(-30, -80),
        left: startX,
        rotation: gsap.utils.random(0, 360),
        scale: gsap.utils.random(0.7, 1.3),
        autoAlpha: 1,
      });

      // Horizontal drift (swaying)
      gsap.to(ribbon, {
        left: startX + gsap.utils.random(-80, 80),
        rotation: `+=${gsap.utils.random(-400, 400)}`,
        duration: duration,
        delay: delay,
        ease: "sine.inOut",
      });

      // Vertical fall (gravity-like)
      gsap.to(ribbon, {
        top: vh + 50,
        duration: duration,
        delay: delay,
        ease: "power1.in",
        onComplete() {
          ribbon.remove();
        },
      });

      // Fade out near the end
      gsap.to(ribbon, {
        autoAlpha: 0,
        duration: 0.5,
        delay: delay + duration - 0.5,
      });
    }
  }

  // --- Handlers ---
  function handleAnswer(e) {
    const btn = e.currentTarget;
    const idx = answerButtons.indexOf(btn);
    const q = QUESTIONS[currentIndex];
    const isCorrect = idx === q.correctIndex;

    if (!isCorrect) {
      lives = Math.max(0, lives - 1);
      updateLives();
    }

    answeredState[currentIndex] = { chosenIndex: idx, correct: isCorrect };

    isBusy = true;

    answerButtons.forEach((b) => {
      b.style.pointerEvents = "none";
    });

    // Step 1: immediately show pressed state
    btn.classList.add("is-pressed");

    // Step 2: after 1s, reveal success/error color + update question text
    setTimeout(() => {
      btn.classList.add(isCorrect ? "is-success" : "is-error");
      questionEl.textContent = isCorrect ? "Correct answer!" : "Wrong answer!";

      if (isCorrect) {
        burstConfetti();
        burstCoinsToCounter(btn);
      }

      // Step 3: wait for coin animation to finish (or 1s if wrong), then FLIP
      const step3Delay = isCorrect ? getCoinAnimationDuration() * 1000 : 1000;
      setTimeout(() => {
        const flipState = Flip.getState(btn);

        // Hide other answer buttons
        answerButtons.forEach((b) => {
          if (b !== btn) b.style.display = "none";
        });

        // Remove color classes, span full width, update text
        btn.classList.remove("is-pressed", "is-success", "is-error");
        btn.style.gridColumn = "1 / -1";
        const textEl = btn.querySelector(".button-new_text") || btn;
        textEl.textContent = "Next question";

        Flip.from(flipState, {
          duration: 0.5,
          ease: "power3.out",
          onComplete() {
            isBusy = false;
          },
        });

        // Promote this button to act as "next question"
        promotedBtn = btn;
        btn.style.pointerEvents = "";

        if (explicationEl) {
          explicationEl.style.display = "";
          revealExplication();
        }

        updateProgressBars();
      }, step3Delay);
    }, 1000);
  }

  function handlePromotedNext() {
    promotedBtn = null;
    const nextIdx = (currentIndex + 1) % QUESTIONS.length;
    slideToQuestion(nextIdx);
  }

  answerButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      if (promotedBtn === btn) {
        handlePromotedNext();
      } else if (!promotedBtn && !isBusy) {
        handleAnswer(e);
      }
    });
  });

  // --- Init ---
  // Strip reveal attributes — quiz handles its own entrance animations
  answerButtons.forEach((btn) => btn.removeAttribute("data-reveal-element"));

  buildProgressBars();
  updateLives();
  renderQuestion();

  // Unified entrance reveal with 0.8s delay after page-enter
  const revealDelay = 0.8;

  if (questionEl) {
    gsap.set(questionEl, { autoAlpha: 0, yPercent: 20 });
    gsap.to(questionEl, {
      autoAlpha: 1,
      yPercent: 0,
      duration: 0.8,
      delay: revealDelay,
      ease: "power2.out",
    });
  }

  // Buttons
  answerButtons.forEach((btn) => {
    if (btn.style.display !== "none") {
      gsap.set(btn, { autoAlpha: 0, yPercent: 12.5 });
    }
  });
  const visibleButtons = answerButtons.filter((b) => b.style.display !== "none");
  gsap.to(visibleButtons, {
    autoAlpha: 1,
    yPercent: 0,
    stagger: 0.1,
    duration: 1,
    delay: revealDelay + 0.3,
    ease: "power2.out",
  });
}

function gameQuiz() {
  document.addEventListener("barba:pageVisible", (e) => {
    initGameQuiz(e.detail.container);
  });
}

export default gameQuiz;
