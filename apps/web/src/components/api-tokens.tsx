import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { z } from 'zod';
import {
  type CreateToken,
  type CreatedToken,
  type TokenScope,
  apiTokenSchema,
  createdTokenSchema,
} from '@opencook/schemas';
import { api } from '../lib/api';
import { formatAgo } from '../lib/format';
import { FormError } from './auth-card';

const SCOPE_LABELS: Record<TokenScope, string> = {
  'recipes:read': 'Read and search my recipes',
  'recipes:write': 'Save, change and delete my recipes',
  'lists:read': 'Read our shopping lists and purchase history',
  'lists:write': 'Add to, change and tick off our shopping lists',
};

/** Personal tokens that let AI assistants use openCook over MCP. */
export function ApiTokens() {
  const queryClient = useQueryClient();
  const tokens = useQuery({
    queryKey: ['tokens'],
    queryFn: () => api('/tokens', z.array(apiTokenSchema)),
  });
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tokens'] });
  const create = useMutation({
    mutationFn: (body: CreateToken) =>
      api('/tokens', createdTokenSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (t) => {
      setCreated(t);
      void refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api(`/tokens/${id}`, z.undefined(), { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const expires = Number(form.get('expires'));
    create.mutate({
      name: String(form.get('name')),
      scopes: form.getAll('scopes') as TokenScope[],
      expiresInDays: expires || undefined,
    });
    e.currentTarget.reset();
  };

  const endpoint = `${window.location.origin}/mcp`;

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">AI assistants</h2>
      <p className="text-sm text-stone-500">
        Let an AI assistant such as Claude find and save recipes for you. Create
        a token, then add openCook as an MCP server at{' '}
        <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">
          {endpoint}
        </code>{' '}
        with the header{' '}
        <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">
          Authorization: Bearer &lt;token&gt;
        </code>
        .
      </p>

      {created && (
        <div className="space-y-2 rounded-xl bg-brand-50 p-3 text-sm dark:bg-brand-500/10">
          <p className="font-medium">
            Copy your token now. It won't be shown again.
          </p>
          <code className="block break-all rounded bg-white p-2 dark:bg-stone-900">
            {created.token}
          </code>
          <p className="text-stone-600 dark:text-stone-400">For Claude Code:</p>
          <code className="block break-all rounded bg-white p-2 text-xs dark:bg-stone-900">
            claude mcp add --transport http opencook {endpoint} --header
            "Authorization: Bearer {created.token}"
          </code>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void navigator.clipboard?.writeText(created.token)}
            >
              Copy token
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCreated(null)}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {!!tokens.data?.length && (
        <ul className="divide-y divide-stone-200 dark:divide-stone-800">
          {tokens.data.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-stone-500">
                  {t.prefix}… ·{' '}
                  {t.scopes.includes('recipes:write')
                    ? 'read & write'
                    : 'read only'}{' '}
                  ·{' '}
                  {t.lastUsedAt
                    ? `used ${formatAgo(t.lastUsedAt)}`
                    : 'never used'}
                  {t.expiresAt
                    ? ` · expires ${new Date(t.expiresAt).toLocaleDateString()}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                className="text-red-600"
                onClick={() => revoke.mutate(t.id)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit} className="space-y-2">
        <div>
          <label className="label" htmlFor="token-name">
            New token name
          </label>
          <input
            className="input"
            id="token-name"
            name="name"
            placeholder="Claude on my laptop"
            required
            maxLength={100}
          />
        </div>
        <fieldset className="space-y-1 text-sm">
          <legend className="label">It may</legend>
          {(Object.keys(SCOPE_LABELS) as TokenScope[]).map((s) => (
            <label key={s} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="scopes"
                value={s}
                defaultChecked
                className="accent-brand-600"
              />
              {SCOPE_LABELS[s]}
            </label>
          ))}
        </fieldset>
        <div>
          <label className="label" htmlFor="token-expires">
            Expires
          </label>
          <select
            className="input"
            id="token-expires"
            name="expires"
            defaultValue="90"
          >
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
            <option value="365">In a year</option>
            <option value="">Never</option>
          </select>
        </div>
        <FormError message={create.error?.message ?? null} />
        <button className="btn-secondary" disabled={create.isPending}>
          Create token
        </button>
      </form>
    </section>
  );
}
