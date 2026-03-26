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


// Initialize Dynamic Current Year
function utilities() {
  document.addEventListener('barba:pageVisible', (e) => {
    initDynamicCurrentYear(e.detail.container);
  });
}

export default utilities;