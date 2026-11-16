import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { type Db, schema } from '@opencook/db';
import { handleMcpRequest, type OpenCookServices } from '@opencook/mcp';
import { importRecipeFromUrl } from '@opencook/recipe-import';
import type { Config } from '../config.js';
import type { AppEnv } from '../context.js';
import { downloadImage } from '../services/images.js';
import { householdOf, householdRecipeIds } from '../services/households.js';
import { mergeItems } from '../services/items.js';
import {
  addRecipeToList,
  addToList,
  checkListItems,
  getList,
  listLists,
  purchaseHistory,
  removeListItems,
  updateListItem,
} from '../services/shopping.js';
import {
  type Viewer,
  createRecipe,
  deleteRecipe,
  forkRecipe,
  getRecipe,
  listRecipes,
  listTags,
  logCooked,
  setNote,
  updateRecipe,
} from '../services/recipes.js';
import { verifyToken } from '../services/tokens.js';
import { version } from '../version.js';

function servicesFor(db: Db, config: Config, viewer: Viewer): OpenCookServices {
  const fetchImage = async (url: string, ownerId: string) =>
    (
      await downloadImage(db, config.dataDir, ownerId, url, {
        allowPrivate: config.allowPrivateImports,
      })
    ).id;
  return {
    searchRecipes: (q) => listRecipes(db, viewer, q),
    getRecipe: (id) => getRecipe(db, viewer, id),
    listTags: () => listTags(db, viewer),
    createRecipe: (input) => createRecipe(db, viewer, input, { fetchImage }),
    updateRecipe: (id, input) =>
      updateRecipe(db, viewer, id, input, { fetchImage }),
    deleteRecipe: (id) => deleteRecipe(db, viewer, id),
    setNote: (id, text) => setNote(db, viewer, id, text),
    logCooked: (id, input) => logCooked(db, viewer, id, input),
    forkRecipe: (id) => forkRecipe(db, viewer, id, config.origin),
    listLists: () => listLists(db, viewer),
    getList: (id) => getList(db, viewer, id),
    addToList: (id, entries) => addToList(db, viewer, id, entries),
    updateListItem: (id, line, patch) =>
      updateListItem(db, viewer, id, line, patch),
    removeListItems: (id, ids) => removeListItems(db, viewer, id, ids),
    checkListItems: (id, ids, checked) =>
      checkListItems(db, viewer, id, ids, checked, 'mcp'),
    addRecipeToList: (id, input) => addRecipeToList(db, viewer, id, input),
    purchaseHistory: (input) => purchaseHistory(db, viewer, input),
    mergeItems: (from, into) =>
      mergeItems(
        db,
        viewer.householdId,
        from,
        into,
        householdRecipeIds(db, viewer.householdId),
      ),
    importFromUrl: (url) =>
      importRecipeFromUrl(url, { allowPrivate: config.allowPrivateImports }),
  };
}

/**
 * The MCP endpoint AI assistants connect to, at /mcp. Authenticated with a
 * personal API token (Settings → AI assistants) sent as a Bearer token.
 */
export const mcpRoutes = new Hono<AppEnv>().all('/', async (c) => {
  const db = c.get('db');
  const config = c.get('config');
  const header = c.req.header('authorization') ?? '';
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const grant = token ? verifyToken(db, token) : null;
  if (!grant) {
    c.header(
      'WWW-Authenticate',
      'Bearer realm="openCook", error="invalid_token"',
    );
    return c.json(
      {
        error:
          'Send an openCook API token as "Authorization: Bearer ock_…". Create one in Settings.',
      },
      401,
    );
  }
  const user = db
    .select({ units: schema.user.units })
    .from(schema.user)
    .where(eq(schema.user.id, grant.userId))
    .get();
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const viewer = {
    userId: grant.userId,
    householdId: householdOf(db, grant.userId),
  };
  return handleMcpRequest(c.req.raw, {
    services: servicesFor(db, config, viewer),
    scopes: grant.scopes,
    preference: user.units,
    origin: config.origin,
    version,
  });
});
