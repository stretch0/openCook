import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { id, timestamps } from './columns.js';
import { household } from './households.js';

/**
 * Things you cook with or buy: "onion", "mouthwash". Items with no household
 * are the shared starter catalogue; households add their own as they type.
 * Two names are the same item when they share a normal key (see
 * normalItemKey in @opencook/domain).
 */
export const item = sqliteTable(
  'item',
  {
    id: id(),
    householdId: text('household_id').references(() => household.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    normalKey: text('normal_key').notNull(),
    /** Aisle, e.g. "produce" (see AISLE_NAMES). */
    category: text('category').notNull().default('other'),
    ...timestamps,
  },
  (t) => [
    index('item_normal_key_idx').on(t.normalKey),
    index('item_household_idx').on(t.householdId),
  ],
);

/** Other names for an item, learnt from the catalogue or a household's merges. */
export const itemAlias = sqliteTable(
  'item_alias',
  {
    id: id(),
    itemId: text('item_id')
      .notNull()
      .references(() => item.id, { onDelete: 'cascade' }),
    householdId: text('household_id').references(() => household.id, {
      onDelete: 'cascade',
    }),
    normalKey: text('normal_key').notNull(),
    ...timestamps,
  },
  (t) => [
    index('item_alias_normal_key_idx').on(t.normalKey),
    index('item_alias_item_idx').on(t.itemId),
  ],
);
