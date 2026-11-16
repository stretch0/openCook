import { NUMBER_PATTERN, formatQuantity, parseNumber } from './quantity.js';
import {
  MULTI_WORD_UNIT_ALIASES,
  type MeasurePreference,
  bestUnit,
  findUnit,
  unitDef,
} from './units.js';

/**
 * linear: scales with servings (most things).
 * fixed: stays the same whatever the servings (1 bay leaf, a tin for greasing).
 * to_taste: no amount; shown as written.
 */
export type Scaling = 'linear' | 'fixed' | 'to_taste';

export type ParsedIngredient = {
  quantity: number | null;
  quantityMax: number | null;
  unit: string | null;
  name: string;
  preparation: string | null;
  note: string | null;
  optional: boolean;
  scaling: Scaling;
  rawText: string;
};

const PACK_SIZE = new RegExp(
  `^\\s*(${NUMBER_PATTERN}\\s*-?\\s*(?:g|kg|ml|l|oz|lb|fl oz)\\.?)(?=\\s)`,
  'i',
);

const RANGE = new RegExp(
  `^(${NUMBER_PATTERN})(?:\\s*(?:-|–|—|to|or)\\s*(${NUMBER_PATTERN}))?`,
);

/**
 * Parses a line like "1 ½ cups plain flour, sifted" or "2-3 cloves garlic"
 * into an amount, unit, name and preparation. Never fails: anything it can't
 * read stays in the name, and the original line is kept in rawText.
 */
export function parseIngredientLine(line: string): ParsedIngredient {
  const rawText = line.trim().replace(/\s+/g, ' ');
  let s = rawText.replace(/^[-*•▢□]\s*/, '');
  let optional = false;
  let scaling: Scaling = 'linear';
  const notes: string[] = [];

  if (/\(optional\)|,?\s*\boptional\s*$|^optional:?\s*/i.test(s)) {
    optional = true;
    s = s
      .replace(/\s*\(optional\)/i, '')
      .replace(/,?\s*\boptional\s*$/i, '')
      .replace(/^optional:?\s*/i, '');
  }
  if (/\bto taste\b/i.test(s)) {
    scaling = 'to_taste';
    s = s.replace(/,?\s*\bto taste\b/i, '').trim();
  }

  let quantity: number | null = null;
  let quantityMax: number | null = null;
  const range = s.match(RANGE);
  if (range) {
    quantity = parseNumber(range[1]);
    quantityMax = range[2] ? parseNumber(range[2]) : null;
    s = s.slice(range[0].length);
    // "2 x 400g tins": the multiplier is the amount.
    s = s.replace(/^\s*x\s+/i, ' ');
  } else {
    const article = s.match(/^(a|an|one)\s+/i);
    if (article && unitAt(s.slice(article[0].length))) {
      quantity = 1;
      s = s.slice(article[0].length);
    }
  }

  // A size in brackets right after the amount: "1 (400g) can tomatoes".
  const size = s.match(/^\s*\(([^)]*)\)/);
  if (size && quantity !== null) {
    notes.push(size[1].trim());
    s = s.slice(size[0].length);
  }

  // A pack size before the container: "2 x 400g tins", "1 14-oz can".
  if (quantity !== null) {
    const pack = s.match(PACK_SIZE);
    if (pack) {
      const container = unitAt(s.slice(pack[0].length));
      if (container && unitDef(container.code)?.dimension === 'other') {
        notes.push(pack[1].replace(/\s*-\s*/, ' ').trim());
        s = s.slice(pack[0].length);
      }
    }
  }

  let unit: string | null = null;
  if (quantity !== null) {
    const found = unitAt(s);
    if (found) {
      unit = found.code;
      s = s.slice(found.length);
    }
  }
  s = s.replace(/^\s*\.?\s*(of\s+)?/i, '');

  let name = s;
  let preparation: string | null = null;
  const comma = name.indexOf(',');
  if (comma > 0) {
    preparation = name.slice(comma + 1).trim() || null;
    name = name.slice(0, comma);
  }
  const bracket = name.match(/\s*\(([^)]*)\)\s*/);
  if (bracket) {
    notes.push(bracket[1].trim());
    name = name.replace(bracket[0], ' ');
  }
  name = name.trim();
  if (!name) name = rawText;

  if (quantityMax !== null && quantity !== null && quantityMax <= quantity) {
    quantityMax = null;
  }

  return {
    quantity,
    quantityMax,
    unit,
    name,
    preparation,
    note: notes.filter(Boolean).join('; ') || null,
    optional,
    scaling,
    rawText,
  };
}

