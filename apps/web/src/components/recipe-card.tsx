import { Link } from 'react-router-dom';
import type { RecipeSummary } from '@opencook/schemas';
import { formatAgo, formatMinutes } from '../lib/format';

export function RecipeCard({
  recipe,
  showOwner = false,
}: {
  recipe: RecipeSummary;
  showOwner?: boolean;
}) {
  return (
    <Link
      to={`/recipes/${recipe.id}`}
      className="card flex gap-3 p-2 transition hover:border-brand-500"
    >
      <RecipeThumb
        url={recipe.imageUrl}
        className="h-20 w-20 shrink-0 rounded-xl"
      />
      <div className="min-w-0 flex-1 py-1">
        <h3 className="truncate font-semibold">{recipe.title}</h3>
        <p className="mt-0.5 text-sm text-stone-500">
          {[
            recipe.totalMinutes ? formatMinutes(recipe.totalMinutes) : null,
            `serves ${recipe.servings}`,
            showOwner ? `by ${recipe.owner.name}` : null,
            recipe.lastCookedAt
              ? `cooked ${formatAgo(recipe.lastCookedAt)}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {recipe.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {recipe.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

export function RecipeThumb({
  url,
  className = '',
}: {
  url: string | null;
  className?: string;
}) {
  return url ? (
    <img
      src={url}
      alt=""
      loading="lazy"
      className={`object-cover ${className}`}
    />
  ) : (
    <div
      className={`grid place-items-center bg-brand-50 text-3xl dark:bg-brand-500/10 ${className}`}
      aria-hidden
    >
      🍲
    </div>
  );
}
