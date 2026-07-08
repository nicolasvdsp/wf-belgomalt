/**
 * Thin wrapper around the official `webflow-api` SDK that exposes only the
 * operations the sync function needs. Centralizing this here keeps the
 * function entrypoint focused on routing/validation and lets us swap retry,
 * pagination, or logging strategies in one place.
 *
 * Idempotency: items are looked up by a custom `origino-id` text field on the
 * collection. Without that field the sync would create duplicates on every
 * webhook, so the helper throws if it encounters items missing the anchor.
 *
 * Create/update strategy: tries `createItemLive`/`updateItemLive` first for
 * instant publishing. Falls back to staged `createItem`/`updateItem` if the
 * live endpoint 404s (happens on collections that have never been part of a
 * site publish). Staged items become live on next site publish.
 */

const { WebflowClient } = require('webflow-api');

const ORIGINO_ID_FIELD = 'origino-id';
const LIST_PAGE_SIZE = 100;

function createWebflowClient({ apiToken }) {
  return new WebflowClient({ accessToken: apiToken });
}

/**
 * Find a Webflow item whose `origino-id` field matches the given Origino ID.
 * Returns the item or null. Paginates through the collection because the Data
 * API does not support filtering by arbitrary custom fields server-side.
 */
async function findItemByOriginoId(client, { collectionId, originoId }) {
  let offset = 0;

  while (true) {
    const page = await client.collections.items.listItems(collectionId, {
      offset,
      limit: LIST_PAGE_SIZE,
    });

    const items = page.items || [];
    const match = items.find((item) => item.fieldData?.[ORIGINO_ID_FIELD] === originoId);
    if (match) return match;

    if (items.length < LIST_PAGE_SIZE) return null;
    offset += LIST_PAGE_SIZE;
  }
}

/**
 * Create a new item in the collection. Tries live-publish first; falls back
 * to staged create if the live endpoint fails (e.g. collection never published).
 *
 * Note: the runtime SDK wrapper expects a flat shape
 * (`{ isArchived, isDraft, fieldData }`), not the `{ body: { ... } }` shape
 * shown in the .d.ts examples.
 */
async function createItem(client, { collectionId, fieldData }) {
  if (!fieldData?.[ORIGINO_ID_FIELD]) {
    throw new Error(`createItem: fieldData is missing required '${ORIGINO_ID_FIELD}'`);
  }

  const itemData = { isArchived: false, isDraft: false, fieldData };

  try {
    return await client.collections.items.createItemLive(collectionId, itemData);
  } catch (err) {
    if (err?.statusCode === 404 || err?.status === 404) {
      return await client.collections.items.createItem(collectionId, itemData);
    }
    throw err;
  }
}

/**
 * Update an existing item's fields. Tries live-publish first; falls back
 * to staged update if the live endpoint fails.
 */
async function updateItem(client, { collectionId, itemId, fieldData }) {
  const itemData = { isArchived: false, isDraft: false, fieldData };

  try {
    return await client.collections.items.updateItemLive(collectionId, itemId, itemData);
  } catch (err) {
    if (err?.statusCode === 404 || err?.status === 404) {
      return await client.collections.items.updateItem(collectionId, itemId, itemData);
    }
    throw err;
  }
}

/**
 * Delete an item from both the staged and live versions of the collection.
 */
async function deleteItem(client, { collectionId, itemId }) {
  try {
    await client.collections.items.deleteItemLive(collectionId, itemId);
  } catch {
    // Live version may not exist if collection was never published
  }
  await client.collections.items.deleteItem(collectionId, itemId);
}

module.exports = {
  ORIGINO_ID_FIELD,
  createWebflowClient,
  findItemByOriginoId,
  createItem,
  updateItem,
  deleteItem,
};
