import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { user } from './auth.js';
import { id, timestamp, timestamps } from './columns.js';

/**
 * An app that can ask people to connect openCook (claude.ai, ChatGPT…).
 * Either registered itself (dynamic client registration) or identified by
 * the URL of its client metadata document.
 */
export const oauthClient = sqliteTable('oauth_client', {
  /** Our generated id, or the metadata document's https URL. */
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['registered', 'metadata_document'] }).notNull(),
  name: text('name').notNull(),
  /** Where the app may send people back to; exact matches only. */
  redirectUris: text('redirect_uris', { mode: 'json' }).$type<string[]>().notNull(),
  uri: text('uri'),
  logoUri: text('logo_uri'),
  /** For metadata documents: when it was last fetched. */
  fetchedAt: timestamp('fetched_at'),
  ...timestamps,
});

/** A one-time code from the consent screen, exchanged for tokens. */
export const oauthCode = sqliteTable(
  'oauth_code',
  {
    /** SHA-256 of the code; the code itself is never stored. */
    codeHash: text('code_hash').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    resource: text('resource').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    ...timestamps,
  },
  (t) => [index('oauth_code_client_idx').on(t.clientId)],
);

/**
 * Someone's consent for an app: what it may do, and the current refresh
 * token (rotated on every use). Disconnecting the app deletes it, and with
 * it every access token it was given.
 */
export const oauthGrant = sqliteTable(
  'oauth_grant',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    resource: text('resource').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    /** The refresh token before the last rotation; seeing it again means it leaked. */
    previousRefreshTokenHash: text('previous_refresh_token_hash'),
    lastUsedAt: timestamp('last_used_at'),
    ...timestamps,
  },
  (t) => [
    index('oauth_grant_user_idx').on(t.userId),
    index('oauth_grant_previous_idx').on(t.previousRefreshTokenHash),
  ],
);
