import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  type MeasurePreference,
  displayAmount,
  servingsFactor,
  scaleStepText,
} from '@opencook/domain';
import {
  type CookLogEntry,
  type CookedInput,
  type ImportResult,
  type Recipe,
  type RecipeInput,
  type RecipeListQuery,
  type RecipeSummary,
  type TokenScope,
  ingredientInputSchema,
  stepInputSchema,
  visibilitySchema,
} from '@opencook/schemas';
import { type ListServices, registerListTools } from './list-tools.js';
import { type PlanServices, registerPlanTools } from './plan-tools.js';

/**
 * What the MCP tools need from the app. The API implements this with the
 * same services its REST routes use, so tools behave exactly like the UI.
 */
export type OpenCookServices = {
  searchRecipes(query: RecipeListQuery): RecipeSummary[];
  getRecipe(id: string): Recipe;
  listTags(): { tag: string; count: number }[];
  createRecipe(input: RecipeInput): Promise<Recipe>;
  updateRecipe(
    id: string,
    input: RecipeInput & { expectedRevision?: number },
  ): Promise<Recipe>;
  deleteRecipe(id: string): void;
  setNote(id: string, text: string): string | null;
  logCooked(id: string, input: CookedInput): CookLogEntry;
  forkRecipe(id: string): Recipe;
  importFromUrl(url: string): Promise<ImportResult>;
} & ListServices &
  PlanServices;

export type McpContext = {
  services: OpenCookServices;
  /** What the token may do. Tools outside these scopes aren't offered. */
  scopes: readonly string[];
  /** The user's preferred measures, for scaled amounts. */
  preference: MeasurePreference;
  /** The public URL of this instance, for links back to recipes. */
  origin: string;
  version: string;
};

export const INSTRUCTIONS = `openCook is the user's self-hosted recipe book.

- Search before creating, so you don't save a recipe the user already has.
- When the user shares a link, call import_recipe_from_url first. If it finds a recipe, show the user the title and ingredients and save it with create_recipe once they agree. If it finds no structured recipe (often social media posts), read page_text yourself and pass the recipe you find to create_recipe.
- Ingredients can be plain lines like "200 g butter, softened": openCook parses the amount, unit and preparation, so amounts scale when the user changes servings. Write one ingredient per line with its amount first.
- Write amounts in steps with units ("add 200 g flour") so they scale too.
- Ask before deleting anything.
- Shopping list: the household shares one ongoing list. Add plain lines like "2 x milk" or "500 g mince"; openCook matches names to items it knows and adds amounts to lines already there. When a result says match "new" and has suggestions, ask the user whether they meant one of them (merge_items teaches openCook for next time).
- When the user says what they're cooking, use add_recipe_to_shopping_list with the servings they mention. It leaves out optional and "to taste" ingredients; ask about things they probably already have (spices, oil, salt) before adding them.
- Meal planning: plan meals with add_to_meal_plan. To shop for them, call preview_shopping first; ask the user about anything marked probably_have (give the reason), then call add_needed_to_shopping_list with include set to the keys they want.
- get_restock_suggestions lists things the household usually buys and is about due to buy again.`;

