import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type App, get, json, send, setup, signUp } from './test-utils.js';

const origin = 'http://localhost:3000';
const redirect = 'https://claude.example/api/callback';

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function register(app: App, body: object = {}) {
  const res = await app.request('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Claude',
      redirect_uris: [redirect],
      ...body,
    }),
  });
  return { res, body: (await res.json()) as Record<string, unknown> };
}

function authorizeParams(
  clientId: string,
  challenge: string,
  extra: Record<string, string> = {},
) {
  return {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    resource: `${origin}/mcp`,
    ...extra,
  };
}

async function approve(
  app: App,
  cookie: string,
  params: Record<string, string>,
  scopes?: string[],
) {
  const res = await send(app, cookie, 'POST', '/api/oauth/approve', {
    params,
    scopes,
  });
  return (await res.json()) as { redirectTo?: string; error?: string };
}

function token(app: App, form: Record<string, string>) {
  return app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
}

/** Signs up, connects an app, and returns its tokens. */
async function connect(app: App, scopes?: string[]) {
  const { cookie } = await signUp(app, 'cook@example.com');
  const { body: client } = await register(app);
  const { verifier, challenge } = pkce();
  const { redirectTo } = await approve(
    app,
    cookie,
    authorizeParams(client.client_id as string, challenge),
    scopes,
  );
  const code = new URL(redirectTo as string).searchParams.get('code') as string;
  const res = await token(app, {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: client.client_id as string,
    redirect_uri: redirect,
    resource: `${origin}/mcp`,
  });
  expect(res.status).toBe(200);
  return {
    cookie,
    clientId: client.client_id as string,
    code,
    verifier,
    tokens: (await res.json()) as {
      access_token: string;
      refresh_token: string;
      scope: string;
      expires_in: number;
    },
  };
}

async function mcpTools(app: App, accessToken: string) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      fetch: ((url: string | URL, init?: RequestInit) =>
        app.request(String(url), init)) as typeof fetch,
      requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    }),
  );
  return (await client.listTools()).tools.map((t) => t.name);
}

describe('discovery', () => {
  it('points apps from /mcp to sign-in', async () => {
    const { app } = setup();
    const res = await app.request('/mcp', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
    );
    expect(res.headers.get('access-control-expose-headers')).toContain(
      'www-authenticate',
    );

    const resource = await json(
      await app.request('/.well-known/oauth-protected-resource/mcp'),
    );
    expect(resource).toMatchObject({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
    });

    const server = await json(
      await app.request('/.well-known/oauth-authorization-server'),
    );
    expect(server).toMatchObject({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
    });
  });

  it('sends the authorize link on to the consent screen', async () => {
    const { app } = setup();
    const res = await app.request('/oauth/authorize?client_id=x&state=y');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/connect?client_id=x&state=y');
  });
});

describe('registration', () => {
  it('registers public clients with safe redirect addresses', async () => {
    const { app } = setup();
    const ok = await register(app);
    expect(ok.res.status).toBe(201);
    expect(ok.body).toMatchObject({
      client_name: 'Claude',
      token_endpoint_auth_method: 'none',
      redirect_uris: [redirect],
    });

    expect(
      (await register(app, { redirect_uris: ['http://evil.example/cb'] })).res
        .status,
    ).toBe(400);
    expect(
      (
        await register(app, {
          redirect_uris: ['http://localhost:6274/callback'],
        })
      ).res.status,
    ).toBe(201);
    expect(
      (
        await register(app, {
          token_endpoint_auth_method: 'client_secret_basic',
        })
      ).res.status,
    ).toBe(400);
  });
});

