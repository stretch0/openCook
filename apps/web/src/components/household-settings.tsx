import { type FormEvent, useState } from 'react';
import type { HouseholdInvite } from '@opencook/schemas';
import { useMe } from '../lib/queries';
import {
  createHouseholdInvite,
  useHousehold,
  useHouseholdChange,
  useRenameHousehold,
} from '../lib/shopping';
import { FormError } from './auth-card';

/** Who shares your shopping list, and inviting someone to. */
export function HouseholdSettings() {
  const { data: me } = useMe();
  const household = useHousehold();
  const rename = useRenameHousehold();
  const leave = useHouseholdChange();
  const [invite, setInvite] = useState<HouseholdInvite | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!household.data) return null;
  const h = household.data;
  const link = invite ? `${window.location.origin}/join/${invite.code}` : null;

  const onRename = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    rename.mutate(String(new FormData(e.currentTarget).get('household-name')));
  };

  const makeInvite = async () => {
    setError(null);
    try {
      setInvite(await createHouseholdInvite());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create an invite');
    }
  };

  const share = async () => {
    if (!link) return;
    try {
      if (navigator.share)
        await navigator.share({
          title: `Join ${h.name} on openCook`,
          url: link,
        });
      else await navigator.clipboard.writeText(link);
    } catch {
      /* cancelled */
    }
  };

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Household</h2>
      <p className="text-sm text-stone-500">
        Everyone in your household shares the shopping list, meal plan and
        pantry, and can see each other's recipes. Only you can change yours.
      </p>
      <form onSubmit={onRename} className="flex gap-2">
        <input
          className="input"
          name="household-name"
          aria-label="Household name"
          defaultValue={h.name}
          key={h.name}
          required
          maxLength={100}
        />
        <button className="btn-secondary shrink-0" disabled={rename.isPending}>
          Rename
        </button>
      </form>
      <ul className="divide-y divide-stone-200 text-sm dark:divide-stone-800">
        {h.members.map((m) => (
          <li key={m.id} className="flex justify-between py-1.5">
            <span>
              {m.name}
              {m.id === me?.id ? ' (you)' : ''}
            </span>
            <span className="text-stone-500">
              {m.role === 'owner' ? 'Owner' : 'Member'}
            </span>
          </li>
        ))}
      </ul>
      {link ? (
        <div className="space-y-2 rounded-xl bg-brand-50 p-3 text-sm dark:bg-brand-500/10">
          <p>
            Send this link to whoever you shop with. It works once, for 7 days.
            They'll need an account on this openCook.
          </p>
          <code className="block break-all rounded bg-white p-2 dark:bg-stone-900">
            {link}
          </code>
          <button type="button" className="btn-secondary" onClick={share}>
            Share link
          </button>
        </div>
      ) : (
        <button type="button" className="btn-secondary" onClick={makeInvite}>
          Invite someone
        </button>
      )}
      {h.members.length > 1 && (
        <button
          type="button"
          className="block text-sm text-red-600"
          onClick={() => {
            if (
              window.confirm(
                `Leave ${h.name}? You'll get a new, empty shopping list.`,
              )
            ) {
              leave.mutate('leave');
            }
          }}
        >
          Leave household
        </button>
      )}
      <FormError
        message={error ?? rename.error?.message ?? leave.error?.message ?? null}
      />
    </section>
  );
}
