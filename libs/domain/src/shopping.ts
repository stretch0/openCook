import { AISLE_NAMES } from './catalogue.js';
import { bestUnit, compatibleUnits, convert, unitDef } from './units.js';

export type Amount = { quantity: number | null; unit: string | null };

/**
 * Adds two amounts of the same item for a shopping list: 200 g + 1 kg is
 * 1.2 kg, 2 + 3 is 5, "some milk" + 2 l is 2 l. Returns null when they can't
 * be added (2 cans + 400 g), so the list keeps them as separate lines.
 */
export function combineAmounts(a: Amount, b: Amount): Amount | null {
  if (a.quantity === null && b.quantity === null) {
    return a.unit === b.unit || !a.unit || !b.unit
      ? { quantity: null, unit: a.unit ?? b.unit }
      : null;
  }
  if (a.quantity === null)
    return a.unit && a.unit !== b.unit && !compatibleUnits(a.unit, b.unit)
      ? null
      : b;
  if (b.quantity === null)
    return b.unit && b.unit !== a.unit && !compatibleUnits(a.unit, b.unit)
      ? null
      : a;
  if (!compatibleUnits(a.unit, b.unit)) return null;
  if (a.unit === b.unit)
    return { quantity: a.quantity + b.quantity, unit: a.unit };
  // Different units of the same dimension: add in the first, then tidy up.
  const sum =
    a.quantity + convert(b.quantity, b.unit as string, a.unit as string);
  const def = unitDef(a.unit);
  if (!def || def.dimension === 'other') return { quantity: sum, unit: a.unit };
  return bestUnit(sum, a.unit as string);
}

/** The order aisles appear on a list, roughly the walk round a supermarket. */
export const AISLE_ORDER = Object.keys(AISLE_NAMES);

export function aisleRank(category: string): number {
  const i = AISLE_ORDER.indexOf(category);
  return i < 0 ? AISLE_ORDER.length : i;
}

/** Groups list lines by aisle, in aisle order, keeping each group's order. */
export function groupByAisle<T extends { category: string }>(
  items: T[],
): { category: string; name: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = AISLE_NAMES[item.category] ? item.category : 'other';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .sort((x, y) => aisleRank(x[0]) - aisleRank(y[0]))
    .map(([category, list]) => ({
      category,
      name: AISLE_NAMES[category],
      items: list,
    }));
}
