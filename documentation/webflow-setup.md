# Webflow Setup Instructions

← [Back to README](../README.md)

## 1. Add CDN Dependencies (optional)

If your project uses external libraries (GSAP, Three.js, etc.), add them in Webflow's **Custom Code** section (Before `</body>` tag):

```html
<!-- GSAP Core -->
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/ScrollTrigger.min.js"></script>

<!-- Three.js (if needed) -->
<script src="https://cdn.jsdelivr.net/npm/three@0.160/build/three.min.js"></script>

<!-- jQuery (if needed) -->
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
```

> Only include the libraries your project actually uses.

## 2. Add Your Bundle

Add this **after** the CDN scripts in the same Custom Code section:

```html
<script src="https://MY-PROJECT.netlify.app/main.min.js"></script>
```

That's it. No loader script, no inline code, no configuration needed in Webflow.

### Optional: Feature Selection via Attributes

To selectively enable features, add attributes to the script tag:

```html
<script src="https://MY-PROJECT.netlify.app/main.min.js" breakpoints glossary></script>
```

If no attributes are provided, all features from `src/config.js` are loaded.

## 3. How It Works

The loader logic is built into the bundle itself. It automatically detects the environment:

| Environment | What happens |
|---|---|
| **Production** (custom domain) | Runs the bundled code immediately. Zero overhead. |
| **Staging** (`.webflow.io`) + `npm run dev` | Detects localhost dev server → loads dev version with HMR. |
| **Staging** (`.webflow.io`) without dev server | Falls back to bundled code. |

No manual toggles. No changes needed between development and production.

## 4. Development Workflow

1. **Start the dev server:**
   ```bash
   npm run dev
   ```
   This starts Vite on `localhost:3011`.

2. **Open your Webflow staging site** (`your-project.webflow.io`)

3. The bundle detects it's on staging and that localhost is running → loads your local code with Hot Module Replacement (HMR). Changes you save are reflected instantly.

4. **When you're done developing:**
   ```bash
   npm run build
   ```

5. **Push to GitHub** → Netlify auto-deploys → your production site uses the new bundle.

## 5. Feature Configuration

Edit `src/config.js` to enable/disable features:

```javascript
export const INCLUDE_FEATURES = {
  animations: true,
  scrollBehaviour: true,
  breakpoints: true,
  glossary: true,
  // myNewFeature: false,
}
```

## 6. Dev Server Port

The dev server port (`3011`) is configured in two places:
- `src/loader.js` → `DEV_PORT`
- `vite.config.js` → `server.port`

When cloning this template for a new project, change both to a unique port (e.g., `3012`, `3013`) to avoid conflicts when working on multiple projects simultaneously.

## 7. Alternative: Inline Loader (not recommended)

If you ever need the loader as a separate inline script in Webflow instead of built into the bundle, see [`inline_loader_script.js`](inline_loader_script.js) for reference.

← [Back to README](../README.md)
