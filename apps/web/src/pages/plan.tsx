import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addDays, formatQuantity, today, weekStart } from '@opencook/domain';
import type { MealSlot, PlanEntry, ShoppingNeed } from '@opencook/schemas';
import { FormError } from '../components/auth-card';
import { RecipeThumb } from '../components/recipe-card';
import { Sheet } from '../components/sheet';
import { formatDay } from '../lib/format';
import {
  useAddNeeds,
  useAddPlanEntry,
  usePlan,
  useRemovePlanEntry,
  useShoppingPreview,
  useUpdatePlanEntry,
} from '../lib/planner';
import { useMe } from '../lib/queries';
import { useRecipes } from '../lib/recipes';

const SLOTS: { value: MealSlot; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

/** The household's week of meals, and shopping for it. */
export function PlanPage() {
  const { data: me } = useMe();
  const now = today(me?.timezone);
  const [params, setParams] = useSearchParams();
  const from = weekStart(params.get('week') ?? now);
  const plan = usePlan(from);
  const [adding, setAdding] = useState<string | null>(null);
  const [open, setOpen] = useState<PlanEntry | null>(null);
  const [shopping, setShopping] = useState(false);
  const go = (weeks: number) =>
    setParams({ week: addDays(from, weeks * 7) }, { replace: true });

  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const entries = plan.data?.entries ?? [];
  const toCook = entries.filter((e) => e.recipeId && !e.cookedAt).length;

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Meal plan</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-secondary px-3 py-1.5"
            aria-label="Previous week"
            onClick={() => go(-1)}
          >
            ‹
          </button>
          {from !== weekStart(now) && (
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              onClick={() => setParams({}, { replace: true })}
            >
              This week
            </button>
          )}
          <button
            type="button"
            className="btn-secondary px-3 py-1.5"
            aria-label="Next week"
            onClick={() => go(1)}
          >
            ›
          </button>
        </div>
      </div>
      <p className="text-sm text-stone-500">
        {formatDay(from)} – {formatDay(addDays(from, 6))}
      </p>

      <button
        type="button"
        className="btn-primary w-full"
        disabled={!toCook}
        onClick={() => setShopping(true)}
      >
        Shop for this week
        {toCook ? ` (${toCook} meal${toCook === 1 ? '' : 's'})` : ''}
      </button>

      <div className="space-y-2">
        {days.map((day) => {
          const meals = entries.filter((e) => e.date === day);
          return (
            <section
              key={day}
              className={`card p-3 ${day === now ? 'border-brand-500' : ''}`}
              aria-label={formatDay(day)}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">
                  {formatDay(day)}
                  {day === now && (
                    <span className="ml-2 text-xs font-medium text-brand-600">
                      Today
                    </span>
                  )}
                </h2>
                <button
                  type="button"
                  className="text-sm text-brand-600"
                  onClick={() => setAdding(day)}
                >
                  + Add
                </button>
              </div>
              {meals.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {meals.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 text-left"
                        onClick={() => setOpen(m)}
                      >
                        <RecipeThumb
                          url={m.imageUrl}
                          className="h-11 w-11 shrink-0 rounded-lg text-xl"
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate ${m.cookedAt ? 'text-stone-400 line-through' : ''}`}
                          >
                            {m.title}
                          </span>
                          <span className="block text-xs text-stone-500">
                            {SLOTS.find((s) => s.value === m.slot)?.label}
                            {(m.servings ?? m.recipeServings)
                              ? ` · for ${m.servings ?? m.recipeServings}`
                              : ''}
                            {m.cookedAt ? ' · cooked' : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {adding && <AddMealSheet date={adding} onClose={() => setAdding(null)} />}
      {open && <MealSheet entry={open} onClose={() => setOpen(null)} />}
      {shopping && (
        <ShopSheet
          from={from}
          to={addDays(from, 6)}
          onClose={() => setShopping(false)}
        />
      )}
    </>
  );
}

function AddMealSheet({
  date,
  onClose,
}: {
  date: string;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [slot, setSlot] = useState<MealSlot>('dinner');
  const recipes = useRecipes({
    q: q.trim() || undefined,
    scope: 'mine',
    limit: 20,
  });
  const add = useAddPlanEntry();
  const plan = (body: { recipeId?: string; title?: string }) =>
    add.mutate({ date, slot, ...body }, { onSuccess: onClose });

  const onFreeText = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) plan({ title: q.trim() });
  };

  return (
    <Sheet label={`Plan a meal for ${formatDay(date)}`} onClose={onClose}>
      <h2 className="text-lg font-semibold">{formatDay(date)}</h2>
      <div
        className="flex rounded-lg bg-stone-100 p-1 text-sm dark:bg-stone-800"
        role="group"
        aria-label="Meal"
      >
        {SLOTS.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={slot === s.value}
            onClick={() => setSlot(s.value)}
            className={`flex-1 rounded-md px-2 py-1.5 ${slot === s.value ? 'bg-white font-medium shadow-sm dark:bg-stone-700' : 'text-stone-500'}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <form onSubmit={onFreeText}>
        <input
          className="input"
          aria-label="Find a recipe or type a meal"
          placeholder="Find a recipe, or type “Leftovers”"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </form>
      <ul className="divide-y divide-stone-100 dark:divide-stone-800">
        {(recipes.data ?? []).map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className="flex w-full items-center gap-3 py-2 text-left"
              onClick={() => plan({ recipeId: r.id })}
            >
              <RecipeThumb
                url={r.imageUrl}
                className="h-10 w-10 shrink-0 rounded-lg text-lg"
              />
              <span className="truncate">{r.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {q.trim() && (
        <button
          type="button"
          className="btn-secondary w-full"
          onClick={() => plan({ title: q.trim() })}
        >
          Add “{q.trim()}” without a recipe
        </button>
      )}
      <FormError message={add.error?.message ?? null} />
    </Sheet>
  );
}

function MealSheet({
  entry,
  onClose,
}: {
  entry: PlanEntry;
  onClose: () => void;
}) {
  const update = useUpdatePlanEntry();
  const remove = useRemovePlanEntry();
  const [date, setDate] = useState(entry.date);
  const [servings, setServings] = useState(
    entry.servings ?? entry.recipeServings ?? 2,
  );

  const save = (patch: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate({ id: entry.id, patch }, { onSuccess: onClose });

  return (
    <Sheet label={entry.title} onClose={onClose}>
      <h2 className="text-lg font-semibold">{entry.title}</h2>
      {entry.recipeId && (
        <div className="flex gap-2">
          <Link
            className="btn-secondary flex-1"
            to={`/recipes/${entry.recipeId}`}
          >
            Open recipe
          </Link>
          <Link
            className="btn-primary flex-1"
            to={`/recipes/${entry.recipeId}/cook`}
          >
            Start cooking
          </Link>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="meal-date">
            Day
          </label>
          <input
            className="input"
            id="meal-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        {entry.recipeId && (
          <div>
            <label className="label" htmlFor="meal-servings">
              People
            </label>
            <input
              className="input"
              id="meal-servings"
              type="number"
              min={1}
              max={500}
              value={servings}
              onChange={(e) =>
                setServings(Math.max(1, Number(e.target.value) || 1))
              }
            />
          </div>
        )}
      </div>
      <button
        type="button"
        className="btn-primary w-full"
        disabled={update.isPending}
        onClick={() => save({ date, ...(entry.recipeId ? { servings } : {}) })}
      >
        Save
      </button>
      <button
        type="button"
        className="btn-secondary w-full"
        onClick={() => save({ cooked: !entry.cookedAt })}
      >
        {entry.cookedAt ? 'Not cooked yet' : 'Mark as cooked'}
      </button>
      <button
        type="button"
        className="w-full text-sm text-red-600"
        onClick={() => remove.mutate(entry.id, { onSuccess: onClose })}
      >
        Remove from plan
      </button>
      <FormError
        message={update.error?.message ?? remove.error?.message ?? null}
      />
    </Sheet>
  );
}

const GROUPS: {
  status: ShoppingNeed['status'];
  title: string;
  hint: string;
}[] = [
  { status: 'need', title: 'To buy', hint: '' },
  {
    status: 'probably_have',
    title: 'Probably got',
    hint: 'Tick anything you’re out of.',
  },
  {
    status: 'already_on_list',
    title: 'Already on the list',
    hint: 'Tick to add the extra amount.',
  },
];

/** Everything the week needs, sorted, with what to buy ticked. */
export function ShopSheet({
  from,
  to,
  recipes,
  onClose,
}: {
  from?: string;
  to?: string;
  recipes?: { recipeId: string; servings?: number }[];
  onClose: () => void;
}) {
  const selection = recipes ? { recipes } : { from, to };
  const preview = useShoppingPreview(selection);
  const add = useAddNeeds();
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const needs = preview.data ?? [];
  const chosen =
    picked ??
    new Set(needs.filter((n) => n.status === 'need').map((n) => n.key));
  const toggle = (key: string) => {
    const next = new Set(chosen);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };

  return (
    <Sheet label="Shop for these meals" onClose={onClose}>
      <h2 className="text-lg font-semibold">Shopping for these meals</h2>
      {preview.isPending ? (
        <p className="text-stone-500">Working out what you need…</p>
      ) : add.isSuccess ? (
        <div className="space-y-3">
          <p>
            Added {add.data.length} item{add.data.length === 1 ? '' : 's'} to
            the list.
          </p>
          <div className="flex gap-2">
            <Link className="btn-primary" to="/list">
              View list
            </Link>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : !needs.length ? (
        <p className="text-stone-500">
          These meals don't need anything (or have no ingredients yet).
        </p>
      ) : (
        <>
          {GROUPS.map((g) => {
            const items = needs.filter((n) => n.status === g.status);
            if (!items.length) return null;
            return (
              <section key={g.status} aria-label={g.title}>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                  {g.title}
                </h3>
                {g.hint && <p className="text-xs text-stone-500">{g.hint}</p>}
                <ul className="mt-1">
                  {items.map((n) => {
                    const amount = formatQuantity(n.quantity, n.unit);
                    return (
                      <li key={n.key}>
                        <label className="flex cursor-pointer items-start gap-3 py-1.5">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 accent-brand-600"
                            checked={chosen.has(n.key)}
                            onChange={() => toggle(n.key)}
                          />
                          <span>
                            {amount && (
                              <strong className="font-semibold">
                                {amount}{' '}
                              </strong>
                            )}
                            {n.name}
                            <span className="block text-xs text-stone-500">
                              {[
                                n.reason,
                                `for ${n.sources.map((s) => s.title).join(', ')}`,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          <FormError
            message={add.error?.message ?? preview.error?.message ?? null}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={!chosen.size || add.isPending}
              onClick={() => add.mutate({ selection, include: [...chosen] })}
            >
              Add {chosen.size} to list
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
