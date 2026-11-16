import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RecipeCard } from '../components/recipe-card';
import { useMe } from '../lib/queries';
import { useRecipes, useTags } from '../lib/recipes';

/** The signed-in cook's own recipes: search and filter by tag. */
export function RecipesPage() {
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const tag = params.get('tag') ?? undefined;
  const [q, setQ] = useState(params.get('q') ?? '');
  const recipes = useRecipes({ q: q.trim() || undefined, tag, scope: 'mine' });
  const tags = useTags();

  const setTag = (t?: string) => {
    const next = new URLSearchParams(params);
    if (t && t !== tag) next.set('tag', t);
    else next.delete('tag');
    setParams(next, { replace: true });
  };

  if (!me) return null;
  const list = recipes.data ?? [];

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Recipes</h1>
        <Link to="/recipes/new" className="btn-primary">
          Add recipe
        </Link>
      </div>
      <input
        className="input"
        type="search"
        placeholder="Search recipes or ingredients"
        aria-label="Search recipes"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {!!tags.data?.length && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {tags.data.map(({ tag: t }) => (
            <button
              key={t}
              type="button"
              onClick={() => setTag(t)}
              aria-pressed={t === tag}
              className={`shrink-0 rounded-full border px-3 py-1 text-sm ${
                t === tag
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-stone-300 dark:border-stone-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      {recipes.isPending ? (
        <p className="text-stone-500">Loading…</p>
      ) : list.length ? (
        <div className="space-y-2">
          {list.map((r) => (
            <RecipeCard key={r.id} recipe={r} />
          ))}
        </div>
      ) : q || tag ? (
        <p className="text-stone-500">No recipes match.</p>
      ) : (
        <EmptyState />
      )}
    </>
  );
}

function EmptyState() {
  return (
    <div className="card space-y-3 text-center">
      <div className="text-5xl" aria-hidden>
        🧑‍🍳
      </div>
      <h2 className="font-semibold">Your recipe book is empty</h2>
      <p className="text-sm text-stone-500">
        Paste a link to a recipe you love, write one down, or ask your AI
        assistant to save recipes here (Settings → AI assistants).
      </p>
      <Link to="/recipes/new" className="btn-primary">
        Add your first recipe
      </Link>
    </div>
  );
}
