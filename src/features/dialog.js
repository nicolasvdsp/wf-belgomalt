/**
 * Dialog Component
 *
 * Per-instance dialog markup with a single global controller. Designers author
 * the dialog content visually in Webflow (CMS bindings work natively); this
 * module handles open/close behavior, scroll lock, focus management, and ARIA.
 * The visual style (slide-up drawer, center pop, side panel, fade…) is purely
 * a CSS concern — swap the transition in `_dialog.scss` to change the look.
 *
 * Markup convention:
 *
 *   <div data-dialog>                             (optional id: data-dialog="bio-john")
 *     <button data-dialog-open>Learn more</button>
 *     <aside data-dialog-panel>                   (kept thin — designer styles its inner content)
 *       <button data-dialog-close aria-label="Close"></button>
 *       …dialog content…
 *     </aside>
 *   </div>
 *
 * Triggering:
 *   - <button data-dialog-open>            opens the closest [data-dialog]
 *   - <button data-dialog-open="bio-john"> opens [data-dialog="bio-john"] from anywhere
 *   - <button data-dialog-close>           closes the active dialog
 *
 * Behavior:
 *   - Only one dialog is open at a time. Opening another closes the active one.
 *   - Single global backdrop element (appended to <body>). Click closes.
 *   - ESC closes the active dialog.
 *   - Scroll is locked via Lenis.stop() + [data-dialog-locked] on <html>.
 *   - Focus is trapped inside the panel; the trigger is refocused on close.
 *   - Iframes/videos inside a panel with a [data-src] attribute have their
 *     src swapped in on first open (lazy load — keep your CMS lists snappy).
 *   - On Barba page navigation, state is reset.
 *   - Events bubble from [data-dialog]: 'dialog:open', 'dialog:close'.
 *
 * Grabber (drag-to-dismiss):
 *   Add [data-dialog-grabber] (or `.grabber` class) inside [data-dialog-panel]
 *   to let the user drag the panel down to close it. The drag is velocity-
 *   aware: a fast downward flick closes regardless of position; a slow drag
 *   closes only if released past ~40% of the panel height. Releasing earlier
 *   snaps back to the open state.
 *
 * Public API (programmatic open/close from sliders, animations, etc.):
 *   window.dialog.open(idOrEl)
 *   window.dialog.close()
 *   window.dialog.isOpen()
 *
 * Note: we deliberately do NOT use the native <dialog> element here. Webflow's
 * Tag dropdown doesn't include <dialog>, so authoring it in Webflow would mean
 * using an HTML Embed (no visual styling, no CMS bindings). With this module
 * we get equivalent semantics (role="dialog", aria-modal, focus trap, ESC,
 * scroll lock) on whatever block-level element the designer picks.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function initDialog() {
  let activeDialog = null;
  let lastTrigger = null;
  let backdrop = null;

  function getPanel(dialogEl) {
    return dialogEl.querySelector('[data-dialog-panel]');
  }

  function getFocusables(panel) {
    return Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
  }

  function ensureBackdrop() {
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.setAttribute('data-dialog-backdrop', '');
    backdrop.setAttribute('data-dialog-status', 'closed');
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', () => close());
    return backdrop;
  }

  function findDialog(idOrEl) {
    if (!idOrEl) return null;
    if (typeof idOrEl !== 'string') return idOrEl.closest?.('[data-dialog]') || null;
    const safe = (window.CSS && CSS.escape) ? CSS.escape(idOrEl) : idOrEl;
    return document.querySelector(`[data-dialog="${safe}"]`) || document.getElementById(idOrEl);
  }

  function findDialogFromTrigger(trigger) {
    const id = trigger.getAttribute('data-dialog-open');
    if (id) {
      const byId = findDialog(id);
      if (byId) return byId;
    }
    return trigger.closest('[data-dialog]');
  }

  function lockScroll() {
    document.documentElement.setAttribute('data-dialog-locked', '');
    if (window.lenis && typeof window.lenis.stop === 'function') {
      window.lenis.stop();
    }
  }

  function unlockScroll() {
    document.documentElement.removeAttribute('data-dialog-locked');
    if (window.lenis && typeof window.lenis.start === 'function') {
      window.lenis.start();
    }
  }

  // Swap [data-src] -> src on first open so heavy media (Vimeo/YouTube iframes,
  // <video>, large <img>) don't load until the dialog is actually opened.
  function lazyLoadMedia(panel) {
    panel.querySelectorAll('[data-src]:not([src])').forEach((el) => {
      const src = el.getAttribute('data-src');
      if (src) el.setAttribute('src', src);
    });
  }

  // ---------------------------------------------------------
  // Grabber — drag-to-dismiss
  // Attaches once per grabber on first open. Uses Pointer Events
  // so it works with mouse, touch, and stylus uniformly.
  // Two outcomes on release: close (if dragged past CLOSE_THRESHOLD
  // or flicked downward past FLING_THRESHOLD) or snap back to open.
  // ---------------------------------------------------------
  const GRABBER_INIT_KEY = '__dialogGrabberInit';
  const FLING_THRESHOLD = 0.6;  // px/ms — flick speed that forces close
  const CLOSE_THRESHOLD = 0.4;  // fraction of panel height dragged before slow-release closes

  function setupGrabber(panel, dialogEl) {
    const grabber = panel.querySelector('[data-dialog-grabber], .grabber');
    if (!grabber || grabber[GRABBER_INIT_KEY]) return;
    grabber[GRABBER_INIT_KEY] = true;

    let dragging = false;
    let pointerId = null;
    let startY = 0;
    let panelHeight = 0;
    let dragTranslate = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;

    function onPointerDown(e) {
      if (dialogEl.getAttribute('data-dialog-status') !== 'open') return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointerId = e.pointerId;
      dragging = true;
      startY = e.clientY;
      lastY = startY;
      lastTime = performance.now();
      velocity = 0;
      panelHeight = panel.getBoundingClientRect().height;
      dragTranslate = 0;
      panel.style.transition = 'none';
      panel.style.transform = 'translateY(0px)';
      try { grabber.setPointerCapture(pointerId); } catch (_) { /* noop */ }
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!dragging || e.pointerId !== pointerId) return;
      const dy = e.clientY - startY;
      dragTranslate = Math.max(0, Math.min(panelHeight, dy));
      panel.style.transform = `translateY(${dragTranslate}px)`;
      const now = performance.now();
      const dt = now - lastTime;
      if (dt > 0) velocity = (e.clientY - lastY) / dt;
      lastY = e.clientY;
      lastTime = now;
      e.preventDefault();
    }

    function onPointerUp(e) {
      if (!dragging || e.pointerId !== pointerId) return;
      dragging = false;
      try { grabber.releasePointerCapture(pointerId); } catch (_) { /* noop */ }

      const fraction = panelHeight ? dragTranslate / panelHeight : 0;
      const shouldClose = velocity > FLING_THRESHOLD || fraction > CLOSE_THRESHOLD;

      panel.style.transition = '';

      if (shouldClose) {
        panel.style.transform = '';
        close();
        return;
      }

      // Snap back to fully open.
      requestAnimationFrame(() => {
        panel.style.transform = '';
      });
    }

    grabber.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
  }

  function trapFocus(e) {
    if (!activeDialog) return;
    const panel = getPanel(activeDialog);
    if (!panel) return;
    const focusables = getFocusables(panel);
    if (!focusables.length) {
      e.preventDefault();
      panel.focus({ preventScroll: true });
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function open(dialogEl, trigger) {
    if (!dialogEl) return;
    if (activeDialog === dialogEl) return;
    if (activeDialog) closeActive(false);

    activeDialog = dialogEl;
    lastTrigger = trigger || (document.activeElement !== document.body ? document.activeElement : null);

    const panel = getPanel(dialogEl);
    dialogEl.setAttribute('data-dialog-status', 'open');

    if (panel) {
      if (!panel.hasAttribute('role')) panel.setAttribute('role', 'dialog');
      if (!panel.hasAttribute('aria-modal')) panel.setAttribute('aria-modal', 'true');
      if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
      panel.setAttribute('aria-hidden', 'false');
      panel.style.transform = '';
      panel.style.transition = '';
      lazyLoadMedia(panel);
      setupGrabber(panel, dialogEl);
    }

    const bd = ensureBackdrop();
    bd.setAttribute('data-dialog-status', 'open');
    bd.setAttribute('aria-hidden', 'false');

    lockScroll();

    requestAnimationFrame(() => {
      if (!panel) return;
      const focusables = getFocusables(panel);
      const target = focusables.find((el) => !el.matches('[data-dialog-close]')) || focusables[0] || panel;
      target.focus({ preventScroll: true });
    });

    dialogEl.dispatchEvent(new CustomEvent('dialog:open', {
      bubbles: true,
      detail: { dialog: dialogEl, trigger: lastTrigger },
    }));
  }

  // Internal: close + (optionally) release scroll lock / restore focus.
  // When chaining (dialog A -> dialog B), we don't release between them.
  function closeActive(release) {
    if (!activeDialog) return;
    const dialogEl = activeDialog;
    const panel = getPanel(dialogEl);

    dialogEl.setAttribute('data-dialog-status', 'closed');
    if (panel) panel.setAttribute('aria-hidden', 'true');

    dialogEl.dispatchEvent(new CustomEvent('dialog:close', {
      bubbles: true,
      detail: { dialog: dialogEl },
    }));

    if (release) {
      if (backdrop) {
        backdrop.setAttribute('data-dialog-status', 'closed');
        backdrop.setAttribute('aria-hidden', 'true');
      }
      unlockScroll();
      const trigger = lastTrigger;
      activeDialog = null;
      lastTrigger = null;
      if (trigger && typeof trigger.focus === 'function') {
        trigger.focus({ preventScroll: true });
      }
    } else {
      activeDialog = null;
    }
  }

  function close() {
    closeActive(true);
  }

  // Hard reset (used on Barba page navigation — DOM is being swapped out).
  function reset() {
    if (activeDialog) {
      const panel = getPanel(activeDialog);
      activeDialog.setAttribute('data-dialog-status', 'closed');
      if (panel) {
        panel.setAttribute('aria-hidden', 'true');
        panel.style.transform = '';
        panel.style.transition = '';
      }
    }
    if (backdrop) {
      backdrop.setAttribute('data-dialog-status', 'closed');
      backdrop.setAttribute('aria-hidden', 'true');
    }
    unlockScroll();
    activeDialog = null;
    lastTrigger = null;
  }

  // Idempotent ARIA + Lenis prep for every dialog in scope.
  // [data-lenis-prevent] tells Lenis to ignore wheel/touch events that originate
  // inside the panel so the panel's native `overflow-y: auto` scroll works
  // (without this, Lenis swallows the wheel events even when stopped).
  function prepDialogs(container) {
    const scope = container || document;
    scope.querySelectorAll('[data-dialog]').forEach((dialogEl) => {
      if (!dialogEl.hasAttribute('data-dialog-status')) {
        dialogEl.setAttribute('data-dialog-status', 'closed');
      }
      const panel = getPanel(dialogEl);
      if (panel) {
        if (!panel.hasAttribute('aria-hidden')) panel.setAttribute('aria-hidden', 'true');
        if (!panel.hasAttribute('data-lenis-prevent')) panel.setAttribute('data-lenis-prevent', '');
      }
    });
  }

  // -----------------------------
  // Event delegation (attach once)
  // -----------------------------

  document.addEventListener('click', (e) => {
    const openTrigger = e.target.closest('[data-dialog-open]');
    if (openTrigger) {
      const dialogEl = findDialogFromTrigger(openTrigger);
      if (dialogEl) {
        e.preventDefault();
        open(dialogEl, openTrigger);
        return;
      }
    }
    const closeTrigger = e.target.closest('[data-dialog-close]');
    if (closeTrigger && (!activeDialog || activeDialog.contains(closeTrigger))) {
      e.preventDefault();
      close();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!activeDialog) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      trapFocus(e);
    }
  });

  document.addEventListener('barba:pageVisible', (e) => {
    reset();
    prepDialogs(e.detail?.container);
  });

  prepDialogs(document);

  window.dialog = {
    open: (idOrEl) => {
      const target = typeof idOrEl === 'string' ? findDialog(idOrEl) : (idOrEl?.closest?.('[data-dialog]') || idOrEl);
      open(target, document.activeElement);
    },
    close,
    isOpen: () => !!activeDialog,
  };
}

function dialog() {
  initDialog();
}

export default dialog;
