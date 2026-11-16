import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  type MeasurePreference,
  displayAmount,
  scaleStep,
  servingsFactor,
} from '@opencook/domain';
import type { Ingredient, Recipe } from '@opencook/schemas';
import { FormError } from '../components/auth-card';
import { BackLink } from '../components/back-link';
import { RecipeThumb } from '../components/recipe-card';
import { formatAgo, formatMinutes } from '../lib/format';
import { useMe } from '../lib/queries';
import { useRecipeToList } from '../lib/shopping';
import {
  useDeleteRecipe,
  useForkRecipe,
  useLogCooked,
  useRecipe,
  useSaveNote,
} from '../lib/recipes';

function savedServings(id: string): number | null {
  try {
    const n = Number(sessionStorage.getItem(`servings:${id}`));
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** The servings chosen for a recipe, remembered for this browser session. */
export function useServings(recipe: Recipe | undefined) {
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const id = recipe?.id ?? '';
  const servings =
    chosen[id] ?? (recipe ? (savedServings(recipe.id) ?? recipe.servings) : 1);
  const set = (n: number) => {
    const v = Math.min(Math.max(1, n), 500);
    setChosen((c) => ({ ...c, [id]: v }));
    try {
      sessionStorage.setItem(`servings:${id}`, String(v));
    } catch {
      /* private mode */
    }
  };
  return [servings, set] as const;
}

export function RecipePage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const { data: recipe, isPending, error } = useRecipe(id);
  const [servings, setServings] = useServings(recipe);
  const [measure, setMeasure] = useState<MeasurePreference | undefined>(
    undefined,
  );

  if (isPending) return <p className="text-stone-500">Loading…</p>;
  if (error || !recipe) {
    return (
      <>
        <BackLink to="/">Recipes</BackLink>
        <p>This recipe doesn't exist, or isn't shared with you.</p>
      </>
    );
  }

  const factor = servingsFactor(recipe.servings, servings);
  const preference = measure ?? me?.units;

  return (
    <>
      <BackLink to="/">Recipes</BackLink>
      <RecipeThumb
        url={recipe.imageUrl}
        className="aspect-[4/3] w-full rounded-2xl"
      />
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{recipe.title}</h1>
        <p className="text-sm text-stone-500">
          {[
            recipe.prepMinutes
              ? `Prep ${formatMinutes(recipe.prepMinutes)}`
              : null,
            recipe.cookMinutes
              ? `Cook ${formatMinutes(recipe.cookMinutes)}`
              : null,
            recipe.cuisine,
            !recipe.mine ? `by ${recipe.owner.name}` : null,
            recipe.visibility !== 'private' ? recipe.visibility : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {recipe.forkedFrom && (
          <p className="text-sm text-stone-500">
            Adapted from{' '}
            <Link
              className="text-brand-600"
              to={`/recipes/${recipe.forkedFrom.id}`}
            >
              {recipe.forkedFrom.title}
            </Link>{' '}
            by {recipe.forkedFrom.owner.name}
          </p>
        )}
        {recipe.sourceUrl && (
          <p className="text-sm">
            <a
              className="text-brand-600"
              href={recipe.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              {recipe.sourceName ?? new URL(recipe.sourceUrl).hostname}
            </a>
          </p>
        )}
        {recipe.description && (
          <p className="whitespace-pre-line pt-1 text-stone-700 dark:text-stone-300">
            {recipe.description}
          </p>
        )}
      </header>

      <Actions recipe={recipe} servings={servings} />

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Ingredients</h2>
          <ServingsStepper value={servings} onChange={setServings} />
        </div>
        <div className="flex justify-end">
          <MeasureToggle value={preference ?? 'metric'} onChange={setMeasure} />
        </div>
        <IngredientList
          ingredients={recipe.ingredients}
          factor={factor}
          preference={preference}
        />
      </section>

      {recipe.steps.length > 0 && (
        <section className="card space-y-3">
          <h2 className="text-lg font-semibold">Method</h2>
          <ol className="space-y-4">
            {recipe.steps.map((s, n) => (
              <li key={n}>
                {s.section &&
                  (n === 0 || recipe.steps[n - 1].section !== s.section) && (
                    <h3 className="mb-2 font-semibold">{s.section}</h3>
                  )}
                <div className="flex gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-500">
                    {n + 1}
                  </span>
                  <p className="whitespace-pre-line pt-0.5">
                    <StepText
                      text={s.text}
                      factor={factor}
                      preference={preference}
                      ingredients={recipe.ingredients}
                    />
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <Notes recipe={recipe} />
    </>
  );
}

export function StepText({
  text,
  factor,
  preference,
  ingredients,
}: {
  text: string;
  factor: number;
  preference?: MeasurePreference;
  ingredients: Ingredient[];
}) {
  return (
    <>
      {scaleStep(text, factor, { preference, ingredients }).map((seg, i) =>
        seg.amount ? (
          <strong
            key={i}
            className="font-semibold text-brand-700 dark:text-brand-500"
          >
            {seg.text}
          </strong>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

export function IngredientList({
  ingredients,
  factor,
  preference,
}: {
  ingredients: Ingredient[];
  factor: number;
  preference?: MeasurePreference;
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setTicked((t) => {
      const next = new Set(t);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  if (!ingredients.length)
    return <p className="text-stone-500">No ingredients yet.</p>;
  return (
    <ul className="space-y-1">
      {ingredients.map((i, n) => {
        const amount = displayAmount(i, factor, preference);
        const heading =
          i.section && (n === 0 || ingredients[n - 1].section !== i.section);
        return (
          <li key={i.id}>
            {heading && (
              <h3 className="mb-1 mt-3 text-sm font-semibold uppercase text-stone-500">
                {i.section}
              </h3>
            )}
            <label className="flex cursor-pointer items-start gap-3 py-1">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-brand-600"
                checked={ticked.has(i.id)}
                onChange={() => toggle(i.id)}
              />
              <span
                className={
                  ticked.has(i.id) ? 'text-stone-400 line-through' : ''
                }
              >
                {amount && <strong className="font-semibold">{amount} </strong>}
                {i.name}
                {i.preparation && (
                  <span className="text-stone-500">, {i.preparation}</span>
                )}
                {i.note && <span className="text-stone-500"> ({i.note})</span>}
                {i.scaling === 'to_taste' && !amount && (
                  <span className="text-stone-500">, to taste</span>
                )}
                {i.optional && (
                  <span className="text-stone-500"> (optional)</span>
                )}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export function ServingsStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-stone-300 dark:border-stone-700">
      <button
        type="button"
        className="h-9 w-9 text-lg"
        aria-label="Fewer servings"
        onClick={() => onChange(value - 1)}
        disabled={value <= 1}
      >
        −
      </button>
      <span className="min-w-[5.5rem] text-center text-sm" aria-live="polite">
        Serves <strong>{value}</strong>
      </span>
      <button
        type="button"
        className="h-9 w-9 text-lg"
        aria-label="More servings"
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

function MeasureToggle({
  value,
  onChange,
}: {
  value: MeasurePreference;
  onChange: (v: MeasurePreference) => void;
}) {
  return (
    <div
      className="flex rounded-lg bg-stone-100 p-0.5 text-xs dark:bg-stone-800"
      role="group"
      aria-label="Measures"
    >
      {(
        [
          ['metric', 'Metric'],
          ['imperial', 'US'],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 ${value === v ? 'bg-white font-medium shadow-sm dark:bg-stone-700' : 'text-stone-500'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Actions({ recipe, servings }: { recipe: Recipe; servings: number }) {
  const navigate = useNavigate();
  const fork = useForkRecipe();
  const remove = useDeleteRecipe();
  const cooked = useLogCooked(recipe.id);
  const [shopping, setShopping] = useState(false);

  return (
    <div className="space-y-2">
      {shopping && (
        <AddToListSheet
          recipe={recipe}
          servings={servings}
          onClose={() => setShopping(false)}
        />
      )}
      <div className="grid grid-cols-2 gap-2">
        <Link to={`/recipes/${recipe.id}/cook`} className="btn-primary">
          Start cooking
        </Link>
        <button
          type="button"
          className="btn-secondary"
          disabled={cooked.isPending}
          onClick={() => cooked.mutate({ servings })}
        >
          {cooked.isSuccess ? 'Logged ✓' : 'I cooked this'}
        </button>
        <button
          type="button"
          className="btn-secondary col-span-2"
          disabled={!recipe.ingredients.length}
          onClick={() => setShopping(true)}
        >
          Add ingredients to shopping list
        </button>
      </div>
      <p className="text-center text-xs text-stone-500">
        {recipe.timesCooked
          ? `Cooked ${recipe.timesCooked} time${recipe.timesCooked === 1 ? '' : 's'}, last ${formatAgo(recipe.lastCookedAt as string)}`
          : 'Not cooked yet'}
      </p>
      <div className="flex flex-wrap justify-center gap-4 text-sm">
        {recipe.mine ? (
          <>
            <Link className="text-brand-600" to={`/recipes/${recipe.id}/edit`}>
              Edit
            </Link>
            <button
              type="button"
              className="text-brand-600"
              onClick={() =>
                fork.mutate(recipe.id, {
                  onSuccess: (r) => navigate(`/recipes/${r.id}/edit`),
                })
              }
            >
              Make a variation
            </button>
            <button
              type="button"
              className="text-red-600"
              onClick={() => {
                if (
                  window.confirm(
                    `Delete “${recipe.title}”? This can't be undone.`,
                  )
                ) {
                  remove.mutate(recipe.id, {
                    onSuccess: () => navigate('/', { replace: true }),
                  });
                }
              }}
            >
              Delete
            </button>
          </>
        ) : (
          <button
            type="button"
            className="text-brand-600"
            disabled={fork.isPending}
            onClick={() =>
              fork.mutate(recipe.id, {
                onSuccess: (r) => navigate(`/recipes/${r.id}`),
              })
            }
          >
            Copy to my recipes
          </button>
        )}
        {recipe.visibility !== 'private' &&
          typeof navigator.share === 'function' && (
            <button
              type="button"
              className="text-brand-600"
              onClick={() =>
                void navigator
                  .share({ title: recipe.title, url: window.location.href })
                  .catch(() => undefined)
              }
            >
              Share
            </button>
          )}
      </div>
    </div>
  );
}

function Notes({ recipe }: { recipe: Recipe }) {
  const save = useSaveNote(recipe.id);
  const [text, setText] = useState(recipe.note ?? '');
  const [editing, setEditing] = useState(false);
  const startEditing = () => {
    setText(recipe.note ?? '');
    setEditing(true);
  };

  return (
    <section className="card space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">My notes</h2>
        {!editing && (
          <button
            type="button"
            className="text-sm text-brand-600"
            onClick={startEditing}
          >
            {recipe.note ? 'Edit' : 'Add a note'}
          </button>
        )}
      </div>
      {editing ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(text, { onSuccess: () => setEditing(false) });
          }}
        >
          <textarea
            className="input min-h-28"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Swaps, timings, what you'd do differently…"
            aria-label="My notes"
            autoFocus
          />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={save.isPending}>
              Save note
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : recipe.note ? (
        <p className="whitespace-pre-line text-stone-700 dark:text-stone-300">
          {recipe.note}
        </p>
      ) : (
        <p className="text-sm text-stone-500">Only you can see your notes.</p>
      )}
    </section>
  );
}

/** Pick which ingredients to buy (things to taste and optional ones start unticked). */
function AddToListSheet({
  recipe,
  servings,
  onClose,
}: {
  recipe: Recipe;
  servings: number;
  onClose: () => void;
}) {
  const factor = servingsFactor(recipe.servings, servings);
  const [picked, setPicked] = useState(
    () =>
      new Set(
        recipe.ingredients
          .filter((i) => !i.optional && i.scaling !== 'to_taste')
          .map((i) => i.id),
      ),
  );
  const add = useRecipeToList();
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[85svh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:bg-stone-900 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Add to shopping list"
      >
        <h2 className="text-lg font-semibold">Add to shopping list</h2>
        <p className="text-sm text-stone-500">
          For {servings} {servings === 1 ? 'person' : 'people'}. Untick anything
          you already have.
        </p>
        {add.isSuccess ? (
          <div className="space-y-3">
            <p>
              Added {add.data.length} item{add.data.length === 1 ? '' : 's'}
              {add.data.some((a) => a.combined)
                ? ', adding to some already on the list'
                : ''}
              .
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
        ) : (
          <>
            <ul className="space-y-1">
              {recipe.ingredients.map((i) => {
                const amount = displayAmount(i, factor);
                return (
                  <li key={i.id}>
                    <label className="flex cursor-pointer items-start gap-3 py-1">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-brand-600"
                        checked={picked.has(i.id)}
                        onChange={() => toggle(i.id)}
                      />
                      <span>
                        {amount && (
                          <strong className="font-semibold">{amount} </strong>
                        )}
                        {i.name}
                        {i.scaling === 'to_taste' && (
                          <span className="text-stone-500"> (to taste)</span>
                        )}
                        {i.optional && (
                          <span className="text-stone-500"> (optional)</span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <FormError message={add.error?.message ?? null} />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={!picked.size || add.isPending}
                onClick={() =>
                  add.mutate({
                    recipeId: recipe.id,
                    servings,
                    ingredientIds: [...picked],
                  })
                }
              >
                Add {picked.size} item{picked.size === 1 ? '' : 's'}
              </button>
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
