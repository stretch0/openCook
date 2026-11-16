import type { Context } from 'hono';
import type { AuthedEnv } from '../context.js';
import { downloadImage } from '../services/images.js';
import { householdOf } from '../services/households.js';
import type { ImageFetcher, Viewer } from '../services/recipes.js';

export function viewerOf(c: Context<AuthedEnv>): Viewer {
  const userId = c.get('user').id;
  return { userId, householdId: householdOf(c.get('db'), userId) };
}

/** Downloads recipe photos into this instance's uploads. */
export function imageFetcher(c: Context<AuthedEnv>): ImageFetcher {
  const config = c.get('config');
  return async (url, ownerId) =>
    (
      await downloadImage(c.get('db'), config.dataDir, ownerId, url, {
        allowPrivate: config.allowPrivateImports,
      })
    ).id;
}
