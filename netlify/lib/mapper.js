/**
 * Translates an Origino payload into the Webflow `fieldData` shape expected by
 * the target collection. This is the only file that should change once
 * Origino's real payload contract is known: the function entrypoint, client
 * wrapper, and config are all decoupled from the source schema.
 *
 * Field names below assume the Webflow collection has been set up with the
 * default slugs Webflow generates from these labels. Adjust slugs here if the
 * collection in Webflow uses different ones.
 */

const { ORIGINO_ID_FIELD } = require('./webflow-client');

function toSlug(input) {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function joinIngredients(ingredients) {
  if (!Array.isArray(ingredients) || ingredients.length === 0) return '';
  return ingredients
    .map((ing) => {
      const parts = [ing.name, ing.origin].filter(Boolean);
      return parts.length > 0 ? `<li>${parts.join(' &mdash; ')}</li>` : '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Map an Origino item -> Webflow `fieldData`. The `name` and `slug` fields are
 * required by every Webflow collection; the rest mirror the fixture for now.
 */
function mapOriginoToWebflow(originoItem, originoId) {
  if (!originoItem || typeof originoItem !== 'object') {
    throw new Error('mapOriginoToWebflow: payload is missing or not an object');
  }

  const name = originoItem.name || `Untitled ${originoId}`;
  const slug = originoItem.slug ? toSlug(originoItem.slug) : toSlug(name);

  const fieldData = {
    name,
    slug,
    [ORIGINO_ID_FIELD]: originoId,
    brewery: originoItem.brewery || '',
    style: originoItem.style || '',
    description: originoItem.description || '',
    story: originoItem.story || '',
    ingredients: joinIngredients(originoItem.ingredients),
    'qr-batch': originoItem.qrBatch || '',
  };

  if (typeof originoItem.abv === 'number') fieldData.abv = originoItem.abv;
  if (typeof originoItem.ibu === 'number') fieldData.ibu = originoItem.ibu;

  if (originoItem.imageUrl) {
    fieldData['main-image'] = { url: originoItem.imageUrl };
  }

  return fieldData;
}

module.exports = { mapOriginoToWebflow };
