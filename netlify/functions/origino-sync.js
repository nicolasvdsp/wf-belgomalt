/**
 * Origino -> Webflow CMS sync endpoint.
 *
 * Accepts a JSON body of the form:
 *   { action: 'upsert' | 'delete', originoId: string, payload?: object }
 *
 * Authenticated with a shared secret in the `x-sync-secret` header. The
 * endpoint is intentionally simple: it validates input, looks up the matching
 * Webflow item by `origino-id`, and dispatches to create/update/delete.
 *
 * The Origino-specific shape lives entirely in `lib/mapper.js`; everything
 * else here is reusable once the real Origino webhook contract lands.
 */

const { loadConfig } = require('../lib/config');
const {
  createWebflowClient,
  findItemByOriginoId,
  createItem,
  updateItem,
  deleteItem,
} = require('../lib/webflow-client');
const { mapOriginoToWebflow } = require('../lib/mapper');

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

function logEvent(level, fields) {
  const line = JSON.stringify({ level, ts: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

exports.handler = async (event) => {
  const startedAt = Date.now();

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'method-not-allowed' });
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    logEvent('error', { event: 'config_error', message: err.message });
    return jsonResponse(500, { ok: false, error: 'server-misconfigured' });
  }

  const providedSecret = event.headers?.['x-sync-secret'] || event.headers?.['X-Sync-Secret'];
  if (!timingSafeEqual(providedSecret || '', config.syncSecret)) {
    logEvent('warn', { event: 'auth_failed' });
    return jsonResponse(401, { ok: false, error: 'unauthorized' });
  }

  let body;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    return jsonResponse(400, { ok: false, error: 'invalid-json' });
  }

  if (!body || typeof body !== 'object') {
    return jsonResponse(400, { ok: false, error: 'missing-body' });
  }

  const { action, originoId, payload } = body;

  if (!originoId || typeof originoId !== 'string') {
    return jsonResponse(400, { ok: false, error: 'missing-originoId' });
  }

  if (action !== 'upsert' && action !== 'delete') {
    return jsonResponse(400, { ok: false, error: 'invalid-action' });
  }

  const client = createWebflowClient({ apiToken: config.webflow.apiToken });
  const collectionId = config.webflow.collectionId;

  try {
    const existing = await findItemByOriginoId(client, { collectionId, originoId });

    if (action === 'delete') {
      if (!existing) {
        logEvent('info', { event: 'delete_noop', originoId, durationMs: Date.now() - startedAt });
        return jsonResponse(200, { ok: true, action: 'delete-noop', originoId });
      }

      await deleteItem(client, { collectionId, itemId: existing.id });
      logEvent('info', {
        event: 'delete_ok',
        originoId,
        webflowItemId: existing.id,
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse(200, { ok: true, action: 'delete', originoId, webflowItemId: existing.id });
    }

    const fieldData = mapOriginoToWebflow(payload, originoId);

    if (existing) {
      const updated = await updateItem(client, {
        collectionId,
        itemId: existing.id,
        fieldData,
      });
      logEvent('info', {
        event: 'update_ok',
        originoId,
        webflowItemId: existing.id,
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse(200, {
        ok: true,
        action: 'update',
        originoId,
        webflowItemId: updated?.id || existing.id,
      });
    }

    const created = await createItem(client, { collectionId, fieldData });
    logEvent('info', {
      event: 'create_ok',
      originoId,
      webflowItemId: created?.id,
      durationMs: Date.now() - startedAt,
    });
    return jsonResponse(200, {
      ok: true,
      action: 'create',
      originoId,
      webflowItemId: created?.id,
    });
  } catch (err) {
    const status = err?.statusCode || err?.status;
    logEvent('error', {
      event: 'sync_error',
      originoId,
      action,
      status,
      message: err?.message,
      body: err?.body,
      durationMs: Date.now() - startedAt,
    });

    if (status >= 400 && status < 500) {
      return jsonResponse(status, {
        ok: false,
        error: 'webflow-rejected',
        status,
        message: err?.message,
        details: err?.body,
      });
    }

    return jsonResponse(502, { ok: false, error: 'webflow-upstream-failure' });
  }
};
