import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { mergeItemsSchema as mergeSchema } from '@opencook/schemas';
import { type AuthedEnv, requireUser } from '../context.js';
import {
  autocompleteItems,
  mergeItems,
  searchItems,
} from '../services/items.js';
import { householdRecipeIds } from '../services/households.js';
import { viewerOf } from './viewer.js';

export const itemRoutes = new Hono<AuthedEnv>()
  .use(requireUser)
  /** Autocomplete as someone types. */
  .get('/', zValidator('query', z.object({ q: z.string().max(200) })), (c) =>
    c.json(
      autocompleteItems(
        c.get('db'),
        viewerOf(c).householdId,
        c.req.valid('query').q,
      ),
    ),
  )
  /** The item a name refers to, or "Did you mean…?" suggestions. */
  .get(
    '/match',
    zValidator('query', z.object({ name: z.string().max(200) })),
    (c) =>
      c.json(
        searchItems(
          c.get('db'),
          viewerOf(c).householdId,
          c.req.valid('query').name,
        ),
      ),
  )
  /** "These are the same": folds one item into another for the household. */
  .post('/merge', zValidator('json', mergeSchema), (c) => {
    const db = c.get('db');
    const v = viewerOf(c);
    const { from, into } = c.req.valid('json');
    const recipeIds = householdRecipeIds(db, v.householdId);
    return c.json(mergeItems(db, v.householdId, from, into, recipeIds));
  });
