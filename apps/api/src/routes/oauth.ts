import { zValidator } from '@hono/zod-validator';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { type AppEnv, type AuthedEnv, requireUser } from '../context.js';
import {
  type AuthorizeParams,
  type ClientFetcher,
  OAuthError,
  approveAuthorization,
  authorizationServerMetadata,
  denyAuthorization,
  disconnectGrant,
  exchangeToken,
  listGrants,
  protectedResourceMetadata,
  registerClient,
  revokeToken,
  validateAuthorization,
} from '../services/oauth.js';

// Apps call these from servers and from browsers (e.g. the MCP Inspector).
// None of them use cookies, so any origin may.
const openCors = cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['content-type', 'authorization', 'mcp-protocol-version'],
  maxAge: 86400,
});

function oauthError(c: Context, e: unknown) {
  if (e instanceof OAuthError) {
    c.header('Cache-Control', 'no-store');
    return c.json(
      { error: e.error, error_description: e.description },
      e.status,
    );
  }
  throw e;
}

async function formOf(c: Context): Promise<Record<string, string | undefined>> {
  const type = c.req.header('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = await c.req.json().catch(() => ({}));
    return Object.fromEntries(
      Object.entries(body).map(([k, v]) => [
        k,
        typeof v === 'string' ? v : undefined,
      ]),
    );
  }
  const body = await c.req.parseBody();
  return Object.fromEntries(
    Object.entries(body).map(([k, v]) => [
      k,
      typeof v === 'string' ? v : undefined,
    ]),
  );
}

/** Discovery documents, under /.well-known. */
export const wellKnownRoutes = new Hono<AppEnv>()
  .use('*', openCors)
  .get('/oauth-protected-resource', (c) =>
    c.json(protectedResourceMetadata(c.get('config'))),
  )
  .get('/oauth-protected-resource/mcp', (c) =>
    c.json(protectedResourceMetadata(c.get('config'))),
  )
  .get('/oauth-authorization-server', (c) =>
    c.json(authorizationServerMetadata(c.get('config'))),
  )
  .get('/oauth-authorization-server/mcp', (c) =>
    c.json(authorizationServerMetadata(c.get('config'))),
  )
  .get('/openid-configuration', (c) =>
    c.json(authorizationServerMetadata(c.get('config'))),
  );

/** The OAuth endpoints apps call, under /oauth. */
export function oauthRoutes() {
  return (
    new Hono<AppEnv>()
      .use('/register', openCors)
      .use('/token', openCors)
      .use('/revoke', openCors)
      .post('/register', async (c) => {
        try {
          const body = await c.req.json().catch(() => null);
          return c.json(registerClient(c.get('db'), body), 201);
        } catch (e) {
          return oauthError(c, e);
        }
      })
      /**
       * Where the app sends the person. The consent screen is part of the
       * web app (it needs their session), so pass the request on to it.
       */
      .get('/authorize', (c) => {
        const url = new URL(c.req.url);
        return c.redirect(`/connect${url.search}`, 302);
      })
      .post('/token', async (c) => {
        try {
          c.header('Cache-Control', 'no-store');
          return c.json(
            exchangeToken(c.get('db'), c.get('config'), await formOf(c)),
          );
        } catch (e) {
          return oauthError(c, e);
        }
      })
      .post('/revoke', async (c) => {
        revokeToken(c.get('db'), (await formOf(c)).token);
        // Always 200, whether or not the token existed (RFC 7009).
        return c.body(null, 200);
      })
  );
}

const consentSchema = z.object({
  params: z.record(z.string(), z.string()),
  scopes: z.array(z.string()).max(20).optional(),
});

/** For the consent screen in the web app, under /api/oauth. */
export function consentRoutes(fetchImpl?: ClientFetcher) {
  return (
    new Hono<AuthedEnv>()
      .use(requireUser)
      /** What the app is asking for, checked. */
      .get('/request', async (c) => {
        const params = Object.fromEntries(
          new URL(c.req.url).searchParams,
        ) as AuthorizeParams;
        const result = await validateAuthorization(
          c.get('db'),
          c.get('config'),
          params,
          fetchImpl,
        );
        if ('fatal' in result) return c.json({ error: result.fatal }, 400);
        if ('redirect' in result)
          return c.json({ redirectTo: result.redirect });
        const { client, scopes, redirectUri } = result.ok;
        return c.json({
          client: {
            name: client.name,
            uri: client.uri,
            logoUri: client.logoUri,
            redirectHost: new URL(redirectUri).host,
            verified: client.kind === 'metadata_document',
            id: client.id,
          },
          scopes,
        });
      })
      .post('/approve', zValidator('json', consentSchema), async (c) => {
        const { params, scopes } = c.req.valid('json');
        const result = await validateAuthorization(
          c.get('db'),
          c.get('config'),
          params,
          fetchImpl,
        );
        if ('fatal' in result) return c.json({ error: result.fatal }, 400);
        if ('redirect' in result)
          return c.json({ redirectTo: result.redirect });
        try {
          return c.json({
            redirectTo: approveAuthorization(
              c.get('db'),
              c.get('config'),
              c.get('user').id,
              result.ok,
              scopes ?? result.ok.scopes,
            ),
          });
        } catch (e) {
          if (e instanceof OAuthError)
            return c.json({ error: e.description }, 400);
          throw e;
        }
      })
      .post('/deny', zValidator('json', consentSchema), async (c) => {
        const result = await validateAuthorization(
          c.get('db'),
          c.get('config'),
          c.req.valid('json').params,
          fetchImpl,
        );
        if ('fatal' in result) return c.json({ error: result.fatal }, 400);
        if ('redirect' in result)
          return c.json({ redirectTo: result.redirect });
        return c.json({
          redirectTo: denyAuthorization(c.get('config'), result.ok),
        });
      })
      .get('/grants', (c) => c.json(listGrants(c.get('db'), c.get('user').id)))
      .delete('/grants/:id', (c) =>
        disconnectGrant(c.get('db'), c.get('user').id, c.req.param('id'))
          ? c.body(null, 204)
          : c.json({ error: 'Not found' }, 404),
      )
  );
}
