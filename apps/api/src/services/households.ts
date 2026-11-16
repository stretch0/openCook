import { asc, eq } from 'drizzle-orm';
import { type Db, schema } from '@opencook/db';

/**
 * The household a user cooks and shops with. Everyone has one: it's created
 * with the account, and sharing it with someone else comes later (M2).
 */
export function householdOf(db: Db, userId: string): string {
  const row = db
    .select({ id: schema.householdMember.householdId })
    .from(schema.householdMember)
    .where(eq(schema.householdMember.userId, userId))
    .orderBy(asc(schema.householdMember.createdAt))
    .get();
  return row?.id ?? createHousehold(db, userId);
}

export function createHousehold(db: Db, userId: string, name?: string): string {
  const user = db
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .get();
  return db.transaction((tx) => {
    const [h] = tx
      .insert(schema.household)
      .values({ name: name ?? `${user?.name ?? 'My'}’s kitchen` })
      .returning()
      .all();
    tx.insert(schema.householdMember)
      .values({ householdId: h.id, userId, role: 'owner' })
      .run();
    return h.id;
  });
}
