import { z } from 'zod';

/** What an API token (used by MCP clients) may do. */
export const TOKEN_SCOPES = ['recipes:read', 'recipes:write'] as const;
export const tokenScopeSchema = z.enum(TOKEN_SCOPES);
export type TokenScope = z.infer<typeof tokenScopeSchema>;

export const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(tokenScopeSchema).min(1),
  /** Days until it stops working; omit for no expiry. */
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export type CreateToken = z.infer<typeof createTokenSchema>;

export const apiTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ApiToken = z.infer<typeof apiTokenSchema>;

/** Returned once, when a token is created. */
export const createdTokenSchema = apiTokenSchema.extend({ token: z.string() });
export type CreatedToken = z.infer<typeof createdTokenSchema>;
