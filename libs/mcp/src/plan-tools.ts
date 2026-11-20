import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { formatQuantity } from '@opencook/domain';
import {
  type AddNeeds,
  type AddPlanEntry,
  type AddedListItem,
  type MealPlan,
  type Pantry,
  type PlanEntry,
  type RestockSuggestion,
  type ShoppingNeed,
  type ShoppingSelection,
  type UpdatePantry,
  type UpdatePlanEntry,
  mealSlotSchema,
} from '@opencook/schemas';

/** The planner and pantry operations the tools need; see OpenCookServices. */
export type PlanServices = {
  getPlan(input: { from?: string; days?: number }): MealPlan;
  addPlanEntry(input: AddPlanEntry): PlanEntry;
  updatePlanEntry(id: string, patch: UpdatePlanEntry): PlanEntry;
  removePlanEntry(id: string): void;
  shoppingNeeds(selection: ShoppingSelection): ShoppingNeed[];
  addNeedsToList(input: AddNeeds): AddedListItem[];
  getPantry(): Pantry;
  updatePantry(input: UpdatePantry): Pantry;
  restockSuggestions(): RestockSuggestion[];
};

type Ctx = { services: PlanServices; scopes: readonly string[] };

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('YYYY-MM-DD');

function entry(e: PlanEntry) {
  return {
    id: e.id,
    date: e.date,
    meal: e.slot,
    title: e.title,
    recipe_id: e.recipeId,
    servings: e.servings ?? e.recipeServings,
    note: e.note,
    cooked: !!e.cookedAt,
  };
}

function need(n: ShoppingNeed) {
  return {
    key: n.key,
    item_id: n.itemId,
    name: n.name,
    amount: formatQuantity(n.quantity, n.unit) || null,
    status: n.status,
    reason: n.reason,
    for_recipes: n.sources.map((s) => s.title),
  };
}

const selection = {
  from: date.optional().describe('First day of the plan to shop for.'),
  to: date.optional().describe('Last day of the plan to shop for.'),
  recipes: z
    .array(
      z.object({
        recipe_id: z.string(),
        servings: z.number().int().min(1).max(500).optional(),
      }),
    )
    .max(50)
    .optional()
    .describe('Recipes to shop for, as well as or instead of plan days.'),
};

function toSelection(args: {
  from?: string;
  to?: string;
  recipes?: { recipe_id: string; servings?: number }[];
}): ShoppingSelection {
  return {
    from: args.from,
    to: args.to,
    recipes: args.recipes?.map((r) => ({
      recipeId: r.recipe_id,
      servings: r.servings,
    })),
  };
}

