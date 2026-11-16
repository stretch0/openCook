import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { type AuthedEnv, requireUser } from '../context.js';
import { autocompleteItems, searchItems } from '../services/items.js';
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
  );
