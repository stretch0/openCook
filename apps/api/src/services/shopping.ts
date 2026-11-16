import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
} from 'drizzle-orm';
import { type Db, schema } from '@opencook/db';
import {
  combineAmounts,
  parseIngredientLine,
  scaleAmount,
  servingsFactor,
  unitDef,
} from '@opencook/domain';
import type {
  AddedListItem,
  ListEntry,
  ListItem,
  Purchase,
  RecipeToList,
  ShoppingList,
  ShoppingListSummary,
  UpdateListItem,
} from '@opencook/schemas';
import { HttpError, notFound } from './errors.js';
import { listChanged } from './events.js';
import { categoriesFor, resolveItems, setItemCategory } from './items.js';
import { type Viewer, getRecipe } from './recipes.js';

type ListRow = typeof schema.shoppingList.$inferSelect;
type LineRow = typeof schema.shoppingListItem.$inferSelect;
type ListItemSource = LineRow['sources'][number];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The household's ongoing list, made the first time it's needed. */
export function ongoingList(db: Db, householdId: string): ListRow {
  const existing = db
    .select()
    .from(schema.shoppingList)
    .where(
      and(
        eq(schema.shoppingList.householdId, householdId),
        eq(schema.shoppingList.kind, 'ongoing'),
      ),
    )
    .get();
  if (existing) return existing;
  const [created] = db
    .insert(schema.shoppingList)
    .values({ householdId, name: 'Shopping list', kind: 'ongoing' })
    .returning()
    .all();
  return created;
}

/** A list in the viewer's household; "ongoing" means the household's ongoing list. */
export function loadList(db: Db, viewer: Viewer, listId: string): ListRow {
  if (listId === 'ongoing') return ongoingList(db, viewer.householdId);
  const list = db
    .select()
    .from(schema.shoppingList)
    .where(eq(schema.shoppingList.id, listId))
    .get();
  if (!list || list.householdId !== viewer.householdId) {
    throw notFound('List not found');
  }
  return list;
}

export function listLists(db: Db, viewer: Viewer): ShoppingListSummary[] {
  ongoingList(db, viewer.householdId);
  const lists = db
    .select()
    .from(schema.shoppingList)
    .where(eq(schema.shoppingList.householdId, viewer.householdId))
    .orderBy(asc(schema.shoppingList.createdAt))
    .all();
  const remaining = new Map(
    db
      .select({ listId: schema.shoppingListItem.listId, n: count() })
      .from(schema.shoppingListItem)
      .where(
        and(
          inArray(
            schema.shoppingListItem.listId,
            lists.map((l) => l.id),
          ),
          isNull(schema.shoppingListItem.checkedAt),
        ),
      )
      .groupBy(schema.shoppingListItem.listId)
      .all()
      .map((r) => [r.listId, r.n]),
  );
  return lists
    .sort((a, b) => Number(b.kind === 'ongoing') - Number(a.kind === 'ongoing'))
    .map((l) => ({
      id: l.id,
      name: l.name,
      kind: l.kind,
      remaining: remaining.get(l.id) ?? 0,
    }));
}

export function createList(
  db: Db,
  viewer: Viewer,
  name: string,
): ShoppingListSummary {
  const [list] = db
    .insert(schema.shoppingList)
    .values({ householdId: viewer.householdId, name, kind: 'named' })
    .returning()
    .all();
  return { id: list.id, name: list.name, kind: list.kind, remaining: 0 };
}

export function renameList(
  db: Db,
  viewer: Viewer,
  listId: string,
  name: string,
) {
  const list = loadList(db, viewer, listId);
  db.update(schema.shoppingList)
    .set({ name })
    .where(eq(schema.shoppingList.id, list.id))
    .run();
  listChanged(list.id, viewer.userId);
}

export function deleteList(db: Db, viewer: Viewer, listId: string) {
  const list = loadList(db, viewer, listId);
  if (list.kind === 'ongoing') {
    throw new HttpError(
      422,
      "The ongoing list can't be deleted. Tick things off instead.",
    );
  }
  db.delete(schema.shoppingList)
    .where(eq(schema.shoppingList.id, list.id))
    .run();
  listChanged(list.id, viewer.userId);
}

