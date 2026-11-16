import { type FormEvent, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  displayAmount,
  ingredientLine,
  parseIngredientLine,
} from '@opencook/domain';
import type {
  Ingredient,
  Recipe,
  RecipeInput,
  Visibility,
} from '@opencook/schemas';
import { FormError } from '../components/auth-card';
import { BackLink } from '../components/back-link';
import { ApiError } from '../lib/api';
import {
  importRecipe,
  uploadImage,
  useRecipe,
  useSaveRecipe,
} from '../lib/recipes';

type Draft = {
  title: string;
  description: string;
  servings: number;
  prepMinutes: string;
  cookMinutes: string;
  cuisine: string;
  tags: string;
  visibility: Visibility;
  sourceUrl: string;
  sourceName: string;
  ingredients: string;
  steps: string;
  imageId: string | null;
  imageUrl: string | null;
  /** A picture on the web to download when saving (from an import). */
  remoteImageUrl: string | null;
};

const EMPTY: Draft = {
  title: '',
  description: '',
  servings: 4,
  prepMinutes: '',
  cookMinutes: '',
  cuisine: '',
  tags: '',
  visibility: 'private',
  sourceUrl: '',
  sourceName: '',
  ingredients: '',
  steps: '',
  imageId: null,
  imageUrl: null,
  remoteImageUrl: null,
};

/** A line like "For the sauce:" starts a section. */
const SECTION = /^(?!\d)([^:]{1,60}):\s*$/;

function linesWithSections<T>(
  text: string,
  each: (line: string, section: string | null) => T,
): T[] {
  let section: string | null = null;
  const out: T[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(SECTION);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    out.push(each(line, section));
  }
  return out;
}

function withSections<T extends { section: string | null }>(
  list: T[],
  toLine: (item: T) => string,
  separator = '\n',
) {
  let section: string | null = null;
  const out: string[] = [];
  for (const item of list) {
    if (item.section && item.section !== section) {
      if (out.length) out.push('');
      out.push(`${item.section}:`);
    }
    section = item.section;
    out.push(toLine(item));
  }
  return out.join(separator);
}

function fromRecipe(r: Recipe): Draft {
  return {
    title: r.title,
    description: r.description ?? '',
    servings: r.servings,
    prepMinutes: r.prepMinutes?.toString() ?? '',
    cookMinutes: r.cookMinutes?.toString() ?? '',
    cuisine: r.cuisine ?? '',
    tags: r.tags.join(', '),
    visibility: r.visibility,
    sourceUrl: r.sourceUrl ?? '',
    sourceName: r.sourceName ?? '',
    ingredients: withSections(r.ingredients, ingredientLine),
    steps: withSections(r.steps, (s) => s.text, '\n\n').replace(
      /:\n\n/g,
      ':\n',
    ),
    imageId: r.imageId,
    imageUrl: r.imageUrl,
    remoteImageUrl: null,
  };
}

/** The draft as a recipe to save, keeping ingredient ids for unchanged lines. */
function toInput(d: Draft, previous?: Recipe): RecipeInput {
  const unused = new Map<string, Ingredient[]>();
  for (const i of previous?.ingredients ?? []) {
    const line = ingredientLine(i);
    unused.set(line, [...(unused.get(line) ?? []), i]);
  }
  const ingredients = linesWithSections(d.ingredients, (line, section) => {
    const same = unused.get(line)?.shift();
    if (same) {
      const { itemId: _itemId, ...rest } = same;
      return { ...rest, section };
    }
    const { rawText: _raw, ...parsed } = parseIngredientLine(line);
    return { ...parsed, rawText: line, section };
  });
  const timers = new Map(
    (previous?.steps ?? []).map((s) => [s.text, s.timerSeconds]),
  );
  const steps = linesWithSections(d.steps, (text, section) => ({
    text,
    section,
    timerSeconds: timers.get(text) ?? null,
  }));
  const minutes = (s: string) =>
    s.trim() ? Math.max(0, Math.round(Number(s))) || null : null;
  return {
    title: d.title.trim(),
    description: d.description.trim() || null,
    servings: d.servings,
    prepMinutes: minutes(d.prepMinutes),
    cookMinutes: minutes(d.cookMinutes),
    cuisine: d.cuisine.trim() || null,
    tags: d.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    visibility: d.visibility,
    sourceUrl: d.sourceUrl.trim() || null,
    sourceName: d.sourceName.trim() || null,
    imageId: d.imageId,
    imageUrl: d.imageId ? null : d.remoteImageUrl,
    ingredients,
    steps,
  };
}

