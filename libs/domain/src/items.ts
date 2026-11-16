/**
 * Item identity: deciding that "Mouth wash", "mouthwash" and "mouth-wash" are
 * the same thing on a shopping list, and that "Tomatoes" in a recipe is the
 * "tomato" in the cupboard.
 *
 * Every item has a `normal key`. Two names with the same key are the same
 * item. Close-but-different keys ("mouthwsh") are only ever offered as
 * suggestions, never merged silently.
 */

/** Words that describe an item without changing what you'd buy. */
const DESCRIPTORS = new Set([
  'large',
  'small',
  'medium',
  'big',
  'fresh',
  'freshly',
  'ripe',
  'organic',
  'free-range',
  'freerange',
  'good',
  'quality',
  'goodquality',
  'good-quality',
  'some',
  'extra',
  'sliced',
  'minced',
  'grated',
  'finely',
  'roughly',
  'thinly',
  'peeled',
  'washed',
]);

/** Keep these as they are: they end in s but aren't plurals. */
const NOT_PLURAL = new Set([
  'asparagus',
  'couscous',
  'hummus',
  'houmous',
  'molasses',
  'swiss',
  'brussels',
  'harissa',
  'bass',
  'cress',
  'watercress',
  'grass',
  'lemongrass',
  'glass',
  'citrus',
  'octopus',
  'haggis',
  'jus',
  'gras',
  'grits',
  'series',
  'species',
  'pants',
  'scissors',
  'tongs',
  'clothes',
  'news',
  'oats',
  'hops',
  'bitters',
]);

const IRREGULAR: Record<string, string> = {
  leaves: 'leaf',
  loaves: 'loaf',
  halves: 'half',
  knives: 'knife',
  calves: 'calf',
  potatoes: 'potato',
  tomatoes: 'tomato',
  mangoes: 'mango',
  avocadoes: 'avocado',
  echoes: 'echo',
  heroes: 'hero',
  cookies: 'cookie',
  brownies: 'brownie',
  smoothies: 'smoothie',
  pies: 'pie',
  veggies: 'veggie',
  goodies: 'goodie',
  calories: 'calorie',
  anchovies: 'anchovy',
  mice: 'mouse',
  geese: 'goose',
  teeth: 'tooth',
  feet: 'foot',
  children: 'child',
  shoes: 'shoe',
  toes: 'toe',
  dice: 'dice',
  fish: 'fish',
  sheep: 'sheep',
};

/** "tomatoes" → "tomato", "berries" → "berry", "peaches" → "peach". */
export function singular(word: string): string {
  const w = word.toLowerCase();
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (NOT_PLURAL.has(w) || w.length <= 3) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (/(ches|shes|xes|sses|zzes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('oes')) return w.slice(0, -2);
  if (/(ss|us|is)$/.test(w)) return w;
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

/** Folds case, accents and punctuation so a name can be compared word by word. */
export function cleanName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The key two names must share to be the same item.
 *
 *   "Mouth wash", "mouthwash", "Mouth-Wash" → "mouthwash"
 *   "Large Free-Range Eggs", "eggs"        → "egg"
 *   "Crème fraîche"                         → "cremefraiche"
 */
export function normalItemKey(name: string): string {
  const words = cleanName(name).split(' ').filter(Boolean);
  const kept = words.filter((w) => !DESCRIPTORS.has(w));
  const use = kept.length ? kept : words;
  if (!use.length) return '';
  const lastParts = use[use.length - 1].split('-');
  lastParts[lastParts.length - 1] = singular(lastParts[lastParts.length - 1]);
  use[use.length - 1] = lastParts.join('-');
  return use.join('').replace(/-/g, '');
}

/** Edit distance between two strings (Levenshtein), stopping early past `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** How many typos a key of this length may have and still be suggested. */
function allowedDistance(key: string) {
  if (key.length <= 3) return 0;
  if (key.length <= 5) return 1;
  if (key.length <= 9) return 2;
  return 3;
}

export type ItemCandidate = { id: string; name: string; keys: string[] };

export type ItemMatch =
  | { kind: 'exact'; item: ItemCandidate }
  | { kind: 'new'; suggestions: ItemCandidate[] };

/**
 * Finds the item a typed name refers to. `candidates` should list the
 * household's own items before the shared catalogue, so a household's
 * spelling wins. Each candidate's keys are its normal key plus its aliases.
 */
export function matchItem(
  name: string,
  candidates: ItemCandidate[],
  maxSuggestions = 3,
): ItemMatch {
  const key = normalItemKey(name);
  if (!key) return { kind: 'new', suggestions: [] };
  const exact = candidates.find((c) => c.keys.includes(key));
  if (exact) return { kind: 'exact', item: exact };
  return {
    kind: 'new',
    suggestions: suggestItems(key, candidates, maxSuggestions),
  };
}

/** Close spellings of `key`, nearest first. Also matches word prefixes ("mouth" → "mouthwash"). */
export function suggestItems(
  key: string,
  candidates: ItemCandidate[],
  limit = 3,
): ItemCandidate[] {
  const max = allowedDistance(key);
  const scored: { c: ItemCandidate; score: number }[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    let best = Infinity;
    for (const k of c.keys) {
      const d = editDistance(key, k, max);
      if (d <= max) best = Math.min(best, d);
      else if (key.length >= 3 && k.startsWith(key))
        best = Math.min(best, max + 0.5);
    }
    if (best < Infinity) {
      scored.push({ c, score: best });
      seen.add(c.id);
    }
  }
  return scored
    .sort((a, b) => a.score - b.score || a.c.name.length - b.c.name.length)
    .slice(0, limit)
    .map((s) => s.c);
}
