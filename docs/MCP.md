# Connecting an AI assistant

openCook has an [MCP](https://modelcontextprotocol.io) server, so an AI assistant can find, save and change your recipes for you: "save this recipe", "what can I make with chickpeas?", "scale the dal for 6 and read me the method".

## 1. Create a token

In openCook, open **Settings → AI assistants**, give the token a name ("Claude on my laptop"), choose what it may do and how long it lasts, and press **Create token**. Copy it straight away: it's shown once. Revoke it there whenever you like.

## 2. Add openCook to your assistant

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

Adding openCook as a connector on claude.ai or ChatGPT, signing in instead of pasting a token, needs OAuth, which is on the roadmap.

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

Meal plan and pantry tools come with those features (see [ROADMAP.md](../ROADMAP.md)).

Try: _"I'm cooking the chickpea curry for 6 and the dal on Thursday. Put what I need on the shopping list, but ask me about spices first."_

## Saving recipes from social media

Most recipe websites publish their recipe in a structured form, which `import_recipe_from_url` reads directly. Instagram, TikTok and YouTube usually don't: there, the tool returns the post's caption and page text, and the assistant reads the recipe out of it and saves it with `create_recipe`. If the page needs a login, paste the caption into the chat instead.
