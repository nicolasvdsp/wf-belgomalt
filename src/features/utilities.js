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

const counterState = { cleanup: null };

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
  const reached = new Set();
  let observer = null;

  if (sectionCount > 0) {
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          if (reached.has(entry.target)) return;
          reached.add(entry.target);
          addToCounter(pointsPerSection);
        });
      },
      { threshold: 0.15 }
    );
    sections.forEach((section) => observer.observe(section));
  }

  // --- Button click points ---
  const buttons = container.querySelectorAll('[data-counter-add]');
  buttons.forEach((btn) => btn.addEventListener('click', onButtonClick));

  // --- Mirror counter (data-counter-total) ---
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

  counterState.cleanup = () => {
    if (observer) observer.disconnect();
    if (totalObserver) totalObserver.disconnect();
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
