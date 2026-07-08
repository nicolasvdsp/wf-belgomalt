/**
 * Origino → Webflow Assets pipeline.
 *
 * Origino delivers every image as an S3 signed URL that expires after
 * 15 minutes. Hot-linking would break overnight, so every asset is
 * downloaded once, re-uploaded to Webflow Assets, and the resulting
 * permanent `{ fileId, url }` is reused on every subsequent sync via a
 * Netlify Blobs cache keyed on the Origino checksum / fileId.
 *
 * Cache lookup is best-effort: when Netlify Blobs is unavailable (e.g.
 * outside the Netlify runtime) we skip the cache and re-upload, which
 * is wasteful but still correct.
 *
 * Webflow Assets upload is a 2-step dance:
 *   1. POST /sites/:id/assets    -> { uploadUrl, uploadDetails, id, hostedUrl }
 *   2. multipart POST uploadUrl  -> 204 No Content
 */

const { createHash } = require('node:crypto');
const { getStore } = require('@netlify/blobs');

const CACHE_STORE_NAME = 'origino-assets-cache';

// ---------------------------------------------------------------------------
// Origino file blob parsing
// ---------------------------------------------------------------------------

/**
 * Origino stores file metadata as a JSON-stringified object inside text
 * fields (`beer_logo`, `beer_image`, every `journey[].logo`). Some entries
 * are stripped down to just `{ publicFileURI }` (e.g. the static
 * origin-place-logo). Returns null on missing / empty input.
 */
function parseOriginoFile(input) {
  if (input == null || input === '') return null;

  let obj;
  if (typeof input === 'object') {
    obj = input;
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{')) {
      try {
        obj = JSON.parse(trimmed);
      } catch {
        return null;
      }
    } else {
      // bare URL string fallback
      obj = { publicFileURI: trimmed };
    }
  } else {
    return null;
  }

  const publicFileURI = obj.publicFileURI || obj.url || null;
  if (!publicFileURI) return null;

  return {
    fileId: obj.fileId || null,
    checksum: obj.checksum || null,
    publicFileURI,
    originalName: obj.originalName || obj.storageName || null,
  };
}

/**
 * Derive a stable, content-addressed cache key for an Origino file:
 * prefer the upstream sha256 checksum, fall back to fileId, last
 * resort the URL path (strips S3 signature query params).
 */
function cacheKeyFor(parsed) {
  if (parsed.checksum) return `sha256:${parsed.checksum}`;
  if (parsed.fileId) return `fileid:${parsed.fileId}`;
  try {
    const u = new URL(parsed.publicFileURI);
    return `url:${u.origin}${u.pathname}`;
  } catch {
    return `url:${parsed.publicFileURI}`;
  }
}

/**
 * Best-effort filename derivation for the Webflow Assets upload.
 * Falls back to a checksum-prefixed name when nothing else is available.
 */
function deriveFileName(parsed) {
  if (parsed.originalName) return parsed.originalName;
  try {
    const u = new URL(parsed.publicFileURI);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last) {
      return last.includes('.') ? last : `${last}.png`;
    }
  } catch {
    // fall through
  }
  return `origino-${(parsed.checksum || parsed.fileId || 'asset').slice(0, 12)}.png`;
}

// ---------------------------------------------------------------------------
// Webflow upload (2-step)
// ---------------------------------------------------------------------------

/**
 * Download the S3 bytes and push them to Webflow Assets. Returns the
 * permanent `{ fileId, url }` ready for use in CMS `fieldData`.
 */