const ok = (data: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

const fail = (e: unknown): CallToolResult => ({
  isError: true,
  content: [
    {
      type: 'text',
      text: e instanceof Error ? e.message : String(e),
    },
  ],
});

export async function run(fn: () => unknown): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

/** A recipe as an agent sees it: amounts scaled and written out. */
export function presentRecipe(
  recipe: Recipe,
  origin: string,
  servings?: number,
  preference?: MeasurePreference,
) {
  const target = servings ?? recipe.servings;
  const factor = servingsFactor(recipe.servings, target);
  return {
    id: recipe.id,
    url: `${origin}/recipes/${recipe.id}`,
    title: recipe.title,
    description: recipe.description,
    servings: target,
    written_for_servings: recipe.servings,
    prep_minutes: recipe.prepMinutes,
    cook_minutes: recipe.cookMinutes,
    cuisine: recipe.cuisine,
    tags: recipe.tags,
    visibility: recipe.visibility,
    owner: recipe.owner.name,
    yours: recipe.mine,
    source_url: recipe.sourceUrl,
    ingredients: recipe.ingredients.map((i) => ({
      id: i.id,
      section: i.section,
      amount: displayAmount(i, factor, preference) || null,
      name: i.name,
      preparation: i.preparation,
      note: i.note,
      optional: i.optional || undefined,
      to_taste: i.scaling === 'to_taste' || undefined,
    })),
    steps: recipe.steps.map((s, n) => ({
      number: n + 1,
      section: s.section,
      text: scaleStepText(s.text, factor, {
        preference,
        ingredients: recipe.ingredients,
      }),
      timer_seconds: s.timerSeconds,
    })),
    your_note: recipe.note,
    times_cooked: recipe.timesCooked,
    last_cooked_at: recipe.lastCookedAt,
    revision: recipe.revision,
  };
}

const recipeFields = {
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  servings: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe('How many people the amounts are for. Defaults to 4.'),
  prep_minutes: z.number().int().min(0).optional(),
  cook_minutes: z.number().int().min(0).optional(),
  cuisine: z.string().max(100).optional(),
  tags: z.array(z.string().max(50)).max(30).optional(),
  visibility: visibilitySchema
    .optional()
    .describe('private (default), unlisted (anyone with the link) or public.'),
  source_url: z.url().optional().describe('Where the recipe came from.'),
  source_name: z.string().max(200).optional(),
  image_url: z
    .url()
    .optional()
    .describe('A photo of the dish to download and attach.'),
  ingredients: z
    .array(ingredientInputSchema)
    .max(200)
    .optional()
    .describe(
      'One per ingredient. Plain lines like "2 cloves garlic, crushed" are best; objects with quantity, unit (g, ml, tsp, tbsp, cup, clove, can…), name and preparation also work.',
    ),
  steps: z
    .array(stepInputSchema)
    .max(200)
    .optional()
    .describe(
      'Method steps in order, as text or {text, section, timerSeconds}.',
    ),
};

type RecipeFieldArgs = {
  [K in keyof typeof recipeFields]?: z.infer<(typeof recipeFields)[K]>;
};

function toInput(args: RecipeFieldArgs): Partial<RecipeInput> {
  const out: Partial<RecipeInput> = {};
  if (args.title !== undefined) out.title = args.title;
  if (args.description !== undefined) out.description = args.description;
  if (args.servings !== undefined) out.servings = args.servings;
  if (args.prep_minutes !== undefined) out.prepMinutes = args.prep_minutes;
  if (args.cook_minutes !== undefined) out.cookMinutes = args.cook_minutes;
  if (args.cuisine !== undefined) out.cuisine = args.cuisine;
  if (args.tags !== undefined) out.tags = args.tags;
  if (args.visibility !== undefined) out.visibility = args.visibility;
  if (args.source_url !== undefined) out.sourceUrl = args.source_url;
  if (args.source_name !== undefined) out.sourceName = args.source_name;
  if (args.image_url !== undefined) out.imageUrl = args.image_url;
  if (args.ingredients !== undefined) out.ingredients = args.ingredients;
  if (args.steps !== undefined) out.steps = args.steps;
  return out;
}

/** The recipe as editable input, for merging a partial update into. */
function recipeAsInput(r: Recipe): RecipeInput {
  return {
    title: r.title,
    description: r.description,
    servings: r.servings,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    cuisine: r.cuisine,
    tags: r.tags,
    visibility: r.visibility,
    sourceUrl: r.sourceUrl,
    sourceName: r.sourceName,
    ingredients: r.ingredients.map((i) => ({
      id: i.id,
      section: i.section,
      quantity: i.quantity,
      quantityMax: i.quantityMax,
      unit: i.unit,
      name: i.name,
      preparation: i.preparation,
      note: i.note,
      optional: i.optional,
      scaling: i.scaling,
      rawText: i.rawText,
    })),
    steps: r.steps.map((s) => ({
      section: s.section,
      text: s.text,
      timerSeconds: s.timerSeconds,
    })),
  };
}

/** Builds an MCP server for one request, offering only the tools the token allows. */
export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: 'opencook', title: 'openCook', version: ctx.version },
    { instructions: INSTRUCTIONS },
  );
  const can = (scope: TokenScope) => ctx.scopes.includes(scope);
  const s = ctx.services;
  const present = (r: Recipe, servings?: number) =>
    presentRecipe(r, ctx.origin, servings, ctx.preference);

  if (can('recipes:read')) {
    server.registerTool(
      'search_recipes',
      {
        title: 'Search recipes',
        description:
          "Finds recipes by words in the title, description, tags or ingredients. scope 'mine' searches the user's own recipes; 'all' also includes everyone's public recipes on this instance.",
        inputSchema: {
          query: z.string().max(200).optional(),
          tag: z.string().max(50).optional(),
          scope: z.enum(['mine', 'all']).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      (args) =>
        run(() =>
          s
            .searchRecipes({
              q: args.query,
              tag: args.tag,
              scope: args.scope,
              limit: args.limit ?? 20,
            })
            .map((r) => ({
              id: r.id,
              title: r.title,
              description: r.description,
              servings: r.servings,
              total_minutes: r.totalMinutes,
              tags: r.tags,
              owner: r.owner.name,
              last_cooked_at: r.lastCookedAt,
            })),
        ),
    );

    server.registerTool(
      'get_recipe',
      {
        title: 'Get a recipe',
        description:
          'A full recipe with ingredients and method. Pass servings to get every amount (in ingredients and steps) scaled for that many people.',
        inputSchema: {
          id: z.string(),
          servings: z.number().int().min(1).max(500).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      (args) => run(() => present(s.getRecipe(args.id), args.servings)),
    );

    server.registerTool(
      'list_tags',
      {
        title: 'List tags',
        description: "The tags on the user's recipes, most used first.",
        annotations: { readOnlyHint: true },
      },
      () => run(() => s.listTags()),
    );

    server.registerTool(
      'import_recipe_from_url',
      {
        title: 'Read a recipe from a link',
        description:
          'Fetches a web page and reads the recipe on it. Nothing is saved: show the result to the user, then save it with create_recipe. When found is false (common for social media), page_text holds the words on the page for you to read the recipe from.',
        inputSchema: { url: z.url() },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      (args) =>
        run(async () => {
          const r = await s.importFromUrl(args.url);
          return {
            found: r.found,
            recipe: r.recipe,
            page_title: r.pageTitle,
            page_text: r.pageText,
            image_url: r.imageUrl,
          };
        }),
    );
  }

  if (can('recipes:write')) {
    server.registerTool(
      'create_recipe',
      {
        title: 'Save a recipe',
        description:
          "Saves a new recipe to the user's openCook. Search first to avoid duplicates.",
        inputSchema: recipeFields,
      },
      (args) =>
        run(async () =>
          present(await s.createRecipe(toInput(args) as RecipeInput)),
        ),
    );

    server.registerTool(
      'update_recipe',
      {
        title: 'Change a recipe',
        description:
          "Changes one of the user's recipes. Only the fields you pass change; ingredients and steps, if passed, replace the whole list. Pass expected_revision (from get_recipe) so a change made meanwhile isn't overwritten.",
        inputSchema: {
          id: z.string(),
          expected_revision: z.number().int().positive().optional(),
          ...Object.fromEntries(
            Object.entries(recipeFields).map(([k, v]) => [k, v.optional()]),
          ),
        } as {
          id: z.ZodString;
          expected_revision: z.ZodOptional<z.ZodNumber>;
        } & {
          [K in keyof typeof recipeFields]: z.ZodOptional<
            (typeof recipeFields)[K]
          >;
        },
      },
      (args) =>
        run(async () => {
          const { id, expected_revision, ...fields } = args;
          const current = s.getRecipe(id);
          const merged = { ...recipeAsInput(current), ...toInput(fields) };
          return present(
            await s.updateRecipe(id, {
              ...merged,
              expectedRevision: expected_revision,
            }),
          );
        }),
    );

    server.registerTool(
      'delete_recipe',
      {
        title: 'Delete a recipe',
        description:
          "Deletes one of the user's recipes for good. Ask the user first, then pass confirm: true.",
        inputSchema: { id: z.string(), confirm: z.literal(true) },
        annotations: { destructiveHint: true },
      },
      (args) =>
        run(() => {
          s.deleteRecipe(args.id);
          return { deleted: args.id };
        }),
    );

    server.registerTool(
      'add_recipe_note',
      {
        title: 'Write a note on a recipe',
        description:
          'Sets the user\'s private note on a recipe (theirs or anyone\'s they can see), e.g. "use less salt next time". Replaces the existing note; pass an empty string to remove it.',
        inputSchema: { id: z.string(), text: z.string().max(10000) },
      },
      (args) => run(() => ({ note: s.setNote(args.id, args.text) })),
    );

    server.registerTool(
      'log_cooked',
      {
        title: 'Record cooking a recipe',
        description:
          'Records that the user cooked a recipe, with an optional rating (1–5) and note.',
        inputSchema: {
          id: z.string(),
          cooked_at: z.iso.datetime().optional(),
          servings: z.number().int().min(1).max(500).optional(),
          rating: z.number().int().min(1).max(5).optional(),
          note: z.string().max(2000).optional(),
        },
      },
      (args) =>
        run(() =>
          s.logCooked(args.id, {
            cookedAt: args.cooked_at,
            servings: args.servings,
            rating: args.rating,
            note: args.note,
          }),
        ),
    );

    server.registerTool(
      'fork_recipe',
      {
        title: 'Copy a recipe',
        description:
          "Copies a recipe the user can see (for example someone else's public recipe) into their own recipes, so they can change it. The copy remembers where it came from.",
        inputSchema: { id: z.string() },
      },
      (args) => run(() => present(s.forkRecipe(args.id))),
    );
  }

  registerListTools(server, ctx, run);
  registerPlanTools(server, ctx, run);
  return server;
}