export function RecipeEditPage() {
  const { id } = useParams();
  const existing = useRecipe(id);
  if (id && existing.isPending)
    return <p className="text-stone-500">Loading…</p>;
  if (id && !existing.data) return <p>This recipe doesn't exist.</p>;
  if (existing.data && !existing.data.mine) {
    return <p>Only the owner can edit this recipe.</p>;
  }
  return (
    <RecipeForm
      key={existing.data?.id ?? 'new'}
      previous={existing.data}
      initial={existing.data ? fromRecipe(existing.data) : EMPTY}
    />
  );
}

function RecipeForm({
  previous,
  initial,
}: {
  previous?: Recipe;
  initial: Draft;
}) {
  const id = previous?.id;
  const navigate = useNavigate();
  const save = useSaveRecipe(id);
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const input = toInput(draft, previous);
    save.mutate(
      id ? { ...input, expectedRevision: previous?.revision } : input,
      {
        onSuccess: (r) => navigate(`/recipes/${r.id}`, { replace: true }),
        onError: (e) =>
          setError(
            e instanceof ApiError && e.status === 409
              ? 'Someone changed this recipe while you were editing. Reload to see their changes.'
              : e.message,
          ),
      },
    );
  };

  return (
    <>
      <BackLink to={id ? `/recipes/${id}` : '/'}>
        {id ? 'Recipe' : 'Recipes'}
      </BackLink>
      <h1 className="text-2xl font-semibold">
        {id ? 'Edit recipe' : 'Add a recipe'}
      </h1>
      {!id && <ImportBox onImported={(d) => setDraft({ ...EMPTY, ...d })} />}

      <form onSubmit={onSubmit} className="space-y-4">
        <section className="card space-y-3">
          <PhotoPicker
            url={draft.imageUrl}
            onChange={(imageId, imageUrl) =>
              setDraft((d) => ({
                ...d,
                imageId,
                imageUrl,
                remoteImageUrl: null,
              }))
            }
          />
          <Field label="Title" id="title">
            <input
              className="input"
              id="title"
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
              required
              maxLength={200}
            />
          </Field>
          <Field label="Description" id="description">
            <textarea
              className="input min-h-20"
              id="description"
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Serves" id="servings">
              <input
                className="input"
                id="servings"
                type="number"
                min={1}
                max={500}
                value={draft.servings}
                onChange={(e) =>
                  set('servings', Math.max(1, Number(e.target.value) || 1))
                }
                required
              />
            </Field>
            <Field label="Prep (min)" id="prep">
              <input
                className="input"
                id="prep"
                type="number"
                min={0}
                value={draft.prepMinutes}
                onChange={(e) => set('prepMinutes', e.target.value)}
              />
            </Field>
            <Field label="Cook (min)" id="cook">
              <input
                className="input"
                id="cook"
                type="number"
                min={0}
                value={draft.cookMinutes}
                onChange={(e) => set('cookMinutes', e.target.value)}
              />
            </Field>
          </div>
        </section>

        <section className="card space-y-2">
          <Field
            label="Ingredients"
            id="ingredients"
            hint="One per line, amount first: “200 g butter, softened”. A line ending in a colon (“For the sauce:”) starts a section."
          >
            <textarea
              className="input min-h-48 font-mono text-sm"
              id="ingredients"
              value={draft.ingredients}
              onChange={(e) => set('ingredients', e.target.value)}
            />
          </Field>
          <IngredientPreview text={draft.ingredients} />
        </section>

        <section className="card">
          <Field
            label="Method"
            id="steps"
            hint="One step per line. Amounts with units (“add 200 g flour”) scale with the servings."
          >
            <textarea
              className="input min-h-48"
              id="steps"
              value={draft.steps}
              onChange={(e) => set('steps', e.target.value)}
            />
          </Field>
        </section>

        <section className="card space-y-3">
          <Field
            label="Tags"
            id="tags"
            hint="Separated by commas: quick, vegetarian, weeknight"
          >
            <input
              className="input"
              id="tags"
              value={draft.tags}
              onChange={(e) => set('tags', e.target.value)}
            />
          </Field>
          <Field label="Cuisine" id="cuisine">
            <input
              className="input"
              id="cuisine"
              value={draft.cuisine}
              onChange={(e) => set('cuisine', e.target.value)}
            />
          </Field>
          <Field label="Who can see it" id="visibility">
            <select
              className="input"
              id="visibility"
              value={draft.visibility}
              onChange={(e) => set('visibility', e.target.value as Visibility)}
            >
              <option value="private">Only me</option>
              <option value="unlisted">
                Anyone with the link (signed in here)
              </option>
              <option value="public">Everyone on this instance</option>
            </select>
          </Field>
          <Field label="Source" id="sourceUrl">
            <input
              className="input"
              id="sourceUrl"
              type="url"
              placeholder="https://"
              value={draft.sourceUrl}
              onChange={(e) => set('sourceUrl', e.target.value)}
            />
          </Field>
        </section>

        <FormError message={error} />
        <button className="btn-primary w-full" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save recipe'}
        </button>
      </form>
    </>
  );
}

