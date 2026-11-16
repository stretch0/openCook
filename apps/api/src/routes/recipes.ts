import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { importRecipeFromUrl } from '@opencook/recipe-import';
import {
  cookedInputSchema,
  importRequestSchema,
  noteInputSchema,
  recipeInputSchema,
  recipeListQuerySchema,
  updateRecipeSchema,
} from '@opencook/schemas';
import { type AuthedEnv, requireUser } from '../context.js';
import {
  cookHistory,
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
import { imageFetcher, viewerOf } from './viewer.js';

export const recipeRoutes = new Hono<AuthedEnv>()
  .use(requireUser)
  .get('/', zValidator('query', recipeListQuerySchema), (c) =>
    c.json(listRecipes(c.get('db'), viewerOf(c), c.req.valid('query'))),
  )
  .get('/tags', (c) => c.json(listTags(c.get('db'), viewerOf(c))))
  .post('/', zValidator('json', recipeInputSchema), async (c) =>
    c.json(
      await createRecipe(c.get('db'), viewerOf(c), c.req.valid('json'), {
        fetchImage: imageFetcher(c),
      }),
      201,
    ),
  )
  .post('/import', zValidator('json', importRequestSchema), async (c) =>
    c.json(
      await importRecipeFromUrl(c.req.valid('json').url, {
        allowPrivate: c.get('config').allowPrivateImports,
      }),
    ),
  )
  .get('/:id', (c) =>
    c.json(getRecipe(c.get('db'), viewerOf(c), c.req.param('id'))),
  )
  .put('/:id', zValidator('json', updateRecipeSchema), async (c) =>
    c.json(
      await updateRecipe(
        c.get('db'),
        viewerOf(c),
        c.req.param('id'),
        c.req.valid('json'),
        {
          fetchImage: imageFetcher(c),
        },
      ),
    ),
  )
  .delete('/:id', (c) => {
    deleteRecipe(c.get('db'), viewerOf(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .put('/:id/note', zValidator('json', noteInputSchema), (c) =>
    c.json({
      note: setNote(
        c.get('db'),
        viewerOf(c),
        c.req.param('id'),
        c.req.valid('json').text,
      ),
    }),
  )
  .get('/:id/cooked', (c) =>
    c.json(cookHistory(c.get('db'), viewerOf(c), c.req.param('id'))),
  )
  .post('/:id/cooked', zValidator('json', cookedInputSchema), (c) =>
    c.json(
      logCooked(
        c.get('db'),
        viewerOf(c),
        c.req.param('id'),
        c.req.valid('json'),
      ),
      201,
    ),
  )
  .post('/:id/fork', (c) =>
    c.json(
      forkRecipe(
        c.get('db'),
        viewerOf(c),
        c.req.param('id'),
        c.get('config').origin,
      ),
      201,
    ),
  );
