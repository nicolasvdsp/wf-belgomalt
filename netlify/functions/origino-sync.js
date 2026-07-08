/**
 * Origino -> Webflow CMS sync — HTTP entrypoint (manual triggers).
 *
 * The scheduled counterpart lives in `origino-sync-cron.js`; both share
 * the same runner logic in `netlify/lib/runner.js`. Splitting is
 * required because Netlify's runtime discards the HTTP response of a
 * scheduled function.
 *
 * Modes
 *   POST + empty body                              → sync everything
 *   POST + { originoId: "..." }                    → sync one lot only
 *   POST + { action: "delete", originoId: "..." }  → remove one lot
 *
 * Auth: shared secret in the `x-sync-secret` header.
 */

const { loadConfig } = require('../lib/config');
const { runSync, runDelete } = require('../lib/runner');

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function parseBodySafe(body) {
  if (!body) return null;
  if (typeof body !== 'string') return body;
  if (!body.trim()) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'method-not-allowed' });
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    return jsonResponse(500, { ok: false, error: 'server-misconfigured', message: err.message });
  }

  const providedSecret =
    event.headers?.['x-sync-secret'] || event.headers?.['X-Sync-Secret'];
  if (!timingSafeEqual(providedSecret || '', config.syncSecret)) {
    return jsonResponse(401, { ok: false, error: 'unauthorized' });
  }

  const body = parseBodySafe(event.body);

  if (body?.action === 'delete') {
    if (!body.originoId || typeof body.originoId !== 'string') {
      return jsonResponse(400, { ok: false, error: 'missing-originoId' });
    }
    const result = await runDelete({ mode: 'manual', config, originoId: body.originoId });
    const status = result.ok ? 200 : (result.status >= 400 && result.status < 500 ? result.status : 502);
    return jsonResponse(status, result);
  }

  const result = await runSync({
    mode: 'manual',
    config,
    originoIdFilter: body?.originoId || null,
  });

  const status = result.ok ? 200 : (result.error === 'origino-id-not-found' ? 404 : 502);
  return jsonResponse(status, result);
};
