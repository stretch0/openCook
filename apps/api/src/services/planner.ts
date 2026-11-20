import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { type Db, schema } from '@opencook/db';
import {
  type NeedLine,
  addDays,
  aggregateNeeds,
  classifyNeed,
  normalItemKey,
  scaleAmount,
  servingsFactor,
  weekStart,
} from '@opencook/domain';
import {
  type AddNeeds,
  type AddPlanEntry,
  type AddedListItem,
  type MealPlan,
  type PlanEntry,
  type ShoppingNeed,
  type ShoppingSelection,
  type UpdatePlanEntry,
  addNeedsSchema,
  addPlanEntrySchema,
  shoppingSelectionSchema,
} from '@opencook/schemas';
import { HttpError, notFound } from './errors.js';
import { imageUrl } from './images.js';
import { categoriesFor } from './items.js';
import { type Viewer, getRecipe, logCooked } from './recipes.js';
import { addToList, loadList } from './shopping.js';

type EntryRow = typeof schema.mealPlanEntry.$inferSelect;

function toEntries(db: Db, rows: EntryRow[]): PlanEntry[] {
  const recipeIds = [
    ...new Set(rows.map((r) => r.recipeId).filter((id): id is string => !!id)),
  ];
  const recipes = new Map(
    recipeIds.length
      ? db
          .select({
            id: schema.recipe.id,
            servings: schema.recipe.servings,
            imageId: schema.recipe.imageId,
          })
          .from(schema.recipe)
          .where(inArray(schema.recipe.id, recipeIds))
          .all()
          .map((r) => [r.id, r])
      : [],
  );
  return rows.map((r) => {
    const recipe = r.recipeId ? recipes.get(r.recipeId) : undefined;
    return {
      id: r.id,
      date: r.date,
      slot: r.slot,
      recipeId: r.recipeId,
      title: r.title,
      imageUrl: imageUrl(recipe?.imageId ?? null),
      servings: r.servings,
      recipeServings: recipe?.servings ?? null,
      note: r.note,
      cookedAt: r.cookedAt?.toISOString() ?? null,
    };
  });
}

const SLOT_ORDER = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 } as const;

export function getPlan(
  db: Db,
  viewer: Viewer,
  { from, days = 7, today }: { from?: string; days?: number; today: string },
): MealPlan {
  const start = from ?? weekStart(today);
  const end = addDays(start, days - 1);
  const rows = db
    .select()
    .from(schema.mealPlanEntry)
    .where(
      and(
        eq(schema.mealPlanEntry.householdId, viewer.householdId),
        gte(schema.mealPlanEntry.date, start),
        lte(schema.mealPlanEntry.date, end),
      ),
    )
    .orderBy(
      asc(schema.mealPlanEntry.date),
      asc(schema.mealPlanEntry.createdAt),
    )
    .all()
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot],
    );
  return { from: start, to: end, entries: toEntries(db, rows) };
}

export function addPlanEntry(
  db: Db,
  viewer: Viewer,
  raw: AddPlanEntry,
): PlanEntry {
  const input = addPlanEntrySchema.parse(raw);
  const recipe = input.recipeId ? getRecipe(db, viewer, input.recipeId) : null;
  const [row] = db
    .insert(schema.mealPlanEntry)
    .values({
      householdId: viewer.householdId,
      date: input.date,
      slot: input.slot,
      recipeId: recipe?.id ?? null,
      title: input.title ?? recipe?.title ?? 'Meal',
      servings: input.servings ?? null,
      note: input.note ?? null,
      addedBy: viewer.userId,
    })
    .returning()
    .all();
  return toEntries(db, [row])[0];
}

function loadEntry(db: Db, viewer: Viewer, id: string): EntryRow {
  const row = db
    .select()
    .from(schema.mealPlanEntry)
    .where(eq(schema.mealPlanEntry.id, id))
    .get();
  if (!row || row.householdId !== viewer.householdId)
    throw notFound('Not on your plan');
  return row;
}

export function updatePlanEntry(
  db: Db,
  viewer: Viewer,
  id: string,
  patch: UpdatePlanEntry,
): PlanEntry {
  const row = loadEntry(db, viewer, id);
  const { cooked, ...rest } = patch;
  const set: Partial<EntryRow> = { ...rest };
  if (cooked === true && !row.cookedAt) {
    set.cookedAt = new Date();
    if (row.recipeId) {
      try {
        logCooked(db, viewer, row.recipeId, {
          servings: row.servings ?? undefined,
        });
      } catch {
        // The recipe was deleted or isn't visible any more; the plan still counts.
      }
    }
  } else if (cooked === false) {
    set.cookedAt = null;
  }
  db.update(schema.mealPlanEntry)
    .set(set)
    .where(eq(schema.mealPlanEntry.id, id))
    .run();
  return toEntries(db, [loadEntry(db, viewer, id)])[0];
}

export function removePlanEntry(db: Db, viewer: Viewer, id: string) {
  loadEntry(db, viewer, id);
  db.delete(schema.mealPlanEntry).where(eq(schema.mealPlanEntry.id, id)).run();
}

/**
 * Everything the chosen meals need, added up across recipes and sorted into
 * what to buy, what the household probably has (with the reason) and what's
 * already on the list. Optional ingredients are left out.
 */