describe('connecting an app', () => {
  it('signs in, asks for consent, and gives tokens for just what was allowed', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const { body: client } = await register(app);
    const { verifier, challenge } = pkce();
    const params = authorizeParams(client.client_id as string, challenge, {
      scope: 'recipes:read lists:read lists:write',
    });

    // Signed out, the consent screen's API refuses.
    expect(
      (await get(app, `/api/oauth/request?${new URLSearchParams(params)}`))
        .status,
    ).toBe(401);
    const request = await json(
      await get(
        app,
        `/api/oauth/request?${new URLSearchParams(params)}`,
        cookie,
      ),
    );
    expect(request).toMatchObject({
      client: {
        name: 'Claude',
        redirectHost: 'claude.example',
        verified: false,
      },
      scopes: ['recipes:read', 'lists:read', 'lists:write'],
    });

    // They untick "change our lists".
    const { redirectTo } = await approve(app, cookie, params, [
      'recipes:read',
      'lists:read',
    ]);
    const back = new URL(redirectTo as string);
    expect(back.origin + back.pathname).toBe(redirect);
    expect(back.searchParams.get('state')).toBe('xyz');
    expect(back.searchParams.get('iss')).toBe(origin);

    const res = await token(app, {
      grant_type: 'authorization_code',
      code: back.searchParams.get('code') as string,
      code_verifier: verifier,
      client_id: client.client_id as string,
      redirect_uri: redirect,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const tokens = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      scope: string;
      token_type: string;
    };
    expect(tokens).toMatchObject({
      token_type: 'Bearer',
      scope: 'recipes:read lists:read',
      expires_in: 3600,
    });

    const tools = await mcpTools(app, tokens.access_token);
    expect(tools).toContain('get_shopping_list');
    expect(tools).not.toContain('add_shopping_items');

    // The connection shows in Settings, not among personal tokens.
    const grants = (await (
      await get(app, '/api/oauth/grants', cookie)
    ).json()) as { clientName: string; scopes: string[] }[];
    expect(grants).toEqual([
      expect.objectContaining({
        clientName: 'Claude',
        scopes: ['recipes:read', 'lists:read'],
      }),
    ]);
    expect(await (await get(app, '/api/tokens', cookie)).json()).toEqual([]);
  });

  it('refuses a wrong verifier, a reused code and a different redirect', async () => {
    const { app } = setup();
    const { clientId, code, verifier } = await connect(app);
    // The code was used by connect().
    const reused = await token(app, {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: redirect,
    });
    expect(await reused.json()).toMatchObject({ error: 'invalid_grant' });

    const { cookie } = await signUp(app, 'other@example.com');
    const p = pkce();
    const { redirectTo } = await approve(
      app,
      cookie,
      authorizeParams(clientId, p.challenge),
    );
    const fresh = new URL(redirectTo as string).searchParams.get(
      'code',
    ) as string;
    const wrongVerifier = await token(app, {
      grant_type: 'authorization_code',
      code: fresh,
      code_verifier: pkce().verifier,
      client_id: clientId,
    });
    expect(await wrongVerifier.json()).toMatchObject({
      error: 'invalid_grant',
    });

    // Redirect addresses the app didn't register are refused outright.
    const bad = await approve(
      app,
      cookie,
      authorizeParams(clientId, p.challenge, {
        redirect_uri: 'https://evil.example/cb',
      }),
    );
    expect(bad.error).toMatch(/didn’t register/);
    expect(bad.redirectTo).toBeUndefined();
  });

  it('sends other mistakes back to the app', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const { body: client } = await register(app);
    const noPkce = await approve(app, cookie, {
      response_type: 'code',
      client_id: client.client_id as string,
      redirect_uri: redirect,
      state: 's',
    });
    expect(new URL(noPkce.redirectTo as string).searchParams.get('error')).toBe(
      'invalid_request',
    );
    const otherResource = await approve(
      app,
      cookie,
      authorizeParams(client.client_id as string, pkce().challenge, {
        resource: 'https://elsewhere.example/mcp',
      }),
    );
    expect(
      new URL(otherResource.redirectTo as string).searchParams.get('error'),
    ).toBe('invalid_target');
    const denied = (await (
      await send(app, cookie, 'POST', '/api/oauth/deny', {
        params: authorizeParams(client.client_id as string, pkce().challenge),
      })
    ).json()) as { redirectTo: string };
    expect(new URL(denied.redirectTo).searchParams.get('error')).toBe(
      'access_denied',
    );
  });

  it('rotates refresh tokens and cuts off a connection whose old token reappears', async () => {
    const { app } = setup();
    const { clientId, tokens, cookie } = await connect(app);

    const first = await token(app, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    });
    expect(first.status).toBe(200);
    const rotated = (await first.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    // The old access token stops working; the new one works.
    expect(
      (
        await app.request('/mcp', {
          method: 'POST',
          headers: { authorization: `Bearer ${tokens.access_token}` },
          body: '{}',
        })
      ).status,
    ).toBe(401);
    expect(await mcpTools(app, rotated.access_token)).toContain(
      'search_recipes',
    );

    // Someone replays the old refresh token: the whole connection ends.
    const replay = await token(app, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    });
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });
    const after = await token(app, {
      grant_type: 'refresh_token',
      refresh_token: rotated.refresh_token,
      client_id: clientId,
    });
    expect(after.status).toBe(400);
    expect(await (await get(app, '/api/oauth/grants', cookie)).json()).toEqual(
      [],
    );
  });

  it('can be disconnected from Settings or revoked by the app', async () => {
    const { app } = setup();
    const a = await connect(app);
    const [grant] = (await (
      await get(app, '/api/oauth/grants', a.cookie)
    ).json()) as { id: string }[];
    expect(
      (await send(app, a.cookie, 'DELETE', `/api/oauth/grants/${grant.id}`))
        .status,
    ).toBe(204);
    expect(
      (
        await app.request('/mcp', {
          method: 'POST',
          headers: { authorization: `Bearer ${a.tokens.access_token}` },
          body: '{}',
        })
      ).status,
    ).toBe(401);

    const { app: app2 } = setup();
    const b = await connect(app2);
    const revoked = await app2.request('/oauth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: b.tokens.refresh_token }).toString(),
    });
    expect(revoked.status).toBe(200);
    expect(
      await (await get(app2, '/api/oauth/grants', b.cookie)).json(),
    ).toEqual([]);
  });
});

describe('client metadata documents', () => {
  it('reads the app from the URL it gives as its client_id', async () => {
    const clientId = 'https://app.example/oauth/client.json';
    const fetchImpl = (async (url: string | URL) => {
      expect(String(url)).toBe(clientId);
      return new Response(
        JSON.stringify({
          client_id: clientId,
          client_name: 'Example AI',
          redirect_uris: [redirect],
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    // The fake app lives at a made-up address, so skip the public-address check.
    const { app } = setup(
      { ALLOW_PRIVATE_IMPORTS: 'true' },
      { clientFetch: fetchImpl },
    );
    const { cookie } = await signUp(app, 'cook@example.com');
    const params = authorizeParams(clientId, pkce().challenge);
    const request = await json(
      await get(
        app,
        `/api/oauth/request?${new URLSearchParams(params)}`,
        cookie,
      ),
    );
    expect(request).toMatchObject({
      client: { name: 'Example AI', verified: true },
    });

    const lying = (async () =>
      new Response(
        JSON.stringify({
          client_id: 'https://other.example/x',
          redirect_uris: [redirect],
        }),
      )) as typeof fetch;
    const { app: app2 } = setup(
      { ALLOW_PRIVATE_IMPORTS: 'true' },
      { clientFetch: lying },
    );
    const other = await signUp(app2, 'cook@example.com');
    const res = await get(
      app2,
      `/api/oauth/request?${new URLSearchParams(params)}`,
      other.cookie,
    );
    expect(res.status).toBe(400);
  });
});
