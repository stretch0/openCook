# Architecture

## Overview

openCook ships as **one Docker image**. A Node API built with [Hono](https://hono.dev) serves `/api`, the MCP endpoint at `/mcp` and the built PWA, all from one origin, so passkeys and cookies just work. Data lives in **SQLite** at `/data/opencook.db`, with uploaded photos in `/data/uploads`.

```
browser / installed PWA ──► api (Hono, Node 22) ──► SQLite (/data)
AI assistant (MCP) ───────►   ├─ /api/auth/*   Better Auth (password, passkeys)
                              ├─ /api/*        app routes (REST + Zod)
                              ├─ /mcp          MCP server (Streamable HTTP, API tokens)
                              └─ /*            built PWA (apps/web/dist)
```

The layout copies [openRun](https://github.com/stretch0/openRun) on purpose: the same Nx setup, the same lib split and the same image and Fly deploy, so `nx affected` only builds and tests what a change touches.

## Monorepo layout

| Project              | Purpose                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `apps/api`           | Hono server. Bundled with esbuild into one file; third-party packages stay external.          |
| `apps/web`           | React 19 + Vite PWA (`vite-plugin-pwa`), React Router, TanStack Query, Tailwind CSS 4         |
| `apps/web-e2e`       | Playwright tests run against the production build (API serving the PWA)                       |
| `libs/schemas`       | Zod schemas and types shared by the API, the web app and the MCP server                       |
| `libs/db`            | Drizzle schema and database client                                                            |
| `libs/db-migrations` | Generated SQL migrations and the `generate` / `check` / `migrate` targets                     |
| `libs/domain`        | Pure, unit-tested cooking logic: units, ingredient parsing, scaling, item identity, timers    |
| `libs/recipe-import` | Reads recipes from web pages (schema.org JSON-LD), with a fetch that refuses private networks |
| `libs/mcp`           | The MCP server: tools, instructions and the Streamable HTTP handler                           |

Libraries are not buildable. They export TypeScript source (`package.json` `exports` → `src/index.ts`), and the consuming app's bundler compiles it. Projects are configured in each `package.json`'s `"nx"` key; there are no `project.json` files.

`libs/mcp` doesn't import the API. It declares `OpenCookServices`, and `apps/api/src/routes/mcp.ts` implements it with the same service functions the REST routes use, so the tools and the app can't drift apart.

## Database and migrations

- The schema lives in `libs/db/src/schema`, one file per area (`auth`, `households`, `items`, `recipes`).
- Migrations live in their own Nx project, `libs/db-migrations`. Because of that:
  - `nx affected -t check` only runs when the schema or the migrations change, and fails CI if the schema changed without a migration.
  - `apps/api` has an implicit dependency on `db-migrations`, so a new migration also rebuilds the image.
- On startup the API applies pending migrations, then adds any missing items from the starter catalogue (`seedCatalogue`). Upgrading a self-hosted instance is just pulling a new image.
- Never edit a migration once it has been released.

## Recipes and amounts

The part that makes scaling work is how amounts are stored. Each `recipe_ingredient` has:

- `quantity` and `quantity_max` (for "2–3"), as numbers;
- `unit`: a code from `UNITS` in `libs/domain/src/units.ts`. Mass and volume units convert through grams and millilitres; everything else (`clove`, `can`, `pinch`…) only combines with itself;
- `name`, `preparation` ("finely chopped"), `note` ("400g"), `optional`;
- `scaling`: `linear` (most things), `fixed` (1 bay leaf whatever the servings) or `to_taste`;
- `raw_text`, the line as it was written;
- `item_id`, the item it is (see below).

`parseIngredientLine` reads lines such as "1 ½ cups plain flour, sifted", "2-3 cloves garlic", "200g butter" and "2 x 400g tins chickpeas"; `ingredientLine` writes an ingredient back as a line that parses the same way, which is how the editor round-trips ingredients as plain text.

Showing an amount is `displayAmount(ingredient, factor, preference)`: scale by `target servings ÷ recipe servings`, pick a sensible unit (`bestUnit`: 6 tsp → 2 tbsp, 1500 g → 1.5 kg, metric ↔ US on request) and round to what a cook would write (`⅓ cup`, `235 g`).

**Steps scale too.** `scaleStep` finds weights and volumes written in a step ("add 200 g flour") and scales them, leaving times, temperatures and counts alone. Agents can also write `{{ing:<ingredient id>}}` (shows that ingredient's scaled amount and name) or `{{qty:2 cups}}`. Ingredient ids are kept across edits so these keep pointing at the right thing. `findDurations` spots "simmer for 20 minutes" so cooking mode can offer a timer.

Each recipe has a `revision`. Edits may send `expectedRevision`; a mismatch is a 409, so an agent and a person editing at once can't silently overwrite each other.

## Items: knowing two names are the same thing

`item` is the catalogue of things you cook with or buy: shared rows (`household_id` null) come from `libs/domain/src/catalogue.ts`; households add their own the first time a name is typed. `item_alias` holds other names.

Two names are the same item when they share a **normal key** (`normalItemKey`): lowercase, accents folded, punctuation and spaces removed, the last word made singular, and descriptions like "large" or "fresh" dropped. So "Mouth wash", "mouth-wash" and "Mouthwash" are all `mouthwash`, and "Large free-range eggs" is `egg`.

Matching (`matchItem`, `resolveItems`) looks for an exact key or alias, household items first. Close spellings ("mouthwsh") are **only ever suggestions** (edit distance scaled by length, plus prefixes), never merged silently. The catalogue doesn't need to be complete; it just gives good autocomplete and aisles from day one. Households teach it their own names by merging items on the shopping list (below).

## Households

- Everyone is in exactly one household (`household`, `household_member`); it's created with the account. Items, shopping lists and purchases belong to the household; recipes stay with their owner.
- `household_invite` is a single-use link valid for 7 days. Joining moves you across: whatever was still to buy on your old ongoing list is added to the new one (`carryOverList`), your recipes' ingredients are re-linked to items the new household can see (`relinkRecipeItems`), and a household left empty is deleted. Leaving gives you a fresh household of your own.

## Shopping lists

- `shopping_list`: one `ongoing` list per household (made when first needed; can't be deleted) plus any `named` lists. The API accepts `ongoing` in place of its id.
- `shopping_list_item` is a line: display name, `item_id`, amount, note, `sources` (which recipes wanted it, at what servings), who added it, and `checked_at`/`checked_by`.
- **Adding** (`addToList`) parses each line with `parseIngredientLine`, resolves the name to an item (`resolveItems`: exact key, alias, or a new household item with "Did you mean…?" suggestions) and, if that item already has an unticked line whose amount it can be added to (`combineAmounts`: same unit, or both weights / both volumes), adds to that line. Otherwise it's a new line.
- **Aisles**: a line's aisle is its item's category, overridden per household by `household_item_preference` when someone moves it. `groupByAisle` orders aisles like a walk round a supermarket.
- **Merging** (`mergeItems`): the old item's key and aliases become household aliases of the kept item. A household alias claims its key, so a shared catalogue item that was merged away no longer matches for that household. List lines, purchases and the household's recipe ingredients move across; a household-owned item is deleted.
- **Ticking off** sets `checked_at` and writes a `purchase_event` (household, item, name, amount, time, who, source `list`/`mcp`, the line it came from). Unticking deletes that event, so mistakes don't pollute the history. Ticked lines show under "Recently bought" for a week.
- **Recipes to the list** (`addRecipeToList`): scaled with `scaleAmount`, a range buys the larger amount, optional and to-taste ingredients are skipped unless picked, and each line records the recipe in `sources`.
- **Live updates**: every change calls `listChanged(listId)`, an in-process event emitter (one server, so no broker is needed). `GET /api/lists/:id/events` is a Server-Sent Events stream that sends `ready`, then `changed` on each edit, with a comment every 25 s to keep proxies from closing it. The web app refetches on each event; the service worker never caches the stream.
- The web app ticks lines off immediately (optimistic update) and rolls back if the server refuses. TanStack Query pauses requests made without a connection and sends them when it's back, while the app stays open.

## Meal plan and pantry

- `meal_plan_entry`: household, `date` (YYYY-MM-DD in the household's calendar; "this week" uses the user's time zone), `slot` (breakfast/lunch/dinner/snack), an optional `recipe_id` plus a `title` (the recipe's title when planned, or free text), servings (the recipe's when empty), note and `cooked_at`. Marking it cooked also writes a `cook_log` row for the recipe.
- **Shopping for meals** (`shoppingNeeds`): takes plan days (meals not yet cooked) and/or recipes with servings, scales each recipe's non-optional ingredients, and adds them up with `aggregateNeeds` (same item, compatible amounts). Each line is sorted by `classifyNeed`:
  - **already on the list**: an unticked line for that item;
  - **need**: marked low or run out, or a staple that's overdue, or bought regularly and due again;
  - **probably have**: a staple ("You always have this"), bought within half its usual gap, or (with too little history to know the gap) bought in the last 3 days, with the reason in words.
    `addNeedsToList` adds the chosen lines (by default those marked need) through `addToList`, keeping every recipe in the line's `sources`. The app always shows the sorted lines for review first; nothing is left off silently.
- `pantry_item` (household, item): `staple` and `status` (`have`/`low`/`out`). Ticking an item off the list sets it back to `have`. Rows that say nothing (`have`, not a staple) are removed. `SUGGESTED_STAPLES` in `libs/domain/src/planning.ts` seeds the first-run checklist.
- **Running low** (`restockState`): purchases on the same day count as one shop; with three or more shops, the usual gap is the median gap in days, and an item is due once the time since it was last bought reaches 85% of that. `restockSuggestions` lists due items that aren't on the ongoing list, most overdue first.
- Household members can open each other's private recipes (not edit them), since a shared plan needs everyone's ingredients.

## Visibility, notes and copies

- Recipes are `private` (default; the owner and their household), `unlisted` (anyone signed in here with the link) or `public` (listed in Discover). Only the owner can change one.
- `recipe_note` is one private note per person per recipe, including other people's recipes.
- `cook_log` records each time someone cooked a recipe; it feeds "last cooked".
- Forking copies a recipe with `forked_from_id` and an `origin` (author, instance, revision), so copies keep their provenance, including, later, across instances.

## Photos

`POST /api/images` takes an upload, turns it upright, shrinks it to at most 1600 px and stores it as WebP without metadata (so no location from a phone camera) at `DATA_DIR/uploads/<sha256>.webp`. Identical photos share one file. `GET /api/images/:id` serves them to anyone with the unguessable link, cached forever. A recipe can also name an `imageUrl`, which is downloaded through the safe fetch below.

## Importing recipes

`libs/recipe-import` fetches a page and reads its schema.org `Recipe` (inside `@graph`, arrays, `HowToSection`s…). Nearly every recipe site publishes one, so no AI is needed for websites. When there isn't one (often social media), it returns the page's caption and text for an AI assistant to read; the assistant then calls `create_recipe`.

`safeFetch` only allows http(s), resolves the host and refuses loopback, private, link-local and other non-public addresses (checking every redirect hop), and limits time and size. `ALLOW_PRIVATE_IMPORTS=true` lifts the address check for people with recipe sites on their own network.

## MCP

- `/mcp` is a stateless Streamable HTTP endpoint (`WebStandardStreamableHTTPServerTransport`, JSON responses). Each request builds a server for the token's user.
- Auth is a personal API token (`ock_…`, created in Settings → AI assistants). Only its SHA-256 is stored. Tokens have scopes (`recipes:read`, `recipes:write`) and an optional expiry; tools a token can't use aren't listed.
- Recipe tools: `search_recipes`, `get_recipe` (scaled to any servings), `list_tags`, `import_recipe_from_url`, `create_recipe`, `update_recipe` (partial, with `expected_revision`), `delete_recipe` (needs `confirm: true`), `add_recipe_note`, `log_cooked`, `fork_recipe`.
- List tools (`libs/mcp/src/list-tools.ts`, scopes `lists:read` / `lists:write`): `get_shopping_lists`, `get_shopping_list`, `get_purchase_history`, `add_shopping_items`, `update_shopping_item`, `remove_shopping_items`, `check_off_items`, `add_recipe_to_shopping_list`, `merge_items`. Purchases ticked off by an assistant are recorded with source `mcp`.
- The server's instructions tell the assistant to search before creating, ask before deleting, check "did you mean" suggestions with the user, and ask about things they probably already have before adding a recipe's ingredients.
- **Sign-in for apps (OAuth 2.1, `apps/api/src/services/oauth.ts`).** openCook is its own authorization server, following the MCP authorization spec:
  - `/mcp` answers unauthenticated requests with `401` and `WWW-Authenticate: Bearer resource_metadata=…`, pointing to `/.well-known/oauth-protected-resource/mcp` (RFC 9728), which names this origin as the authorization server; `/.well-known/oauth-authorization-server` (RFC 8414) lists the endpoints.
  - Clients either register at `/oauth/register` (RFC 7591; public clients only, https redirects or http on localhost) or use an https URL as their `client_id`, pointing to a client ID metadata document. That document is fetched through `safeFetch`, must repeat its own URL as `client_id`, and is cached for a day (`oauth_client`).
  - `/oauth/authorize` hands the request to the web app's `/connect` page, which needs the person's session. It checks the request through `/api/oauth/request`: problems with the client or redirect URI are shown on the page (never redirected), and anything else goes back to the app as an OAuth error. PKCE with S256 is required, and the `resource`, when given, must be this server's `/mcp`.
  - Allowing creates a single-use code (stored hashed, 10 minutes, bound to the client, redirect URI, PKCE challenge, scopes and resource). `/oauth/token` swaps it for an access token (an `ock_` API token that expires in an hour, linked to an `oauth_grant`) and a refresh token (`ocr_`, stored hashed on the grant).
  - Refreshing rotates the refresh token and deletes the grant's earlier access tokens. Presenting the previous refresh token again means it leaked, so the whole grant is deleted.
  - `/oauth/revoke` (RFC 7009) ends a grant (refresh token) or a single access token. Settings lists grants as Connected apps; disconnecting deletes the grant and its tokens. Because the `api_token.grant_id` column was added with `ALTER TABLE`, which can't cascade in SQLite, grant tokens are deleted explicitly first.
  - Discovery, registration, token and revocation endpoints and `/mcp` allow any origin (CORS), since none of them use cookies.

See [MCP.md](MCP.md) for connecting an assistant.

## Testing

- Vitest everywhere; `*.spec.ts` next to the code.
- API tests run `createApp` against an in-memory database (`apps/api/src/test-utils.ts`). The MCP tests connect the real MCP client to the app through `app.request`.
- Playwright (`apps/web-e2e`) builds the API and web app, runs the production bundle on port 3100 with a fresh `DATA_DIR`, and walks through sign-up, writing, scaling and cooking a recipe, notes and creating an MCP token.
