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

A Netlify Function at `netlify/functions/origino-sync.js` pulls every lot from the Origino list endpoint and mirrors it into three Webflow CMS collections. Webflow then renders the resulting QR-code landing pages server-side, so visitors get a fully static-feeling experience with zero client-side data fetching.

### 3-Collection architecture

| Collection | Role | Synced from Origino | Hand-managed fields |
|---|---|---|---|
| **Beers** (master) | QR landing / unlock screen | name, slug, brewery, batch, brewing date, malt %, CO2, beer logo, beer image, raw JSON | `beer---cap` |
| **Scrollytelling** (refs Beers) | Journey map experience | journey JSON (with resolved logos), water / hops / yeast quotes | `grains---description` |
| **Quiz** (refs Beers) | Quiz game experience | placeholder linked back to Beers | `quiz-data---json` (all quiz content) |

Upsert order: Beers → Scrollytelling → Quiz (master first, so satellites can reference it).
Delete order: Quiz → Scrollytelling → Beers (satellites first, no dangling refs).

Each collection carries its own `origino-id` (= Origino `id_lot`) for idempotent lookup.

### Triggers

Two thin function entrypoints share the same runner in [netlify/lib/runner.js](netlify/lib/runner.js). They're split because Netlify's runtime discards the HTTP response body of a scheduled function.

1. **Scheduled** — `origino-sync-cron` runs every 6 hours (see `netlify.toml`). No auth; Netlify is the only caller. Response is discarded — logs are the only observable output.
2. **Manual HTTP POST (full sync)** — POST empty body to `origino-sync`.
3. **Manual HTTP POST (single lot)** — POST `{ "originoId": "317" }` to `origino-sync`.
4. **Manual HTTP POST (delete)** — POST `{ "action": "delete", "originoId": "317" }` to `origino-sync`.

HTTP invocations require an `x-sync-secret` header that matches `SYNC_WEBHOOK_SECRET`.

### Asset pipeline

Every image URL returned by Origino is an S3 signed URL that expires after 15 minutes. The sync downloads each one, uploads to Webflow Assets, and caches the resulting `{ fileId, url }` in [Netlify Blobs](https://docs.netlify.com/blobs/overview/) keyed by the upstream sha256 checksum — so subsequent syncs reuse the upload without re-downloading. This applies to `beer_logo`, `beer_image`, and every `journey[].logo`. The Webflow API token therefore needs `assets:read` + `assets:write` scopes in addition to CMS.

### One-time manual setup

1. **Create a Webflow Site API token** in Workspace settings → Integrations → API access with these scopes: `cms:read`, `cms:write`, `sites:read`, `assets:read`, `assets:write`.
2. **Set environment variables**, both in Netlify (Site settings → Environment variables) and in a local `.env` for `netlify dev`:

   | Variable | Description |
   |---|---|
   | `WEBFLOW_API_TOKEN` | Site API token from step 1 |
   | `WEBFLOW_SITE_ID` | Site ID from Webflow → Site settings |
   | `WEBFLOW_COLLECTION_UNLOCK_ID` | ID of the Beers (unlock/master) collection |
   | `WEBFLOW_COLLECTION_SCROLLY_ID` | ID of the Scrollytelling collection |
   | `WEBFLOW_COLLECTION_QUIZ_ID` | ID of the Quiz collection |
   | `SYNC_WEBHOOK_SECRET` | Self-generated random string, sent in `x-sync-secret` header |
   | `ORIGINO_LIST_URL` | Origino list endpoint, or `file://...` for offline tests |

### Local development

```bash
npm install -g netlify-cli   # one-time
netlify dev                  # serves the function alongside Vite
```

Run a full sync (everything not already skipped):

```bash
curl -X POST http://localhost:8888/.netlify/functions/origino-sync \
  -H "x-sync-secret: $SYNC_WEBHOOK_SECRET"
```

Sync a single lot:

```bash
curl -X POST http://localhost:8888/.netlify/functions/origino-sync \
  -H "x-sync-secret: $SYNC_WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d '{"originoId":"317"}'
```

Delete a lot:

```bash
curl -X POST http://localhost:8888/.netlify/functions/origino-sync \
  -H "x-sync-secret: $SYNC_WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d '{"action":"delete","originoId":"317"}'
```

Offline mode: set `ORIGINO_LIST_URL=file://$(pwd)/fixtures/origino-beer.sample.json` to sync from the bundled snapshot without hitting the live endpoint.

### Response shape

```json
{
  "ok": true,
  "mode": "cron" | "manual",
  "total": 6,
  "synced": 1,
  "skipped": 5,
  "errored": 0,
  "durationMs": 1234,
  "results": [
    { "originoId": "317", "unlock": { "action": "update", "id": "..." }, "scrollytelling": { ... }, "quiz": { ... } },
    { "originoId": "252", "skipped": true, "reason": "missing_beer_name" }
  ]
}
```

### File map

| File | Purpose |
|---|---|
| [netlify/functions/origino-sync.js](netlify/functions/origino-sync.js) | HTTP entrypoint (manual triggers): auth, parse, dispatch to runner |
| [netlify/functions/origino-sync-cron.js](netlify/functions/origino-sync-cron.js) | Scheduled entrypoint: no auth, always full sync |
| [netlify/lib/runner.js](netlify/lib/runner.js) | Shared runner used by both entrypoints: fetch, iterate, upsert, delete |
| [netlify/lib/config.js](netlify/lib/config.js) | Env-var loading + validation |
| [netlify/lib/origino.js](netlify/lib/origino.js) | `fetchAllLots()` from the Origino list endpoint |
| [netlify/lib/assets.js](netlify/lib/assets.js) | Origino S3 → Webflow Assets pipeline with Netlify Blobs cache |
| [netlify/lib/mapper.js](netlify/lib/mapper.js) | `mapToUnlock()`, `mapToScrollytelling()`, `mapToQuiz()` for the real Origino shape |
| [netlify/lib/webflow-client.js](netlify/lib/webflow-client.js) | Wrapper around `webflow-api` SDK (list/create/update/delete) |
| [fixtures/origino-beer.sample.json](fixtures/origino-beer.sample.json) | Snapshot of the live Origino list response for offline tests |

### Out of scope (future phases)

Webhook-driven instant sync, orphan reconciliation (mirror mode), automated quiz authoring, locale normalisation.

## License

MIT
