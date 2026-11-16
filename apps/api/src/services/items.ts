import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { type Db, schema } from '@opencook/db';
import {
  CATALOGUE,
  type ItemCandidate,
  matchItem,
  normalItemKey,
  suggestItems,
} from '@opencook/domain';
import type { Item, ItemSearch } from '@opencook/schemas';
import { HttpError, notFound } from './errors.js';

type ItemRow = typeof schema.item.$inferSelect;

/**
 * Adds any catalogue items this instance doesn't have yet. Safe to run on
 * every start: existing items (and households' changes) are left alone.
 */
export function seedCatalogue(db: Db): number {
  const existing = new Set(
    db
      .select({ key: schema.item.normalKey })
      .from(schema.item)
      .where(isNull(schema.item.householdId))
      .all()
      .map((r) => r.key),
  );
  let added = 0;
  db.transaction((tx) => {
    for (const entry of CATALOGUE) {
      const key = normalItemKey(entry.name);
      if (!key || existing.has(key)) continue;
      const [row] = tx
        .insert(schema.item)
        .values({ name: entry.name, normalKey: key, category: entry.category })
        .returning()
        .all();
      existing.add(key);
      added++;
      const aliasKeys = new Set(entry.aliases.map(normalItemKey));
      aliasKeys.delete(key);
      for (const alias of aliasKeys) {
        if (!alias) continue;
        tx.insert(schema.itemAlias)
          .values({ itemId: row.id, normalKey: alias })
          .run();
      }
    }
  });
  return added;
}

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    shared: row.householdId === null,
  };
}

/** Items a household can use: its own first, then the shared catalogue. */
function candidates(
  db: Db,
  householdId: string,
): {
  list: ItemCandidate[];
  rows: Map<string, ItemRow>;
} {
  const rows = db
    .select()
    .from(schema.item)
    .where(
      or(
        eq(schema.item.householdId, householdId),
        isNull(schema.item.householdId),
      ),
    )
    .all();
  const aliases = db
    .select()
    .from(schema.itemAlias)
    .where(
      or(
        eq(schema.itemAlias.householdId, householdId),
        isNull(schema.itemAlias.householdId),
      ),
    )
    .all();
  // A household's own aliases win: once it says "mouth wash" is its
  // "Mouthwash", no other item answers to that name for it.
  const claimed = new Map(
    aliases
      .filter((a) => a.householdId === householdId)
      .map((a) => [a.normalKey, a.itemId]),
  );
  const keys = new Map<string, string[]>();
  const add = (id: string, key: string) => {
    const owner = claimed.get(key);
    if (!owner || owner === id) keys.get(id)?.push(key);
  };
  for (const r of rows) keys.set(r.id, []);
  for (const r of rows) add(r.id, r.normalKey);
  for (const a of aliases) add(a.itemId, a.normalKey);
  const sorted = [...rows].sort(
    (a, b) => Number(a.householdId === null) - Number(b.householdId === null),
  );
  return {
    list: sorted.map((r) => ({
      id: r.id,
      name: r.name,
      keys: keys.get(r.id) ?? [],
    })),
    rows: new Map(rows.map((r) => [r.id, r])),
  };
}

/** Finds what a typed name refers to, with "Did you mean…?" suggestions. */
export function searchItems(
  db: Db,
  householdId: string,
  name: string,
): ItemSearch {
  const { list, rows } = candidates(db, householdId);
  const result = matchItem(name, list, 5);
  if (result.kind === 'exact') {
    return {
      match: toItem(rows.get(result.item.id) as ItemRow),
      suggestions: [],
    };
  }
  return {
    match: null,
    suggestions: result.suggestions.map((s) =>
      toItem(rows.get(s.id) as ItemRow),
    ),
  };
}

export type ResolvedItem = {
  item: Item;
  /** exact: same normal key; alias: another name for the item; new: created. */
  match: 'exact' | 'alias' | 'new';
  suggestions: Item[];
};

