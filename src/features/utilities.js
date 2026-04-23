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


// Initialize Dynamic Current Year
function utilities() {
  document.addEventListener('barba:pageVisible', (e) => {
    initDynamicCurrentYear(e.detail.container);
    initPaginationPill(e.detail.container);
  });
}

export default utilities;
