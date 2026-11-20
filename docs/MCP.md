# Connecting an AI assistant

openCook has an [MCP](https://modelcontextprotocol.io) server, so an AI assistant can find, save and change your recipes for you: "save this recipe", "what can I make with chickpeas?", "scale the dal for 6 and read me the method".

There are two ways to connect, depending on the app.

## Apps you sign in from: claude.ai, ChatGPT and others

Apps that support remote MCP connectors with sign-in find openCook's sign-in by themselves:

1. In the app's settings, add a **custom connector** (claude.ai: Settings → Connectors; ChatGPT: the connectors or apps settings, which may need developer mode) with the address `https://<your openCook>/mcp`.
2. The app sends you to openCook. Sign in if you need to, check what it's asking for (untick anything you don't want it to do), and press **Allow**.
3. You're sent back to the app, connected.

The app gets an access token that lasts an hour and a refresh token it swaps for a new pair each time. Disconnect it any time in **Settings → AI assistants → Connected apps**. That ends its access straight away.

This needs openCook on an `https://` address the app can reach (for example Fly.io), because the app's servers connect to it.

## Apps that take a token: Claude Code, Claude Desktop config, scripts

### 1. Create a token

In openCook, open **Settings → AI assistants**, give the token a name ("Claude on my laptop"), choose what it may do and how long it lasts, and press **Create token**. Copy it straight away: it's shown once. Revoke it there whenever you like.

### 2. Add openCook to your assistant

The server is at `https://<your openCook>/mcp` and uses Streamable HTTP. Send the token as `Authorization: Bearer ock_…`.

**Claude Code**

```bash
claude mcp add --transport http opencook https://cook.example.com/mcp \
  --header "Authorization: Bearer ock_…"
```

**Claude Desktop, Cursor and other clients** that take a JSON config:

```json
{
  "mcpServers": {
    "opencook": {
      "type": "http",
      "url": "https://cook.example.com/mcp",
      "headers": { "Authorization": "Bearer ock_…" }
    }
  }
}
```

Clients that only speak stdio can use [`mcp-remote`](https://www.npmjs.com/package/mcp-remote): `npx mcp-remote https://cook.example.com/mcp --header "Authorization: Bearer ock_…"`.

## What an app may do

Both kinds of connection use the same permissions (scopes): `recipes:read`, `recipes:write`, `lists:read`, `lists:write`, `plan:read`, `plan:write`, `pantry:read` and `pantry:write`. Tools an app isn't allowed to use aren't listed to it.

## Tools

| Tool                     | What it does                                                                                      | Needs           |
| ------------------------ | ------------------------------------------------------------------------------------------------- | --------------- |
| `search_recipes`         | Finds recipes by words in the title, description, tags or ingredients; yours or everyone's public | `recipes:read`  |
| `get_recipe`             | A whole recipe; pass `servings` to get every amount scaled                                        | `recipes:read`  |
| `list_tags`              | Your tags, most used first                                                                        | `recipes:read`  |
| `import_recipe_from_url` | Reads the recipe on a web page without saving it; returns the page text when there's no recipe    | `recipes:read`  |
| `create_recipe`          | Saves a recipe. Ingredients can be plain lines like "200 g butter, softened"                      | `recipes:write` |
| `update_recipe`          | Changes only the fields passed; `expected_revision` stops it overwriting someone else's edit      | `recipes:write` |
| `delete_recipe`          | Deletes a recipe; needs `confirm: true`                                                           | `recipes:write` |
| `add_recipe_note`        | Sets your private note on a recipe                                                                | `recipes:write` |
| `log_cooked`             | Records that you cooked it, with an optional rating                                               | `recipes:write` |
| `fork_recipe`            | Copies someone's public recipe into yours so you can change it                                    | `recipes:write` |

| `get_shopping_lists` | The household's lists and how much is left on each | `lists:read` |
| `get_shopping_list` | What's still to buy, by aisle; optionally what was bought this week | `lists:read` |
| `get_purchase_history` | When things were bought, newest first, for one item or everything | `lists:read` |
| `add_shopping_items` | Adds lines like "2 x milk"; reports how each name matched, and "did you mean" for new ones | `lists:write` |
| `update_shopping_item` | Changes a line's name, amount, note or aisle | `lists:write` |
| `remove_shopping_items` | Takes lines off without recording a purchase | `lists:write` |
| `check_off_items` | Ticks lines off (recording the purchase), or puts them back | `lists:write` |
| `add_recipe_to_shopping_list` | A recipe's ingredients, scaled to the servings, noting which recipe wanted them | `lists:write` |
| `merge_items` | Two names are the same thing; teaches openCook the household's spelling | `lists:write` |

| `get_meal_plan` | Planned meals, a week from Monday by default | `plan:read` |
| `preview_shopping` | What plan days or recipes need: need / probably_have (with the reason) / already_on_list | `plan:read` |
| `add_to_meal_plan` | Puts a recipe or a note like "Leftovers" on a day | `plan:write` |
| `update_meal_plan_entry` | Moves a meal, changes servings or note, or marks it cooked | `plan:write` |
| `remove_from_meal_plan` | Takes a meal off the plan | `plan:write` |
| `add_needed_to_shopping_list` | Adds what the meals need (only "need" lines unless you pass `include`) | `plan:read` + `lists:write` |
| `get_pantry` | Staples, things running low or run out, and staples not set up yet | `pantry:read` |
| `get_restock_suggestions` | What the household usually buys and is about due to buy again | `pantry:read` |
| `update_pantry` | Marks staples, or things running low / run out / back in | `pantry:write` |

Try: _"Plan dinners Monday to Friday from my recipes, nothing too long on weekdays. Then work out the shopping and check with me about anything we've probably got."_

## Saving recipes from social media

Most recipe websites publish their recipe in a structured form, which `import_recipe_from_url` reads directly. Instagram, TikTok and YouTube usually don't: there, the tool returns the post's caption and page text, and the assistant reads the recipe out of it and saves it with `create_recipe`. If the page needs a login, paste the caption into the chat instead.
