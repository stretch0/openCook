import { z } from 'zod';

export const visibilitySchema = z.enum(['private', 'unlisted', 'public']);
export type Visibility = z.infer<typeof visibilitySchema>;

export const scalingSchema = z.enum(['linear', 'fixed', 'to_taste']);

const text = (max: number) => z.string().trim().max(max);

/** One ingredient as stored: an amount, a unit code and a name. */
export const ingredientSchema = z.object({
  /** Unique within the recipe. Steps can show it with {{ing:<id>}}. */
  id: z.string().min(1).max(64),
  section: text(100).nullable(),
  quantity: z.number().nonnegative().nullable(),
  quantityMax: z.number().nonnegative().nullable(),
  /** A unit code such as "g", "tbsp" or "clove"; null for "3 eggs". */
  unit: z.string().max(20).nullable(),
  name: text(200).min(1),
  itemId: z.string().nullable(),
  preparation: text(200).nullable(),
  note: text(300).nullable(),
  optional: z.boolean(),
  scaling: scalingSchema,
  rawText: z.string().max(500).nullable(),
});
export type Ingredient = z.infer<typeof ingredientSchema>;

/**
 * An ingredient when saving: either a line of text ("200 g butter, softened"),
 * which is parsed, or structured fields.
 */
export const ingredientInputSchema = z.union([
  text(500).min(1),
  z.object({
    id: z.string().min(1).max(64).optional(),
    section: text(100).nullish(),
    quantity: z.number().nonnegative().nullish(),
    quantityMax: z.number().nonnegative().nullish(),
    unit: z.string().max(20).nullish(),
    name: text(200).min(1),
    preparation: text(200).nullish(),
    note: text(300).nullish(),
    optional: z.boolean().optional(),
    scaling: scalingSchema.optional(),
    rawText: z.string().max(500).nullish(),
  }),
]);
export type IngredientInput = z.infer<typeof ingredientInputSchema>;

export const stepSchema = z.object({
  section: text(100).nullable(),
  text: text(5000).min(1),
  timerSeconds: z.number().int().positive().max(86400).nullable(),
});
export type Step = z.infer<typeof stepSchema>;

export const stepInputSchema = z.union([
  text(5000).min(1),
  z.object({
    section: text(100).nullish(),
    text: text(5000).min(1),
    timerSeconds: z.number().int().positive().max(86400).nullish(),
  }),
]);
export type StepInput = z.infer<typeof stepInputSchema>;

export const recipeInputSchema = z.object({
  title: text(200).min(1),
  description: text(5000).nullish(),
  servings: z.number().int().min(1).max(500).default(4),
  prepMinutes: z.number().int().min(0).max(10000).nullish(),
  cookMinutes: z.number().int().min(0).max(10000).nullish(),
  cuisine: text(100).nullish(),
  tags: z.array(text(50).min(1)).max(30).default([]),
  visibility: visibilitySchema.default('private'),
  sourceUrl: z.url().max(2000).nullish(),
  sourceName: text(200).nullish(),
  /** An uploaded image (from POST /api/images). */
  imageId: z.string().nullish(),
  /** Or a picture on the web to download, e.g. from an imported page. */
  imageUrl: z.url().max(2000).nullish(),
  ingredients: z.array(ingredientInputSchema).max(200).default([]),
  steps: z.array(stepInputSchema).max(200).default([]),
});
export type RecipeInput = z.input<typeof recipeInputSchema>;

export const updateRecipeSchema = recipeInputSchema.extend({
  /** The revision being edited. A newer one on the server means a conflict. */
  expectedRevision: z.number().int().positive().optional(),
});
export type UpdateRecipe = z.input<typeof updateRecipeSchema>;

export const personSchema = z.object({ id: z.string(), name: z.string() });

export const recipeSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  servings: z.number(),
  totalMinutes: z.number().nullable(),
  tags: z.array(z.string()),
  visibility: visibilitySchema,
  imageUrl: z.string().nullable(),
  owner: personSchema,
  lastCookedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type RecipeSummary = z.infer<typeof recipeSummarySchema>;

export const recipeSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  servings: z.number(),
  prepMinutes: z.number().nullable(),
  cookMinutes: z.number().nullable(),
  cuisine: z.string().nullable(),
  tags: z.array(z.string()),
  visibility: visibilitySchema,
  sourceUrl: z.string().nullable(),
  sourceName: z.string().nullable(),
  imageId: z.string().nullable(),
  imageUrl: z.string().nullable(),
  owner: personSchema,
  /** Whether the person asking can edit it. */
  mine: z.boolean(),
  forkedFrom: z
    .object({ id: z.string(), title: z.string(), owner: personSchema })
    .nullable(),
  ingredients: z.array(ingredientSchema),
  steps: z.array(stepSchema),
  /** The asker's own private note. */
  note: z.string().nullable(),
  lastCookedAt: z.iso.datetime().nullable(),
  timesCooked: z.number(),
  revision: z.number(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Recipe = z.infer<typeof recipeSchema>;

export const recipeListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  tag: z.string().max(50).optional(),
  /** mine: your recipes; all: yours and everyone's public ones. */
  scope: z.enum(['mine', 'all']).default('mine'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type RecipeListQuery = z.input<typeof recipeListQuerySchema>;

export const noteInputSchema = z.object({ text: text(10000) });

export const cookedInputSchema = z.object({
  cookedAt: z.iso.datetime().optional(),
  servings: z.number().int().min(1).max(500).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  note: text(2000).optional(),
});
export type CookedInput = z.infer<typeof cookedInputSchema>;

export const cookLogEntrySchema = z.object({
  id: z.string(),
  cookedAt: z.iso.datetime(),
  servings: z.number().nullable(),
  rating: z.number().nullable(),
  note: z.string().nullable(),
});
export type CookLogEntry = z.infer<typeof cookLogEntrySchema>;

export const importRequestSchema = z.object({ url: z.url().max(2000) });

/** What an import found on a page; review it, then save it as a recipe. */
export const importResultSchema = z.object({
  /** Whether the page had a structured recipe (schema.org Recipe). */
  found: z.boolean(),
  recipe: recipeInputSchema
    .extend({
      ingredients: z.array(z.string()),
      steps: z.array(z.string()),
    })
    .nullable(),
  /** Page text, for an agent to read when no structured recipe was found. */
  pageTitle: z.string().nullable(),
  pageText: z.string().nullable(),
  imageUrl: z.string().nullable(),
});
export type ImportResult = z.infer<typeof importResultSchema>;

export const imageSchema = z.object({
  id: z.string(),
  url: z.string(),
  width: z.number(),
  height: z.number(),
});
export type ImageInfo = z.infer<typeof imageSchema>;
