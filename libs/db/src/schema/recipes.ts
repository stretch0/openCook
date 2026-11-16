import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { user } from './auth.js';
import { id, timestamp, timestamps } from './columns.js';
import { item } from './items.js';

/** An uploaded photo, stored as DATA_DIR/uploads/<hash>.webp. */
export const image = sqliteTable(
  'image',
  {
    id: id(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    hash: text('hash').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** Where it came from, for credit: a recipe page, or a photo search. */
    sourceUrl: text('source_url'),
    ...timestamps,
  },
  (t) => [index('image_owner_idx').on(t.ownerId)],
);

/** Where a copied recipe came from, possibly on another openCook instance. */
export type RecipeOrigin = {
  recipeId?: string;
  author?: string;
  instance?: string;
  url?: string;
  revision?: number;
};

export const recipe = sqliteTable(
  'recipe',
  {
    id: id(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    /** How many people the amounts are written for. */
    servings: integer('servings').notNull().default(4),
    prepMinutes: integer('prep_minutes'),
    cookMinutes: integer('cook_minutes'),
    cuisine: text('cuisine'),
    tags: text('tags', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    visibility: text('visibility', { enum: ['private', 'unlisted', 'public'] })
      .notNull()
      .default('private'),
    sourceUrl: text('source_url'),
    sourceName: text('source_name'),
    imageId: text('image_id').references(() => image.id, {
      onDelete: 'set null',
    }),
    forkedFromId: text('forked_from_id').references(
      (): AnySQLiteColumn => recipe.id,
      {
        onDelete: 'set null',
      },
    ),
    origin: text('origin', { mode: 'json' }).$type<RecipeOrigin>(),
    /** Goes up by one on every edit, so concurrent edits can be detected. */
    revision: integer('revision').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    index('recipe_owner_idx').on(t.ownerId),
    index('recipe_visibility_idx').on(t.visibility),
  ],
);

export const recipeIngredient = sqliteTable(
  'recipe_ingredient',
  {
    /** Unique within its recipe; steps can refer to it as {{ing:<id>}}. */
    id: text('id').notNull(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    /** A heading like "For the sauce". */
    section: text('section'),
    quantity: real('quantity'),
    quantityMax: real('quantity_max'),
    /** A unit code from @opencook/domain's UNITS, or null for "3 eggs". */
    unit: text('unit'),
    name: text('name').notNull(),
    itemId: text('item_id').references(() => item.id, { onDelete: 'set null' }),
    preparation: text('preparation'),
    note: text('note'),
    optional: integer('optional', { mode: 'boolean' }).notNull().default(false),
    scaling: text('scaling', { enum: ['linear', 'fixed', 'to_taste'] })
      .notNull()
      .default('linear'),
    rawText: text('raw_text'),
  },
  (t) => [
    primaryKey({ columns: [t.recipeId, t.id] }),
    index('recipe_ingredient_item_idx').on(t.itemId),
  ],
);

export const recipeStep = sqliteTable(
  'recipe_step',
  {
    id: id(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    section: text('section'),
    text: text('text').notNull(),
    /** A timer to offer in cooking mode. */
    timerSeconds: integer('timer_seconds'),
  },
  (t) => [index('recipe_step_recipe_idx').on(t.recipeId)],
);

/** A person's private notes on any recipe they can see. */
export const recipeNote = sqliteTable(
  'recipe_note',
  {
    id: id(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('recipe_note_recipe_user_idx').on(t.recipeId, t.userId)],
);

/** Each time someone cooked a recipe. */
export const cookLog = sqliteTable(
  'cook_log',
  {
    id: id(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    cookedAt: timestamp('cooked_at').notNull(),
    servings: integer('servings'),
    /** 1 to 5. */
    rating: integer('rating'),
    note: text('note'),
    ...timestamps,
  },
  (t) => [index('cook_log_recipe_user_idx').on(t.recipeId, t.userId)],
);
