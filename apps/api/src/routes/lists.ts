import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import {
  addListItemsSchema,
  checkListItemsSchema,
  createListSchema,
  removeListItemsSchema,
  updateListItemSchema,
} from '@opencook/schemas';
import { type AuthedEnv, requireUser } from '../context.js';
import { onListChange } from '../services/events.js';
import {
  addToList,
  checkListItems,
  createList,
  deleteList,
  getList,
  listLists,
  loadList,
  purchaseHistory,
  removeListItems,
  renameList,
  updateListItem,
} from '../services/shopping.js';
import { viewerOf } from './viewer.js';

export const listRoutes = new Hono<AuthedEnv>()
  .use(requireUser)
  .get('/', (c) => c.json(listLists(c.get('db'), viewerOf(c))))
  .post('/', zValidator('json', createListSchema), (c) =>
    c.json(createList(c.get('db'), viewerOf(c), c.req.valid('json').name), 201),
  )
  .get('/:id', (c) =>
    c.json(getList(c.get('db'), viewerOf(c), c.req.param('id'))),
  )
  .patch('/:id', zValidator('json', createListSchema), (c) => {
    renameList(
      c.get('db'),
      viewerOf(c),
      c.req.param('id'),
      c.req.valid('json').name,
    );
    return c.json(getList(c.get('db'), viewerOf(c), c.req.param('id')));
  })
  .delete('/:id', (c) => {
    deleteList(c.get('db'), viewerOf(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .post('/:id/items', zValidator('json', addListItemsSchema), (c) =>
    c.json(
      addToList(
        c.get('db'),
        viewerOf(c),
        c.req.param('id'),
        c.req.valid('json').items,
      ),
      201,
    ),
  )
  .patch('/:id/items/:itemId', zValidator('json', updateListItemSchema), (c) =>
    c.json(
      updateListItem(
        c.get('db'),
        viewerOf(c),
        c.req.param('id'),
        c.req.param('itemId'),
        c.req.valid('json'),
      ),
    ),
  )
  .delete('/:id/items/:itemId', (c) => {
    removeListItems(c.get('db'), viewerOf(c), c.req.param('id'), [
      c.req.param('itemId'),
    ]);
    return c.body(null, 204);
  })
  .post('/:id/check', zValidator('json', checkListItemsSchema), (c) => {
    const { ids, checked } = c.req.valid('json');
    checkListItems(c.get('db'), viewerOf(c), c.req.param('id'), ids, checked);
    return c.json(getList(c.get('db'), viewerOf(c), c.req.param('id')));
  })
  .post('/:id/remove', zValidator('json', removeListItemsSchema), (c) => {
    removeListItems(
      c.get('db'),
      viewerOf(c),
      c.req.param('id'),
      c.req.valid('json').ids,
    );
    return c.json(getList(c.get('db'), viewerOf(c), c.req.param('id')));
  })
  /** Server-sent events: "changed" whenever anyone in the household edits the list. */
  .get('/:id/events', (c) => {
    const list = loadList(c.get('db'), viewerOf(c), c.req.param('id'));
    return streamSSE(c, async (stream) => {
      let stop: () => void = () => undefined;
      const closed = new Promise<void>((resolve) => {
        stop = onListChange(list.id, (e) => {
          void stream.writeSSE({ event: 'changed', data: JSON.stringify(e) });
        });
        stream.onAbort(() => resolve());
      });
      await stream.writeSSE({ event: 'ready', data: list.id });
      // Comments every 25 s keep proxies from closing an idle connection.
      const ping = setInterval(() => void stream.write(': ping\n\n'), 25_000);
      await closed;
      clearInterval(ping);
      stop();
    });
  });

export const purchaseRoutes = new Hono<AuthedEnv>().use(requireUser).get(
  '/',
  zValidator(
    'query',
    z.object({
      itemId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }),
  ),
  (c) =>
    c.json(purchaseHistory(c.get('db'), viewerOf(c), c.req.valid('query'))),
);