async function uploadToWebflow(client, { siteId, fileName, bytes }) {
  const fileHash = createHash('md5').update(bytes).digest('hex');

  // Step 1: ask Webflow to allocate an asset slot.
  const meta = await client.assets.create(siteId, { fileName, fileHash });
  if (!meta?.uploadUrl || !meta?.uploadDetails) {
    throw new Error('Webflow assets.create() returned no uploadUrl');
  }

  // Step 2: POST the binary to S3 with every field Webflow handed us.
  const form = new FormData();
  const detailMap = {
    acl: 'acl',
    bucket: 'bucket',
    xAmzAlgorithm: 'X-Amz-Algorithm',
    xAmzCredential: 'X-Amz-Credential',
    xAmzDate: 'X-Amz-Date',
    key: 'key',
    policy: 'Policy',
    xAmzSignature: 'X-Amz-Signature',
    successActionStatus: 'success_action_status',
    contentType: 'Content-Type',
    cacheControl: 'Cache-Control',
  };
  for (const [sdkKey, formKey] of Object.entries(detailMap)) {
    const v = meta.uploadDetails[sdkKey];
    if (v != null) form.append(formKey, String(v));
  }
  form.append('file', new Blob([bytes]), fileName);

  const upload = await fetch(meta.uploadUrl, { method: 'POST', body: form });
  if (!upload.ok) {
    const body = await upload.text().catch(() => '');
    throw new Error(
      `Webflow asset S3 upload failed: HTTP ${upload.status}${body ? ` — ${body.slice(0, 200)}` : ''}`
    );
  }

  return {
    fileId: meta.id,
    url: meta.hostedUrl || meta.assetUrl || null,
  };
}

// ---------------------------------------------------------------------------
// Netlify Blobs cache (best-effort)
// ---------------------------------------------------------------------------

let cachedStore = null;
function getCacheStore() {
  if (cachedStore !== null) return cachedStore;
  try {
    cachedStore = getStore({ name: CACHE_STORE_NAME, consistency: 'strong' });
  } catch {
    cachedStore = false;
  }
  return cachedStore;
}

async function cacheGet(key) {
  const store = getCacheStore();
  if (!store) return null;
  try {
    const raw = await store.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function cacheSet(key, value) {
  const store = getCacheStore();
  if (!store) return;
  try {
    await store.set(key, JSON.stringify(value));
  } catch {
    // Cache write failures are non-fatal.
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a resolver bound to a Webflow client + site. Call the returned
 * function for every Origino file blob; it returns `{ fileId, url }`
 * on success, or `null` when either the blob was unusable OR any part
 * of the pipeline failed (download 403, S3 upload timeout, ...). We
 * deliberately never throw: a missing asset must not kill the rest of
 * the sync. Failures accumulate on `resolver.failures` for the caller
 * to inspect / surface in logs.
 *
 * Re-uploads are deduped both cross-invocation (Netlify Blobs) and
 * intra-invocation (in-memory map).
 */
function createAssetResolver(client, siteId, { onFailure } = {}) {
  if (!siteId) throw new Error('createAssetResolver: siteId is required');
  const inflight = new Map();
  const failures = [];

  async function fetchAndUpload(parsed, key) {
    const cached = await cacheGet(key);
    if (cached?.fileId) return cached;

    const res = await fetch(parsed.publicFileURI);
    if (!res.ok) {
      throw new Error(
        `download HTTP ${res.status} for ${parsed.publicFileURI.slice(0, 120)}`
      );
    }
    const buffer = Buffer.from(await res.arrayBuffer());

    const uploaded = await uploadToWebflow(client, {
      siteId,
      fileName: deriveFileName(parsed),
      bytes: buffer,
    });
    await cacheSet(key, uploaded);
    return uploaded;
  }

  async function resolveAsset(rawBlob) {
    const parsed = parseOriginoFile(rawBlob);
    if (!parsed) return null;

    const key = cacheKeyFor(parsed);
    if (inflight.has(key)) return inflight.get(key);

    const promise = fetchAndUpload(parsed, key).catch((err) => {
      const entry = {
        key,
        publicFileURI: parsed.publicFileURI,
        message: err?.message || String(err),
      };
      failures.push(entry);
      if (typeof onFailure === 'function') {
        try { onFailure(entry); } catch { /* logging must never throw */ }
      }
      return null;
    });

    inflight.set(key, promise);
    return promise;
  }

  resolveAsset.failures = failures;
  return resolveAsset;
}

module.exports = {
  createAssetResolver,
  parseOriginoFile,
  cacheKeyFor,
  deriveFileName,
};
