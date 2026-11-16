import { decodeEntities, plainText } from './html.js';

/** A recipe found in a page's schema.org data, as plain values. */
export type FoundRecipe = {
  title: string;
  description: string | null;
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  cuisine: string | null;
  tags: string[];
  ingredients: string[];
  steps: string[];
  imageUrl: string | null;
  author: string | null;
};

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

/** Every JSON-LD block in the page, parsed. Broken blocks are skipped. */
export function jsonLdBlocks(html: string): Json[] {
  const out: Json[] = [];
  const re =
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const raw = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Some sites put several objects or stray characters in one block.
      try {
        // eslint-disable-next-line no-control-regex
        out.push(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ')));
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

const isObj = (v: Json | undefined): v is Obj =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function hasType(o: Obj, type: string) {
  const t = o['@type'];
  return t === type || (Array.isArray(t) && t.includes(type));
}

/** Finds the first schema.org Recipe, looking inside arrays and @graph. */
export function findRecipeNode(blocks: Json[]): Obj | null {
  const stack: Json[] = [...blocks];
  while (stack.length) {
    const v = stack.shift() as Json;
    if (Array.isArray(v)) stack.push(...v);
    else if (isObj(v)) {
      if (hasType(v, 'Recipe')) return v;
      if (v['@graph']) stack.push(v['@graph']);
      if (isObj(v.mainEntity)) stack.push(v.mainEntity);
    }
  }
  return null;
}

const str = (v: Json | undefined): string | null => {
  if (typeof v === 'string') return clean(v) || null;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return str(v[0]);
  if (isObj(v)) return str(v.name ?? v.text ?? v['@value'] ?? null);
  return null;
};

function clean(s: string) {
  return plainText(decodeEntities(s)).replace(/\s+/g, ' ').trim();
}

const list = (v: Json | undefined): string[] => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(list);
  if (typeof v === 'string')
    return v
      .split(',')
      .map((s) => clean(s))
      .filter(Boolean);
  const s = str(v);
  return s ? [s] : [];
};

/** ISO 8601 durations like "PT1H30M" → 90. */
export function isoMinutes(v: Json | undefined): number | null {
  if (typeof v !== 'string') return null;
  const m = v.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i,
  );
  if (!m) return null;
  const minutes =
    Number(m[1] ?? 0) * 1440 +
    Number(m[2] ?? 0) * 60 +
    Number(m[3] ?? 0) +
    Number(m[4] ?? 0) / 60;
  return minutes > 0 ? Math.round(minutes) : null;
}

/** "Serves 4", "4-6 servings", ["4", "4 servings"] → 4. */
export function servingsFrom(v: Json | undefined): number | null {
  const values = Array.isArray(v) ? v : [v];
  for (const value of values) {
    const n =
      typeof value === 'number'
        ? value
        : Number(String(value ?? '').match(/\d+/)?.[0]);
    if (Number.isFinite(n) && n > 0 && n < 500) return Math.round(n);
  }
  return null;
}

function instructions(v: Json | undefined): string[] {
  if (v == null) return [];
  if (typeof v === 'string') {
    // One block of text: split into lines or numbered steps.
    return plainText(v)
      .split(/\n+|(?:^|\s)(?=\d+[.)]\s)/)
      .map((s) => s.replace(/^\d+[.)]\s*/, '').trim())
      .filter(Boolean);
  }
  if (Array.isArray(v)) return v.flatMap(instructions);
  if (isObj(v)) {
    if (hasType(v, 'HowToSection') || v.itemListElement) {
      return instructions(v.itemListElement);
    }
    const t = str(v.text ?? v.name ?? null);
    return t ? [t] : [];
  }
  return [];
}

function imageUrl(v: Json | undefined): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return imageUrl(v[0]);
  if (isObj(v)) return imageUrl(v.url ?? v.contentUrl ?? null);
  return null;
}

export function recipeFromNode(node: Obj): FoundRecipe {
  const total = isoMinutes(node.totalTime);
  const prep = isoMinutes(node.prepTime);
  const cook =
    isoMinutes(node.cookTime) ??
    (total && prep ? Math.max(total - prep, 0) : null);
  const tags = [...list(node.recipeCategory), ...list(node.keywords)]
    .map((t) => t.toLowerCase())
    .filter((t, i, all) => t.length <= 40 && all.indexOf(t) === i)
    .slice(0, 15);
  return {
    title: str(node.name) ?? 'Untitled recipe',
    description: str(node.description),
    servings: servingsFrom(node.recipeYield ?? node.yield),
    prepMinutes: prep,
    cookMinutes: cook || (prep ? null : total),
    cuisine: list(node.recipeCuisine)[0] ?? null,
    tags,
    ingredients: (Array.isArray(node.recipeIngredient)
      ? node.recipeIngredient
      : Array.isArray(node.ingredients)
        ? node.ingredients
        : []
    )
      .map((i) => (typeof i === 'string' ? clean(i) : str(i)))
      .filter((i): i is string => !!i),
    steps: instructions(node.recipeInstructions),
    imageUrl: imageUrl(node.image),
    author: str(node.author),
  };
}
