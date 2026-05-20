/**
 * Reads and validates env vars required by the Origino -> Webflow sync.
 * Call `loadConfig()` once per function invocation; it throws a descriptive
 * error listing every missing variable so misconfiguration fails loudly.
 */

const REQUIRED_VARS = [
  'WEBFLOW_API_TOKEN',
  'WEBFLOW_SITE_ID',
  'WEBFLOW_COLLECTION_ID',
  'SYNC_WEBHOOK_SECRET',
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
      collectionId: env.WEBFLOW_COLLECTION_ID,
    },
    syncSecret: env.SYNC_WEBHOOK_SECRET,
  };
}

module.exports = { loadConfig };
