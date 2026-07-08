/**
 * Reads and validates env vars required by the Origino -> Webflow sync.
 * Call `loadConfig()` once per function invocation; it throws a descriptive
 * error listing every missing variable so misconfiguration fails loudly.
 *
 * Three collection IDs are required — one per CMS collection in the
 * 3-collection architecture (Beers/unlock as master, Scrollytelling and
 * Quiz as satellites referencing Beers).
 *
 * `ORIGINO_LIST_URL` accepts an HTTP(S) URL for the live endpoint or a
 * `file://` URI pointing at a JSON snapshot for offline testing.
 */

const REQUIRED_VARS = [
  'WEBFLOW_API_TOKEN',
  'WEBFLOW_SITE_ID',
  'WEBFLOW_COLLECTION_UNLOCK_ID',
  'WEBFLOW_COLLECTION_SCROLLY_ID',
  'WEBFLOW_COLLECTION_QUIZ_ID',
  'SYNC_WEBHOOK_SECRET',
  'ORIGINO_LIST_URL',
];

function loadConfig(env = process.env) {
  const missing = REQUIRED_VARS.filter((key) => !env[key] || !String(env[key]).trim());

  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missing.join(', ')}. ` +
        `Set them in Netlify (Site settings -> Environment variables) and in a local .env for netlify dev.`
    );
  }

  return {
    webflow: {
      apiToken: env.WEBFLOW_API_TOKEN,
      siteId: env.WEBFLOW_SITE_ID,
      collections: {
        unlock: env.WEBFLOW_COLLECTION_UNLOCK_ID,
        scrolly: env.WEBFLOW_COLLECTION_SCROLLY_ID,
        quiz: env.WEBFLOW_COLLECTION_QUIZ_ID,
      },
    },
    syncSecret: env.SYNC_WEBHOOK_SECRET,
    origino: {
      listUrl: env.ORIGINO_LIST_URL,
    },
  };
}

module.exports = { loadConfig };