export function shoppingNeeds(
  db: Db,
  viewer: Viewer,
  raw: ShoppingSelection,
  now = new Date(),
): ShoppingNeed[] {
  const selection = shoppingSelectionSchema.parse(raw);
  const wanted: { recipeId: string; servings?: number }[] = [
    ...(selection.recipes ?? []),
  ];
  if (selection.from && selection.to) {
    if (selection.to < selection.from)
      throw new HttpError(422, '"to" is before "from".');
    const entries = db
      .select()
      .from(schema.mealPlanEntry)
      .where(
        and(
          eq(schema.mealPlanEntry.householdId, viewer.householdId),
          gte(schema.mealPlanEntry.date, selection.from),
          lte(schema.mealPlanEntry.date, selection.to),
          isNull(schema.mealPlanEntry.cookedAt),
        ),
      )
      .all();
    for (const e of entries) {
      if (e.recipeId)
        wanted.push({
          recipeId: e.recipeId,
          servings: e.servings ?? undefined,
        });
    }
  }

  const lines: NeedLine[] = [];
  for (const w of wanted) {
    let recipe;
    try {
      recipe = getRecipe(db, viewer, w.recipeId);
    } catch (e) {
      // A planned recipe that's since been deleted just has nothing to buy.
      if (selection.recipes?.some((r) => r.recipeId === w.recipeId)) throw e;
      continue;
    }
    const servings = w.servings ?? recipe.servings;
    const factor = servingsFactor(recipe.servings, servings);
    for (const i of recipe.ingredients) {
      if (i.optional) continue;
      const scaled = scaleAmount(i, factor);
      lines.push({
        itemId: i.itemId,
        name: i.name.charAt(0).toUpperCase() + i.name.slice(1),
        quantity: scaled.quantityMax ?? scaled.quantity,
        unit: i.unit,
        sources: [{ recipeId: recipe.id, title: recipe.title, servings }],
      });
    }
  }
  const needs = aggregateNeeds(lines);
  if (!needs.length) return [];

  const itemIds = [
    ...new Set(needs.map((n) => n.itemId).filter((id): id is string => !!id)),
  ];
  const pantry = new Map(
    itemIds.length
      ? db
          .select()
          .from(schema.pantryItem)
          .where(
            and(
              eq(schema.pantryItem.householdId, viewer.householdId),
              inArray(schema.pantryItem.itemId, itemIds),
            ),
          )
          .all()
          .map((p) => [p.itemId, p])
      : [],
  );
  const purchases = new Map<string, Date[]>();
  if (itemIds.length) {
    for (const p of db
      .select({
        itemId: schema.purchaseEvent.itemId,
        at: schema.purchaseEvent.purchasedAt,
      })
      .from(schema.purchaseEvent)
      .where(
        and(
          eq(schema.purchaseEvent.householdId, viewer.householdId),
          inArray(schema.purchaseEvent.itemId, itemIds),
        ),
      )
      .all()) {
      if (p.itemId)
        purchases.set(p.itemId, [...(purchases.get(p.itemId) ?? []), p.at]);
    }
  }
  const list = loadList(db, viewer, selection.listId ?? 'ongoing');
  const onList = new Set(
    itemIds.length
      ? db
          .select({ itemId: schema.shoppingListItem.itemId })
          .from(schema.shoppingListItem)
          .where(
            and(
              eq(schema.shoppingListItem.listId, list.id),
              isNull(schema.shoppingListItem.checkedAt),
              inArray(schema.shoppingListItem.itemId, itemIds),
            ),
          )
          .all()
          .map((r) => r.itemId)
      : [],
  );
  const categories = categoriesFor(db, viewer.householdId, itemIds);

  const seen = new Map<string, number>();
  return needs.map((n) => {
    const base = n.itemId ?? `name:${normalItemKey(n.name)}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const p = n.itemId ? pantry.get(n.itemId) : undefined;
    const { status, reason } = classifyNeed(
      {
        pantry: p ? { staple: p.staple, status: p.status } : undefined,
        purchases: n.itemId ? (purchases.get(n.itemId) ?? []) : [],
        onList: !!n.itemId && onList.has(n.itemId),
      },
      now,
    );
    return {
      key: count ? `${base}#${count}` : base,
      itemId: n.itemId,
      name: n.name,
      quantity: n.quantity,
      unit: n.unit,
      category: (n.itemId && categories.get(n.itemId)) || 'other',
      status,
      reason,
      sources: n.sources,
    };
  });
}

/**
 * Adds the chosen needs to the list (by default, everything marked "need"),
 * each line noting which recipes wanted it.
 */
export function addNeedsToList(
  db: Db,
  viewer: Viewer,
  raw: AddNeeds,
  now = new Date(),
): AddedListItem[] {
  const { selection, include } = addNeedsSchema.parse(raw);
  const needs = shoppingNeeds(db, viewer, selection, now);
  const chosen = include
    ? needs.filter((n) => include.includes(n.key))
    : needs.filter((n) => n.status === 'need');
  if (!chosen.length) return [];
  return addToList(
    db,
    viewer,
    selection.listId ?? 'ongoing',
    chosen.map((n) => ({
      entry: n.name,
      name: n.name,
      quantity: n.quantity,
      unit: n.unit,
      note: null,
      itemId: n.itemId ?? undefined,
      sources: n.sources,
    })),
  );
}
