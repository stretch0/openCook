import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { joinHouseholdSchema, updateHouseholdSchema } from '@opencook/schemas';
import { type AuthedEnv, requireUser } from '../context.js';
import {
  createHouseholdInvite,
  getHousehold,
  joinHousehold,
  leaveHousehold,
  previewInvite,
  renameHousehold,
} from '../services/households.js';
import { relinkRecipeItems } from '../services/items.js';
import { carryOverList } from '../services/shopping.js';
import { viewerOf } from './viewer.js';

export const householdRoutes = new Hono<AuthedEnv>()
  .use(requireUser)
  .get('/', (c) => c.json(getHousehold(c.get('db'), viewerOf(c).householdId)))
  .patch('/', zValidator('json', updateHouseholdSchema), (c) =>
    c.json(
      renameHousehold(
        c.get('db'),
        viewerOf(c).householdId,
        c.req.valid('json').name,
      ),
    ),
  )
  .post('/invites', (c) => {
    const v = viewerOf(c);
    return c.json(
      createHouseholdInvite(c.get('db'), v.householdId, v.userId),
      201,
    );
  })
  .get('/invites/:code', (c) =>
    c.json(previewInvite(c.get('db'), c.get('user').id, c.req.param('code'))),
  )
  .post('/join', zValidator('json', joinHouseholdSchema), (c) => {
    const db = c.get('db');
    const userId = c.get('user').id;
    const householdId = joinHousehold(
      db,
      userId,
      c.req.valid('json').code,
      (from, to) => carryOverList(db, userId, from, to),
    );
    relinkRecipeItems(db, userId, householdId);
    return c.json(getHousehold(db, householdId));
  })
  .post('/leave', (c) => {
    const db = c.get('db');
    const userId = c.get('user').id;
    const householdId = leaveHousehold(db, userId);
    relinkRecipeItems(db, userId, householdId);
    return c.json(getHousehold(db, householdId));
  });