/** The unit at the start of `s` (after spaces), and how many characters it used. */
function unitAt(s: string): { code: string; length: number } | null {
  const lead = s.match(/^\s*/)?.[0].length ?? 0;
  const rest = s.slice(lead);
  const lower = rest.toLowerCase();
  for (const [alias, def] of MULTI_WORD_UNIT_ALIASES) {
    if (lower.startsWith(alias) && !/[a-z]/i.test(rest[alias.length] ?? '')) {
      return { code: def.code, length: lead + alias.length };
    }
  }
  const word = rest.match(/^[a-zA-Z]+\.?/)?.[0];
  if (!word) return null;
  const def = findUnit(word);
  if (!def) return null;
  // A lone "t"/"T" must be followed by a space to count as tsp/tbsp.
  if (
    word.length <= 2 &&
    !/^\s/.test(rest.slice(word.length)) &&
    rest.length > word.length
  ) {
    return null;
  }
  return { code: def.code, length: lead + word.length };
}

export type IngredientAmount = {
  quantity: number | null;
  quantityMax?: number | null;
  unit: string | null;
  scaling?: Scaling;
};

/** Multiplies an amount by `factor` (target servings ÷ recipe servings). */
export function scaleAmount<T extends IngredientAmount>(
  ingredient: T,
  factor: number,
): T {
  if (ingredient.scaling === 'fixed' || ingredient.scaling === 'to_taste') {
    return ingredient;
  }
  return {
    ...ingredient,
    quantity:
      ingredient.quantity === null ? null : ingredient.quantity * factor,
    quantityMax:
      ingredient.quantityMax == null
        ? ingredient.quantityMax
        : ingredient.quantityMax * factor,
  };
}

/** The factor that turns `from` servings into `to` servings. */
export function servingsFactor(from: number, to: number): number {
  return from > 0 && to > 0 ? to / from : 1;
}

/**
 * The amount as it should be shown: scaled, put in a sensible unit for the
 * reader's preference, and rounded, e.g. "1 ½ tbsp" or "1.2 kg".
 */
export function displayAmount(
  ingredient: IngredientAmount,
  factor = 1,
  preference?: MeasurePreference,
): string {
  const scaled = scaleAmount(ingredient, factor);
  if (scaled.quantity === null) return '';
  if (!scaled.unit) {
    return formatQuantity(scaled.quantity, null, scaled.quantityMax);
  }
  const best = bestUnit(scaled.quantity, scaled.unit, preference);
  const ratio = scaled.quantity ? best.quantity / scaled.quantity : 1;
  return formatQuantity(
    best.quantity,
    best.unit,
    scaled.quantityMax == null ? null : scaled.quantityMax * ratio,
  );
}

/**
 * Writes an ingredient back as a line that parseIngredientLine reads the
 * same way, for editing as text: "2–3 cloves garlic (large), crushed".
 */
export function ingredientLine(i: {
  quantity: number | null;
  quantityMax?: number | null;
  unit: string | null;
  name: string;
  preparation?: string | null;
  note?: string | null;
  optional?: boolean;
  scaling?: Scaling;
}): string {
  let line = [
    formatQuantity(i.quantity, i.unit, i.quantityMax).replace('–', '-'),
    i.name,
  ]
    .filter(Boolean)
    .join(' ');
  if (i.note) line += ` (${i.note})`;
  if (i.preparation) line += `, ${i.preparation}`;
  if (i.scaling === 'to_taste' && i.quantity === null) line += ', to taste';
  if (i.optional) line += ' (optional)';
  return line;
}
