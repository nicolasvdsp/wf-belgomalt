function initDynamicCurrentYear(container) {
  container = container || document;
  const currentYear = new Date().getFullYear();
  const yearInBinary = currentYear.toString(2);
  const yearInBase10 = currentYear.toString(10);
  const paddedYearForScramble = yearInBase10.padStart(yearInBinary.length, '_');

  const currentYearElements = container.querySelectorAll('[data-current-year]');
  if (!currentYearElements.length) return;
  currentYearElements.forEach(currentYearElement => {
    currentYearElement.textContent = yearInBinary;
    currentYearElement.setAttribute('data-scramble-text', paddedYearForScramble);
  });


}


function initPaginationPill(container) {
  container = container || document;

  const wrappers = container.querySelectorAll('[data-init-pagination-pill]');
  if (!wrappers.length) return;

  wrappers.forEach(wrapper => {
    const pills = wrapper.querySelectorAll('[data-pagination-pill="wrapper"]');
    if (!pills.length) return;

    const total = pills.length;

    pills.forEach((pill, index) => {
      const itemEl = pill.querySelector('[data-pagination-pill="item"]');
      const totalEl = pill.querySelector('[data-pagination-pill="total"]');

      if (itemEl) itemEl.textContent = index + 1;
      if (totalEl) totalEl.textContent = total;
    });
  });
}


// --------------- Preloader counter accumulation ---------------
// Uses a delta approach: each source only ever ADDS to the current display
// value, so it coexists safely with the preloader and quiz animations that
// also write to the same element.

const counterState = { cleanup: null, scrollPointsAwarded: 0 };

const SCROLL_TOTAL_POINTS = 400;
const DEFAULT_BUTTON_POINTS = 20;

function getCounterValueEl() {
  const el = document.querySelector('[data-preloader-counter]');
  if (!el) return null;
  return (
    el.querySelector('[data-preloader-counter-value]') ||
    Array.from(el.children).find(
      (c) => c.tagName !== 'SVG' && !c.querySelector('svg')
    ) ||
    el
  );
}

const counterAnim = { target: 0, timer: null };

const STEPS = 5;
const STEP_INTERVAL = 80;

function addToCounter(delta) {
  if (delta <= 0) return;
  const valueEl = getCounterValueEl();
  if (!valueEl) return;

  const displayed = parseInt(valueEl.textContent, 10) || 0;
  const current = Math.max(displayed, counterAnim.target);
  counterAnim.target = current + delta;

  if (counterAnim.timer) clearInterval(counterAnim.timer);

  let step = 0;
  const from = displayed;
  const to = counterAnim.target;

  counterAnim.timer = setInterval(() => {
    step++;
    if (step >= STEPS) {
      clearInterval(counterAnim.timer);
      counterAnim.timer = null;
      valueEl.textContent = to;
      return;
    }
    const t = step / STEPS;
    valueEl.textContent = Math.round(from + (to - from) * t);
  }, STEP_INTERVAL);
}

function onButtonClick(e) {
  const btn = e.currentTarget;
  const raw = btn.getAttribute('data-counter-add');
  const parsed = parseInt(raw, 10);
  const amount = (raw !== null && raw !== '') ? (isNaN(parsed) ? DEFAULT_BUTTON_POINTS : parsed) : DEFAULT_BUTTON_POINTS;
  if (amount <= 0) return;

  addToCounter(amount);

  const group = btn.closest('[data-counter-group]');
  const siblings = group
    ? group.querySelectorAll('[data-counter-add]')
    : [btn];
  siblings.forEach((b) => b.setAttribute('data-counter-add', '0'));
}

function syncTotalCounter(el) {
  const sourceEl = getCounterValueEl();
  if (!sourceEl) return;
  const to = parseInt(sourceEl.textContent, 10) || 0;
  const from = parseInt(el.textContent, 10) || 0;
  if (to === from) return;

  let step = 0;
  const timer = setInterval(() => {
    step++;
    if (step >= STEPS) {
      clearInterval(timer);
      el.textContent = to;
      return;
    }
    const t = step / STEPS;
    el.textContent = Math.round(from + (to - from) * t);
  }, STEP_INTERVAL);
}

function initCounterAccumulation(container) {
  container = container || document;

  if (counterState.cleanup) {
    counterState.cleanup();
  }

  // --- Section-based scroll points (opt-in per page) ---
  const scrollEnabled = container.hasAttribute?.('data-counter-scroll') || container.querySelector('[data-counter-scroll]');
  const sections = scrollEnabled
    ? Array.from(container.querySelectorAll('section:not([data-counter-ignore])'))
    : [];
  const sectionCount = sections.length;
  const pointsPerSection = sectionCount > 0 ? Math.round(SCROLL_TOTAL_POINTS / sectionCount) : 0;
  const remaining = SCROLL_TOTAL_POINTS - counterState.scrollPointsAwarded;
  const reached = new Set();
  let observer = null;

  if (sectionCount > 0 && remaining > 0) {
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          if (reached.has(entry.target)) return;
          reached.add(entry.target);
          const award = Math.min(pointsPerSection, SCROLL_TOTAL_POINTS - counterState.scrollPointsAwarded);
          if (award <= 0) return;
          counterState.scrollPointsAwarded += award;
          addToCounter(award);
        });
      },
      { threshold: 0.15 }
    );
    sections.forEach((section) => observer.observe(section));
  }

  // --- Button click points ---
  const buttons = container.querySelectorAll('[data-counter-add]');
  buttons.forEach((btn) => btn.addEventListener('click', onButtonClick));

  // --- Mirror counter (data-counter-total) – one-shot sync on visibility ---
  const totals = Array.from(container.querySelectorAll('[data-counter-total]'));
  let totalObserver = null;

  if (totals.length) {
    totalObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          totalObserver.unobserve(entry.target);
          syncTotalCounter(entry.target);
        });
      },
      { threshold: 0.15 }
    );
    totals.forEach((el) => totalObserver.observe(el));
  }

  // --- Live sync (data-counter-sync) – mirrors coin counter while visible ---
  const syncEls = Array.from(container.querySelectorAll('[data-counter-sync]'));
  const visibleSyncEls = new Set();
  let syncObserver = null;
  let mutationObserver = null;

  if (syncEls.length) {
    const pushValue = () => {
      const sourceEl = getCounterValueEl();
      if (!sourceEl) return;
      const val = sourceEl.textContent;
      visibleSyncEls.forEach((el) => { el.textContent = val; });
    };

    syncObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            visibleSyncEls.add(entry.target);
            pushValue();
          } else {
            visibleSyncEls.delete(entry.target);
          }
        });
      },
      { threshold: 0 }
    );
    syncEls.forEach((el) => syncObserver.observe(el));

    const sourceEl = getCounterValueEl();
    if (sourceEl) {
      mutationObserver = new MutationObserver(pushValue);
      mutationObserver.observe(sourceEl, { childList: true, characterData: true, subtree: true });
    }
  }

  counterState.cleanup = () => {
    if (observer) observer.disconnect();
    if (totalObserver) totalObserver.disconnect();
    if (syncObserver) syncObserver.disconnect();
    if (mutationObserver) mutationObserver.disconnect();
    buttons.forEach((btn) => btn.removeEventListener('click', onButtonClick));
    counterState.cleanup = null;
  };
}


function utilities() {
  document.addEventListener('barba:pageVisible', (e) => {
    initDynamicCurrentYear(e.detail.container);
    initPaginationPill(e.detail.container);
    initCounterAccumulation(e.detail.container);
  });
}

export default utilities;
