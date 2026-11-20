import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { today } from '@opencook/domain';
import {
  addNeedsSchema,
  addPlanEntrySchema,
  planQuerySchema,
  shoppingSelectionSchema,
  updatePantrySchema,
  updatePlanEntrySchema,
} from '@opencook/schemas';
import { type AuthedEnv, requireUser } from '../context.js';
import {
  getPantry,
  restockSuggestions,
  updatePantry,
} from '../services/pantry.js';
import {
  addNeedsToList,
  addPlanEntry,
  getPlan,
  removePlanEntry,
  shoppingNeeds,
  updatePlanEntry,
} from '../services/planner.js';
import { viewerOf } from './viewer.js';

export const planRoutes = new Hono<AuthedEnv>()
  .use(requireUser)
  .get('/', zValidator('query', planQuerySchema), (c) => {
    const { from, days } = c.req.valid('query');
    return c.json(
      getPlan(c.get('db'), viewerOf(c), {
        from,
        days,
        today: today(c.get('user').timezone),
      }),
    );
  })
  .post('/', zValidator('json', addPlanEntrySchema), (c) =>
    c.json(addPlanEntry(c.get('db'), viewerOf(c), c.req.valid('json')), 201),
  )
  .patch('/:id', zValidator('json', updatePlanEntrySchema), (c) =>
    c.json(
      updatePlanEntry(
        c.get('db'),
        viewerOf(c),
        c.req.param('id'),
        c.req.valid('json'),
      ),
    ),
  )
  .delete('/:id', (c) => {
    removePlanEntry(c.get('db'), viewerOf(c), c.req.param('id'));
    return c.body(null, 204);
  })
  /** What the chosen meals need, sorted into need / probably have / on the list. */
  .post('/shopping/preview', zValidator('json', shoppingSelectionSchema), (c) =>
    c.json(shoppingNeeds(c.get('db'), viewerOf(c), c.req.valid('json'))),
  )
  .post('/shopping/add', zValidator('json', addNeedsSchema), (c) =>
    c.json(addNeedsToList(c.get('db'), viewerOf(c), c.req.valid('json')), 201),
  );

export const pantryRoutes = new Hono<AuthedEnv>()
  .use(requireUser)
  .get('/', (c) => c.json(getPantry(c.get('db'), viewerOf(c))))
  .patch('/', zValidator('json', updatePantrySchema), (c) =>
    c.json(updatePantry(c.get('db'), viewerOf(c), c.req.valid('json'))),
  )
  .get('/restock', (c) => c.json(restockSuggestions(c.get('db'), viewerOf(c))));
