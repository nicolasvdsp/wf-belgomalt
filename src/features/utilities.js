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

const counterAnim = { target: 0, tween: null };

const DIGIT_SPAN_STYLE = 'display:inline-block;width:0.6em;text-align:center;';

function ensureDigitSpans(valueEl) {
  const raw = valueEl.textContent;
  const hasSpans = valueEl.children.length > 0 &&
    Array.from(valueEl.children).every((c) => c.tagName === 'SPAN' && c.textContent.length === 1);
  if (hasSpans) return;

  valueEl.style.fontVariantNumeric = 'tabular-nums';
  const digits = raw.replace(/\D/g, '') || '0';
  valueEl.innerHTML = '';
  for (const ch of digits) {
    const s = document.createElement('span');
    s.style.cssText = DIGIT_SPAN_STYLE;
    s.textContent = ch;
    valueEl.appendChild(s);
  }
}

function setDigitSpans(valueEl, value) {
  const str = String(value);
  const spans = Array.from(valueEl.children);

  while (spans.length < str.length) {
    const s = document.createElement('span');
    s.style.cssText = DIGIT_SPAN_STYLE;
    s.textContent = '0';
    valueEl.insertBefore(s, valueEl.firstChild);
    spans.unshift(s);
  }
  while (spans.length > str.length) {
    valueEl.removeChild(spans.shift());
  }

  for (let i = 0; i < str.length; i++) {
    if (spans[i].textContent !== str[i]) {
      spans[i].textContent = str[i];
      gsap.fromTo(spans[i],
        { yPercent: 30, opacity: 0.3 },
        { yPercent: 0, opacity: 1, duration: 0.18, ease: 'power2.out', overwrite: true }
      );
    }
  }
}

function addToCounter(delta) {
  if (delta <= 0) return;
  const valueEl = getCounterValueEl();
  if (!valueEl) return;

  const displayed = parseInt(valueEl.textContent, 10) || 0;
  const current = Math.max(displayed, counterAnim.target);
  counterAnim.target = current + delta;

  if (counterAnim.tween) counterAnim.tween.kill();

  ensureDigitSpans(valueEl);

  const proxy = { val: displayed };
  const distance = counterAnim.target - displayed;
  const duration = Math.min(1.35 + distance * 0.005, 1.8);

  counterAnim.tween = gsap.to(proxy, {
    val: counterAnim.target,
    duration,
    ease: 'none',
    onUpdate() {
      setDigitSpans(valueEl, Math.round(proxy.val));
    },
    onComplete() {
      setDigitSpans(valueEl, counterAnim.target);
      counterAnim.tween = null;
    },
  });
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
  const target = parseInt(sourceEl.textContent, 10) || 0;
  const from = parseInt(el.textContent, 10) || 0;
  if (target === from) return;

  el.style.fontVariantNumeric = 'tabular-nums';

  const proxy = { val: from };
  const distance = Math.abs(target - from);
  const duration = Math.min(0.5 + distance * 0.005, 2);

  // Reuse the same digit-span helpers on this element
  el.innerHTML = '';
  const digits = String(from);
  for (const ch of digits) {
    const s = document.createElement('span');
    s.style.cssText = DIGIT_SPAN_STYLE;
    s.textContent = ch;
    el.appendChild(s);
  }

  gsap.to(proxy, {
    val: target,
    duration,
    ease: 'none',
    onUpdate() {
      setDigitSpans(el, Math.round(proxy.val));
    },
    onComplete() {
      setDigitSpans(el, target);
    },
  });
}

function initCounterAccumulation(container) {
  container = container || document;

  if (counterState.cleanup) {
    counterState.cleanup();
  }

  // --- Section-based scroll points (opt-in per page) ---
  const scrollEnabled = container.querySelector('[data-counter-scroll]');
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
