function initStackingCardsParallax(container) {
  container = container || document;
  const cards = container.querySelectorAll("[data-stacking-cards-item]");
  if (!cards.length) return;

  if (cards.length < 2) return;

  cards.forEach((card, i) => {
    const cardStrength = Number(card.dataset.stackingCardsStrength) || 50;
    const elementStrength = Number(card.dataset.stackingCardsElementStrength) || -25;
    // Skip over the first section
    if (i === 0) return;

    // When current section is in view, target the PREVIOUS one
    const previousCard = cards[i - 1]
    if (!previousCard) return;

    // Find optional element inside the previous card
    const previousCardElement = previousCard.querySelector("[data-stacking-cards-el]");

    const tl = window.gsap.timeline({
      defaults: {
        ease: "none",
        duration: 1
      },
      scrollTrigger: {
        trigger: card,
        start: "top bottom",
        end: "top top",
        scrub: true,
        invalidateOnRefresh: true
      }
    })

    tl.fromTo(previousCard, { yPercent: 0 }, { yPercent: parseInt(cardStrength) });

    // Guard against null target to avoid "GSAP target not found" warnings.
    if (previousCardElement) {
      tl.fromTo(
        previousCardElement,
        { rotate: 0, yPercent: 0 },
        { rotate: -5, yPercent: -elementStrength },
        "<"
      );
    }
  });
}

function initGlobalParallax(container) {
  container = container || document;
  const mm = gsap.matchMedia()

  mm.add(
    {
      isMobile: "(max-width:479px)",
      isMobileLandscape: "(max-width:767px)",
      isTablet: "(max-width:991px)",
      isDesktop: "(min-width:992px)"
    },
    (context) => {
      const { isMobile, isMobileLandscape, isTablet } = context.conditions

      const ctx = gsap.context(() => {
        container.querySelectorAll('[data-parallax="trigger"]').forEach((trigger) => {
          // Check if this trigger has to be disabled on smaller breakpoints
          const disable = trigger.getAttribute("data-parallax-disable")
          if (
            (disable === "mobile" && isMobile) ||
            (disable === "mobileLandscape" && isMobileLandscape) ||
            (disable === "tablet" && isTablet)
          ) {
            return
          }

          // Optional: you can target an element inside a trigger if necessary 
          const target = trigger.querySelector('[data-parallax="target"]') || trigger

          // Get the direction value to decide between xPercent or yPercent tween
          const direction = trigger.getAttribute("data-parallax-direction") || "vertical"
          const prop = direction === "horizontal" ? "xPercent" : "yPercent"

          // Get the scrub value, our default is 'true' because that feels nice with Lenis
          const scrubAttr = trigger.getAttribute("data-parallax-scrub")
          const scrub = scrubAttr ? parseFloat(scrubAttr) : true

          // Get the start position in % 
          const startAttr = trigger.getAttribute("data-parallax-start")
          const startVal = startAttr !== null ? parseFloat(startAttr) : 20

          // Get the end position in %
          const endAttr = trigger.getAttribute("data-parallax-end")
          const endVal = endAttr !== null ? parseFloat(endAttr) : -20

          // Get the start value of the ScrollTrigger
          const scrollStartRaw = trigger.getAttribute("data-parallax-scroll-start") || "top bottom"
          const scrollStart = `clamp(${scrollStartRaw})`

          // Get the end value of the ScrollTrigger  
          const scrollEndRaw = trigger.getAttribute("data-parallax-scroll-end") || "bottom top"
          const scrollEnd = `clamp(${scrollEndRaw})`

          gsap.fromTo(
            target,
            { [prop]: startVal },
            {
              [prop]: endVal,
              ease: "none",
              scrollTrigger: {
                trigger,
                start: scrollStart,
                end: scrollEnd,
                scrub,
              },
            }
          )
        })
      })

      return () => ctx.revert()
    }
  )
}

function initFooterParallax(container) {
  container = container || document;
  const init = container.querySelectorAll('[data-footer-parallax]');
  if (!init.length) return;

  init.forEach(el => {
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: el,
        start: 'clamp(top bottom)',
        end: 'clamp(top top)',
        scrub: true
      }
    });

    const inner = el.querySelector('[data-footer-parallax-inner]');
    const dark = el.querySelector('[data-footer-parallax-dark]');

    if (inner) {
      tl.from(inner, {
        yPercent: -25,
        ease: 'linear'
      });
    }

    if (dark) {
      tl.from(dark, {
        opacity: 0.5,
        ease: 'linear'
      }, '<');
    }
  });
}

function parallax() {
  document.addEventListener("barba:afterEnter", (e) => {
    initStackingCardsParallax(e.detail.container);
    initGlobalParallax(e.detail.container);
    initFooterParallax(e.detail.container);
  });
}

export default parallax;