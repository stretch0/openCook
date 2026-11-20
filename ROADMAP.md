# Roadmap

openCook is a self-hosted recipe app for home cooks: track, find and create recipes; plan the week; shop together; and let an AI assistant do the typing over MCP.

## Decisions

- **Architecture:** the same as [openRun](https://github.com/stretch0/openRun). An Nx monorepo with npm workspaces, Hono + SQLite/Drizzle, a React PWA, one Docker image and Fly.io. Databases and logic live in libs, so `nx affected` builds and tests only what changed.
- **AI goes through the user's own assistant (MCP).** The server holds no LLM keys. Websites are imported by reading their schema.org data; the assistant handles social media posts and judgement calls.
- **Federation later, but designed for it now.** Recipes have stable URLs and copies record their `origin` (author, instance, revision), so ActivityPub can be added without changing the model.
- **Item identity:** a small starter catalogue, plus items each household learns as it types. Names are compared by a normal key ("mouth wash" = "Mouthwash"); close spellings are only ever suggested, never merged silently. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#items-knowing-two-names-are-the-same-thing).

## M0 – Foundation ✅

- Nx workspace mirroring openRun: `api`, `web`, `web-e2e`, `schemas`, `db`, `db-migrations`, `domain`
- Better Auth (passwords, passkeys, first user is admin, invite-only), PWA shell, one Docker image, docker-compose, Fly.io config, CI with `nx affected`

## M1 – Recipes ✅

- ✅ Ingredient model built for scaling: amount, range, unit code, item, preparation, scaling rule; parsing from plain lines
- ✅ Recipe editor (ingredients and method as text, sections, tags, visibility), photos from camera or files
- ✅ Servings toggle that rescales ingredients and the amounts in steps; metric/US display
- ✅ Cooking mode: step by step, wake lock, swipe, timers detected from the text
- ✅ Private notes, "I cooked this" history
- ✅ Import from a link (schema.org JSON-LD), safe against private-network fetches
- ✅ Discover public recipes on the instance; copy ("fork") with provenance
- ✅ MCP server at `/mcp` with scoped, revocable API tokens and recipe tools
- ✅ Starter item catalogue (~400 groceries and household things with aisles and aliases), item matching

## M2 – Households and the shared shopping list ✅

- ✅ Invite someone into your household with a link (single use, 7 days); leave for a household of your own
- ✅ **One ongoing list per household**, plus optional named lists ("BBQ Saturday")
- ✅ Items resolve through the item catalogue: same key or alias joins the existing line and adds the amounts when the units are compatible ("200 g" + "1 kg" → "1.2 kg"), aisles group the list, "Did you mean…?" for close spellings, and "these are the same" merges teach the household's aliases (moving its lines and purchase history across)
- ✅ Moving an item to another aisle is remembered for the household
- ✅ Ticked items sit in "Recently bought" for a week, with "Put back"
- ✅ Live updates between phones (Server-Sent Events); ticks show at once and are sent in the background
- ✅ Every tick-off writes a **purchase event** (item, amount, when, who); unticking removes it
- ✅ Add a recipe's ingredients at the chosen servings, picking which ones (to-taste and optional ones start unticked); lines say which recipes wanted them
- ✅ MCP: `get_shopping_lists`, `get_shopping_list`, `add_shopping_items`, `update_shopping_item`, `remove_shopping_items`, `check_off_items`, `add_recipe_to_shopping_list`, `merge_items`, `get_purchase_history`, behind new `lists:read` / `lists:write` scopes
- Later: changes made with no signal are retried while the app stays open, but not yet kept across a restart of the app (a persistent offline queue)

## M3 – Meal planner and pantry

- ✅ Week planner shared by the household: recipes (at chosen servings) or notes like "Leftovers" per day and meal; move, remove, mark cooked (logs it on the recipe); "Add to meal plan" from a recipe
- ✅ "Shop for this week": the week's ingredients added up across recipes and sorted into **to buy**, **probably got** (with the reason) and **already on the list**, reviewed before anything is added; each line names its recipes
- ✅ Pantry: staples you always have (a common-staples checklist to start), things marked running low or run out (buying them clears it)
- ✅ **Running low** from purchase history: median gap between purchases (once bought three times); suggested at 85% of the usual gap, on the list page and in the pantry
- ✅ Household members can see each other's recipes (only the owner edits), so either can plan and shop for them
- ✅ MCP: `get_meal_plan`, `add_to_meal_plan`, `update_meal_plan_entry`, `remove_from_meal_plan`, `preview_shopping`, `add_needed_to_shopping_list`, `get_pantry`, `update_pantry`, `get_restock_suggestions`, with `plan:*` and `pantry:*` scopes
- ✅ **Sign in from claude.ai and ChatGPT**: openCook is its own OAuth 2.1 server for `/mcp` (protected resource and server discovery, dynamic client registration and client ID metadata documents, PKCE S256 only, tokens for the `/mcp` resource, a consent screen that lets you untick permissions, hour-long access tokens and rotating refresh tokens where a replayed one ends the connection, revocation, and "Connected apps" in Settings)

## M4 – Social

- Profiles, follow other cooks, a feed of recipes from people you follow
- Compare a copy with its original
- Photo search for recipes without a picture (optional Unsplash/Pexels key)
- Public recipe pages that work signed out, with schema.org JSON-LD, so any openCook (or any recipe app) can import them by link

## M5 – Federation

- ActivityPub via [Fedify](https://fedify.dev): first publish-only (follow `@you@cook.example` from Mastodon and see recipes), then follow and copy recipes from other openCook instances

## Later

- Nutrition estimates, collections, export and import (JSON, Paprika, Mealie), push reminders ("defrost the chicken"), translations
