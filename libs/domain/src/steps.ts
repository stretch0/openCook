import {
  type IngredientAmount,
  type Scaling,
  displayAmount,
} from './ingredient.js';
import { NUMBER_PATTERN, parseNumber } from './quantity.js';
import { type MeasurePreference, UNITS } from './units.js';

export type StepSegment = { text: string; amount?: boolean };

export type StepIngredient = IngredientAmount & {
  id: string;
  name: string;
  scaling?: Scaling;
};

// Only weights and volumes are scaled in step text. Counts like "cut into 4
// pieces" or times like "bake for 20 minutes" are left alone.
const MEASURE_ALIASES = UNITS.filter((d) => d.dimension !== 'other')
  .flatMap((d) => [d.code, d.singular, d.plural, ...d.aliases])
  .map((a) => a.replace(/[.]/g, '\\.'))
  .sort((a, b) => b.length - a.length);

const AMOUNT_IN_TEXT = new RegExp(
  `(?<![\\w.,/])(${NUMBER_PATTERN})(?:\\s*(?:-|–|to)\\s*(${NUMBER_PATTERN}))?\\s*(${MEASURE_ALIASES.join('|')})(?![\\w])`,
  'gi',
);

const TOKEN = /\{\{\s*(ing|qty)\s*:\s*([^}]+?)\s*\}\}/g;

/**
 * Splits a step into text and amounts, scaling amounts by `factor`.
 *
 * Amounts written in the text ("add 200 g flour") are found and scaled
 * automatically. Agents can also write `{{ing:<ingredient id>}}`, which shows
 * that ingredient's scaled amount and name, or `{{qty:200 g}}` to mark an
 * amount explicitly.
 */
export function scaleStep(
  text: string,
  factor: number,
  {
    preference,
    ingredients = [],
  }: { preference?: MeasurePreference; ingredients?: StepIngredient[] } = {},
): StepSegment[] {
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const out: StepSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    out.push(...scaleFreeText(text.slice(last, m.index), factor, preference));
    if (m[1] === 'ing') {
      const ing = byId.get(m[2]);
      if (ing) {
        const amount = displayAmount(ing, factor, preference);
        out.push({
          text: amount ? `${amount} ${ing.name}` : ing.name,
          amount: true,
        });
      }
    } else {
      out.push(...scaleFreeText(m[2], factor, preference, true));
    }
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(...scaleFreeText(text.slice(last), factor, preference));
  return merge(out);
}

/** scaleStep as plain text. */
export function scaleStepText(
  text: string,
  factor: number,
  options?: Parameters<typeof scaleStep>[2],
): string {
  return scaleStep(text, factor, options)
    .map((s) => s.text)
    .join('');
}

function scaleFreeText(
  text: string,
  factor: number,
  preference: MeasurePreference | undefined,
  forceAmount = false,
): StepSegment[] {
  const out: StepSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(AMOUNT_IN_TEXT)) {
    const quantity = parseNumber(m[1]);
    const unit = UNITS.find((d) =>
      [d.code, d.singular, d.plural, ...d.aliases].some(
        (a) => a.toLowerCase() === m[3].toLowerCase(),
      ),
    );
    if (quantity === null || !unit) continue;
    out.push({ text: text.slice(last, m.index) });
    out.push({
      text: displayAmount(
        {
          quantity,
          quantityMax: m[2] ? parseNumber(m[2]) : null,
          unit: unit.code,
        },
        factor,
        preference,
      ),
      amount: true,
    });
    last = (m.index ?? 0) + m[0].length;
  }
  const rest = text.slice(last);
  if (rest)
    out.push(forceAmount ? { text: rest, amount: true } : { text: rest });
  return out;
}

function merge(segments: StepSegment[]): StepSegment[] {
  const out: StepSegment[] = [];
  for (const s of segments) {
    if (!s.text) continue;
    const prev = out[out.length - 1];
    if (prev && !prev.amount && !s.amount) prev.text += s.text;
    else out.push({ ...s });
  }
  return out;
}
