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

## M2 – Households and the shared shopping list

- Invite a partner into your household by link
- **One ongoing list per household** that you keep adding to and ticking off; optional extra named lists ("BBQ Saturday")
- Items resolve through the item catalogue: same key merges, quantities add up when units are compatible, aisles group the list, "Did you mean…?" for close spellings, "these are the same" merges teach the household's aliases
- Ticked items sit in "recently bought" for a one-tap re-add
- Live updates between phones (Server-Sent Events) and an offline queue for the supermarket
- Every tick-off writes a **purchase event** (item, amount, when, who): the timeline the pantry learns from
- MCP: `get_shopping_list`, `add_shopping_items` (reports exact/alias/new matches and suggestions), `update_shopping_item`, `remove_shopping_items`, `check_off_items`

## M3 – Meal planner and pantry intelligence

- Week planner: pick recipes (or "leftovers") per day and meal, with servings
- "Add this week to the list": aggregate scaled ingredients across recipes, then sort each into **need**, **probably have** (with the reason) or **already on the list**, with a review sheet before anything is added
- Staples you always have (oil, salt, spices), confirmed once
- **Restock prediction** from purchase history: median gap between purchases; "you usually buy milk every 6 days; it's been 7"
- MCP: `get_meal_plan`, `set_meal_plan`, `preview_shopping_for_recipes` (a dry run with reasons), `add_recipes_to_shopping_list`, `get_pantry`, `update_pantry`, `get_restock_suggestions`, `get_purchase_history`
- **OAuth 2.1** on `/mcp` so claude.ai and ChatGPT can add openCook as a connector (discovery, dynamic registration, PKCE, consent screen), as openGym does
- Scopes for lists, plans and pantry

## M4 – Social

- Profiles, follow other cooks, a feed of recipes from people you follow
- Compare a copy with its original
- Photo search for recipes without a picture (optional Unsplash/Pexels key)
- Public recipe pages that work signed out, with schema.org JSON-LD, so any openCook (or any recipe app) can import them by link

## M5 – Federation

- ActivityPub via [Fedify](https://fedify.dev): first publish-only (follow `@you@cook.example` from Mastodon and see recipes), then follow and copy recipes from other openCook instances

## Later

- Nutrition estimates, collections, export and import (JSON, Paprika, Mealie), push reminders ("defrost the chicken"), translations
