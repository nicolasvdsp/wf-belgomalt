/**
 * Translates an Origino lot ({ id_lot, data }) into three Webflow `fieldData`
 * shapes — one per CMS collection in the 3-collection architecture:
 *
 *   Beers (unlock/master)  ← shared identity + images + numeric metrics
 *   Scrollytelling         ← journey JSON + ingredient quotes, refs Beers
 *   Quiz                   ← placeholder, refs Beers (content fully manual)
 *
 * Fields the sync DOES NOT touch (left for the content team to manage in
 * Webflow Designer): `beer---cap` on Beers, `grains---description` on
 * Scrollytelling, `quiz-data---json` on Quiz.
 *
 * All image fields require asset resolution beforehand: the caller passes
 * a `resolveAsset(rawBlob)` function that returns `{ fileId, url }` (or
 * null). Image fields are only included when resolution succeeds.
 *
 * Field slugs below are the Webflow-assigned slugs (verified 2026-06-03):
 *
 *   Beers:          origino-id, name, slug, brewery, beer---logo,
 *                   beer---image, beer---batch, brewing-date,
 *                   usage-of-pure-malt, co2-footprint-kg, raw-origino-json
 *                   (hand-managed: beer---cap, scrollytelling, quiz)
 *   Scrollytelling: origino-id, name, slug, beer (ref), journey---json,
 *                   water---description, hops---description, yeast---description
 *                   (hand-managed: grains---description)
 *   Quiz:           origino-id, name, slug, beer (ref)
 *                   (hand-managed: quiz-data---json)
 */

const { ORIGINO_ID_FIELD } = require('./webflow-client');

const BREWERY_TIPO_ID = '34';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSlug(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Origino sends every number as a string ("66", "10", ...). Strip and parse,
 * returning undefined when not a finite number so callers can omit the field
 * entirely rather than write 0.
 */
function toNumber(value) {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Origino top-level dates are ISO 8601 strings already. Return them as-is
 * (Webflow's DateTime field accepts ISO 8601) or undefined.
 */
function toDateTime(value) {
  if (!value || typeof value !== 'string') return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Build the Webflow CMS Image field value from a resolved asset.
 * Returns undefined when no asset was resolved, so the caller can omit
 * the field instead of clearing it.
 */
function toImageField(resolved) {
  if (!resolved?.fileId) return undefined;
  return { fileId: resolved.fileId, url: resolved.url };
}

/**
 * Map Origino's `beer_ingredient_N` slots (water / hops / yeast) to the
 * corresponding `*---description` field on Scrollytelling, using the
 * companion `beer_ingredient_N_quote` as the description value.
 */
function extractIngredientDescriptions(data) {
  const out = { water: '', hops: '', yeast: '' };
  for (let i = 1; i <= 3; i += 1) {
    const type = data[`beer_ingredient_${i}`];
    const quote = data[`beer_ingredient_${i}_quote`];
    if (typeof type === 'string' && Object.prototype.hasOwnProperty.call(out, type)) {
      out[type] = typeof quote === 'string' ? quote : '';
    }
  }
  return out;
}

/**
 * The Beers collection has a `brewery` text field. Origino has no top-level
 * brewery, but every journey ends at a step with `tipoId: '34'` (Breweries).
 */
function extractBreweryName(data) {
  const journey = Array.isArray(data?.journey) ? data.journey : [];
  const step = [...journey].reverse().find((j) => String(j?.tipoId) === BREWERY_TIPO_ID);
  return step?.title || '';
}

/**
 * Inline-resolve every `logo` blob inside the journey to a permanent Webflow
 * asset URL. The shape of each step is otherwise preserved so the front-end
 * can keep using the same field names. When resolution fails, `logo` is set
 * to null (rather than left as the raw signed S3 URL) so downstream code
 * doesn't try to load a dead URL.
 */
async function resolveJourneyAssets(data, resolveAsset) {
  const journey = Array.isArray(data?.journey) ? data.journey : [];
  return Promise.all(
    journey.map(async (step) => {
      const next = { ...step };
      if (step?.logo) {
        const resolved = await resolveAsset(step.logo);
        next.logo = resolved?.url ? { fileId: resolved.fileId, url: resolved.url } : null;
      }
      return next;
    })
  );
}

// ---------------------------------------------------------------------------
// Skip rule
// ---------------------------------------------------------------------------

/**
 * Origino marks a lot as "complete" by populating the beer-specific fields.
 * Lots without `beer_name` can't render a useful product page, so we skip
 * them and let the caller log the decision.
 */
function shouldSkipLot(lot) {
  const name = lot?.data?.beer_name;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return { skip: true, reason: 'missing_beer_name' };
  }
  return { skip: false };
}

// ---------------------------------------------------------------------------
// Beers / Unlock (master)
// ---------------------------------------------------------------------------

async function mapToUnlock(lot, resolveAsset) {
  const data = lot?.data || {};
  const originoId = String(lot?.id_lot);

  const name = data.beer_name;
  const slug = toSlug(name);

  const [logo, image] = await Promise.all([
    resolveAsset(data.beer_logo),
    resolveAsset(data.beer_image),
  ]);

  const fieldData = {
    name,
    slug,
    [ORIGINO_ID_FIELD]: originoId,
    brewery: extractBreweryName(data),
    'raw-origino-json': JSON.stringify(data),
  };

  const batch = data.beer_batch;
  if (batch != null && batch !== '') fieldData['beer---batch'] = String(batch);

  const brewingDate = toDateTime(data.brewing_date);
  if (brewingDate) fieldData['brewing-date'] = brewingDate;

  const malt = toNumber(data.usage_of_pure_malt);
  if (malt !== undefined) fieldData['usage-of-pure-malt'] = malt;

  const co2 = toNumber(data.co2_footprint_beer_production);
  if (co2 !== undefined) fieldData['co2-footprint-kg'] = co2;

  const logoField = toImageField(logo);
  if (logoField) fieldData['beer---logo'] = logoField;

  const imageField = toImageField(image);
  if (imageField) fieldData['beer---image'] = imageField;

  return fieldData;
}

// ---------------------------------------------------------------------------
// Scrollytelling (satellite — references Beers)
// ---------------------------------------------------------------------------

async function mapToScrollytelling(lot, unlockItemId, resolveAsset) {
  const data = lot?.data || {};
  const originoId = String(lot?.id_lot);
  const name = data.beer_name;
  const slug = toSlug(name);

  const journeyResolved = await resolveJourneyAssets(data, resolveAsset);
  const ingredients = extractIngredientDescriptions(data);

  const fieldData = {
    name,
    slug,
    [ORIGINO_ID_FIELD]: originoId,
    'journey---json': JSON.stringify(journeyResolved),
    'water---description': ingredients.water,
    'hops---description': ingredients.hops,
    'yeast---description': ingredients.yeast,
  };

  if (unlockItemId) fieldData.beer = unlockItemId;
  return fieldData;
}

// ---------------------------------------------------------------------------
// Quiz (satellite — references Beers, content otherwise manual)
// ---------------------------------------------------------------------------

function mapToQuiz(lot, unlockItemId) {
  const data = lot?.data || {};
  const originoId = String(lot?.id_lot);
  const name = data.beer_name;
  const slug = toSlug(name);

  const fieldData = {
    name,
    slug,
    [ORIGINO_ID_FIELD]: originoId,
  };

  if (unlockItemId) fieldData.beer = unlockItemId;
  return fieldData;
}

module.exports = {
  mapToUnlock,
  mapToScrollytelling,
  mapToQuiz,
  shouldSkipLot,
  toSlug,
  extractBreweryName,
  extractIngredientDescriptions,
};
