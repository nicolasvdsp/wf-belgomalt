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

## Origino → Webflow Sync (Netlify Function)

A Netlify Function lives at `netlify/functions/origino-sync.js` and pushes content from Origino (or, for now, a hardcoded fixture) into the Webflow CMS via the Data API. Webflow renders the resulting pages server-side, so the QR-code landing pages don't need any client-side fetches at runtime.

### One-time manual setup

Before the function can run end-to-end:

1. **Create a Webflow Site API token** in Workspace settings → Integrations → API access. Give it the `CMS:read` and `CMS:write` scopes.
2. **Create the target Webflow collection** (e.g. "Beers") with the fields the page needs (`name`, `slug`, `brewery`, `style`, `description`, `story`, `ingredients`, `qr-batch`, `abv`, `ibu`, `main-image`).
3. **Add a Plain text field** named **`Origino ID`** to that collection (Webflow will give it the slug `origino-id`). Mark it as **required** and **unique**. This is the idempotency anchor — without it, every webhook would create a duplicate.
4. **Set environment variables**, both in Netlify (Site settings → Environment variables) and in a local `.env` for `netlify dev`:

   | Variable | Description |
   |---|---|
   | `WEBFLOW_API_TOKEN` | Site API token from step 1 |
   | `WEBFLOW_SITE_ID` | `69c533332e45232278dbfe34` |
   | `WEBFLOW_COLLECTION_ID` | ID of the Webflow collection from step 2 |
   | `SYNC_WEBHOOK_SECRET` | Self-generated random string, sent in `x-sync-secret` header |

### Local development

```bash
npm install -g netlify-cli   # one-time
netlify dev                  # serves the function alongside Vite
```

Trigger a sync against the fixture in [fixtures/origino-beer.sample.json](fixtures/origino-beer.sample.json):

```bash
curl -X POST http://localhost:8888/.netlify/functions/origino-sync \
  -H "x-sync-secret: $SYNC_WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d @fixtures/origino-beer.sample.json
```

Re-running the same command updates the existing item (idempotent). Switch the fixture's `"action"` to `"delete"` to remove it.

### Endpoint contract

`POST /.netlify/functions/origino-sync`

```json
{
  "action": "upsert" | "delete",
  "originoId": "abc-123",
  "payload": { "...": "Origino item; ignored when action=delete" }
}
```

Required header: `x-sync-secret: <SYNC_WEBHOOK_SECRET>` (constant-time compared).

Response: `200 { ok: true, action, originoId, webflowItemId }` on success, or `4xx/5xx { ok: false, error, ... }` on failure.

### File map

| File | Purpose |
|---|---|
| [netlify/functions/origino-sync.js](netlify/functions/origino-sync.js) | HTTP entrypoint, secret check, action dispatch |
| [netlify/lib/config.js](netlify/lib/config.js) | Env-var loading + validation |
| [netlify/lib/webflow-client.js](netlify/lib/webflow-client.js) | Wrapper around `webflow-api` SDK (list/create/update/delete) |
| [netlify/lib/mapper.js](netlify/lib/mapper.js) | `mapOriginoToWebflow()` — the one piece that changes when Origino's real payload lands |
| [fixtures/origino-beer.sample.json](fixtures/origino-beer.sample.json) | Stand-in payload until Origino webhook contract is finalized |

### Out of scope (future phases)

Real Origino webhook signature verification, initial backfill of existing items, nightly reconciliation cron, asset/image upload pipeline, multi-collection routing.

## License

MIT
