import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { user } from './auth.js';
import { id, timestamps } from './columns.js';

/**
 * A household shares a shopping list, pantry and meal plan, e.g. a couple or
 * family. Everyone gets their own household when they sign up.
 */
export const household = sqliteTable('household', {
  id: id(),
  name: text('name').notNull(),
  ...timestamps,
});

export const householdMember = sqliteTable(
  'household_member',
  {
    householdId: text('household_id')
      .notNull()
      .references(() => household.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'member'] })
      .notNull()
      .default('member'),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.userId] }),
    index('household_member_user_idx').on(t.userId),
  ],
);
