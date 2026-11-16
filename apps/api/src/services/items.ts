import { eq, inArray, isNull, or } from 'drizzle-orm';
import { type Db, schema } from '@opencook/db';
import {
  CATALOGUE,
  type ItemCandidate,
  matchItem,
  normalItemKey,
  suggestItems,
} from '@opencook/domain';
import type { Item, ItemSearch } from '@opencook/schemas';

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
  const keys = new Map<string, string[]>();
  for (const r of rows) keys.set(r.id, [r.normalKey]);
  for (const a of aliases) keys.get(a.itemId)?.push(a.normalKey);
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
  match: 'exact' | 'new';
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
      return {
        item: toItem(rows.get(result.item.id) as ItemRow),
        match: 'exact',
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
