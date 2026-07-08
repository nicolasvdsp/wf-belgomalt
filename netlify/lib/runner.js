/**
 * Shared sync runner used by both entrypoints:
 *
 *   netlify/functions/origino-sync.js       — HTTP (manual triggers)
 *   netlify/functions/origino-sync-cron.js  — Netlify scheduled function
 *
 * Netlify treats a function as either HTTP-triggered OR scheduled — the
 * runtime discards the HTTP response body of a scheduled function and
 * replaces it with a "you can't invoke a scheduled function via HTTP"
 * notice. To support both, we run two thin function files against this
 * one runner.
 *
 * The runner is transport-agnostic: it takes a fully-loaded `config`
 * (from lib/config.js) and returns a structured summary. Callers wrap
 * the return value in whatever response envelope they need.
 *
 * 3-collection orchestration (Beers -> Scrollytelling -> Quiz on
 * upsert, reverse on delete) matches the plan and preserves reference
 * integrity.
 */

const {
  createWebflowClient,
  findItemByOriginoId,
  createItem,
  updateItem,
  deleteItem,
} = require('./webflow-client');
const {
  mapToUnlock,
  mapToScrollytelling,
  mapToQuiz,
  shouldSkipLot,
} = require('./mapper');
const { fetchAllLots } = require('./origino');
const { createAssetResolver } = require('./assets');

