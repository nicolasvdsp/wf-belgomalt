function lenisSetup() {
  document.addEventListener('barba:afterEnter', (e) => {
    if (!window.lenis) {
      window.lenis = new Lenis({
        autoRaf: true,
      });
    }

    initScrollToAnchorLenis(e.detail.container);
  });
}

function initScrollToAnchorLenis(container) {
  container = container || document;
  container.querySelectorAll("[data-anchor-target]").forEach(element => {
    console.log('lenisSetup');
    element.addEventListener("click", function () {
      const target = this.getAttribute("data-anchor-target");

      window.lenis.scrollTo(target, {
        easing: (x) => (x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2),
        duration: 1.6,
        offset: -20,
      });
    });
  });
}

export default lenisSetup;
