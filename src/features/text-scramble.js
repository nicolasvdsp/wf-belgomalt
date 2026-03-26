gsap.registerPlugin(ScrambleTextPlugin)

// Function to reveal stuff on load
function initScrambleOnLoad(container) {    //Reveal on load
  container = container || document;
  let targets = container.querySelectorAll('[data-scramble="load"]')
  if (!targets.length) return;

  targets.forEach((target) => {
    let chars = target.getAttribute("data-scramble-chars") || target.textContent.replace(/\s/g, '')
    let speed = parseFloat(target.getAttribute("data-scramble-speed")) || 0.85
    target.style.height = target.offsetHeight + 'px'
    target.style.overflow = 'hidden'

    let split = new SplitText(target, {
      type: "words, chars",
      wordsClass: "word",
      charsClass: "char"
    });

    gsap.to(split.words, {
      duration: 1.2,
      stagger: 0.01,
      scrambleText: {
        text: "{original}",
        chars: chars,
        speed: speed,
      },
      onComplete: () => {
        split.revert()
        target.style.height = ''
        target.style.overflow = ''
      }
    });
  });
}


function initScrambleOnScroll(container) {  //Reveal on scroll
  container = container || document;
  let targets = container.querySelectorAll('[data-scramble="scroll"]')
  if (!targets.length) return;

  targets.forEach((target) => {
    let chars = target.getAttribute("data-scramble-chars") || target.textContent.replace(/\s/g, '')
    let speed = parseFloat(target.getAttribute("data-scramble-speed")) || 0.95
    target.style.height = target.offsetHeight + 'px'
    target.style.overflow = 'hidden'

    let split = new SplitText(target, {
      type: "words, chars",
      wordsClass: "word",
      charsClass: "char"
    });

    gsap.to(split.words, {
      duration: 1.4,
      stagger: 0.015,
      scrambleText: {
        text: "{original}",
        chars: chars,
        speed: speed,
      },
      scrollTrigger: {
        trigger: target,
        start: "top bottom",
        once: true
      },
      onComplete: () => {
        split.revert()
        target.style.height = ''
        target.style.overflow = ''
      }
    });
  });
}

function initScrambleOnHover(container) {   //Reveal on hover
  container = container || document;
  let targets = container.querySelectorAll('[data-scramble-hover="link"]')
  if (!targets.length) return;

  targets.forEach((target) => {
    let textEl = target.querySelector('[data-scramble-hover="target"]')
    let originalText = textEl.textContent
    let customHoverText = textEl.getAttribute("data-scramble-text")
    let chars = textEl.getAttribute("data-scramble-chars") || originalText.replace(/\s/g, '')

    let split = new SplitText(textEl, {
      type: "words, chars",
      wordsClass: "word",
      charsClass: "char"
    });

    target.addEventListener("mouseenter", () => {
      gsap.to(textEl, {
        duration: 1,
        scrambleText: {
          text: customHoverText ? customHoverText : originalText,
          chars: chars
        }
      });
    });

    target.addEventListener("mouseleave", () => {
      gsap.to(textEl, {
        duration: 0.6,
        scrambleText: {
          text: originalText,
          speed: 2,
          chars: chars
        }
      });
    });
  });
}



function textScramble() {
  //boilerplate - dispatch to the EnterAfterFunction
  document.addEventListener('barba:afterEnter', (e) => {
    initScrambleOnLoad(e.detail.container);
    initScrambleOnScroll(e.detail.container);
    initScrambleOnHover(e.detail.container);
  });
}

export default textScramble;