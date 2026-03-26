# Webflow Custom JavaScript Template

A modern, scalable template for adding custom JavaScript to Webflow projects using Vite, ES modules, and optional feature loading.

## Features

- ✅ **Vite-based bundling** — Modern build tool with HMR for development
- ✅ **Zero-config loader** — Auto-detects staging vs production, no manual toggles
- ✅ **CDN-first dependencies** — GSAP, Three.js, etc. loaded from CDN (shared cache)
- ✅ **Feature toggles** — Enable/disable features via config or script tag attributes
- ✅ **SCSS support** — Write styles with modern Sass features
- ✅ **Production-ready** — Minified + unminified builds

## Quick Start

1. `npm install`
2. Configure features in `src/config.js`
3. Add your bundle to Webflow → see [Webflow Setup](documentation/webflow-setup.md)
4. `npm run dev` → open your `.webflow.io` staging site
5. `npm run build` → push to GitHub → Netlify auto-deploys

## Project Structure

```
├── src/
│   ├── main.js                # Entry point
│   ├── loader.js              # Staging/localhost detection
│   ├── config.js              # Feature toggles
│   ├── features/              # Feature modules
│   └── scss/                  # Styles
├── dist/                      # Build output (main.js + main.min.js)
├── documentation/             # Setup guides & reference
│   ├── webflow-setup.md       # Webflow integration guide
│   └── inline_loader_script.js # Legacy inline loader (reference only)
├── vite.config.js             # Vite configuration
└── package.json
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with HMR (port 3011) |
| `npm run build` | Build `main.js` + `main.min.js` to `dist/` |
| `npm run preview` | Preview production build locally |
| `npm run clean` | Clean dist folder |

## Adding New Features

1. Create `src/features/my-feature.js`
2. Add to `src/config.js`
3. Import and call in `src/main.js`

For details on Webflow integration, development workflow, CDN dependencies, feature configuration, and dev server port setup, see the **[Webflow Setup Guide](documentation/webflow-setup.md)**.

## License

MIT
