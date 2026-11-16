import { z } from 'zod';
import { itemSchema } from './item.js';

export const listSourceSchema = z.object({
  recipeId: z.string(),
  title: z.string(),
  servings: z.number().optional(),
});

export const listItemSchema = z.object({
  id: z.string(),
  itemId: z.string().nullable(),
  name: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  note: z.string().nullable(),
  /** Aisle, e.g. "produce". */
  category: z.string(),
  sources: z.array(listSourceSchema),
  addedBy: z.string().nullable(),
  checkedAt: z.iso.datetime().nullable(),
  checkedBy: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export type ListItem = z.infer<typeof listItemSchema>;

export const shoppingListSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['ongoing', 'named']),
  /** Lines still to buy. */
  remaining: z.number(),
});
export type ShoppingListSummary = z.infer<typeof shoppingListSummarySchema>;

export const shoppingListSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['ongoing', 'named']),
  /** Still to buy. */
  items: z.array(listItemSchema),
  /** Ticked in the last week, newest first, for a quick re-add. */
  recentlyBought: z.array(listItemSchema),
});
export type ShoppingList = z.infer<typeof shoppingListSchema>;

export const createListSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

/** Something to add: a line of text ("2 x milk", "500 g mince") or fields. */
export const listEntrySchema = z.union([
  z.string().trim().min(1).max(300),
  z.object({
    name: z.string().trim().min(1).max(200),
    quantity: z.number().nonnegative().nullish(),
    unit: z.string().max(20).nullish(),
    note: z.string().trim().max(300).nullish(),
    /** Add to this exact item instead of matching the name. */
    itemId: z.string().optional(),
  }),
]);
export type ListEntry = z.infer<typeof listEntrySchema>;

export const addListItemsSchema = z.object({
  items: z.array(listEntrySchema).min(1).max(100),
});

/** How each entry landed on the list. */
export const addedListItemSchema = z.object({
  entry: z.string(),
  listItem: listItemSchema,
  /**
   * exact: the name matched an item; alias: matched another name for one;
   * new: a new item for this household.
   */
  match: z.enum(['exact', 'alias', 'new']),
  /** Whether it was added to a line already on the list. */
  combined: z.boolean(),
  /** For new items: existing items it might be ("Did you mean…?"). */
  suggestions: z.array(itemSchema),
});
export type AddedListItem = z.infer<typeof addedListItemSchema>;

export const updateListItemSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  quantity: z.number().nonnegative().nullable().optional(),
  unit: z.string().max(20).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
  /** Moves the item to another aisle; remembered for next time. */
  category: z.string().max(40).optional(),
});
export type UpdateListItem = z.infer<typeof updateListItemSchema>;

export const checkListItemsSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  checked: z.boolean().default(true),
});

export const removeListItemsSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
});

export const recipeToListSchema = z.object({
  servings: z.number().int().min(1).max(500).optional(),
  listId: z.string().optional(),
  /** Only these ingredients; all of them if left out. */
  ingredientIds: z.array(z.string()).optional(),
});
export type RecipeToList = z.infer<typeof recipeToListSchema>;

export const mergeItemsSchema = z.object({
  /** The item to fold in… */
  from: z.string(),
  /** …to this one, which keeps its name. */
  into: z.string(),
});

export const purchaseSchema = z.object({
  id: z.string(),
  itemId: z.string().nullable(),
  name: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  purchasedAt: z.iso.datetime(),
  by: z.string().nullable(),
  source: z.enum(['list', 'manual', 'mcp']),
});
export type Purchase = z.infer<typeof purchaseSchema>;