function toListItems(db: Db, householdId: string, rows: LineRow[]): ListItem[] {
  const categories = categoriesFor(
    db,
    householdId,
    rows.map((r) => r.itemId).filter((id): id is string => !!id),
  );
  return rows.map((r) => ({
    id: r.id,
    itemId: r.itemId,
    name: r.name,
    quantity: r.quantity,
    unit: r.unit,
    note: r.note,
    category: (r.itemId && categories.get(r.itemId)) || 'other',
    sources: r.sources,
    addedBy: r.addedBy,
    checkedAt: r.checkedAt?.toISOString() ?? null,
    checkedBy: r.checkedBy,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export function getList(db: Db, viewer: Viewer, listId: string): ShoppingList {
  const list = loadList(db, viewer, listId);
  const open = db
    .select()
    .from(schema.shoppingListItem)
    .where(
      and(
        eq(schema.shoppingListItem.listId, list.id),
        isNull(schema.shoppingListItem.checkedAt),
      ),
    )
    .orderBy(asc(schema.shoppingListItem.createdAt))
    .all();
  const recent = db
    .select()
    .from(schema.shoppingListItem)
    .where(
      and(
        eq(schema.shoppingListItem.listId, list.id),
        isNotNull(schema.shoppingListItem.checkedAt),
        gt(schema.shoppingListItem.checkedAt, new Date(Date.now() - WEEK_MS)),
      ),
    )
    .orderBy(desc(schema.shoppingListItem.checkedAt))
    .limit(50)
    .all();
  return {
    id: list.id,
    name: list.name,
    kind: list.kind,
    items: toListItems(db, viewer.householdId, open),
    recentlyBought: toListItems(db, viewer.householdId, recent),
  };
}

type Normalised = {
  entry: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  itemId?: string;
  /** Recipes that asked for it. */
  sources?: ListItemSource[];
};

function normaliseEntry(entry: ListEntry): Normalised {
  if (typeof entry === 'string') {
    const p = parseIngredientLine(entry);
    const note = [p.note, p.preparation].filter(Boolean).join(', ') || null;
    return {
      entry,
      name: p.name,
      quantity: p.quantity,
      unit: p.unit,
      note,
    };
  }
  let unit = entry.unit ?? null;
  if (unit && !unitDef(unit)) {
    unit = parseIngredientLine(`1 ${unit} x`).unit;
    if (!unit) {
      throw new HttpError(
        422,
        `Unknown unit "${entry.unit}". Use a unit code like g, ml, l, kg, can, or leave it empty.`,
      );
    }
  }
  return {
    entry: entry.name,
    name: entry.name,
    quantity: entry.quantity ?? null,
    unit,
    note: entry.note ?? null,
    itemId: entry.itemId,
  };
}

/**
 * Adds things to a list. Each name is matched to an item ("mouth wash" →
 * Mouthwash); if that item is already on the list and the amounts can be
 * added, the line's amount goes up instead of a second line appearing.
 */
export type ListAddition = Normalised;

export function addToList(
  db: Db,
  viewer: Viewer,
  listId: string,
  entries: (ListEntry | Normalised)[],
): AddedListItem[] {
  const list = loadList(db, viewer, listId);
  const normalised = entries.map((e) =>
    typeof e === 'object' && 'entry' in e ? e : normaliseEntry(e),
  );
  const forced = normalised
    .filter((n) => n.itemId)
    .map((n) => n.itemId as string);
  if (forced.length) {
    const found = db
      .select({ id: schema.item.id, householdId: schema.item.householdId })
      .from(schema.item)
      .where(inArray(schema.item.id, forced))
      .all();
    const ok = new Set(
      found
        .filter(
          (i) => i.householdId === null || i.householdId === viewer.householdId,
        )
        .map((i) => i.id),
    );
    for (const id of forced) if (!ok.has(id)) throw notFound('Item not found');
  }
  const resolved = resolveItems(
    db,
    viewer.householdId,
    normalised.map((n) => n.name),
  );

  const results: { lineId: string; rest: Omit<AddedListItem, 'listItem'> }[] =
    [];
  db.transaction((tx) => {
    normalised.forEach((n, i) => {
      const r = resolved[i];
      const itemId = n.itemId ?? r?.item.id ?? null;
      const match = n.itemId ? 'exact' : (r?.match ?? 'new');
      const existing = itemId
        ? tx
            .select()
            .from(schema.shoppingListItem)
            .where(
              and(
                eq(schema.shoppingListItem.listId, list.id),
                eq(schema.shoppingListItem.itemId, itemId),
                isNull(schema.shoppingListItem.checkedAt),
              ),
            )
            .all()
        : [];
      let combinedInto: LineRow | undefined;
      let amount: { quantity: number | null; unit: string | null } | null =
        null;
      for (const line of existing) {
        amount = combineAmounts(line, n);
        if (amount) {
          combinedInto = line;
          break;
        }
      }
      if (combinedInto && amount) {
        const sources = (n.sources ?? []).reduce(
          mergeSources,
          combinedInto.sources,
        );
        tx.update(schema.shoppingListItem)
          .set({
            quantity: amount.quantity,
            unit: amount.unit,
            sources,
            note: combinedInto.note ?? n.note,
          })
          .where(eq(schema.shoppingListItem.id, combinedInto.id))
          .run();
        results.push({
          lineId: combinedInto.id,
          rest: { entry: n.entry, match, combined: true, suggestions: [] },
        });
        return;
      }
      const [line] = tx
        .insert(schema.shoppingListItem)
        .values({
          listId: list.id,
          itemId,
          name: capitalise(n.name),
          quantity: n.quantity,
          unit: n.unit,
          note: n.note,
          sources: n.sources ?? [],
          addedBy: viewer.userId,
        })
        .returning()
        .all();
      results.push({
        lineId: line.id,
        rest: {
          entry: n.entry,
          match,
          combined: false,
          suggestions: r?.suggestions ?? [],
        },
      });
    });
  });
  listChanged(list.id, viewer.userId);

  const lines = db
    .select()
    .from(schema.shoppingListItem)
    .where(
      inArray(
        schema.shoppingListItem.id,
        results.map((r) => r.lineId),
      ),
    )
    .all();
  const byId = new Map(
    toListItems(db, viewer.householdId, lines).map((l) => [l.id, l]),
  );
  return results.map((r) => ({
    ...r.rest,
    listItem: byId.get(r.lineId) as ListItem,
  }));
}

/** "mouth wash" → "Mouth wash": lists read better with a capital. */
function capitalise(name: string) {
  const t = name.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function mergeSources(existing: ListItemSource[], add: ListItemSource) {
  const others = existing.filter((s) => s.recipeId !== add.recipeId);
  return [...others, add];
}

function loadLines(db: Db, viewer: Viewer, listId: string, ids: string[]) {
  const list = loadList(db, viewer, listId);
  const lines = db
    .select()
    .from(schema.shoppingListItem)
    .where(
      and(
        eq(schema.shoppingListItem.listId, list.id),
        inArray(schema.shoppingListItem.id, ids),
      ),
    )
    .all();
  if (lines.length !== new Set(ids).size)
    throw notFound('Item not on this list');
  return { list, lines };
}

export function updateListItem(
  db: Db,
  viewer: Viewer,
  listId: string,
  lineId: string,
  patch: UpdateListItem,
): ListItem {
  const { list, lines } = loadLines(db, viewer, listId, [lineId]);
  const line = lines[0];
  const { category, unit: rawUnit, ...rest } = patch;
  let unit = rawUnit;
  if (rawUnit && !unitDef(rawUnit)) {
    unit = parseIngredientLine(`1 ${rawUnit} x`).unit;
    if (!unit) throw new HttpError(422, `Unknown unit "${rawUnit}".`);
  }
  db.update(schema.shoppingListItem)
    .set({ ...rest, ...(unit !== undefined ? { unit } : {}) })
    .where(eq(schema.shoppingListItem.id, line.id))
    .run();
  if (category) {
    if (!line.itemId)
      throw new HttpError(422, 'This line has no item to move.');
    setItemCategory(db, viewer.householdId, line.itemId, category);
  }
  listChanged(list.id, viewer.userId);
  const [updated] = db
    .select()
    .from(schema.shoppingListItem)
    .where(eq(schema.shoppingListItem.id, line.id))
    .all();
  return toListItems(db, viewer.householdId, [updated])[0];
}

/**
 * Ticks lines off (or back on). Ticking one off records a purchase, the
 * history the pantry learns from; unticking removes that purchase again.
 */
export function checkListItems(
  db: Db,
  viewer: Viewer,
  listId: string,
  ids: string[],
  checked: boolean,
  source: 'list' | 'mcp' = 'list',
) {
  const { list, lines } = loadLines(db, viewer, listId, ids);
  const now = new Date();
  db.transaction((tx) => {
    for (const line of lines) {
      const isChecked = line.checkedAt !== null;
      if (checked === isChecked) continue;
      tx.update(schema.shoppingListItem)
        .set(
          checked
            ? { checkedAt: now, checkedBy: viewer.userId }
            : { checkedAt: null, checkedBy: null },
        )
        .where(eq(schema.shoppingListItem.id, line.id))
        .run();
      if (checked) {
        tx.insert(schema.purchaseEvent)
          .values({
            householdId: viewer.householdId,
            itemId: line.itemId,
            name: line.name,
            quantity: line.quantity,
            unit: line.unit,
            purchasedAt: now,
            userId: viewer.userId,
            source,
            listItemId: line.id,
          })
          .run();
        // Bought it, so it's no longer running low.
        if (line.itemId) {
          tx.update(schema.pantryItem)
            .set({ status: 'have' })
            .where(
              and(
                eq(schema.pantryItem.householdId, viewer.householdId),
                eq(schema.pantryItem.itemId, line.itemId),
              ),
            )
            .run();
        }
      } else {
        tx.delete(schema.purchaseEvent)
          .where(eq(schema.purchaseEvent.listItemId, line.id))
          .run();
      }
    }
  });
  listChanged(list.id, viewer.userId);
}

export function removeListItems(
  db: Db,
  viewer: Viewer,
  listId: string,
  ids: string[],
) {
  const { list } = loadLines(db, viewer, listId, ids);
  db.delete(schema.shoppingListItem)
    .where(inArray(schema.shoppingListItem.id, ids))
    .run();
  listChanged(list.id, viewer.userId);
}

/**
 * Puts a recipe's ingredients on a list, scaled to the servings. Optional
 * ingredients and things "to taste" are left off unless picked by id.
 */
export function addRecipeToList(
  db: Db,
  viewer: Viewer,
  recipeId: string,
  input: RecipeToList,
): AddedListItem[] {
  const recipe = getRecipe(db, viewer, recipeId);
  const servings = input.servings ?? recipe.servings;
  const factor = servingsFactor(recipe.servings, servings);
  const chosen = input.ingredientIds ? new Set(input.ingredientIds) : null;
  const picked = recipe.ingredients.filter((i) =>
    chosen ? chosen.has(i.id) : !i.optional && i.scaling !== 'to_taste',
  );
  if (!picked.length) return [];
  const source: ListItemSource = {
    recipeId: recipe.id,
    title: recipe.title,
    servings,
  };
  return addToList(
    db,
    viewer,
    input.listId ?? 'ongoing',
    picked.map((i) => {
      const scaled = scaleAmount(i, factor);
      return {
        entry: i.name,
        name: i.name,
        // A range means buying the larger amount.
        quantity: scaled.quantityMax ?? scaled.quantity,
        unit: i.unit,
        note: i.note,
        itemId: i.itemId ?? undefined,
        sources: [source],
      };
    }),
  );
}

/**
 * When someone joins another household, whatever was still to buy on their
 * old ongoing list comes too.
 */
export function carryOverList(
  db: Db,
  userId: string,
  fromHouseholdId: string,
  toHouseholdId: string,
) {
  const from = ongoingList(db, fromHouseholdId);
  const open = db
    .select()
    .from(schema.shoppingListItem)
    .where(
      and(
        eq(schema.shoppingListItem.listId, from.id),
        isNull(schema.shoppingListItem.checkedAt),
      ),
    )
    .all();
  if (!open.length) return;
  addToList(
    db,
    { userId, householdId: toHouseholdId },
    'ongoing',
    open.map((l) => ({
      entry: l.name,
      name: l.name,
      quantity: l.quantity,
      unit: l.unit,
      note: l.note,
    })),
  );
}

export function purchaseHistory(
  db: Db,
  viewer: Viewer,
  { itemId, limit = 100 }: { itemId?: string; limit?: number } = {},
): Purchase[] {
  const rows = db
    .select({ p: schema.purchaseEvent, by: schema.user.name })
    .from(schema.purchaseEvent)
    .leftJoin(schema.user, eq(schema.user.id, schema.purchaseEvent.userId))
    .where(
      and(
        eq(schema.purchaseEvent.householdId, viewer.householdId),
        itemId ? eq(schema.purchaseEvent.itemId, itemId) : undefined,
      ),
    )
    .orderBy(desc(schema.purchaseEvent.purchasedAt))
    .limit(Math.min(Math.max(limit, 1), 500))
    .all();
  return rows.map(({ p, by }) => ({
    id: p.id,
    itemId: p.itemId,
    name: p.name,
    quantity: p.quantity,
    unit: p.unit,
    purchasedAt: p.purchasedAt.toISOString(),
    by,
    source: p.source,
  }));
}
