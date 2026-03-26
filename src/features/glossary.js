/**
 * Glossary Component
 * 
 * Grouped A-Z + search + highlight + nav disable
 * Supports 2 letter-nav modes:
 * 1) Default: <a href="#D">
 * 2) Lenis-mode: elements with [data-anchor-target="#D"]
 * Toggle on the letter list wrapper: data-glossary-lenis="true" (default false)
 *
 * 100+ items: set data-glossary-load-all="true" on [data-glossary-init].
 * Requires Webflow pagination enabled on the Collection List. No Finsweet needed.
 */

function initGlossary() {
  const ITEMS_PER_PAGE = 100;

  // ---------------------------------------------------------------------------
  // Load all pages (helper) — runs first when data-glossary-load-all="true"
  // ---------------------------------------------------------------------------

  function getPageParamFromRoot(root) {
    const explicit = root.getAttribute("data-glossary-page-param");
    if (explicit && explicit.trim()) return explicit.trim();
    const link = root.querySelector('a[href*="_page="]');
    if (!link) return null;
    const href = link.getAttribute("href") || "";
    const match = href.match(/([a-z0-9]+_page)=/i);
    return match ? match[1] : null;
  }

  function getPageUrl(pageNum, paramName) {
    const url = new URL(window.location.href);
    url.searchParams.set(paramName, String(pageNum));
    return url.toString();
  }

  function fetchPageItems(pageNum, paramName, listIndex, itemSelector) {
    const url = getPageUrl(pageNum, paramName);
    return fetch(url, { credentials: "same-origin" })
      .then((res) => res.text())
      .then((html) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const lists = doc.querySelectorAll("[data-glossary-init] .glossary-list_list");
        const listEl = lists[listIndex];
        if (!listEl) return [];
        return Array.from(listEl.querySelectorAll(itemSelector));
      });
  }

  function loadAll(root, listIndex) {
    const list = root.querySelector(".glossary-list_list");
    if (!list) return Promise.resolve();

    const loadAllEnabled = (root.getAttribute("data-glossary-load-all") || "").toLowerCase() === "true";
    if (!loadAllEnabled) return Promise.resolve();

    const paramName = getPageParamFromRoot(root);
    if (!paramName) return Promise.resolve();

    const itemSelector = ":scope > .glossary-list_item";
    let pageNum = 2;

    function fetchNext() {
      return fetchPageItems(pageNum, paramName, listIndex, itemSelector).then((items) => {
        if (items.length === 0) return;
        items.forEach((item) => {
          const clone = document.importNode(item, true);
          list.appendChild(clone);
        });
        if (items.length >= ITEMS_PER_PAGE) {
          pageNum += 1;
          return fetchNext();
        }
      });
    }

    return fetchNext().then(() => {
      const pagination = root.querySelector("[data-glossary-pagination]");
      if (pagination) pagination.style.display = "none";
      const firstLink = root.querySelector('a[href*="_page="]');
      if (firstLink && !pagination) {
        const wrapper = firstLink.closest(".w-pagination-wrapper") || firstLink.parentElement;
        if (wrapper) wrapper.style.display = "none";
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Setup one glossary instance (grouping, filtering, nav, keyboard)
  // ---------------------------------------------------------------------------

  function initInstance(root) {
    const list = root.querySelector(".glossary-list_list");
    if (!list) return;

    const sourceItems = Array.from(list.querySelectorAll(":scope > .glossary-list_item"));
    if (!sourceItems.length) return;

    const inputs = Array.from(root.querySelectorAll("input[data-glossary-filter], textarea[data-glossary-filter]"));
    const highlightEnabled =
      (root.getAttribute("data-glossary-match-highlight") || "false").toLowerCase() === "true";
    const emptyState = root.querySelector("[data-glossary-filter-empty]");

    // — Helpers —
    const normalizeLetter = (v) => {
      const s = (v || "").trim().toUpperCase();
      return /^[A-Z]$/.test(s) ? s : "#";
    };
    const anchorId = (letter) => (letter === "#" ? "hash" : letter);
    const normalizeText = (str) =>
      (str || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const normalizeQuery = (q) => normalizeText(q).trim();
    const splitKeys = (raw) =>
      (raw || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    function debounce(fn, wait = 120) {
      let t;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
      };
    }
    function escapeHtml(str) {
      return (str || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }
    function highlightHtml(text, query) {
      const q = (query || "").trim();
      if (!q) return escapeHtml(text);
      const escapedText = escapeHtml(text);
      const escapedQ = escapeHtml(q);
      const safeQ = escapedQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(${safeQ})`, "gi");
      return escapedText.replace(re, "<mark>$1</mark>");
    }
    function showEmpty() {
      if (emptyState) emptyState.style.display = "block";
    }
    function hideEmpty() {
      if (emptyState) emptyState.style.display = "none";
    }

    // — Letter nav disable —
    function getNavRoot() {
      return document.querySelector("[data-glossary-letter-list]");
    }
    function isDisableFeatureOn(navRoot) {
      return (navRoot?.getAttribute("data-glossary-disable") || "false").toLowerCase() === "true";
    }
    function isLenisMode(navRoot) {
      return (navRoot?.getAttribute("data-glossary-lenis") || "false").toLowerCase() === "true";
    }
    function getLetterTriggers(navRoot) {
      if (!navRoot) return [];
      return isLenisMode(navRoot)
        ? Array.from(navRoot.querySelectorAll("[data-anchor-target]"))
        : Array.from(navRoot.querySelectorAll("a[href^='#']"));
    }
    function normalizeNavLetter(raw) {
      const s = (raw || "").trim().toUpperCase();
      return /^[A-Z]$/.test(s) ? s : "#";
    }
    function updateDisabledLetters(availableLettersSet) {
      const navRoot = getNavRoot();
      if (!navRoot) return;
      const disableOn = isDisableFeatureOn(navRoot);
      const triggers = getLetterTriggers(navRoot);
      triggers.forEach((el) => {
        const fromAttr = el.getAttribute("data-glossary-letter");
        let letter = fromAttr ? fromAttr : (el.textContent || "");
        letter = normalizeNavLetter(letter);
        const enabled = availableLettersSet.has(letter);
        if (!disableOn) {
          el.classList.remove("is-disabled");
          el.setAttribute("aria-disabled", "false");
          el.removeAttribute("tabindex");
          return;
        }
        el.classList.toggle("is-disabled", !enabled);
        el.setAttribute("aria-disabled", enabled ? "false" : "true");
        if (!enabled) el.setAttribute("tabindex", "-1");
        else el.removeAttribute("tabindex");
      });
    }

    // — Cache originals + per-item index —
    const originals = new WeakMap();
    const index = new WeakMap();
    sourceItems.forEach((item) => {
      const perEl = new Map();
      item.querySelectorAll("[data-glossary-filter]").forEach((el) => {
        perEl.set(el, { text: el.textContent || "" });
      });
      originals.set(item, perEl);
      const perKey = new Map();
      item.querySelectorAll("[data-glossary-filter]").forEach((el) => {
        const key = (el.getAttribute("data-glossary-filter") || "").trim();
        if (!key) return;
        const prev = perKey.get(key) || "";
        const combined = (prev + " " + (el.textContent || "")).trim();
        perKey.set(key, normalizeText(combined));
      });
      index.set(item, perKey);
    });

    function restoreItemText(item) {
      const perEl = originals.get(item);
      if (!perEl) return;
      perEl.forEach((val, el) => {
        el.textContent = val.text;
      });
    }
    function applyHighlight(item, queryRaw, keysToHighlight) {
      restoreItemText(item);
      if (!highlightEnabled) return;
      const q = (queryRaw || "").trim();
      if (!q) return;
      const allowed = new Set(keysToHighlight || []);
      const perEl = originals.get(item);
      if (!perEl) return;
      perEl.forEach((val, el) => {
        const key = (el.getAttribute("data-glossary-filter") || "").trim();
        if (!key) return;
        if (allowed.size && !allowed.has(key)) return;
        el.innerHTML = highlightHtml(val.text, q);
      });
    }

    // — Render grouped —
    function render(itemsToRender, queryRawForHighlight = "", keysForHighlight = []) {
      const frag = document.createDocumentFragment();
      const groups = new Map();
      list.innerHTML = "";

      if (!itemsToRender.length) {
        showEmpty();
        updateDisabledLetters(new Set());
        return;
      }
      hideEmpty();

      itemsToRender.forEach((item) => {
        const letter = normalizeLetter(item.getAttribute("data-letter"));
        const existingBadge = item.querySelector(":scope > .glossary-list_badge");
        if (existingBadge) existingBadge.remove();
        applyHighlight(item, queryRawForHighlight, keysForHighlight);

        if (!groups.has(letter)) {
          const group = document.createElement("div");
          group.className = "glossary-list_group";
          group.setAttribute("data-group-letter", letter);
          group.id = anchorId(letter);
          const badge = document.createElement("div");
          badge.className = "glossary-list_badge";
          const badgeText = document.createElement("span");
          badgeText.className = "glossary-list_badge-text";
          badgeText.textContent = letter;
          badge.appendChild(badgeText);
          const itemsWrap = document.createElement("div");
          itemsWrap.className = "glossary-list_group-items";
          group.appendChild(badge);
          group.appendChild(itemsWrap);
          groups.set(letter, itemsWrap);
          frag.appendChild(group);
        }
        item.style.display = "block";
        groups.get(letter).appendChild(item);
      });

      updateDisabledLetters(new Set(Array.from(groups.keys())));
      list.appendChild(frag);
    }

    // — Filtering —
    function itemMatches(item, queryNormalized, keys) {
      if (!queryNormalized) return true;
      const perKey = index.get(item);
      if (!perKey) return false;
      for (const key of keys) {
        const hay = perKey.get(key);
        if (hay && hay.includes(queryNormalized)) return true;
      }
      return false;
    }
    function applyAllFilters() {
      const active = inputs
        .map((inp) => {
          const keys = splitKeys(inp.getAttribute("data-glossary-filter"));
          const qRaw = inp.value || "";
          const qNorm = normalizeQuery(qRaw);
          return { inp, keys, qRaw, qNorm };
        })
        .filter((f) => f.keys.length);
      const anyQuery = active.some((f) => f.qNorm);
      if (!anyQuery) {
        render(sourceItems, "", []);
        return;
      }
      const filtered = sourceItems.filter((item) => active.every((f) => itemMatches(item, f.qNorm, f.keys)));
      const primary = active.find((f) => f.qNorm) || { qRaw: "", keys: [] };
      render(filtered, primary.qRaw, primary.keys);
    }

    // — Init instance —
    render(sourceItems, "", []);
    const onAnyInput = debounce(() => applyAllFilters(), 120);
    inputs.forEach((inp) => inp.addEventListener("input", onAnyInput));
    inputs.forEach((inp) => {
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          inp.value = "";
          applyAllFilters();
          inp.blur();
        }
      });
    });
    if (inputs[0]) {
      document.addEventListener("keydown", (e) => {
        const isK = (e.key || "").toLowerCase() === "k";
        if ((e.metaKey || e.ctrlKey) && isK) {
          const tag = (document.activeElement?.tagName || "").toLowerCase();
          if (tag === "input" || tag === "textarea") return;
          e.preventDefault();
          inputs[0].focus();
          inputs[0].select();
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Run: load all (when enabled) then init each instance
  // ---------------------------------------------------------------------------

  const instances = Array.from(document.querySelectorAll("[data-glossary-init]"));
  if (!instances.length) return;

  Promise.all(instances.map((root, i) => loadAll(root, i))).then(() => {
    instances.forEach(initInstance);
  });
}

// Export initialization function (DOM ready is handled in main.js)
function glossary() {
  initGlossary();
}

export default glossary;