export function registerPlanTools(
  server: McpServer,
  ctx: Ctx,
  run: (fn: () => unknown) => Promise<CallToolResult>,
) {
  const can = (scope: string) => ctx.scopes.includes(scope);
  const s = ctx.services;

  if (can('plan:read')) {
    server.registerTool(
      'get_meal_plan',
      {
        title: 'Read the meal plan',
        description:
          "The household's planned meals, a week from Monday by default.",
        inputSchema: {
          from: date.optional(),
          days: z.number().int().min(1).max(31).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      (args) =>
        run(() => {
          const plan = s.getPlan({ from: args.from, days: args.days });
          return {
            from: plan.from,
            to: plan.to,
            meals: plan.entries.map(entry),
          };
        }),
    );

    server.registerTool(
      'preview_shopping',
      {
        title: 'What do these meals need?',
        description:
          'Adds up the ingredients for plan days and/or recipes (scaled) and sorts each into need, probably_have (with the reason: a staple, or bought recently) or already_on_list. Nothing is added. Check probably_have items with the user, then call add_needed_to_shopping_list.',
        inputSchema: selection,
        annotations: { readOnlyHint: true },
      },
      (args) => run(() => s.shoppingNeeds(toSelection(args)).map(need)),
    );
  }

  if (can('plan:write')) {
    server.registerTool(
      'add_to_meal_plan',
      {
        title: 'Plan a meal',
        description:
          'Puts a recipe (or a note like "Leftovers") on a day of the plan.',
        inputSchema: {
          date,
          meal: mealSlotSchema.optional().describe('Defaults to dinner.'),
          recipe_id: z.string().optional(),
          title: z
            .string()
            .max(200)
            .optional()
            .describe('For meals without a recipe.'),
          servings: z.number().int().min(1).max(500).optional(),
          note: z.string().max(500).optional(),
        },
      },
      (args) =>
        run(() =>
          entry(
            s.addPlanEntry({
              date: args.date,
              slot: args.meal,
              recipeId: args.recipe_id,
              title: args.title,
              servings: args.servings,
              note: args.note,
            }),
          ),
        ),
    );

    server.registerTool(
      'update_meal_plan_entry',
      {
        title: 'Change a planned meal',
        description:
          'Moves a planned meal, changes its servings or note, or marks it cooked (which logs it on the recipe).',
        inputSchema: {
          id: z.string(),
          date: date.optional(),
          meal: mealSlotSchema.optional(),
          servings: z.number().int().min(1).max(500).nullable().optional(),
          note: z.string().max(500).nullable().optional(),
          cooked: z.boolean().optional(),
        },
      },
      (args) =>
        run(() =>
          entry(
            s.updatePlanEntry(args.id, {
              date: args.date,
              slot: args.meal,
              servings: args.servings,
              note: args.note,
              cooked: args.cooked,
            }),
          ),
        ),
    );

    server.registerTool(
      'remove_from_meal_plan',
      {
        title: 'Remove a planned meal',
        description: 'Takes a meal off the plan.',
        inputSchema: { id: z.string() },
        annotations: { destructiveHint: true },
      },
      (args) =>
        run(() => {
          s.removePlanEntry(args.id);
          return { removed: args.id };
        }),
    );
  }

  if (can('plan:read') && can('lists:write')) {
    server.registerTool(
      'add_needed_to_shopping_list',
      {
        title: 'Shop for these meals',
        description:
          'Adds what the meals need to the shopping list, noting which recipes wanted each thing. By default only lines with status "need" are added; pass include (keys from preview_shopping) to choose exactly which.',
        inputSchema: {
          ...selection,
          include: z.array(z.string()).optional(),
        },
      },
      (args) =>
        run(() =>
          s
            .addNeedsToList({
              selection: toSelection(args),
              include: args.include,
            })
            .map((a) => ({
              name: a.listItem.name,
              amount:
                formatQuantity(a.listItem.quantity, a.listItem.unit) || null,
              added_to_existing_line: a.combined,
            })),
        ),
    );
  }

  if (can('pantry:read')) {
    server.registerTool(
      'get_pantry',
      {
        title: 'Read the pantry',
        description:
          'Staples the household always has, things marked running low or run out, and common staples not set up yet.',
        annotations: { readOnlyHint: true },
      },
      (args) =>
        run(() => {
          void args;
          const p = s.getPantry();
          return {
            staples: p.items.filter((i) => i.staple).map((i) => i.name),
            running_low: p.items
              .filter((i) => i.status === 'low')
              .map((i) => i.name),
            run_out: p.items
              .filter((i) => i.status === 'out')
              .map((i) => i.name),
            suggested_staples_not_set_up: p.suggestedStaples.map((i) => i.name),
          };
        }),
    );

    server.registerTool(
      'get_restock_suggestions',
      {
        title: 'What is running low?',
        description:
          'Things the household buys regularly and is about due to buy again, from its purchase history (needs three purchases of something). Leaves out what is already on the list.',
        annotations: { readOnlyHint: true },
      },
      () =>
        run(() =>
          s.restockSuggestions().map((r) => ({
            item_id: r.itemId,
            name: r.name,
            usually_every_days: r.intervalDays,
            days_since_bought: r.daysSince,
            last_bought_amount:
              formatQuantity(r.lastQuantity, r.lastUnit) || null,
          })),
        ),
    );
  }

  if (can('pantry:write')) {
    server.registerTool(
      'update_pantry',
      {
        title: 'Update the pantry',
        description:
          'Marks things as staples the household always has (by name, e.g. "olive oil"), unmarks them, or marks things as running low, run out or in again.',
        inputSchema: {
          add_staples: z.array(z.string().min(1).max(200)).max(100).optional(),
          remove_staples: z.array(z.string()).max(100).optional(),
          status: z
            .array(
              z.object({
                item: z.string(),
                status: z.enum(['have', 'low', 'out']),
              }),
            )
            .max(100)
            .optional(),
        },
      },
      (args) =>
        run(() => {
          const p = s.updatePantry({
            addStaples: args.add_staples,
            removeStaples: args.remove_staples,
            status: args.status,
          });
          return {
            staples: p.items.filter((i) => i.staple).map((i) => i.name),
            running_low: p.items
              .filter((i) => i.status === 'low')
              .map((i) => i.name),
            run_out: p.items
              .filter((i) => i.status === 'out')
              .map((i) => i.name),
          };
        }),
    );
  }
}
