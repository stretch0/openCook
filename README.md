# openCook

**A self-hosted recipe book for home cooks**, with an AI assistant if you like.

Keep your recipes in one place, scale them to however many people you're feeding, and cook from a screen that stays on. Paste a link and openCook reads the recipe for you. Connect Claude (or any MCP client) and just ask: _"save this recipe"_, _"what can I make with chickpeas?"_, _"read me the dal for six"_.

It runs as one Docker image on your own server, a Raspberry Pi or a small [Fly.io](docs/FLY.md) machine, and installs on your phone as an app (PWA). Inspired by [openGym](https://github.com/DuarteSantos8/openGym); built like [openRun](https://github.com/stretch0/openRun).

## What it does today

- **Recipes that scale.** Ingredients are stored as amounts and units, so changing the servings rescales everything (in the method too) and shows it the way a cook would write it: 6 tsp becomes 2 tbsp, ⅓ cup stays ⅓ cup. Switch between metric and US measures.
- **Write recipes the easy way.** Paste or type ingredients one per line ("2-3 cloves garlic, crushed") and openCook works out the amount, unit and preparation.
- **Import from a link.** Most recipe sites publish their recipe in a structured form, and openCook reads it directly, photo included. For social media posts, your AI assistant reads the caption and saves the recipe.
- **Cooking mode.** One step at a time in big type, the screen kept awake, swipe between steps, and timers for any time a step mentions.
- **Photos** from your camera or files, resized and stripped of location data.
- **Notes and history.** Private notes on any recipe, and a record of when you cooked it.
- **A shopping list you share.** Invite your partner into your household and you both see one ongoing list, live. "mouth wash" and "Mouthwash" are the same thing, amounts add up ("200 g" + "1 kg" mince is "1.2 kg"), everything is grouped by aisle, and close spellings get a "Did you mean…?". Add a recipe's ingredients at the servings you're cooking. Ticking things off builds a history of what you buy and when.
- **Plan the week, shop for it.** Put recipes on the days you'll cook them, then "Shop for this week" adds up everything they need and sorts it into what to buy, what you've probably got (your staples, or something bought recently, with the reason) and what's already on the list. Mark it cooked from the plan.
- **Knows when you're running low.** From what you tick off, openCook learns how often you buy things and suggests them when they're about due ("milk: every 6 days, it's been 7").
- **Share and copy.** Make recipes public on your instance, browse other cooks' in Discover, and copy one to make your own variation (it remembers where it came from).
- **AI assistants over MCP.** Search, read (scaled), save, edit, note and import recipes; read and change the shopping list, meal plan and pantry ("plan dinners for this week from my recipes, then put what we need on the list"). Tokens are scoped and revocable. See [docs/MCP.md](docs/MCP.md).
- Passkeys or passwords, invite-only sign-up, light and dark themes, works offline for recipes you've opened.

**Coming next:** signing in from claude.ai and ChatGPT without pasting a token, then following other cooks. See [ROADMAP.md](ROADMAP.md).

## Run it

```bash
mkdir opencook && cd opencook
curl -O https://raw.githubusercontent.com/stretch0/openCook/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/stretch0/openCook/main/.env.example
# Set BETTER_AUTH_SECRET (openssl rand -base64 32) and ORIGIN in .env
docker compose up -d
```

Open your `ORIGIN` and create an account: the first one becomes the admin. Your data lives in `./data`.

On Fly.io instead: see [docs/FLY.md](docs/FLY.md).

### Upgrading

```bash
docker compose pull && docker compose up -d
```

Database updates are applied on start. Back up first: `docker compose exec opencook node backup.js`.

## Develop

Node 22 or later.

```bash
npm install
npm run dev        # API on :3000, web app on :4200
npx nx affected -t lint typecheck test build
npm run e2e
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the conventions, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how it fits together.

## Licence

[AGPL-3.0-or-later](LICENSE).
