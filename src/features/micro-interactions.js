function alianInteraction(container) {
  container = container || document;
  const folder = container.querySelector('[data-icon-type="folder"]');
  if (!folder) return;
  const alian = folder.querySelector('[data-icon-type="alian"]');

  gsap.set(alian, { xPercent: 0, yPercent: 0, x: 0, y: 0 });

  let isOpen = false;
  let autoCloseTimer = null;

  function close() {
    gsap.to(alian, {
      duration: 0.5,
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      ease: "power2.inOut"
    });
    gsap.to(folder, {
      duration: 0.5,
      rotate: 0,
      ease: "power2.inOut"
    });
    isOpen = false;
    clearTimeout(autoCloseTimer);
  }

  folder.addEventListener("click", function () {
    clearTimeout(autoCloseTimer);

    if (!isOpen) {
      const iconFolderWidth = parseFloat(window.getComputedStyle(folder).width);
      const moveX = iconFolderWidth * 0.305;
      const moveY = -iconFolderWidth * 0.61;

      gsap.to(alian, {
        duration: .6,
        x: moveX,
        y: moveY,
        rotation: 135,
        scale: 1.5,
        ease: "back.out"
      });
      gsap.to(folder, {
        duration: .6,
        rotate: 15,
        ease: "back.out"
      });
      isOpen = true;
      autoCloseTimer = setTimeout(close, 3000);
    } else {
      close();
    }
  });
}

function dragJoystick(container) {
  container = container || document;
  const joystick = container.querySelector('[data-icon-type="stick"]');
  if (!joystick) return;


  const maxRotation = 15; // Max 15 graden naar links/rechts
  const centerX = window.innerWidth / 2; // Center van het scherm (horizontaal)

  joystick.style.transformOrigin = "50% 55%";

  document.addEventListener("mousemove", (event) => {
    const mouseX = event.clientX; // Muispositie op de X-as
    const deltaX = mouseX - centerX;
    const rotation = Math.max(-maxRotation, Math.min(maxRotation, deltaX / 10)); // deltaX wordt gedeeld om de rotatie geleidelijker te maken

    // Gebruik GSAP om de rotatie van de joystick te veranderen
    gsap.to(joystick, { rotation: rotation, ease: "linear" });
  });
}

function microInteractions() {
  document.addEventListener('barba:pageVisible', (e) => {
    dragJoystick(e.detail.container);
    alianInteraction(e.detail.container);
  });
}

export default microInteractions;