import {
  index,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { user } from './auth.js';
import { id, timestamp, timestamps } from './columns.js';
import { household } from './households.js';
import { item } from './items.js';

/**
 * Every household has one ongoing list it keeps adding to and ticking off;
 * named lists ("BBQ Saturday") are optional extras.
 */
export const shoppingList = sqliteTable(
  'shopping_list',
  {
    id: id(),
    householdId: text('household_id')
      .notNull()
      .references(() => household.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['ongoing', 'named'] })
      .notNull()
      .default('named'),
    ...timestamps,
  },
  (t) => [index('shopping_list_household_idx').on(t.householdId)],
);

/** Which recipes asked for a list line, e.g. "Lasagne, for 4". */
export type ListItemSource = {
  recipeId: string;
  title: string;
  servings?: number;
};

export const shoppingListItem = sqliteTable(
  'shopping_list_item',
  {
    id: id(),
    listId: text('list_id')
      .notNull()
      .references(() => shoppingList.id, { onDelete: 'cascade' }),
    itemId: text('item_id').references(() => item.id, { onDelete: 'set null' }),
    /** As shown on the list. */
    name: text('name').notNull(),
    quantity: real('quantity'),
    unit: text('unit'),
    note: text('note'),
    sources: text('sources', { mode: 'json' })
      .$type<ListItemSource[]>()
      .notNull()
      .default([]),
    addedBy: text('added_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    checkedAt: timestamp('checked_at'),
    checkedBy: text('checked_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (t) => [
    index('shopping_list_item_list_idx').on(t.listId, t.checkedAt),
    index('shopping_list_item_item_idx').on(t.itemId),
  ],
);

/**
 * Each time something was bought (ticked off a list, or recorded by hand or
 * by an assistant). The timeline the pantry learns how often you buy from.
 */
export const purchaseEvent = sqliteTable(
  'purchase_event',
  {
    id: id(),
    householdId: text('household_id')
      .notNull()
      .references(() => household.id, { onDelete: 'cascade' }),
    itemId: text('item_id').references(() => item.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    quantity: real('quantity'),
    unit: text('unit'),
    purchasedAt: timestamp('purchased_at').notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    source: text('source', { enum: ['list', 'manual', 'mcp'] })
      .notNull()
      .default('list'),
    /** The list line it came from, so unticking can undo it. */
    listItemId: text('list_item_id'),
    ...timestamps,
  },
  (t) => [
    index('purchase_event_household_item_idx').on(t.householdId, t.itemId),
    index('purchase_event_list_item_idx').on(t.listItemId),
  ],
);

/** A household's own choices about a shared item, such as its aisle. */
export const householdItemPreference = sqliteTable(
  'household_item_preference',
  {
    householdId: text('household_id')
      .notNull()
      .references(() => household.id, { onDelete: 'cascade' }),
    itemId: text('item_id')
      .notNull()
      .references(() => item.id, { onDelete: 'cascade' }),
    category: text('category'),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.householdId, t.itemId] })],
);
