import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { z } from 'zod';
import type { TokenScope } from '@opencook/schemas';
import { AuthCard, FormError } from '../components/auth-card';
import { SCOPE_LABELS } from '../components/api-tokens';
import { api } from '../lib/api';
import { useMe } from '../lib/queries';

const requestSchema = z.union([
  z.object({ redirectTo: z.string() }),
  z.object({
    client: z.object({
      name: z.string(),
      uri: z.string().nullable(),
      logoUri: z.string().nullable(),
      redirectHost: z.string(),
      verified: z.boolean(),
      id: z.string(),
    }),
    scopes: z.array(z.string()),
  }),
]);
const redirectSchema = z.object({ redirectTo: z.string() });

/**
 * The consent screen an AI app sends people to: which app, what it wants to
 * do, and Allow or Deny. Reached from /oauth/authorize after signing in.
 */
export function ConnectPage() {
  const { search } = useLocation();
  const { data: me } = useMe();
  const params = Object.fromEntries(new URLSearchParams(search));
  const request = useQuery({
    queryKey: ['oauth-request', search],
    queryFn: () => api(`/oauth/request${search}`, requestSchema),
    retry: false,
  });
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const decide = useMutation({
    mutationFn: (allow: boolean) =>
      api(`/oauth/${allow ? 'approve' : 'deny'}`, redirectSchema, {
        method: 'POST',
        body: JSON.stringify({
          params,
          scopes:
            allow && request.data && 'scopes' in request.data
              ? request.data.scopes.filter((s) => !unticked.has(s))
              : undefined,
        }),
      }),
    // Back to the app, with a code or a "no".
    onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
  });

  if (request.data && 'redirectTo' in request.data) {
    window.location.assign(request.data.redirectTo);
    return null;
  }

  if (request.isPending) {
    return (
      <AuthCard title="Connecting…">
        <p className="text-center text-stone-500">Checking the app…</p>
      </AuthCard>
    );
  }
  if (request.error || !request.data) {
    return (
      <AuthCard title="Can’t connect this app">
        <FormError
          message={request.error?.message ?? 'Something went wrong.'}
        />
        <p className="text-sm text-stone-500">
          Go back to the app and try again.
        </p>
      </AuthCard>
    );
  }

  const { client, scopes } = request.data;
  const allowed = scopes.filter((s) => !unticked.has(s));

  return (
    <AuthCard title={`Connect ${client.name}?`}>
      <p className="text-sm text-stone-600 dark:text-stone-300">
        <strong>{client.name}</strong> wants to use your openCook as{' '}
        <strong>{me?.name}</strong>. You'll be sent back to{' '}
        <strong>{client.redirectHost}</strong>.
        {!client.verified && (
          <>
            {' '}
            openCook can't confirm who made this app, so only continue if you
            started this from an app you trust.
          </>
        )}
      </p>
      <fieldset className="space-y-1">
        <legend className="label">It may</legend>
        {scopes.map((s) => (
          <label key={s} className="flex items-center gap-2 py-1 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={!unticked.has(s)}
              onChange={() =>
                setUnticked((u) => {
                  const next = new Set(u);
                  if (next.has(s)) next.delete(s);
                  else next.add(s);
                  return next;
                })
              }
            />
            {SCOPE_LABELS[s as TokenScope] ?? s}
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-stone-500">
        You can disconnect it at any time in Settings → AI assistants.
      </p>
      <FormError message={decide.error?.message ?? null} />
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={!allowed.length || decide.isPending}
          onClick={() => decide.mutate(true)}
        >
          Allow
        </button>
        <button
          type="button"
          className="btn-secondary flex-1"
          disabled={decide.isPending}
          onClick={() => decide.mutate(false)}
        >
          Deny
        </button>
      </div>
    </AuthCard>
  );
}
