import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AISLE_NAMES, formatQuantity } from '@opencook/domain';
import {
  type AddedListItem,
  type ListEntry,
  type ListItem,
  type Purchase,
  type RecipeToList,
  type ShoppingList,
  type ShoppingListSummary,
  type UpdateListItem,
  type Item,
  listEntrySchema,
} from '@opencook/schemas';

/** The shopping list operations the tools need; see OpenCookServices. */
export type ListServices = {
  listLists(): ShoppingListSummary[];
  getList(listId: string): ShoppingList;
  addToList(listId: string, entries: ListEntry[]): AddedListItem[];
  updateListItem(
    listId: string,
    lineId: string,
    patch: UpdateListItem,
  ): ListItem;
  removeListItems(listId: string, ids: string[]): void;
  checkListItems(listId: string, ids: string[], checked: boolean): void;
  addRecipeToList(recipeId: string, input: RecipeToList): AddedListItem[];
  purchaseHistory(input: { itemId?: string; limit?: number }): Purchase[];
  mergeItems(fromId: string, intoId: string): Item;
};

type Ctx = {
  services: ListServices;
  scopes: readonly string[];
};

const listArg = z
  .string()
  .optional()
  .describe(
    'A list id from get_shopping_lists. Leave out for the ongoing list.',
  );

function line(i: ListItem) {
  return {
    id: i.id,
    item_id: i.itemId,
    name: i.name,
    amount: formatQuantity(i.quantity, i.unit) || null,
    note: i.note,
    aisle: AISLE_NAMES[i.category] ?? 'Other',
    for_recipes: i.sources.length ? i.sources.map((s) => s.title) : undefined,
  };
}

function added(a: AddedListItem) {
  return {
    you_asked_for: a.entry,
    line: line(a.listItem),
    match: a.match,
    added_to_existing_line: a.combined,
    did_you_mean: a.suggestions.length
      ? a.suggestions.map((s) => ({ item_id: s.id, name: s.name }))
      : undefined,
  };
}

export function registerListTools(
  server: McpServer,
  ctx: Ctx,
  run: (fn: () => unknown) => Promise<CallToolResult>,
) {
  const can = (scope: string) => ctx.scopes.includes(scope);
  const s = ctx.services;

  if (can('lists:read')) {
    server.registerTool(
      'get_shopping_lists',
      {
        title: 'List shopping lists',
        description:
          "The household's shopping lists: the ongoing one, and any named ones, with how much is left on each.",
        annotations: { readOnlyHint: true },
      },
      () => run(() => s.listLists()),
    );

    server.registerTool(
      'get_shopping_list',
      {
        title: 'Read the shopping list',
        description:
          'What is still to buy, grouped by aisle in the order of a walk round the shop. The household shares it.',
        inputSchema: {
          list: listArg,
          include_recently_bought: z
            .boolean()
            .optional()
            .describe('Also return what was ticked off in the last week.'),
        },
        annotations: { readOnlyHint: true },
      },
      (args) =>
        run(() => {
          const l = s.getList(args.list ?? 'ongoing');
          return {
            id: l.id,
            name: l.name,
            to_buy: l.items.map(line),
            recently_bought: args.include_recently_bought
              ? l.recentlyBought.map(line)
              : undefined,
          };
        }),
    );

    server.registerTool(
      'get_purchase_history',
      {
        title: 'Purchase history',
        description:
          'When things were bought (ticked off a list), newest first. Pass item_id (from a list line) for one item, to see how often it gets bought.',
        inputSchema: {
          item_id: z.string().optional(),
          limit: z.number().int().min(1).max(500).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      (args) =>
        run(() =>
          s.purchaseHistory({ itemId: args.item_id, limit: args.limit ?? 50 }),
        ),
    );
  }

  if (can('lists:write')) {
    server.registerTool(
      'add_shopping_items',
      {
        title: 'Add to the shopping list',
        description:
          'Adds things to a list. Lines like "2 x milk" or "500 g mince" are best. Items already on the list have the amounts added. Each result says how the name matched; for match "new" with did_you_mean, check with the user.',
        inputSchema: {
          items: z.array(listEntrySchema).min(1).max(100),
          list: listArg,
        },
      },
      (args) =>
        run(() => s.addToList(args.list ?? 'ongoing', args.items).map(added)),
    );

    server.registerTool(
      'update_shopping_item',
      {
        title: 'Change a list line',
        description:
          'Changes a line on a list: its name, amount, note or aisle (aisle is remembered for next time).',
        inputSchema: {
          id: z.string().describe('The line id from get_shopping_list.'),
          list: listArg,
          name: z.string().min(1).max(200).optional(),
          quantity: z.number().nonnegative().nullable().optional(),
          unit: z.string().max(20).nullable().optional(),
          note: z.string().max(300).nullable().optional(),
          aisle: z
            .enum(Object.keys(AISLE_NAMES) as [string, ...string[]])
            .optional()
            .describe(
              Object.entries(AISLE_NAMES)
                .map(([k, v]) => `${k} (${v})`)
                .join(', '),
            ),
        },
      },
      (args) =>
        run(() =>
          line(
            s.updateListItem(args.list ?? 'ongoing', args.id, {
              name: args.name,
              quantity: args.quantity,
              unit: args.unit,
              note: args.note,
              category: args.aisle,
            }),
          ),
        ),
    );

    server.registerTool(
      'remove_shopping_items',
      {
        title: 'Remove from the shopping list',
        description:
          "Takes lines off a list without recording them as bought (use check_off_items when they've been bought).",
        inputSchema: {
          ids: z.array(z.string()).min(1).max(200),
          list: listArg,
        },
      },
      (args) =>
        run(() => {
          s.removeListItems(args.list ?? 'ongoing', args.ids);
          return { removed: args.ids.length };
        }),
    );

    server.registerTool(
      'check_off_items',
      {
        title: 'Tick off bought items',
        description:
          'Marks lines as bought, which also records the purchase in the history. checked: false puts them back on the list.',
        inputSchema: {
          ids: z.array(z.string()).min(1).max(200),
          list: listArg,
          checked: z.boolean().optional(),
        },
      },
      (args) =>
        run(() => {
          s.checkListItems(
            args.list ?? 'ongoing',
            args.ids,
            args.checked ?? true,
          );
          return { updated: args.ids.length };
        }),
    );

    server.registerTool(
      'add_recipe_to_shopping_list',
      {
        title: "Add a recipe's ingredients",
        description:
          "Puts a recipe's ingredients on the list, scaled to the servings, noting which recipe wanted them. Optional and to-taste ingredients are left out unless you pass ingredient_ids (from get_recipe).",
        inputSchema: {
          recipe_id: z.string(),
          servings: z.number().int().min(1).max(500).optional(),
          ingredient_ids: z.array(z.string()).optional(),
          list: listArg,
        },
      },
      (args) =>
        run(() =>
          s
            .addRecipeToList(args.recipe_id, {
              servings: args.servings,
              ingredientIds: args.ingredient_ids,
              listId: args.list,
            })
            .map(added),
        ),
    );

    server.registerTool(
      'merge_items',
      {
        title: 'Two names are the same thing',
        description:
          "Tells openCook that one item is another (e.g. a misspelling): the first item's name becomes another name for the second, for this household, and its lines and purchase history move across.",
        inputSchema: { from_item_id: z.string(), into_item_id: z.string() },
      },
      (args) => run(() => s.mergeItems(args.from_item_id, args.into_item_id)),
    );
  }
}
