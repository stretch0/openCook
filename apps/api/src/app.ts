import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { getConnInfo } from '@hono/node-server/conninfo';
import { type Context, Hono } from 'hono';
import { logger } from 'hono/logger';
import { ZodError } from 'zod';
import type { Db } from '@opencook/db';
import { FetchError } from '@opencook/recipe-import';
import type { Auth } from './auth.js';
import type { Config } from './config.js';
import type { AppEnv } from './context.js';
import { securityHeaders } from './security-headers.js';
import { HttpError } from './services/errors.js';
import { adminRoutes } from './routes/admin.js';
import { householdRoutes } from './routes/household.js';
import { listRoutes, purchaseRoutes } from './routes/lists.js';
import { imageRoutes } from './routes/images.js';
import { instanceRoutes } from './routes/instance.js';
import { itemRoutes } from './routes/items.js';
import { mcpRoutes } from './routes/mcp.js';
import { meRoutes } from './routes/me.js';
import { recipeRoutes } from './routes/recipes.js';
import { tokenRoutes } from './routes/tokens.js';

export function createApp({
  db,
  auth,
  config,
}: {
  db: Db;
  auth: Auth;
  config: Config;
}) {
  const app = new Hono<AppEnv>();
  const indexHtml = config.webDir ? readIndexHtml(config.webDir) : undefined;
  app.use('*', securityHeaders(config, indexHtml));

  if (config.logRequests) app.use(logger());

  app.use('/api/*', async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set('user', session?.user ?? null);
    c.set('db', db);
    c.set('config', config);
    await next();
  });
  app.use('/mcp', async (c, next) => {
    c.set('user', null);
    c.set('db', db);
    c.set('config', config);
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message, details: err.details }, err.status);
    }
    if (err instanceof ZodError) {
      return c.json({ error: 'Invalid request', details: err.issues }, 422);
    }
    if (err instanceof FetchError) return c.json({ error: err.message }, 502);
    console.error(err);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  app.on(['GET', 'POST'], '/api/auth/*', (c) =>
    auth.handler(withClientIp(c.req.raw, config.trustProxy ? null : c)),
  );
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/instance', instanceRoutes);
  app.route('/api/me', meRoutes);
  app.route('/api/admin', adminRoutes);
  app.route('/api/recipes', recipeRoutes);
  app.route('/api/items', itemRoutes);
  app.route('/api/household', householdRoutes);
  app.route('/api/lists', listRoutes);
  app.route('/api/purchases', purchaseRoutes);
  app.route('/api/tokens', tokenRoutes);
  app.route('/api/images', imageRoutes);
  app.route('/mcp', mcpRoutes);
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  if (config.webDir && indexHtml !== undefined) {
    serveWeb(app, config.webDir, indexHtml);
  }

  return app;
}

/**
 * Better Auth rate-limits by client IP, read from X-Forwarded-For. Unless a
 * trusted proxy sets that header, replace it with the socket address so
 * clients cannot spoof it.
 */
function withClientIp(req: Request, c: Context | null) {
  if (!c) return req;
  let address: string | undefined;
  try {
    address = getConnInfo(c).remote.address;
  } catch {
    // No socket, e.g. in tests using app.request().
  }
  const headers = new Headers(req.headers);
  if (address) headers.set('x-forwarded-for', address);
  else headers.delete('x-forwarded-for');
  return new Request(req, { headers });
}

/** Serves the built PWA, falling back to index.html for client-side routes. */
function readIndexHtml(webDir: string) {
  const indexPath = join(webDir, 'index.html');
  if (!existsSync(indexPath)) {
    console.warn(`WEB_DIR is set but ${indexPath} does not exist`);
    return undefined;
  }
  return readFileSync(indexPath, 'utf8');
}

function serveWeb(app: Hono<AppEnv>, webDir: string, indexHtml: string) {
  app.use(
    '*',
    serveStatic({
      root: webDir,
      onFound: (path, c) => {
        // The service worker and HTML must always be revalidated; hashed assets can be cached forever.
        c.header(
          'Cache-Control',
          path.includes('/assets/')
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    }),
  );
  app.get('*', (c) => c.html(indexHtml));
}
