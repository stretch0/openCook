import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { type Db, schema } from '@opencook/db';
import {
  SUGGESTED_STAPLES,
  normalItemKey,
  restockState,
} from '@opencook/domain';
import type {
  Pantry,
  PantryEntry,
  RestockSuggestion,
  UpdatePantry,
} from '@opencook/schemas';
import { categoriesFor, resolveItems } from './items.js';
import type { Viewer } from './recipes.js';
import { ongoingList } from './shopping.js';

export function getPantry(db: Db, viewer: Viewer): Pantry {
  const rows = db
    .select({ p: schema.pantryItem, name: schema.item.name })
    .from(schema.pantryItem)
    .innerJoin(schema.item, eq(schema.item.id, schema.pantryItem.itemId))
    .where(eq(schema.pantryItem.householdId, viewer.householdId))
    .all();
  const categories = categoriesFor(
    db,
    viewer.householdId,
    rows.map((r) => r.p.itemId),
  );
  const items: PantryEntry[] = rows
    .map(({ p, name }) => ({
      itemId: p.itemId,
      name,
      category: categories.get(p.itemId) ?? 'other',
      staple: p.staple,
      status: p.status,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const staples = new Set(items.filter((i) => i.staple).map((i) => i.itemId));
  const keys = SUGGESTED_STAPLES.map(normalItemKey);
  const shared = db
    .select({
      id: schema.item.id,
      name: schema.item.name,
      key: schema.item.normalKey,
    })
    .from(schema.item)
    .where(
      and(
        isNull(schema.item.householdId),
        inArray(schema.item.normalKey, keys),
      ),
    )
    .all();
  const aliased = db
    .select({
      id: schema.item.id,
      name: schema.item.name,
      key: schema.itemAlias.normalKey,
    })
    .from(schema.itemAlias)
    .innerJoin(schema.item, eq(schema.item.id, schema.itemAlias.itemId))
    .where(
      and(
        isNull(schema.itemAlias.householdId),
        inArray(schema.itemAlias.normalKey, keys),
      ),
    )
    .all();
  const byKey = new Map([...aliased, ...shared].map((r) => [r.key, r]));
  const suggestedStaples = keys
    .map((k) => byKey.get(k))
    .filter((r): r is NonNullable<typeof r> => !!r && !staples.has(r.id))
    .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i)
    .map((r) => ({ itemId: r.id, name: r.name }));

  return { items, suggestedStaples };
}

/** Item ids for references that are either ids the household can use or names. */
function resolveRefs(db: Db, viewer: Viewer, refs: string[]): string[] {
  if (!refs.length) return [];
  const byId = new Set(
    db
      .select({ id: schema.item.id })
      .from(schema.item)
      .where(
        and(
          inArray(schema.item.id, refs),
          or(
            isNull(schema.item.householdId),
            eq(schema.item.householdId, viewer.householdId),
          ),
        ),
      )
      .all()
      .map((r) => r.id),
  );
  const names = refs.filter((r) => !byId.has(r));
  const resolved = resolveItems(db, viewer.householdId, names);
  const fromNames = new Map(names.map((n, i) => [n, resolved[i]?.item.id]));
  return refs
    .map((r) => (byId.has(r) ? r : fromNames.get(r)))
    .filter((id): id is string => !!id);
}

function upsert(
  db: Db,
  householdId: string,
  itemId: string,
  set: { staple?: boolean; status?: 'have' | 'low' | 'out' },
) {
  db.insert(schema.pantryItem)
    .values({
      householdId,
      itemId,
      staple: set.staple ?? false,
      status: set.status ?? 'have',
    })
    .onConflictDoUpdate({
      target: [schema.pantryItem.householdId, schema.pantryItem.itemId],
      set: { ...set, updatedAt: new Date() },
    })
    .run();
}

export function updatePantry(
  db: Db,
  viewer: Viewer,
  input: UpdatePantry,
): Pantry {
  db.transaction(() => {
    for (const id of resolveRefs(db, viewer, input.addStaples ?? [])) {
      upsert(db, viewer.householdId, id, { staple: true });
    }
    for (const id of resolveRefs(db, viewer, input.removeStaples ?? [])) {
      upsert(db, viewer.householdId, id, { staple: false });
    }
    const statuses = input.status ?? [];
    const ids = resolveRefs(
      db,
      viewer,
      statuses.map((s) => s.item),
    );
    statuses.forEach((s, i) => {
      if (ids[i]) upsert(db, viewer.householdId, ids[i], { status: s.status });
    });
    // Rows that say nothing any more ("have", not a staple) go.
    db.delete(schema.pantryItem)
      .where(
        and(
          eq(schema.pantryItem.householdId, viewer.householdId),
          eq(schema.pantryItem.staple, false),
          eq(schema.pantryItem.status, 'have'),
        ),
      )
      .run();
  });
  return getPantry(db, viewer);
}

/**
 * Things the household buys regularly and is about due to buy again, from
 * its purchase history, leaving out what's already on the ongoing list.
 * Most overdue first.
 */
export function restockSuggestions(
  db: Db,
  viewer: Viewer,
  now = new Date(),
): RestockSuggestion[] {
  const events = db
    .select({
      itemId: schema.purchaseEvent.itemId,
      at: schema.purchaseEvent.purchasedAt,
      quantity: schema.purchaseEvent.quantity,
      unit: schema.purchaseEvent.unit,
    })
    .from(schema.purchaseEvent)
    .where(eq(schema.purchaseEvent.householdId, viewer.householdId))
    .all();
  const byItem = new Map<string, typeof events>();
  for (const e of events) {
    if (e.itemId) byItem.set(e.itemId, [...(byItem.get(e.itemId) ?? []), e]);
  }
  const list = ongoingList(db, viewer.householdId);
  const onList = new Set(
    db
      .select({ itemId: schema.shoppingListItem.itemId })
      .from(schema.shoppingListItem)
      .where(
        and(
          eq(schema.shoppingListItem.listId, list.id),
          isNull(schema.shoppingListItem.checkedAt),
        ),
      )
      .all()
      .map((r) => r.itemId),
  );
  const due: (RestockSuggestion & { ratio: number })[] = [];
  for (const [itemId, list] of byItem) {
    if (onList.has(itemId)) continue;
    const state = restockState(
      list.map((e) => e.at),
      now,
    );
    if (!state.due || !state.intervalDays || state.daysSince === null) continue;
    const last = list.reduce((a, b) => (a.at > b.at ? a : b));
    due.push({
      itemId,
      name: '',
      intervalDays: state.intervalDays,
      daysSince: state.daysSince,
      lastQuantity: last.quantity,
      lastUnit: last.unit,
      ratio: state.daysSince / state.intervalDays,
    });
  }
  if (!due.length) return [];
  const names = new Map(
    db
      .select({ id: schema.item.id, name: schema.item.name })
      .from(schema.item)
      .where(
        inArray(
          schema.item.id,
          due.map((d) => d.itemId),
        ),
      )
      .all()
      .map((r) => [r.id, r.name.charAt(0).toUpperCase() + r.name.slice(1)]),
  );
  return due
    .sort((a, b) => b.ratio - a.ratio)
    .map(({ ratio: _ratio, ...d }) => ({
      ...d,
      name: names.get(d.itemId) ?? 'Item',
    }));
}