/**
 * Many names at once (e.g. a recipe's ingredients): each becomes an existing
 * item with the same key, or a new household item. Suggestions for new ones
 * are returned so the caller can offer to merge.
 */
export function resolveItems(
  db: Db,
  householdId: string,
  names: string[],
): (ResolvedItem | null)[] {
  const { list, rows } = candidates(db, householdId);
  const created = new Map<string, Item>();
  return names.map((name) => {
    const key = normalItemKey(name);
    if (!key) return null;
    const found = created.get(key);
    if (found) return { item: found, match: 'exact', suggestions: [] };
    const result = matchItem(name, list);
    if (result.kind === 'exact') {
      const row = rows.get(result.item.id) as ItemRow;
      return {
        item: toItem(row),
        match: row.normalKey === key ? 'exact' : 'alias',
        suggestions: [],
      };
    }
    const [row] = db
      .insert(schema.item)
      .values({ householdId, name: name.trim(), normalKey: key })
      .returning()
      .all();
    const item = toItem(row);
    created.set(key, item);
    return {
      item,
      match: 'new',
      suggestions: result.suggestions.map((s) =>
        toItem(rows.get(s.id) as ItemRow),
      ),
    };
  });
}

/** Autocomplete: items whose keys start with, or are close to, what's typed. */
export function autocompleteItems(
  db: Db,
  householdId: string,
  text: string,
  limit = 8,
): Item[] {
  const key = normalItemKey(text);
  if (!key) return [];
  const { list, rows } = candidates(db, householdId);
  const starts = list.filter((c) => c.keys.some((k) => k.startsWith(key)));
  const close = suggestItems(key, list, limit);
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const c of [
    ...starts.sort((a, b) => a.name.length - b.name.length),
    ...close,
  ]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(toItem(rows.get(c.id) as ItemRow));
    if (out.length >= limit) break;
  }
  return out;
}

/** Items by id, for showing names. */
export function itemsById(db: Db, ids: string[]): Map<string, Item> {
  if (!ids.length) return new Map();
  return new Map(
    db
      .select()
      .from(schema.item)
      .where(inArray(schema.item.id, ids))
      .all()
      .map((r) => [r.id, toItem(r)]),
  );
}

/**
 * Each item's aisle for a household: its own choice if it moved the item,
 * otherwise the item's.
 */
export function categoriesFor(
  db: Db,
  householdId: string,
  itemIds: string[],
): Map<string, string> {
  const ids = [...new Set(itemIds)];
  if (!ids.length) return new Map();
  const out = new Map(
    db
      .select({ id: schema.item.id, category: schema.item.category })
      .from(schema.item)
      .where(inArray(schema.item.id, ids))
      .all()
      .map((r) => [r.id, r.category]),
  );
  for (const p of db
    .select()
    .from(schema.householdItemPreference)
    .where(
      and(
        eq(schema.householdItemPreference.householdId, householdId),
        inArray(schema.householdItemPreference.itemId, ids),
      ),
    )
    .all()) {
    if (p.category) out.set(p.itemId, p.category);
  }
  return out;
}

/** Moves an item to another aisle for this household (or for good, if it's theirs). */
export function setItemCategory(
  db: Db,
  householdId: string,
  itemId: string,
  category: string,
) {
  const row = db
    .select()
    .from(schema.item)
    .where(eq(schema.item.id, itemId))
    .get();
  if (!row || (row.householdId && row.householdId !== householdId)) {
    throw notFound('Item not found');
  }
  if (row.householdId === householdId) {
    db.update(schema.item)
      .set({ category })
      .where(eq(schema.item.id, itemId))
      .run();
    return;
  }
  db.insert(schema.householdItemPreference)
    .values({ householdId, itemId, category })
    .onConflictDoUpdate({
      target: [
        schema.householdItemPreference.householdId,
        schema.householdItemPreference.itemId,
      ],
      set: { category, updatedAt: new Date() },
    })
    .run();
}

