import { type Amount, combineAmounts } from './shopping.js';
import { normalItemKey } from './items.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD plus or minus whole days (calendar maths, no time zones). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday on or before a date. */
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((day + 6) % 7));
}

/** Today's date in a time zone, as YYYY-MM-DD. */
export function today(timeZone = 'UTC', now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function isIsoDate(s: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  );
}

export type RestockState = {
  lastBought: Date | null;
  daysSince: number | null;
  /** The usual number of days between buying it; needs three purchases. */
  intervalDays: number | null;
  /** It's been nearly as long as usual (or longer) since it was bought. */
  due: boolean;
};

/** Purchases closer together than this are one shop (e.g. two packs at once). */
const SAME_SHOP_DAYS = 0.5;

/**
 * How often something gets bought, from when it was bought: the median gap
 * between purchases. "Due" once the time since the last purchase reaches
 * 85% of that, so it's suggested a little before it runs out.
 */
export function restockState(
  purchases: Date[],
  now = new Date(),
): RestockState {
  const times = [...new Set(purchases.map((d) => d.getTime()))].sort(
    (a, b) => a - b,
  );
  const shops: number[] = [];
  for (const t of times) {
    if (
      !shops.length ||
      (t - shops[shops.length - 1]) / DAY_MS >= SAME_SHOP_DAYS
    )
      shops.push(t);
  }
  if (!shops.length)
    return {
      lastBought: null,
      daysSince: null,
      intervalDays: null,
      due: false,
    };
  const last = shops[shops.length - 1];
  const daysSince = Math.max(0, Math.floor((now.getTime() - last) / DAY_MS));
  if (shops.length < 3) {
    return {
      lastBought: new Date(last),
      daysSince,
      intervalDays: null,
      due: false,
    };
  }
  const gaps = shops
    .slice(1)
    .map((t, i) => (t - shops[i]) / DAY_MS)
    .sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  const intervalDays = Math.max(1, Math.round(median));
  return {
    lastBought: new Date(last),
    daysSince,
    intervalDays,
    due: daysSince >= intervalDays * 0.85,
  };
}

export type NeedSource = { recipeId: string; title: string; servings?: number };

export type NeedLine = Amount & {
  itemId: string | null;
  name: string;
  sources: NeedSource[];
};

/**
 * Adds up what several recipes need: the same item's amounts are added
 * when they can be (two recipes' onions become one line), otherwise they
 * stay as separate lines.
 */
export function aggregateNeeds(lines: NeedLine[]): NeedLine[] {
  const out: NeedLine[] = [];
  for (const line of lines) {
    const key = line.itemId ?? `name:${normalItemKey(line.name)}`;
    let merged = false;
    for (const existing of out) {
      const existingKey =
        existing.itemId ?? `name:${normalItemKey(existing.name)}`;
      if (existingKey !== key) continue;
      const sum = combineAmounts(existing, line);
      if (!sum) continue;
      existing.quantity = sum.quantity;
      existing.unit = sum.unit;
      for (const s of line.sources) {
        if (!existing.sources.some((e) => e.recipeId === s.recipeId))
          existing.sources.push(s);
      }
      merged = true;
      break;
    }
    if (!merged) out.push({ ...line, sources: [...line.sources] });
  }
  return out;
}

export type NeedStatus = 'need' | 'probably_have' | 'already_on_list';

export type NeedContext = {
  /** From the pantry: a staple, and/or marked low or out. */
  pantry?: { staple: boolean; status: 'have' | 'low' | 'out' };
  /** When the household bought it. */
  purchases: Date[];
  /** Already waiting on the shopping list. */
  onList: boolean;
};

/**
 * Whether something a recipe needs has to be bought, with the reason in
 * plain words. "Probably have" is a guess the cook confirms: the app never
 * silently leaves something off.
 */
export function classifyNeed(
  ctx: NeedContext,
  now = new Date(),
): { status: NeedStatus; reason: string | null } {
  if (ctx.onList)
    return {
      status: 'already_on_list',
      reason: 'Already on the shopping list',
    };
  if (ctx.pantry?.status === 'out')
    return { status: 'need', reason: 'Marked as run out' };
  if (ctx.pantry?.status === 'low')
    return { status: 'need', reason: 'Marked as running low' };
  const r = restockState(ctx.purchases, now);
  if (ctx.pantry?.staple) {
    if (r.due && r.intervalDays) {
      return {
        status: 'need',
        reason: `A staple, but you usually buy it every ${plural(r.intervalDays, 'day')} and it's been ${plural(r.daysSince ?? 0, 'day')}`,
      };
    }
    return { status: 'probably_have', reason: 'You always have this' };
  }
  if (r.daysSince !== null) {
    if (r.intervalDays !== null) {
      if (r.daysSince < r.intervalDays * 0.5) {
        return {
          status: 'probably_have',
          reason: `Bought ${ago(r.daysSince)}; usually lasts about ${plural(r.intervalDays, 'day')}`,
        };
      }
      if (r.due) {
        return {
          status: 'need',
          reason: `You usually buy it every ${plural(r.intervalDays, 'day')}; it's been ${plural(r.daysSince, 'day')}`,
        };
      }
    } else if (r.daysSince <= 3) {
      return { status: 'probably_have', reason: `Bought ${ago(r.daysSince)}` };
    }
  }
  return { status: 'need', reason: null };
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function ago(days: number) {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * Things most kitchens always have. Offered once as a checklist so they
 * don't land on the list every week; households tick their own.
 */
export const SUGGESTED_STAPLES = [
  'salt',
  'black pepper',
  'olive oil',
  'vegetable oil',
  'plain flour',
  'granulated sugar',
  'baking powder',
  'bicarbonate of soda',
  'soy sauce',
  'stock cube',
  'white wine vinegar',
  'tomato puree',
  'dijon mustard',
  'honey',
  'rice',
  'pasta',
  'garlic',
  'cumin',
  'paprika',
  'smoked paprika',
  'turmeric',
  'garam masala',
  'chilli flakes',
  'cinnamon',
  'dried oregano',
  'mixed herbs',
  'bay leaf',
];
