import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { and, desc, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { type Db, schema } from '@opencook/db';
import { safeFetch } from '@opencook/recipe-import';
import { TOKEN_SCOPES } from '@opencook/schemas';
import type { Config } from '../config.js';
import { hashToken } from './tokens.js';

/**
 * openCook as its own OAuth 2.1 authorization server, so AI apps (claude.ai,
 * ChatGPT…) can connect with a sign-in and a consent screen instead of a
 * pasted token. Follows the MCP authorization spec:
 *
 * - discovery: RFC 9728 (protected resource) and RFC 8414 (server) metadata;
 * - clients: dynamic registration (RFC 7591) or a client ID metadata document;
 * - public clients only, authorization code with PKCE (S256) required;
 * - tokens are for one resource, the /mcp endpoint (RFC 8707);
 * - refresh tokens rotate on every use, and a reused one revokes the grant.
 *
 * Access tokens are ordinary `ock_` API tokens with an expiry, so /mcp checks
 * them exactly like personal tokens.
 */

const ACCESS_TOKEN_SECONDS = 60 * 60;
const CODE_SECONDS = 10 * 60;
const METADATA_DOCUMENT_TTL_MS = 24 * 60 * 60 * 1000;

export class OAuthError extends Error {
  constructor(
    public error: string,
    public description: string,
    public status: 400 | 401 = 400,
  ) {
    super(description);
  }
}

export const resourceUrl = (config: Config) => `${config.origin}/mcp`;

export function protectedResourceMetadata(config: Config) {
  return {
    resource: resourceUrl(config),
    authorization_servers: [config.origin],
    scopes_supported: [...TOKEN_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: config.instanceName,
  };
}

export function authorizationServerMetadata(config: Config) {
  return {
    issuer: config.origin,
    authorization_endpoint: `${config.origin}/oauth/authorize`,
    token_endpoint: `${config.origin}/oauth/token`,
    registration_endpoint: `${config.origin}/oauth/register`,
    revocation_endpoint: `${config.origin}/oauth/revoke`,
    scopes_supported: [...TOKEN_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  };
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const b64urlSha256 = (s: string) =>
  createHash('sha256').update(s).digest('base64url');

/** https anywhere; plain http only back to this machine (desktop apps, CLIs). */
function allowedRedirect(uri: string) {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === 'https:') return true;
  return (
    u.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  );
}

type ClientRow = typeof schema.oauthClient.$inferSelect;

/** RFC 7591: an app registers itself and gets a client_id. */
export function registerClient(db: Db, body: unknown) {
  const b = (body && typeof body === 'object' ? body : {}) as Record<
    string,
    unknown
  >;
  const redirectUris = b.redirect_uris;
  if (
    !Array.isArray(redirectUris) ||
    !redirectUris.length ||
    redirectUris.length > 10 ||
    !redirectUris.every(
      (u) => typeof u === 'string' && u.length <= 2000 && allowedRedirect(u),
    )
  ) {
    throw new OAuthError(
      'invalid_redirect_uri',
      'redirect_uris must list 1 to 10 https URLs (or http on localhost), without fragments.',
    );
  }
  const method = b.token_endpoint_auth_method ?? 'none';
  if (method !== 'none') {
    throw new OAuthError(
      'invalid_client_metadata',
      'Only public clients are supported: use token_endpoint_auth_method "none" with PKCE.',
    );
  }
  const grantTypes = (b.grant_types as string[] | undefined) ?? [
    'authorization_code',
    'refresh_token',
  ];
  if (
    !Array.isArray(grantTypes) ||
    grantTypes.some((g) => !['authorization_code', 'refresh_token'].includes(g))
  ) {
    throw new OAuthError(
      'invalid_client_metadata',
      'Supported grant_types: authorization_code, refresh_token.',
    );
  }
  const name =
    typeof b.client_name === 'string' && b.client_name.trim()
      ? b.client_name.trim().slice(0, 100)
      : 'An app';
  const uri =
    typeof b.client_uri === 'string' && b.client_uri.startsWith('https://')
      ? b.client_uri
      : null;
  const logoUri =
    typeof b.logo_uri === 'string' && b.logo_uri.startsWith('https://')
      ? b.logo_uri
      : null;
  const id = `occ_${randomUUID()}`;
  db.insert(schema.oauthClient)
    .values({
      id,
      kind: 'registered',
      name,
      redirectUris: redirectUris as string[],
      uri,
      logoUri,
    })
    .run();
  return {
    client_id: id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    client_uri: uri ?? undefined,
    logo_uri: logoUri ?? undefined,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

export type ClientFetcher = typeof fetch | undefined;

/**
 * The client for a client_id: a registered one, or (when the id is an
 * https URL) the app described by the metadata document at that URL,
 * fetched safely and cached for a day.
 */
export async function resolveClient(
  db: Db,
  config: Config,
  clientId: string,
  fetchImpl?: ClientFetcher,
): Promise<ClientRow> {
  const existing = db
    .select()
    .from(schema.oauthClient)
    .where(eq(schema.oauthClient.id, clientId))
    .get();
  if (existing?.kind === 'registered') return existing;
  if (!clientId.startsWith('https://')) {
    throw new OAuthError(
      'invalid_client',
      'Unknown client_id. Register the app first.',
      401,
    );
  }
  if (
    existing?.fetchedAt &&
    Date.now() - existing.fetchedAt.getTime() < METADATA_DOCUMENT_TTL_MS
  ) {
    return existing;
  }
  let doc: Record<string, unknown>;
  try {
    const res = await safeFetch(clientId, {
      accept: 'application/json',
      maxBytes: 64 * 1024,
      timeoutMs: 10_000,
      allowPrivate: config.allowPrivateImports,
      fetchImpl,
    });
    doc = JSON.parse(new TextDecoder().decode(res.body));
  } catch (e) {
    throw new OAuthError(
      'invalid_client',
      `Couldn't read the app's client metadata document: ${e instanceof Error ? e.message : e}`,
      401,
    );
  }
  const redirectUris = doc.redirect_uris;
  if (
    doc.client_id !== clientId ||
    !Array.isArray(redirectUris) ||
    !redirectUris.length ||
    !redirectUris.every((u) => typeof u === 'string' && allowedRedirect(u))
  ) {
    throw new OAuthError(
      'invalid_client',
      'The client metadata document must repeat its own URL as client_id and list redirect_uris.',
      401,
    );
  }
  const values = {
    kind: 'metadata_document' as const,
    name:
      typeof doc.client_name === 'string' && doc.client_name.trim()
        ? doc.client_name.trim().slice(0, 100)
        : new URL(clientId).hostname,
    redirectUris: redirectUris as string[],
    uri:
      typeof doc.client_uri === 'string' &&
      doc.client_uri.startsWith('https://')
        ? doc.client_uri
        : null,
    logoUri:
      typeof doc.logo_uri === 'string' && doc.logo_uri.startsWith('https://')
        ? doc.logo_uri
        : null,
    fetchedAt: new Date(),
  };
  db.insert(schema.oauthClient)
    .values({ id: clientId, ...values })
    .onConflictDoUpdate({ target: schema.oauthClient.id, set: values })
    .run();
  return db
    .select()
    .from(schema.oauthClient)
    .where(eq(schema.oauthClient.id, clientId))
    .get() as ClientRow;
}

export type AuthorizeParams = Record<string, string | undefined>;

export type ValidRequest = {
  client: ClientRow;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  state: string | null;
  resource: string;
};

/**
 * Checks an authorization request. Problems with the client or redirect URI
 * are shown to the person (never redirected, so the link can't be used to
 * bounce people elsewhere); anything else is reported back to the app.
 */
export async function validateAuthorization(
  db: Db,
  config: Config,
  p: AuthorizeParams,
  fetchImpl?: ClientFetcher,
): Promise<{ ok: ValidRequest } | { fatal: string } | { redirect: string }> {
  if (!p.client_id)
    return { fatal: 'The app didn’t say who it is (no client_id).' };
  let client: ClientRow;
  try {
    client = await resolveClient(db, config, p.client_id, fetchImpl);
  } catch (e) {
    return { fatal: e instanceof Error ? e.message : 'Unknown app.' };
  }
  const redirectUri =
    p.redirect_uri ??
    (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return {
      fatal: 'The app asked to send you back to an address it didn’t register.',
    };
  }
  const back = (error: string, description: string) => {
    const u = new URL(redirectUri);
    u.searchParams.set('error', error);
    u.searchParams.set('error_description', description);
    if (p.state) u.searchParams.set('state', p.state);
    u.searchParams.set('iss', config.origin);
    return { redirect: u.toString() };
  };
  if (p.response_type !== 'code')
    return back(
      'unsupported_response_type',
      'Only response_type=code is supported.',
    );
  if (
    !p.code_challenge ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_challenge)
  ) {
    return back('invalid_request', 'PKCE is required: send a code_challenge.');
  }
  if ((p.code_challenge_method ?? 'plain') !== 'S256') {
    return back(
      'invalid_request',
      'Only code_challenge_method=S256 is supported.',
    );
  }
  const resource = resourceUrl(config);
  if (
    p.resource &&
    p.resource.replace(/\/$/, '') !== resource &&
    p.resource.replace(/\/$/, '') !== config.origin
  ) {
    return back(
      'invalid_target',
      `This server can only issue tokens for ${resource}.`,
    );
  }
  const asked = (p.scope ?? '').split(' ').filter(Boolean);
  const known = new Set<string>(TOKEN_SCOPES);
  const scopes = asked.length
    ? asked.filter((s) => known.has(s))
    : [...TOKEN_SCOPES];
  if (!scopes.length)
    return back('invalid_scope', `Known scopes: ${TOKEN_SCOPES.join(' ')}.`);
  return {
    ok: {
      client,
      redirectUri,
      scopes,
      codeChallenge: p.code_challenge,
      state: p.state ?? null,
      resource,
    },
  };
}

/** After consent: a one-time code, sent back to the app. */
export function approveAuthorization(
  db: Db,
  config: Config,
  userId: string,
  req: ValidRequest,
  grantedScopes: string[],
): string {
  const scopes = req.scopes.filter((s) => grantedScopes.includes(s));
  if (!scopes.length)
    throw new OAuthError('invalid_scope', 'Allow at least one thing.');
  const code = randomBytes(32).toString('base64url');
  db.insert(schema.oauthCode)
    .values({
      codeHash: sha256(code),
      clientId: req.client.id,
      userId,
      redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge,
      scopes,
      resource: req.resource,
      expiresAt: new Date(Date.now() + CODE_SECONDS * 1000),
    })
    .run();
  // Codes expire quickly; clear old ones while we're here.
  db.delete(schema.oauthCode)
    .where(lt(schema.oauthCode.expiresAt, new Date(Date.now() - 86_400_000)))
    .run();
  const u = new URL(req.redirectUri);
  u.searchParams.set('code', code);
  if (req.state) u.searchParams.set('state', req.state);
  u.searchParams.set('iss', config.origin);
  return u.toString();
}

export function denyAuthorization(config: Config, req: ValidRequest): string {
  const u = new URL(req.redirectUri);
  u.searchParams.set('error', 'access_denied');
  u.searchParams.set('error_description', 'The person said no.');
  if (req.state) u.searchParams.set('state', req.state);
  u.searchParams.set('iss', config.origin);
  return u.toString();
}

function issueAccessToken(
  db: Db,
  grant: typeof schema.oauthGrant.$inferSelect,
  clientName: string,
) {
  const token = `ock_${randomBytes(24).toString('base64url')}`;
  db.insert(schema.apiToken)
    .values({
      userId: grant.userId,
      name: clientName,
      tokenHash: hashToken(token),
      prefix: token.slice(0, 8),
      scopes: grant.scopes,
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_SECONDS * 1000),
      grantId: grant.id,
    })
    .run();
  return token;
}

function deleteGrant(db: Db, grantId: string) {
  // The api_token → grant link was added by ALTER TABLE, which in SQLite
  // can't carry ON DELETE CASCADE, so the tokens go first, by hand.
  db.transaction((tx) => {
    tx.delete(schema.apiToken)
      .where(eq(schema.apiToken.grantId, grantId))
      .run();
    tx.delete(schema.oauthGrant).where(eq(schema.oauthGrant.id, grantId)).run();
  });
}

function tokenResponse(
  accessToken: string,
  refreshToken: string,
  scopes: string[],
) {
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_SECONDS,
    refresh_token: refreshToken,
    scope: scopes.join(' '),
  };
}

function sameString(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The token endpoint: exchanges a code, or rotates a refresh token. */
export function exchangeToken(
  db: Db,
  config: Config,
  form: Record<string, string | undefined>,
) {
  const clientId = form.client_id;
  if (!clientId)
    throw new OAuthError('invalid_client', 'client_id is required.', 401);
  const client = db
    .select()
    .from(schema.oauthClient)
    .where(eq(schema.oauthClient.id, clientId))
    .get();
  if (!client)
    throw new OAuthError('invalid_client', 'Unknown client_id.', 401);
  if (
    form.resource &&
    form.resource.replace(/\/$/, '') !== resourceUrl(config) &&
    form.resource.replace(/\/$/, '') !== config.origin
  ) {
    throw new OAuthError(
      'invalid_target',
      `Tokens here are only for ${resourceUrl(config)}.`,
    );
  }

  if (form.grant_type === 'authorization_code') {
    const { code, code_verifier: verifier, redirect_uri: redirectUri } = form;
    if (!code || !verifier)
      throw new OAuthError(
        'invalid_request',
        'code and code_verifier are required.',
      );
    const row = db
      .select()
      .from(schema.oauthCode)
      .where(eq(schema.oauthCode.codeHash, sha256(code)))
      .get();
    if (
      !row ||
      row.usedAt ||
      row.expiresAt < new Date() ||
      row.clientId !== clientId
    ) {
      throw new OAuthError(
        'invalid_grant',
        'This code is invalid, expired or already used.',
      );
    }
    if (redirectUri !== undefined && redirectUri !== row.redirectUri) {
      throw new OAuthError(
        'invalid_grant',
        'redirect_uri doesn’t match the one used to ask.',
      );
    }
    if (!sameString(b64urlSha256(verifier), row.codeChallenge)) {
      throw new OAuthError(
        'invalid_grant',
        'code_verifier doesn’t match the code_challenge.',
      );
    }
    // Claim it first: a code is good for exactly one exchange, even if two
    // requests race.
    const claimed = db
      .update(schema.oauthCode)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(schema.oauthCode.codeHash, row.codeHash),
          isNull(schema.oauthCode.usedAt),
        ),
      )
      .run();
    if (claimed.changes !== 1) {
      throw new OAuthError(
        'invalid_grant',
        'This code is invalid, expired or already used.',
      );
    }
    const refreshToken = `ocr_${randomBytes(32).toString('base64url')}`;
    const [grant] = db
      .insert(schema.oauthGrant)
      .values({
        clientId,
        userId: row.userId,
        scopes: row.scopes,
        resource: row.resource,
        refreshTokenHash: sha256(refreshToken),
        lastUsedAt: new Date(),
      })
      .returning()
      .all();
    return tokenResponse(
      issueAccessToken(db, grant, client.name),
      refreshToken,
      grant.scopes,
    );
  }

  if (form.grant_type === 'refresh_token') {
    const presented = form.refresh_token;
    if (!presented)
      throw new OAuthError('invalid_request', 'refresh_token is required.');
    const hash = sha256(presented);
    const grant = db
      .select()
      .from(schema.oauthGrant)
      .where(eq(schema.oauthGrant.refreshTokenHash, hash))
      .get();
    if (!grant) {
      // An old, already-rotated refresh token: someone else may have it, so
      // the whole connection is revoked and the app must ask again.
      const stolen = db
        .select()
        .from(schema.oauthGrant)
        .where(
          and(
            isNotNull(schema.oauthGrant.previousRefreshTokenHash),
            eq(schema.oauthGrant.previousRefreshTokenHash, hash),
          ),
        )
        .get();
      if (stolen) deleteGrant(db, stolen.id);
      throw new OAuthError(
        'invalid_grant',
        'This refresh token is no longer valid.',
      );
    }
    if (grant.clientId !== clientId)
      throw new OAuthError(
        'invalid_grant',
        'This refresh token belongs to another app.',
      );
    const next = `ocr_${randomBytes(32).toString('base64url')}`;
    db.transaction((tx) => {
      tx.update(schema.oauthGrant)
        .set({
          refreshTokenHash: sha256(next),
          previousRefreshTokenHash: hash,
          lastUsedAt: new Date(),
        })
        .where(eq(schema.oauthGrant.id, grant.id))
        .run();
      // Earlier access tokens for this connection stop working.
      tx.delete(schema.apiToken)
        .where(eq(schema.apiToken.grantId, grant.id))
        .run();
    });
    return tokenResponse(
      issueAccessToken(db, grant, client.name),
      next,
      grant.scopes,
    );
  }

  throw new OAuthError(
    'unsupported_grant_type',
    'Use authorization_code or refresh_token.',
  );
}

/** RFC 7009: revoking a refresh token ends the connection; an access token, just itself. */
export function revokeToken(db: Db, token: string | undefined) {
  if (!token) return;
  if (token.startsWith('ocr_')) {
    const grant = db
      .select()
      .from(schema.oauthGrant)
      .where(eq(schema.oauthGrant.refreshTokenHash, sha256(token)))
      .get();
    if (grant) deleteGrant(db, grant.id);
    return;
  }
  if (token.startsWith('ock_')) {
    db.delete(schema.apiToken)
      .where(
        and(
          eq(schema.apiToken.tokenHash, hashToken(token)),
          isNotNull(schema.apiToken.grantId),
        ),
      )
      .run();
  }
}

/** The apps someone has connected, for Settings. */
export function listGrants(db: Db, userId: string) {
  return db
    .select({ grant: schema.oauthGrant, client: schema.oauthClient })
    .from(schema.oauthGrant)
    .innerJoin(
      schema.oauthClient,
      eq(schema.oauthClient.id, schema.oauthGrant.clientId),
    )
    .where(eq(schema.oauthGrant.userId, userId))
    .orderBy(desc(schema.oauthGrant.createdAt))
    .all()
    .map(({ grant, client }) => ({
      id: grant.id,
      clientName: client.name,
      clientUri: client.uri,
      scopes: grant.scopes,
      connectedAt: grant.createdAt.toISOString(),
      lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
    }));
}

export function disconnectGrant(db: Db, userId: string, grantId: string) {
  const grant = db
    .select()
    .from(schema.oauthGrant)
    .where(eq(schema.oauthGrant.id, grantId))
    .get();
  if (!grant || grant.userId !== userId) return false;
  deleteGrant(db, grantId);
  return true;
}
