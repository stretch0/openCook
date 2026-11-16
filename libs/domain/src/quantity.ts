import { unitDef } from './units.js';

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 1 / 2,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 1 / 4,
  '¾': 3 / 4,
  '⅕': 1 / 5,
  '⅖': 2 / 5,
  '⅗': 3 / 5,
  '⅘': 4 / 5,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅛': 1 / 8,
  '⅜': 3 / 8,
  '⅝': 5 / 8,
  '⅞': 7 / 8,
};

const FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join('');

/**
 * Matches one amount at the start of a string: "1", "1.5", "1,5", "1/2",
 * "1 1/2", "1½", "1 ½" or "½".
 */
export const NUMBER_PATTERN = `(?:\\d+\\s*[${FRACTION_CHARS}]|\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|\\d+(?:[.,]\\d+)?|[${FRACTION_CHARS}])`;

/** Parses one amount written as in NUMBER_PATTERN. */
export function parseNumber(text: string): number | null {
  const s = text.trim();
  let m = s.match(new RegExp(`^(\\d+)\\s*([${FRACTION_CHARS}])$`));
  if (m) return Number(m[1]) + UNICODE_FRACTIONS[m[2]];
  if (UNICODE_FRACTIONS[s] !== undefined) return UNICODE_FRACTIONS[s];
  m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (m)
    return Number(m[3]) ? Number(m[1]) + Number(m[2]) / Number(m[3]) : null;
  m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  return null;
}

const KITCHEN_FRACTIONS: [number, string][] = [
  [0, ''],
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [1, ''],
];

/** Rounds to a cook-friendly fraction: 0.33 → "⅓", 1.5 → "1 ½", 2.97 → "3". */
export function formatFraction(n: number): string {
  if (n <= 0) return '0';
  let whole = Math.floor(n);
  const rest = n - whole;
  let best = KITCHEN_FRACTIONS[0];
  for (const f of KITCHEN_FRACTIONS) {
    if (Math.abs(rest - f[0]) < Math.abs(rest - best[0])) best = f;
  }
  if (best[0] === 1) {
    whole += 1;
    best = KITCHEN_FRACTIONS[0];
  }
  // Too small for the fraction table: show a decimal rather than "0".
  if (whole === 0 && !best[1]) return trimDecimal(n, 2);
  if (whole === 0) return best[1];
  return best[1] ? `${whole} ${best[1]}` : String(whole);
}

function trimDecimal(n: number, places: number) {
  return String(Number(n.toFixed(places)));
}

/** Rounds metric amounts to what a scale can show: 3.333 g → "3.3", 236.6 → "235". */
export function formatDecimal(n: number): string {
  if (n >= 100) return String(Math.round(n / 5) * 5);
  if (n >= 10) return String(Math.round(n));
  if (n >= 1) return trimDecimal(n, 1);
  return trimDecimal(n, 2);
}

/** Formats an amount the way its unit is usually written. */
export function formatAmount(n: number, unit: string | null): string {
  const def = unitDef(unit);
  if (unit === 'kg' || unit === 'l') return trimDecimal(n, 2);
  if (def && !def.fractions) return formatDecimal(n);
  return formatFraction(n);
}

/** "200 g", "2 cups", "1 clove", "3" or "2–3 tbsp". */
export function formatQuantity(
  quantity: number | null,
  unit: string | null,
  quantityMax?: number | null,
): string {
  if (quantity === null) return '';
  const def = unitDef(unit);
  const amount =
    quantityMax != null && quantityMax > quantity
      ? `${formatAmount(quantity, unit)}–${formatAmount(quantityMax, unit)}`
      : formatAmount(quantity, unit);
  if (!def) return amount;
  const plural = (quantityMax ?? quantity) > 1;
  return `${amount} ${plural ? def.plural : def.singular}`;
}
