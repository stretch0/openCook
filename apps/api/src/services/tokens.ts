import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { type Db, schema } from '@opencook/db';
import type { ApiToken, CreateToken, CreatedToken } from '@opencook/schemas';
import { HttpError, notFound } from './errors.js';

/** Tokens look like "ock_…"; only a SHA-256 of them is stored. */
const PREFIX = 'ock_';
const MAX_TOKENS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

function toApiToken(t: typeof schema.apiToken.$inferSelect): ApiToken {
  return {
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    scopes: t.scopes,
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

export function listTokens(db: Db, userId: string): ApiToken[] {
  return (
    db
      .select()
      .from(schema.apiToken)
      // Access tokens of connected apps are listed under the app instead.
      .where(
        and(
          eq(schema.apiToken.userId, userId),
          isNull(schema.apiToken.grantId),
        ),
      )
      .orderBy(desc(schema.apiToken.createdAt))
      .all()
      .map(toApiToken)
  );
}

export function createToken(
  db: Db,
  userId: string,
  input: CreateToken,
): CreatedToken {
  if (listTokens(db, userId).length >= MAX_TOKENS) {
    throw new HttpError(
      422,
      `You can have at most ${MAX_TOKENS} tokens. Revoke one first.`,
    );
  }
  const token = PREFIX + randomBytes(24).toString('base64url');
  const [row] = db
    .insert(schema.apiToken)
    .values({
      userId,
      name: input.name,
      tokenHash: hashToken(token),
      prefix: token.slice(0, PREFIX.length + 4),
      scopes: [...new Set(input.scopes)],
      expiresAt: input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * DAY_MS)
        : null,
    })
    .returning()
    .all();
  return { ...toApiToken(row), token };
}

export function revokeToken(db: Db, userId: string, id: string) {
  const res = db
    .delete(schema.apiToken)
    .where(and(eq(schema.apiToken.id, id), eq(schema.apiToken.userId, userId)))
    .run();
  if (!res.changes) throw notFound('Token not found');
}

/** The user and scopes a bearer token grants, or null if it's unknown or expired. */
export function verifyToken(
  db: Db,
  token: string,
): { userId: string; scopes: string[] } | null {
  if (!token.startsWith(PREFIX)) return null;
  const row = db
    .select()
    .from(schema.apiToken)
    .where(eq(schema.apiToken.tokenHash, hashToken(token)))
    .get();
  if (!row || (row.expiresAt && row.expiresAt < new Date())) return null;
  // Only record use once a minute, to keep writes down.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    db.update(schema.apiToken)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.apiToken.id, row.id))
      .run();
  }
  return { userId: row.userId, scopes: row.scopes };
}
