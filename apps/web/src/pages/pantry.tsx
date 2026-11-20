import { type FormEvent, useState } from 'react';
import { BackLink } from '../components/back-link';
import { FormError } from '../components/auth-card';
import { formatQuantity } from '@opencook/domain';
import { usePantry, useRestock, useUpdatePantry } from '../lib/planner';
import { useAddToList } from '../lib/shopping';

/**
 * What the household keeps in: staples it always has (so the planner
 * doesn't add them every week), things running low, and what it's usually
 * bought by now.
 */
export function PantryPage() {
  const pantry = usePantry();
  const restock = useRestock();
  const update = useUpdatePantry();
  const addToList = useAddToList('ongoing');
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  if (!pantry.data) return <p className="text-stone-500">Loading…</p>;
  const staples = pantry.data.items.filter((i) => i.staple);
  const low = pantry.data.items.filter((i) => i.status !== 'have');
  const suggested = pantry.data.suggestedStaples;

  const addStaple = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim())
      update.mutate(
        { addStaples: [name.trim()] },
        { onSuccess: () => setName('') },
      );
  };

  return (
    <>
      <BackLink to="/list">Shopping list</BackLink>
      <h1 className="text-2xl font-semibold">Pantry</h1>

      {!!restock.data?.length && (
        <section className="card space-y-2" aria-label="Usually bought by now">
          <h2 className="font-semibold">Usually bought by now</h2>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {restock.data.map((r) => (
              <li key={r.itemId} className="flex items-center gap-3 py-2">
                <span className="flex-1">
                  {r.name}
                  <span className="block text-xs text-stone-500">
                    Every {r.intervalDays} days; last bought {r.daysSince} days
                    ago
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-sm"
                  disabled={addToList.isPending}
                  onClick={() =>
                    addToList.mutate(
                      [
                        {
                          name: r.name,
                          itemId: r.itemId,
                          quantity: r.lastQuantity,
                          unit: r.lastUnit,
                        },
                      ],
                      { onSuccess: () => void restock.refetch() },
                    )
                  }
                >
                  Add {formatQuantity(r.lastQuantity, r.lastUnit)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {low.length > 0 && (
        <section className="card space-y-2" aria-label="Running low">
          <h2 className="font-semibold">Running low</h2>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {low.map((i) => (
              <li key={i.itemId} className="flex items-center gap-3 py-2">
                <span className="flex-1">
                  {i.name}{' '}
                  <span className="text-xs text-stone-500">
                    {i.status === 'out' ? 'run out' : 'low'}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-sm text-brand-600"
                  onClick={() =>
                    update.mutate({
                      status: [{ item: i.itemId, status: 'have' }],
                    })
                  }
                >
                  Got it
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card space-y-3" aria-label="Staples">
        <h2 className="font-semibold">Staples you always have</h2>
        <p className="text-sm text-stone-500">
          When you shop for the week, these are put under “probably got” instead
          of on the list. Mark one as running low and it goes back on.
        </p>
        {staples.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {staples.map((s) => (
              <li
                key={s.itemId}
                className="flex items-center gap-1 rounded-full border border-stone-300 py-1 pl-3 pr-1 text-sm dark:border-stone-700"
              >
                {s.name}
                <button
                  type="button"
                  className="rounded-full px-2 text-stone-500"
                  aria-label={`${s.name} is running low`}
                  title="Running low"
                  onClick={() =>
                    update.mutate({
                      status: [{ item: s.itemId, status: 'low' }],
                    })
                  }
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="rounded-full px-2 text-stone-500"
                  aria-label={`Not a staple: ${s.name}`}
                  onClick={() => update.mutate({ removeStaples: [s.itemId] })}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addStaple} className="flex gap-2">
          <input
            className="input"
            aria-label="Add a staple"
            placeholder="Add a staple, e.g. fish sauce"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn-secondary shrink-0" disabled={!name.trim()}>
            Add
          </button>
        </form>
      </section>

      {suggested.length > 0 && (
        <section className="card space-y-3" aria-label="Common staples">
          <h2 className="font-semibold">Common staples</h2>
          <p className="text-sm text-stone-500">
            Tick the ones you always keep in.
          </p>
          <ul className="grid grid-cols-2 gap-1">
            {suggested.map((s) => (
              <li key={s.itemId}>
                <label className="flex items-center gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={picked.has(s.itemId)}
                    onChange={() =>
                      setPicked((p) => {
                        const next = new Set(p);
                        if (next.has(s.itemId)) next.delete(s.itemId);
                        else next.add(s.itemId);
                        return next;
                      })
                    }
                  />
                  {s.name}
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn-primary"
            disabled={!picked.size || update.isPending}
            onClick={() =>
              update.mutate(
                { addStaples: [...picked] },
                { onSuccess: () => setPicked(new Set()) },
              )
            }
          >
            Save {picked.size || ''} staple{picked.size === 1 ? '' : 's'}
          </button>
        </section>
      )}
      <FormError
        message={update.error?.message ?? addToList.error?.message ?? null}
      />
    </>
  );
}
