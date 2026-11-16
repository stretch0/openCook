/**
 * The units openCook understands. Quantities are stored in the unit the recipe
 * was written in; mass and volume can be converted through their base unit
 * (grams and millilitres). Everything else (cloves, cans, pinches) only
 * combines with the same unit.
 */
export type Dimension = 'mass' | 'volume' | 'other';

/** 'metric' and 'us' are measuring systems; 'any' units belong to neither. */
export type UnitSystem = 'metric' | 'us' | 'any';

/** How a user wants amounts shown. 'imperial' means US customary units. */
export type MeasurePreference = 'metric' | 'imperial';

export type UnitDef = {
  code: string;
  dimension: Dimension;
  /** Grams or millilitres in one of this unit. 1 for 'other' units. */
  toBase: number;
  system: UnitSystem;
  singular: string;
  plural: string;
  /** Spellings found in recipes, matched case-insensitively. */
  aliases: string[];
  /** Spellings matched only with this exact case ("T" vs "t"). */
  caseSensitiveAliases?: string[];
  /** Shown with kitchen fractions (½) rather than decimals. */
  fractions: boolean;
};

const u = (
  code: string,
  dimension: Dimension,
  toBase: number,
  system: UnitSystem,
  singular: string,
  plural: string,
  aliases: string[],
  fractions: boolean,
  caseSensitiveAliases?: string[],
): UnitDef => ({
  code,
  dimension,
  toBase,
  system,
  singular,
  plural,
  aliases,
  fractions,
  caseSensitiveAliases,
});

export const UNITS: UnitDef[] = [
  // Mass
  u(
    'mg',
    'mass',
    0.001,
    'metric',
    'mg',
    'mg',
    ['milligram', 'milligrams', 'milligramme', 'milligrammes'],
    false,
  ),
  u(
    'g',
    'mass',
    1,
    'metric',
    'g',
    'g',
    ['gram', 'grams', 'gramme', 'grammes', 'gr', 'grm', 'grms'],
    false,
  ),
  u(
    'kg',
    'mass',
    1000,
    'metric',
    'kg',
    'kg',
    [
      'kilogram',
      'kilograms',
      'kilogramme',
      'kilogrammes',
      'kilo',
      'kilos',
      'kgs',
    ],
    false,
  ),
  u('oz', 'mass', 28.349523125, 'us', 'oz', 'oz', ['ounce', 'ounces'], true),
  u(
    'lb',
    'mass',
    453.59237,
    'us',
    'lb',
    'lb',
    ['pound', 'pounds', 'lbs'],
    true,
  ),
  // Volume
  u(
    'ml',
    'volume',
    1,
    'metric',
    'ml',
    'ml',
    ['millilitre', 'millilitres', 'milliliter', 'milliliters', 'mls'],
    false,
  ),
  u(
    'cl',
    'volume',
    10,
    'metric',
    'cl',
    'cl',
    ['centilitre', 'centilitres', 'centiliter', 'centiliters'],
    false,
  ),
  u(
    'dl',
    'volume',
    100,
    'metric',
    'dl',
    'dl',
    ['decilitre', 'decilitres', 'deciliter', 'deciliters'],
    false,
  ),
  u(
    'l',
    'volume',
    1000,
    'metric',
    'l',
    'l',
    ['litre', 'litres', 'liter', 'liters', 'ltr', 'ltrs'],
    false,
  ),
  u(
    'tsp',
    'volume',
    4.92892159375,
    'any',
    'tsp',
    'tsp',
    ['teaspoon', 'teaspoons', 'tsps', 'tsp.'],
    true,
    ['t'],
  ),
  u(
    'tbsp',
    'volume',
    14.78676478125,
    'any',
    'tbsp',
    'tbsp',
    ['tablespoon', 'tablespoons', 'tbsps', 'tbs', 'tbl', 'tbsp.'],
    true,
    ['T', 'Tb'],
  ),
  u(
    'floz',
    'volume',
    29.5735295625,
    'us',
    'fl oz',
    'fl oz',
    ['fl oz', 'fl. oz.', 'fl. oz', 'fluid ounce', 'fluid ounces'],
    true,
  ),
  u('cup', 'volume', 236.5882365, 'us', 'cup', 'cups', ['cups', 'c.'], true),
  u(
    'pint',
    'volume',
    473.176473,
    'us',
    'pint',
    'pints',
    ['pints', 'pt', 'pts'],
    true,
  ),
  u(
    'quart',
    'volume',
    946.352946,
    'us',
    'quart',
    'quarts',
    ['quarts', 'qt', 'qts'],
    true,
  ),
  u(
    'gallon',
    'volume',
    3785.411784,
    'us',
    'gallon',
    'gallons',
    ['gallons', 'gal'],
    true,
  ),
  // Things you count
  u(
    'piece',
    'other',
    1,
    'any',
    'piece',
    'pieces',
    ['pieces', 'pc', 'pcs'],
    true,
  ),
  u('clove', 'other', 1, 'any', 'clove', 'cloves', ['cloves'], true),
  u('can', 'other', 1, 'any', 'can', 'cans', ['cans', 'tin', 'tins'], true),
  u('jar', 'other', 1, 'any', 'jar', 'jars', ['jars'], true),
  u('bottle', 'other', 1, 'any', 'bottle', 'bottles', ['bottles'], true),
  u(
    'packet',
    'other',
    1,
    'any',
    'packet',
    'packets',
    [
      'packets',
      'pack',
      'packs',
      'package',
      'packages',
      'pkg',
      'sachet',
      'sachets',
    ],
    true,
  ),
  u('bunch', 'other', 1, 'any', 'bunch', 'bunches', ['bunches'], true),
  u('head', 'other', 1, 'any', 'head', 'heads', ['heads'], true),
  u('sprig', 'other', 1, 'any', 'sprig', 'sprigs', ['sprigs'], true),
  u('stalk', 'other', 1, 'any', 'stalk', 'stalks', ['stalks'], true),
  u('stick', 'other', 1, 'any', 'stick', 'sticks', ['sticks'], true),
  u('slice', 'other', 1, 'any', 'slice', 'slices', ['slices'], true),
  u('loaf', 'other', 1, 'any', 'loaf', 'loaves', ['loaves'], true),
  u('rasher', 'other', 1, 'any', 'rasher', 'rashers', ['rashers'], true),
  u(
    'fillet',
    'other',
    1,
    'any',
    'fillet',
    'fillets',
    ['fillets', 'filet', 'filets'],
    true,
  ),
  u('leaf', 'other', 1, 'any', 'leaf', 'leaves', ['leaves'], true),
  u('handful', 'other', 1, 'any', 'handful', 'handfuls', ['handfuls'], true),
  u('pinch', 'other', 1, 'any', 'pinch', 'pinches', ['pinches'], true),
  u('dash', 'other', 1, 'any', 'dash', 'dashes', ['dashes'], true),
  u('drop', 'other', 1, 'any', 'drop', 'drops', ['drops'], true),
  u('knob', 'other', 1, 'any', 'knob', 'knobs', ['knobs'], true),
  u('splash', 'other', 1, 'any', 'splash', 'splashes', ['splashes'], true),
];

