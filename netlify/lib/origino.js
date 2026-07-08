/**
 * Thin wrapper around the Origino "list everything" endpoint.
 *
 * The endpoint returns a JSON array of `{ id_lot: string, data: object }`.
 * Only fully-filled lots include the full beer field set (beer_name,
 * beer_logo, beer_image, beer_ingredient_*). All image URLs inside the
 * payload are S3 signed URLs with a 15-minute lifetime — the asset
 * pipeline (lib/assets.js) is responsible for materialising them into
 * permanent Webflow Assets URLs before they're written to the CMS.
 *
 * For offline testing, the endpoint URL may be a `file://` URI pointing
 * at a JSON snapshot (see fixtures/origino-beer.sample.json).
 */

const { readFile } = require('node:fs/promises');
const { fileURLToPath } = require('node:url');

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Fetch every lot from Origino. Returns the raw array as-is so the mapper
 * can decide which lots to skip. Throws on network errors, non-200 status,
 * or malformed JSON.
 */
async function fetchAllLots(endpointUrl, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpointUrl || typeof endpointUrl !== 'string') {
    throw new Error('fetchAllLots: endpointUrl is required');
  }

  let raw;

  if (endpointUrl.startsWith('file://')) {
    raw = await readFile(fileURLToPath(endpointUrl), 'utf8');
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(endpointUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const err = new Error(
        `Origino fetch failed: HTTP ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`
      );
      err.statusCode = response.status;
      throw err;
    }

    raw = await response.text();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Origino fetch returned non-JSON body: ${err.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Origino fetch did not return an array');
  }

  return parsed;
}

module.exports = { fetchAllLots };
