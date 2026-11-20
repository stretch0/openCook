import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-20');

export const mealSlotSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export type MealSlot = z.infer<typeof mealSlotSchema>;

export const planEntrySchema = z.object({
  id: z.string(),
  date: isoDate,
  slot: mealSlotSchema,
  recipeId: z.string().nullable(),
  title: z.string(),
  imageUrl: z.string().nullable(),
  /** People it's for; the recipe's own servings when not set. */
  servings: z.number().nullable(),
  /** The recipe's servings, for scaling. */
  recipeServings: z.number().nullable(),
  note: z.string().nullable(),
  cookedAt: z.iso.datetime().nullable(),
});
export type PlanEntry = z.infer<typeof planEntrySchema>;

export const planQuerySchema = z.object({
  /** First day; defaults to this week's Monday. */
  from: isoDate.optional(),
  days: z.coerce.number().int().min(1).max(31).default(7),
});

export const mealPlanSchema = z.object({
  from: isoDate,
  to: isoDate,
  entries: z.array(planEntrySchema),
});
export type MealPlan = z.infer<typeof mealPlanSchema>;

export const addPlanEntrySchema = z
  .object({
    date: isoDate,
    slot: mealSlotSchema.default('dinner'),
    recipeId: z.string().optional(),
    /** For meals without a recipe: "Leftovers", "Pizza night". */
    title: z.string().trim().min(1).max(200).optional(),
    servings: z.number().int().min(1).max(500).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((e) => e.recipeId || e.title, {
    message: 'Give a recipe or a title.',
  });
export type AddPlanEntry = z.input<typeof addPlanEntrySchema>;

export const updatePlanEntrySchema = z.object({
  date: isoDate.optional(),
  slot: mealSlotSchema.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  servings: z.number().int().min(1).max(500).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  /** true marks it cooked (and logs it on the recipe); false undoes that. */
  cooked: z.boolean().optional(),
});
export type UpdatePlanEntry = z.infer<typeof updatePlanEntrySchema>;

/** What to shop for: some plan days, and/or recipes at given servings. */
export const shoppingSelectionSchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    recipes: z
      .array(
        z.object({
          recipeId: z.string(),
          servings: z.number().int().min(1).max(500).optional(),
        }),
      )
      .max(50)
      .optional(),
    listId: z.string().optional(),
  })
  .refine((s) => (s.from && s.to) || s.recipes?.length, {
    message: 'Give a date range (from and to) or some recipes.',
  });
export type ShoppingSelection = z.input<typeof shoppingSelectionSchema>;

export const needStatusSchema = z.enum([
  'need',
  'probably_have',
  'already_on_list',
]);

export const shoppingNeedSchema = z.object({
  /** Identifies the line when choosing what to add. */
  key: z.string(),
  itemId: z.string().nullable(),
  name: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  category: z.string(),
  status: needStatusSchema,
  reason: z.string().nullable(),
  sources: z.array(
    z.object({
      recipeId: z.string(),
      title: z.string(),
      servings: z.number().optional(),
    }),
  ),
});
export type ShoppingNeed = z.infer<typeof shoppingNeedSchema>;

export const addNeedsSchema = z.object({
  selection: shoppingSelectionSchema,
  /** Keys of the lines to add; by default every line marked "need". */
  include: z.array(z.string()).optional(),
});
export type AddNeeds = z.input<typeof addNeedsSchema>;

export const pantryEntrySchema = z.object({
  itemId: z.string(),
  name: z.string(),
  category: z.string(),
  staple: z.boolean(),
  status: z.enum(['have', 'low', 'out']),
});
export type PantryEntry = z.infer<typeof pantryEntrySchema>;

export const restockSuggestionSchema = z.object({
  itemId: z.string(),
  name: z.string(),
  intervalDays: z.number(),
  daysSince: z.number(),
  lastQuantity: z.number().nullable(),
  lastUnit: z.string().nullable(),
});
export type RestockSuggestion = z.infer<typeof restockSuggestionSchema>;

export const pantrySchema = z.object({
  items: z.array(pantryEntrySchema),
  /** Common staples not marked yet, offered as a checklist. */
  suggestedStaples: z.array(z.object({ itemId: z.string(), name: z.string() })),
});
export type Pantry = z.infer<typeof pantrySchema>;

export const updatePantrySchema = z.object({
  /** Items to mark as always kept in, by name ("olive oil") or id. */
  addStaples: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  removeStaples: z.array(z.string()).max(100).optional(),
  /** Mark items as in, running low or run out, by id or name. */
  status: z
    .array(
      z.object({
        item: z.string().min(1).max(200),
        status: z.enum(['have', 'low', 'out']),
      }),
    )
    .max(100)
    .optional(),
});
export type UpdatePantry = z.infer<typeof updatePantrySchema>;
