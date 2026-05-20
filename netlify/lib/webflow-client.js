/**
 * Thin wrapper around the official `webflow-api` SDK that exposes only the
 * operations the sync function needs. Centralizing this here keeps the
 * function entrypoint focused on routing/validation and lets us swap retry,
 * pagination, or logging strategies in one place.
 *
 * Idempotency: items are looked up by a custom `origino-id` text field on the
 * collection. Without that field the sync would create duplicates on every
 * webhook, so the helper throws if it encounters items missing the anchor.
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
 * Create a new published item in the collection. The `fieldData` must already
 * include the `origino-id` field so future syncs can find it.
 *
 * Note: the runtime SDK uses a wrapper override (`wrapper/ItemsClient.js`)
 * with a different signature than the auto-generated TypeScript types claim.
 * The wrapper expects a flat shape (`{ isArchived, isDraft, fieldData }`),
 * not the `{ body: { ... } }` shape shown in the .d.ts examples.
 */
async function createItem(client, { collectionId, fieldData }) {
  if (!fieldData?.[ORIGINO_ID_FIELD]) {
    throw new Error(`createItem: fieldData is missing required '${ORIGINO_ID_FIELD}'`);
  }

  return client.collections.items.createItemLive(collectionId, {
    isArchived: false,
    isDraft: false,
    fieldData,
  });
}

/**
 * Update an existing published item's fields. We pass `fieldData` as-is and
 * let Webflow merge it with what's already there.
 */
async function updateItem(client, { collectionId, itemId, fieldData }) {
  return client.collections.items.updateItemLive(collectionId, itemId, {
    isArchived: false,
    isDraft: false,
    fieldData,
  });
}

/**
 * Delete an item from both the staged and live versions of the collection.
 * Webflow deletes propagate immediately to the live site.
 */
async function deleteItem(client, { collectionId, itemId }) {
  await client.collections.items.deleteItemLive(collectionId, itemId);
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
