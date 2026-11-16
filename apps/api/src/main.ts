import { serve } from '@hono/node-server';
import { createDb, runMigrations } from '@opencook/db';
import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { loadConfig } from './config.js';
import { seedCatalogue } from './services/items.js';
import { version } from './version.js';

const config = loadConfig();
const db = createDb(config.databasePath);
const migrated = runMigrations(db, config.migrationsDir);
if (migrated) {
  console.log(
    `Applied ${migrated} database update${migrated === 1 ? '' : 's'}`,
  );
}
const seeded = seedCatalogue(db);
if (seeded) console.log(`Added ${seeded} items to the shared catalogue`);

const auth = createAuth(db, config);
const app = createApp({ db, auth, config });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `openCook ${version} listening on http://localhost:${info.port} (origin ${config.origin})`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    db.$client.close();
    process.exit(0);
  });
}
