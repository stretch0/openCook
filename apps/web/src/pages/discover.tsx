import { useState } from 'react';
import { RecipeCard } from '../components/recipe-card';
import { useMe } from '../lib/queries';
import { useRecipes } from '../lib/recipes';

/** Public recipes from everyone on this instance. */
export function DiscoverPage() {
  const { data: me } = useMe();
  const [q, setQ] = useState('');
  const recipes = useRecipes({ q: q.trim() || undefined, scope: 'all' });
  const others = (recipes.data ?? []).filter((r) => r.owner.id !== me?.id);
  return (
    <>
      <h1 className="text-2xl font-semibold">Discover</h1>
      <p className="text-sm text-stone-500">
        Recipes other cooks here have made public. Copy one to make it your own.
      </p>
      <input
        className="input"
        type="search"
        placeholder="Search public recipes"
        aria-label="Search public recipes"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {recipes.isPending ? (
        <p className="text-stone-500">Loading…</p>
      ) : others.length ? (
        <div className="space-y-2">
          {others.map((r) => (
            <RecipeCard key={r.id} recipe={r} showOwner />
          ))}
        </div>
      ) : (
        <p className="text-stone-500">
          Nothing public yet. When someone shares a recipe, it shows up here.
        </p>
      )}
    </>
  );
}
