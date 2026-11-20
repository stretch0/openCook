import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { user } from './auth.js';
import { id, timestamp, timestamps } from './columns.js';
import { household } from './households.js';
import { item } from './items.js';
import { recipe } from './recipes.js';

/** A meal on the household's plan: a recipe, or just a note like "leftovers". */
export const mealPlanEntry = sqliteTable(
  'meal_plan_entry',
  {
    id: id(),
    householdId: text('household_id')
      .notNull()
      .references(() => household.id, { onDelete: 'cascade' }),
    /** The day, as YYYY-MM-DD in the household's own calendar. */
    date: text('date').notNull(),
    slot: text('slot', { enum: ['breakfast', 'lunch', 'dinner', 'snack'] })
      .notNull()
      .default('dinner'),
    recipeId: text('recipe_id').references(() => recipe.id, {
      onDelete: 'set null',
    }),
    /** What's shown: the recipe's title when planned, or free text. */
    title: text('title').notNull(),
    servings: integer('servings'),
    note: text('note'),
    cookedAt: timestamp('cooked_at'),
    addedBy: text('added_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (t) => [
    index('meal_plan_entry_household_date_idx').on(t.householdId, t.date),
  ],
);

/**
 * What a household keeps in: staples it always has (salt, oil, spices) and
 * anything it has marked as running low or run out.
 */
export const pantryItem = sqliteTable(
  'pantry_item',
  {
    householdId: text('household_id')
      .notNull()
      .references(() => household.id, { onDelete: 'cascade' }),
    itemId: text('item_id')
      .notNull()
      .references(() => item.id, { onDelete: 'cascade' }),
    staple: integer('staple', { mode: 'boolean' }).notNull().default(false),
    status: text('status', { enum: ['have', 'low', 'out'] })
      .notNull()
      .default('have'),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.householdId, t.itemId] })],
);