function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

/** Shows how each ingredient line was understood, so mistakes are easy to spot. */
function IngredientPreview({ text }: { text: string }) {
  const parsed = useMemo(
    () => linesWithSections(text, (line) => parseIngredientLine(line)),
    [text],
  );
  if (!parsed.length) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-stone-500">
        How openCook reads these
      </summary>
      <ul className="mt-2 space-y-1">
        {parsed.map((p, i) => (
          <li key={i} className="flex gap-2">
            <span className="w-24 shrink-0 text-right font-medium text-brand-700 dark:text-brand-500">
              {displayAmount(p) ||
                (p.scaling === 'to_taste' ? 'to taste' : '—')}
            </span>
            <span>
              {p.name}
              {p.preparation && (
                <span className="text-stone-500"> · {p.preparation}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function PhotoPicker({
  url,
  onChange,
}: {
  url: string | null;
  onChange: (imageId: string | null, url: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const image = await uploadImage(file);
      onChange(image.id, image.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      {url ? (
        <img
          src={url}
          alt=""
          className="aspect-[4/3] w-full rounded-xl object-cover"
        />
      ) : (
        <div className="grid aspect-[4/3] w-full place-items-center rounded-xl border-2 border-dashed border-stone-300 text-stone-400 dark:border-stone-700">
          {busy ? 'Uploading…' : 'No photo yet'}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <label className="btn-secondary cursor-pointer">
          Take a photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        <label className="btn-secondary cursor-pointer">
          Choose a picture
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        {url && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onChange(null, null)}
          >
            Remove
          </button>
        )}
      </div>
      <FormError message={error} />
    </div>
  );
}

function ImportBox({
  onImported,
}: {
  onImported: (draft: Partial<Draft>) => void;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onImport = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await importRecipe(url.trim());
      if (!result.found || !result.recipe) {
        setMessage(
          "There's no recipe openCook can read on that page (social media posts often hide it). Ask your AI assistant to read the link and save the recipe, or type it in below.",
        );
        return;
      }
      const r = result.recipe;
      onImported({
        title: r.title,
        description: r.description ?? '',
        servings: r.servings,
        prepMinutes: r.prepMinutes?.toString() ?? '',
        cookMinutes: r.cookMinutes?.toString() ?? '',
        cuisine: r.cuisine ?? '',
        tags: r.tags.join(', '),
        sourceUrl: r.sourceUrl ?? url,
        sourceName: r.sourceName ?? '',
        ingredients: r.ingredients.join('\n'),
        steps: r.steps.join('\n\n'),
        imageUrl: result.imageUrl,
        remoteImageUrl: result.imageUrl,
      });
      setMessage(`Found “${r.title}”. Check it over, then save.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onImport} className="card space-y-2">
      <label className="label" htmlFor="import-url">
        Import from a link
      </label>
      <div className="flex gap-2">
        <input
          className="input"
          id="import-url"
          type="url"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button className="btn-primary shrink-0" disabled={busy}>
          {busy ? 'Reading…' : 'Import'}
        </button>
      </div>
      {message && (
        <p className="text-sm text-stone-600 dark:text-stone-400">{message}</p>
      )}
    </form>
  );
}