/**
 * "These are the same": folds one item into another for this household.
 * The old name becomes an alias, so typing it finds the kept item from now
 * on, and list lines, purchases and the household's recipes move across so
 * the history stays in one place.
 */
export function mergeItems(
  db: Db,
  householdId: string,
  fromId: string,
  intoId: string,
  /** Recipes whose ingredients should follow, e.g. the household's own. */
  recipeIds: string[],
) {
  if (fromId === intoId) throw new HttpError(422, 'Pick two different items.');
  const visible = (id: string) => {
    const row = db
      .select()
      .from(schema.item)
      .where(eq(schema.item.id, id))
      .get();
    if (!row || (row.householdId && row.householdId !== householdId)) {
      throw notFound('Item not found');
    }
    return row;
  };
  const from = visible(fromId);
  const into = visible(intoId);
  db.transaction((tx) => {
    const keys = new Set([
      from.normalKey,
      ...tx
        .select({ key: schema.itemAlias.normalKey })
        .from(schema.itemAlias)
        .where(
          and(
            eq(schema.itemAlias.itemId, fromId),
            or(
              isNull(schema.itemAlias.householdId),
              eq(schema.itemAlias.householdId, householdId),
            ),
          ),
        )
        .all()
        .map((a) => a.key),
    ]);
    keys.delete(into.normalKey);
    for (const key of keys) {
      tx.insert(schema.itemAlias)
        .values({ itemId: intoId, householdId, normalKey: key })
        .run();
    }
    const lists = tx
      .select({ id: schema.shoppingList.id })
      .from(schema.shoppingList)
      .where(eq(schema.shoppingList.householdId, householdId))
      .all()
      .map((l) => l.id);
    if (lists.length) {
      tx.update(schema.shoppingListItem)
        .set({ itemId: intoId })
        .where(
          and(
            eq(schema.shoppingListItem.itemId, fromId),
            inArray(schema.shoppingListItem.listId, lists),
          ),
        )
        .run();
    }
    tx.update(schema.purchaseEvent)
      .set({ itemId: intoId })
      .where(
        and(
          eq(schema.purchaseEvent.itemId, fromId),
          eq(schema.purchaseEvent.householdId, householdId),
        ),
      )
      .run();
    if (recipeIds.length) {
      tx.update(schema.recipeIngredient)
        .set({ itemId: intoId })
        .where(
          and(
            eq(schema.recipeIngredient.itemId, fromId),
            inArray(schema.recipeIngredient.recipeId, recipeIds),
          ),
        )
        .run();
    }
    // A household's own item is gone once merged. A shared one stays for
    // other households; the aliases above stop it matching for this one.
    if (from.householdId === householdId) {
      tx.delete(schema.item).where(eq(schema.item.id, fromId)).run();
    }
  });
  return toItem(into);
}

/**
 * After someone moves household, re-links their recipes' ingredients to
 * items the new household can see.
 */
export function relinkRecipeItems(db: Db, userId: string, householdId: string) {
  const ingredients = db
    .select({
      recipeId: schema.recipeIngredient.recipeId,
      id: schema.recipeIngredient.id,
      name: schema.recipeIngredient.name,
    })
    .from(schema.recipeIngredient)
    .innerJoin(
      schema.recipe,
      eq(schema.recipe.id, schema.recipeIngredient.recipeId),
    )
    .where(eq(schema.recipe.ownerId, userId))
    .all();
  if (!ingredients.length) return;
  const resolved = resolveItems(
    db,
    householdId,
    ingredients.map((i) => i.name),
  );
  db.transaction((tx) => {
    ingredients.forEach((i, n) => {
      tx.update(schema.recipeIngredient)
        .set({ itemId: resolved[n]?.item.id ?? null })
        .where(
          and(
            eq(schema.recipeIngredient.recipeId, i.recipeId),
            eq(schema.recipeIngredient.id, i.id),
          ),
        )
        .run();
    });
  });
}
