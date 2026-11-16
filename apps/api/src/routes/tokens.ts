import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createTokenSchema } from '@opencook/schemas';
import { type AuthedEnv, requireUser } from '../context.js';
import { createToken, listTokens, revokeToken } from '../services/tokens.js';

export const tokenRoutes = new Hono<AuthedEnv>()
  .use(requireUser)
  .get('/', (c) => c.json(listTokens(c.get('db'), c.get('user').id)))
  .post('/', zValidator('json', createTokenSchema), (c) =>
    c.json(
      createToken(c.get('db'), c.get('user').id, c.req.valid('json')),
      201,
    ),
  )
  .delete('/:id', (c) => {
    revokeToken(c.get('db'), c.get('user').id, c.req.param('id'));
    return c.body(null, 204);
  });