const byCode = new Map(UNITS.map((d) => [d.code, d]));
const byAlias = new Map<string, UnitDef>();
const byExactAlias = new Map<string, UnitDef>();
for (const d of UNITS) {
  for (const a of [d.code, d.singular, d.plural, ...d.aliases]) {
    byAlias.set(a.toLowerCase(), d);
  }
  for (const a of d.caseSensitiveAliases ?? []) byExactAlias.set(a, d);
}

export function unitDef(code: string | null | undefined): UnitDef | undefined {
  return code ? byCode.get(code) : undefined;
}

/** The unit a word like "Tablespoons" or "g" means, if any. */
export function findUnit(word: string): UnitDef | undefined {
  const exact = byExactAlias.get(word);
  if (exact) return exact;
  const lower = word.toLowerCase();
  return byAlias.get(lower) ?? byAlias.get(lower.replace(/\.$/, ''));
}

/** Multi-word aliases ("fl oz", "fluid ounces"), longest first, for the parser. */
export const MULTI_WORD_UNIT_ALIASES: [string, UnitDef][] = UNITS.flatMap((d) =>
  [d.singular, d.plural, ...d.aliases]
    .filter((a) => a.includes(' '))
    .map((a) => [a.toLowerCase(), d] as [string, UnitDef]),
).sort((a, b) => b[0].length - a[0].length);

/** Whether amounts in these two units can be added together. */
export function compatibleUnits(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  const da = unitDef(a);
  const db = unitDef(b);
  return (
    !!da && !!db && da.dimension !== 'other' && da.dimension === db.dimension
  );
}

/** Converts between two compatible units. Throws for incompatible ones. */
export function convert(quantity: number, from: string, to: string): number {
  if (from === to) return quantity;
  const f = unitDef(from);
  const t = unitDef(to);
  if (!f || !t || !compatibleUnits(from, to)) {
    throw new Error(`Cannot convert ${from} to ${to}`);
  }
  return (quantity * f.toBase) / t.toBase;
}

/**
 * Picks a sensible unit to show an amount in: 1500 g becomes 1.5 kg,
 * 6 tsp becomes 2 tbsp, and 250 ml becomes 1 cup for someone who
 * prefers US measures. Never changes dimension. Without a preference, the
 * amount stays in the system it was written in.
 */
export function bestUnit(
  quantity: number,
  unit: string,
  preference?: MeasurePreference,
): { quantity: number; unit: string } {
  const def = unitDef(unit);
  if (!def || def.dimension === 'other') return { quantity, unit };
  const base = quantity * def.toBase;
  const system =
    preference === 'imperial'
      ? 'us'
      : preference === 'metric'
        ? 'metric'
        : def.system;

  if (def.dimension === 'mass') {
    if (system === 'us') {
      return base >= 453.59237
        ? { quantity: base / 453.59237, unit: 'lb' }
        : { quantity: base / 28.349523125, unit: 'oz' };
    }
    if (base < 1) return { quantity: base * 1000, unit: 'mg' };
    return base >= 1000
      ? { quantity: base / 1000, unit: 'kg' }
      : { quantity: base, unit: 'g' };
  }

  // Volume. Spoons are used everywhere: without a preference they lead on to
  // cups as in US recipes; for metric readers only small amounts stay in spoons.
  const tsp = 4.92892159375;
  const tbsp = 14.78676478125;
  const cup = 236.5882365;
  const spoons =
    system === 'us' ||
    (def.system === 'any' && (!preference || base < 4 * tbsp));
  if (spoons) {
    if (base < tbsp - 0.01) return { quantity: base / tsp, unit: 'tsp' };
    if (base < cup / 4 - 0.01 || (system !== 'us' && preference)) {
      return { quantity: base / tbsp, unit: 'tbsp' };
    }
    return { quantity: base / cup, unit: 'cup' };
  }
  return base >= 1000
    ? { quantity: base / 1000, unit: 'l' }
    : { quantity: base, unit: 'ml' };
}
