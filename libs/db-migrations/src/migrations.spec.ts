import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { createDb, runMigrations, schema } from '@opencook/db';
const { recipe, user } = schema;

const migrationsFolder = fileURLToPath(
  new URL('../migrations', import.meta.url),
);

describe('db', () => {
  it('applies migrations and enforces foreign keys', () => {
    const db = createDb(':memory:');
    expect(runMigrations(db, migrationsFolder)).toBeGreaterThan(0);
    // Running again is a no-op.
    expect(runMigrations(db, migrationsFolder)).toBe(0);

    const [u] = db
      .insert(user)
      .values({ name: 'Ada', email: 'ada@example.com' })
      .returning()
      .all();
    expect(u.role).toBe('member');

    db.insert(recipe).values({ ownerId: u.id, title: 'Soup' }).run();

    db.delete(user).where(eq(user.id, u.id)).run();
    expect(db.select().from(recipe).all()).toHaveLength(0);
  });
});
