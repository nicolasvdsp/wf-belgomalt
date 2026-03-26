const splitConfig = {
  lines: { duration: 0.8, stagger: 0.08 },
  words: { duration: 0.6, stagger: 0.06 },
  chars: { duration: 0.4, stagger: 0.01 }
};

function initStaggerOnScroll(container) {
  container = container || document;
  const targets = container.querySelectorAll('[data-stagger="scroll"]');
  if (!targets.length) return;

  targets.forEach(el => {
    const type = el.getAttribute('data-stagger-type') || 'lines';
    const typesToSplit =
      type === 'lines' ? 'lines' :
        type === 'words' ? 'lines, words' :
          'lines, words, chars';

    SplitText.create(el, {
      type: typesToSplit,
      mask: 'lines',
      autoSplit: true,
      linesClass: 'line',
      wordsClass: 'word',
      charsClass: 'letter',
      onSplit(instance) {
        gsap.set(instance.lines, { paddingBottom: '0.15em', marginBottom: '-0.15em' });
        const animTargets = instance[type];
        const config = splitConfig[type];

        return gsap.from(animTargets, {
          yPercent: 110,
          duration: config.duration,
          stagger: config.stagger,
          ease: 'expo.out',
          scrollTrigger: {
            trigger: el,
            start: 'clamp(top 80%)',
            once: true
          }
        });
      }
    });
  });
}

function textStagger() {
  document.addEventListener('barba:afterEnter', (e) => {
    initStaggerOnScroll(e.detail.container);
  });
}

export default textStagger;
