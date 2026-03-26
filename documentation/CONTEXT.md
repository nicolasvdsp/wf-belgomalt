# Project Dev Context Template

Use this file at the start of a new chat to skip project discovery and jump straight into implementation.

> Replace placeholders in brackets (`[like-this]`) with project-specific values.

---

## Project Overview

- Project name: `[project-name]`
- Project type: `[marketing site / product site / web app / other]`
- Primary platform: `[Webflow / custom frontend / hybrid]`
- Short description: `[1-3 lines describing scope and goals]`

---

## Tools & MCPs

List the MCPs and tool usage rules for this project.

- **Webflow MCP bridge**
  - Required state: Webflow Designer tab open, active, and not idle/backgrounded.
  - Site ID: `[webflow-site-id]`
  - Rules: no CSS shorthand in style calls; prefer longhand (`margin-top`, `padding-left`, etc.).
- **Figma MCP**
  - File/team: `[figma-file-or-team]`
  - Preferred workflow: use design context + screenshot tools together.
  - Notes location: `[where dev notes are kept in Figma]`
- **Other MCPs**
  - `[mcp-name]`: `[usage rules / auth / constraints]`

General preference: reuse existing variables/styles/components before creating new ones.

---

## Tech Stack

| Layer | Tool / Approach |
|---|---|
| Layout & styles | Webflow (via MCP) |
| Custom JS | Vanilla ES modules in `src/features/` |
| Custom CSS | SCSS in `src/scss/components/` |
| Animations | GSAP + ScrollTrigger (`window.gsap`)  |
| Page transitions | Barba.js |
| Build | Vite (via `npm run dev`) |

---

## Naming Convention

Finsweet **Client First** strategy throughout:

- Sections: `section_[name]` (e.g. `section_services`). This is the outer wrapper of a section.
- Global paddings, and max widths: `padding-global` and `container`can be used (all as a separate div as a child of the previous one, in this order, present if required by the design) to handle a global padding left and right and the max width respectively. Those should be applied on all sections to guarantee consitency, and to have a single source of truth. Sections requiring to touch the sides of the viewports (like a marquee) or that should always grow with the screen width (some hero sections) should not have a wrapper with the respective class. Most sections, however, do need both.
- Components: `[name]_component`. This will contain actuall content. Between sections and 
- Boilerplate for a section: `.section_[name]` > `.padding-global` > `.container` > `.padding-section-[small/medium/large]` > `[name]_component` > ...
- Behaviour of components: If a specific max-width, align center, ... is required for an element, it may be that a dedicated wrapper-class exists for this. (e.g. if `<div.services_content>` needs to have a max width of 5 rem, instead of giving that styling to the `.services_content` class, wrap it in a div with class `.max-width-medium`)
- Child elements: `[name]_[element]` (e.g. `services_list-header-item`)
- State classes: `is-active`, `is-open`, `is-visible` (always combo classes, never standalone)
- JS hooks: **data-attributes preferred** (e.g. `data-services-item="0"`), with hardcoded fallbacks in JS
- Padding / margin wrappers follow Client First: `.padding-[top/bottom/horizontal/vertical] .padding-[small/smedium/medium/large/xlarge/...]` > `[the element that needs the padding or margin]`. Same patterns goes for margin (`.margin-bottom .margin-small`)

---

## JS Feature Pattern

Every feature lives in `src/features/[feature-name].js` and follows this exact boilerplate:

```js
function initFeatureName(container) {
  container = container || document;

  const items = container.querySelectorAll('[data-feature-name]');
  if (!items.length) return;

  // feature logic here
}

function featureName() {
  document.addEventListener('barba:afterEnter', (e) => {
    initFeatureName(e.detail.container);
  });
}

export default featureName;
```

See `src/features/custom-feature.js` for the annotated boilerplate reference.

---

## Adding a New Feature — Checklist

1. Create `src/features/[feature-name].js` using the pattern above
2. Create `src/scss/components/_[feature-name].scss` for any custom CSS
3. Add `@use 'components/[feature-name]';` to `src/scss/app.scss`
4. Add `featureName: true` to `INCLUDE_FEATURES` in `src/config.js`
5. Add `import featureName from './features/[feature-name]';` to `src/main.js`
6. Add `ACTIVE_FEATURES.featureName && featureName();` inside `initFeatures()` in `src/main.js`

---

## Feature Flag System

Features can be toggled in two ways:

- `src/config.js` — default flags (`INCLUDE_FEATURES` object)
- Script tag attributes — override at the HTML level: `<script src="main.min.js" featureName></script>`

If no attributes are present on the script tag, `config.js` values are used.

---

## SCSS Structure

```text
src/scss/
  app.scss
  components/
    _[component-a].scss
    _[component-b].scss
```

Guideline: custom CSS should only cover what cannot be done cleanly in the visual builder or design system layer.

---

## Key CSS Patterns

Keep only patterns that should be reused across projects. Add/remove as needed.

- Prefer `overflow: clip` over `overflow: hidden` when sticky descendants must remain functional.
- For SVG gradient fills, define reusable `<defs>` once and reference via `url(#id)`; avoid wrappers that break gradient resolution in target browsers.
- Guard frontend-only visual behavior from editor/designer modes when needed.

Project-specific CSS gotchas:

- `[gotcha-1]`
- `[gotcha-2]`

---

## Current Feature Inventory

This template already includes the following features/modules. In a new project, update this list to match what is kept, removed, or added.

| Feature | File/Folder | Notes |
|---|---|---|
| Page transitions | `src/features/page-transitions/` | Barba-based transition layer |
| Parallax | `src/features/parallax.js` | Scroll-based parallax behavior |
| Marquee | `src/features/marquee.js` | Continuous marquee interactions |
| Animations core | `src/features/animations/` | GSAP setup and animation helpers |
| Scroll behaviour | `src/features/scroll-behaviour/` | Scroll orchestration and Lenis integration |
| Text effects | `src/features/text-scramble.js`, `src/features/text-stagger.js` | Text animation utilities |
| UI interactions | `src/features/faq.js`, `src/features/glossary.js`, `src/features/micro-interactions.js` | Common interactive modules |
| Video helpers | `src/features/videos/` | Vimeo background and advanced controls |
| Breakpoints and utilities | `src/features/breakpoints.js`, `src/features/utilities.js` | Shared helpers and responsive logic |
| Feature boilerplate | `src/features/custom-feature.js` | Reference scaffold for new features |

---

## Reduced Motion

All animations and transitions must respect `prefers-reduced-motion: reduce`.

- Use `window.matchMedia('(prefers-reduced-motion: reduce)').matches`.
- Replace motion sequences with immediate state changes when reduced motion is enabled.
- Apply this consistently across transitions, scroll effects, and micro-interactions.

---

## Developer Preferences

Set preferences that should guide all implementation decisions for this project.

- JS hooks: `[data-attributes / class hooks / hybrid]`
- DOM injection policy: `[allowed / avoid when embed can do it]`
- CSS strategy: `[minimal custom CSS / utility-first / other]`
- Interaction defaults: `[hover policy, motion defaults, accessibility baseline]`
- Design handoff expectations: `[where to read notes, required screenshots/context]`
- Testing/verification standard: `[manual QA list / automated checks]`

---

## Quick Start for New Agent Chats

When starting a fresh task:

1. Read this file first.
2. Confirm MCP/tool prerequisites are met.
3. Validate current architecture paths (`src/features`, `src/scss`, config/bootstrap files).
4. Implement using existing conventions before introducing new patterns.
5. Document any new project-specific rules back into this file.