function logEvent(level, fields) {
  const line = JSON.stringify({ level, ts: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

// ---------------------------------------------------------------------------
// Per-collection primitives
// ---------------------------------------------------------------------------

async function upsertOne(client, { collectionId, originoId, fieldData }) {
  const existing = await findItemByOriginoId(client, { collectionId, originoId });
  if (existing) {
    const updated = await updateItem(client, {
      collectionId,
      itemId: existing.id,
      fieldData,
    });
    return { action: 'update', id: updated?.id || existing.id };
  }
  const created = await createItem(client, { collectionId, fieldData });
  return { action: 'create', id: created?.id };
}

async function deleteOne(client, { collectionId, originoId }) {
  const existing = await findItemByOriginoId(client, { collectionId, originoId });
  if (!existing) return { action: 'delete-noop', id: null };
  await deleteItem(client, { collectionId, itemId: existing.id });
  return { action: 'delete', id: existing.id };
}

// ---------------------------------------------------------------------------
// Single lot: upsert / delete
// ---------------------------------------------------------------------------

async function syncLot(lot, { client, collections, resolveAsset }) {
  const originoId = String(lot?.id_lot);
  const startedAt = Date.now();
  const failuresBefore = resolveAsset.failures.length;

  const unlockFieldData = await mapToUnlock(lot, resolveAsset);
  const unlockResult = await upsertOne(client, {
    collectionId: collections.unlock,
    originoId,
    fieldData: unlockFieldData,
  });

  const scrollyFieldData = await mapToScrollytelling(lot, unlockResult.id, resolveAsset);
  const scrollyResult = await upsertOne(client, {
    collectionId: collections.scrolly,
    originoId,
    fieldData: scrollyFieldData,
  });

  const quizFieldData = mapToQuiz(lot, unlockResult.id);
  const quizResult = await upsertOne(client, {
    collectionId: collections.quiz,
    originoId,
    fieldData: quizFieldData,
  });

  // Patch unlock with reverse references to satellites
  await updateItem(client, {
    collectionId: collections.unlock,
    itemId: unlockResult.id,
    fieldData: {
      scrollytelling: scrollyResult.id,
      quiz: quizResult.id,
    },
  });

  const assetFailures = resolveAsset.failures.length - failuresBefore;

  return {
    originoId,
    unlock: unlockResult,
    scrollytelling: scrollyResult,
    quiz: quizResult,
    assetFailures,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Beers <-> Scrollytelling and Beers <-> Quiz reference each other in
 * both directions. Webflow refuses to delete an item that is still the
 * target of any reference, which means the naive "satellites first"
 * order still hits a 409 because Beers is holding refs to the
 * satellites we're about to remove. Clearing those refs on Beers before
 * deleting anything breaks the cycle, after which the standard
 * satellites-then-master order works.
 */
async function deleteLotAcrossCollections(originoId, { client, collections }) {
  const startedAt = Date.now();

  const unlockExisting = await findItemByOriginoId(client, {
    collectionId: collections.unlock,
    originoId,
  });

  if (unlockExisting) {
    try {
      await updateItem(client, {
        collectionId: collections.unlock,
        itemId: unlockExisting.id,
        fieldData: { scrollytelling: null, quiz: null },
      });
    } catch (err) {
      logEvent('warn', {
        event: 'unlock_ref_clear_failed',
        originoId,
        message: err?.message,
      });
    }
  }

  const quiz = await deleteOne(client, { collectionId: collections.quiz, originoId });
  const scrolly = await deleteOne(client, { collectionId: collections.scrolly, originoId });
  const unlock = unlockExisting
    ? await (async () => {
        await deleteItem(client, {
          collectionId: collections.unlock,
          itemId: unlockExisting.id,
        });
        return { action: 'delete', id: unlockExisting.id };
      })()
    : { action: 'delete-noop', id: null };

  return {
    originoId,
    unlock,
    scrollytelling: scrolly,
    quiz,
    durationMs: Date.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// Public: high-level orchestration
// ---------------------------------------------------------------------------

/**
 * Fetch every lot from Origino, then upsert either all of them or just
 * the ones matching `originoIdFilter`. Never throws — per-lot failures
 * are captured in the results array so the caller can decide how to
 * surface them.
 */
async function runSync({ mode, config, originoIdFilter = null }) {
  const startedAt = Date.now();
  const client = createWebflowClient({ apiToken: config.webflow.apiToken });
  const collections = config.webflow.collections;

  let lots;
  try {
    lots = await fetchAllLots(config.origino.listUrl);
  } catch (err) {
    logEvent('error', { event: 'origino_fetch_error', mode, message: err.message });
    return {
      ok: false,
      mode,
      error: 'origino-fetch-failed',
      message: err.message,
      durationMs: Date.now() - startedAt,
    };
  }

  const targeted = originoIdFilter
    ? lots.filter((lot) => String(lot?.id_lot) === String(originoIdFilter))
    : lots;

  if (originoIdFilter && targeted.length === 0) {
    return {
      ok: false,
      mode,
      error: 'origino-id-not-found',
      originoId: originoIdFilter,
      durationMs: Date.now() - startedAt,
    };
  }

  const resolveAsset = createAssetResolver(client, config.webflow.siteId, {
    onFailure: (f) => logEvent('warn', { event: 'asset_failure', mode, ...f }),
  });

  const results = [];
  for (const lot of targeted) {
    const originoId = String(lot?.id_lot);
    const skip = shouldSkipLot(lot);
    if (skip.skip) {
      logEvent('info', { event: 'lot_skipped', mode, originoId, reason: skip.reason });
      results.push({ originoId, skipped: true, reason: skip.reason });
      continue;
    }
    try {
      const r = await syncLot(lot, { client, collections, resolveAsset });
      logEvent('info', { event: 'lot_synced', mode, ...r });
      results.push(r);
    } catch (err) {
      const status = err?.statusCode || err?.status;
      logEvent('error', {
        event: 'lot_error',
        mode,
        originoId,
        status,
        message: err?.message,
        body: err?.body,
      });
      results.push({ originoId, error: err.message, status });
    }
  }

  const summary = {
    ok: true,
    mode,
    total: targeted.length,
    synced: results.filter((r) => r.unlock).length,
    skipped: results.filter((r) => r.skipped).length,
    errored: results.filter((r) => r.error).length,
    assetFailures: resolveAsset.failures.length,
    durationMs: Date.now() - startedAt,
  };

  logEvent('info', { event: 'sync_complete', ...summary });

  return { ...summary, results };
}

/**
 * Remove a single Origino ID from every collection. Satellites first,
 * then the master (avoids dangling references).
 */
async function runDelete({ mode, config, originoId }) {
  const startedAt = Date.now();
  const client = createWebflowClient({ apiToken: config.webflow.apiToken });
  const collections = config.webflow.collections;

  try {
    const result = await deleteLotAcrossCollections(originoId, { client, collections });
    logEvent('info', {
      event: 'delete_ok',
      mode,
      ...result,
      totalDurationMs: Date.now() - startedAt,
    });
    return { ok: true, action: 'delete', mode, ...result };
  } catch (err) {
    const status = err?.statusCode || err?.status || 502;
    logEvent('error', {
      event: 'delete_error',
      mode,
      originoId,
      status,
      message: err?.message,
    });
    return {
      ok: false,
      mode,
      action: 'delete',
      error: 'webflow-rejected',
      status,
      message: err?.message,
    };
  }
}

module.exports = { runSync, runDelete, logEvent };
