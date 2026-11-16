# Contributing to openCook

Thanks for helping. openCook is a self-hosted recipe app for home cooks, and it is small enough that one change can make a real difference.

## Ways to help

- **Try it and say what's missing.** Open an [issue](https://github.com/stretch0/openCook/issues) for bugs or ideas.
- **Teach it more groceries.** The starter catalogue in `libs/domain/src/catalogue.ts` is easy to add to, especially names used outside the UK and US.
- **Pick up an issue.** Ones labelled [`good first issue`](https://github.com/stretch0/openCook/labels/good%20first%20issue) are small and self-contained. Say on the issue that you're working on it.
- **Bigger changes:** open an issue first, so we can agree the approach before you spend time on it. [ROADMAP.md](ROADMAP.md) has what's planned.

Security problems go through [private reporting](SECURITY.md), not public issues.

## Getting set up

You need Node 22 or later.

```bash
npm install
npm run dev
```

The API runs on http://localhost:3000 and the web app on http://localhost:4200. The first account you create becomes the admin.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit together. In short:

| Where                | What                                                               |
| -------------------- | ------------------------------------------------------------------ |
| `apps/api`           | Hono API server, which also serves the built web app and `/mcp`    |
| `apps/web`           | React PWA                                                          |
| `apps/web-e2e`       | Playwright tests against the production build                      |
| `libs/schemas`       | Zod request and response shapes shared by the API, web app and MCP |
| `libs/domain`        | Pure logic (units, ingredient parsing, scaling, item matching)     |
| `libs/db`            | Drizzle schema and database client                                 |
| `libs/db-migrations` | Generated SQL migrations                                           |
| `libs/recipe-import` | Reading recipes from web pages, and fetching links safely          |
| `libs/mcp`           | The MCP server for AI assistants                                   |

## Conventions

- Shared request and response shapes go in `libs/schemas`, and both the API and the web app use them.
- Pure logic goes in `libs/domain` with unit tests, not in routes or components.
- Schema changes: edit `libs/db/src/schema`, then run `npm run db:generate -- --name=<description>` and commit the generated SQL. Never edit a migration that's already on `main`.
- Relative imports in the Node libraries use `.js` extensions.
- Privacy first: recipes are private by default. If a change touches what other people can see, say so in the pull request.
- Interface text is plain and short, in British English.

## Before you open a pull request

```bash
npx nx affected -t lint typecheck test build
npm run e2e
```

CI runs these too, plus CodeQL, a dependency review and an image scan. The end-to-end tests need Playwright's Chromium (`npx playwright install chromium`), or point `CHROMIUM_PATH` at a Chromium you already have.

Keep pull requests to one change, with tests for new behaviour. Describe what changed and why, and add screenshots for anything visible. Pull requests are squash-merged into `main`.

By contributing, you agree that your work is licensed under the project's [AGPL-3.0-or-later licence](LICENSE).
