import { randomBytes } from 'node:crypto';
import { and, asc, count, eq, gt, inArray, isNull } from 'drizzle-orm';
import { type Db, schema } from '@opencook/db';
import type {
  Household,
  HouseholdInvite,
  InvitePreview,
} from '@opencook/schemas';
import { HttpError, notFound } from './errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const INVITE_DAYS = 7;

/**
 * The household a user cooks and shops with. Everyone is in exactly one:
 * it's created with the account, and joining another moves them across.
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

export function getHousehold(db: Db, householdId: string): Household {
  const h = db
    .select()
    .from(schema.household)
    .where(eq(schema.household.id, householdId))
    .get();
  if (!h) throw notFound('Household not found');
  const members = db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      role: schema.householdMember.role,
    })
    .from(schema.householdMember)
    .innerJoin(schema.user, eq(schema.user.id, schema.householdMember.userId))
    .where(eq(schema.householdMember.householdId, householdId))
    .orderBy(asc(schema.householdMember.createdAt))
    .all();
  return { id: h.id, name: h.name, members };
}

export function renameHousehold(db: Db, householdId: string, name: string) {
  db.update(schema.household)
    .set({ name })
    .where(eq(schema.household.id, householdId))
    .run();
  return getHousehold(db, householdId);
}

/** People in the same household, e.g. to find everyone's recipes. */
export function householdMemberIds(db: Db, householdId: string): string[] {
  return db
    .select({ id: schema.householdMember.userId })
    .from(schema.householdMember)
    .where(eq(schema.householdMember.householdId, householdId))
    .all()
    .map((m) => m.id);
}

export function createHouseholdInvite(
  db: Db,
  householdId: string,
  userId: string,
): HouseholdInvite {
  const [invite] = db
    .insert(schema.householdInvite)
    .values({
      householdId,
      code: randomBytes(12).toString('base64url'),
      createdBy: userId,
      expiresAt: new Date(Date.now() + INVITE_DAYS * DAY_MS),
    })
    .returning()
    .all();
  return { code: invite.code, expiresAt: invite.expiresAt.toISOString() };
}

function usableInvite(db: Db, code: string) {
  const invite = db
    .select()
    .from(schema.householdInvite)
    .where(
      and(
        eq(schema.householdInvite.code, code),
        isNull(schema.householdInvite.usedAt),
        gt(schema.householdInvite.expiresAt, new Date()),
      ),
    )
    .get();
  if (!invite) {
    throw new HttpError(
      404,
      'This invite link has expired or was already used. Ask for a new one.',
    );
  }
  return invite;
}

export function previewInvite(
  db: Db,
  userId: string,
  code: string,
): InvitePreview {
  const invite = usableInvite(db, code);
  const h = getHousehold(db, invite.householdId);
  const by = invite.createdBy
    ? db
        .select({ name: schema.user.name })
        .from(schema.user)
        .where(eq(schema.user.id, invite.createdBy))
        .get()
    : undefined;
  return {
    householdName: h.name,
    invitedBy: by?.name ?? null,
    alreadyMember: h.members.some((m) => m.id === userId),
  };
}

/**
 * Moves someone into the invite's household. Whatever was still to buy on
 * their old ongoing list comes with them (via `carryOver`), and a household
 * left with nobody in it is removed.
 */
export function joinHousehold(
  db: Db,
  userId: string,
  code: string,
  carryOver: (fromHouseholdId: string, toHouseholdId: string) => void,
): string {
  const invite = usableInvite(db, code);
  const current = householdOf(db, userId);
  if (current === invite.householdId) return current;
  carryOver(current, invite.householdId);
  db.transaction((tx) => {
    tx.delete(schema.householdMember)
      .where(eq(schema.householdMember.userId, userId))
      .run();
    tx.insert(schema.householdMember)
      .values({ householdId: invite.householdId, userId, role: 'member' })
      .run();
    tx.update(schema.householdInvite)
      .set({ usedAt: new Date(), usedBy: userId })
      .where(eq(schema.householdInvite.id, invite.id))
      .run();
    removeIfEmpty(tx, current);
  });
  return invite.householdId;
}

/** Leaves a shared household for a new one of their own. */
export function leaveHousehold(db: Db, userId: string): string {
  const current = householdOf(db, userId);
  const [{ n }] = db
    .select({ n: count() })
    .from(schema.householdMember)
    .where(eq(schema.householdMember.householdId, current))
    .all();
  if (n <= 1)
    throw new HttpError(422, "You're the only one in this household.");
  db.transaction((tx) => {
    tx.delete(schema.householdMember)
      .where(eq(schema.householdMember.userId, userId))
      .run();
    // Someone has to own what's left.
    const owner = tx
      .select()
      .from(schema.householdMember)
      .where(
        and(
          eq(schema.householdMember.householdId, current),
          eq(schema.householdMember.role, 'owner'),
        ),
      )
      .get();
    if (!owner) {
      const next = tx
        .select()
        .from(schema.householdMember)
        .where(eq(schema.householdMember.householdId, current))
        .orderBy(asc(schema.householdMember.createdAt))
        .get();
      if (next) {
        tx.update(schema.householdMember)
          .set({ role: 'owner' })
          .where(
            and(
              eq(schema.householdMember.householdId, current),
              eq(schema.householdMember.userId, next.userId),
            ),
          )
          .run();
      }
    }
  });
  return createHousehold(db, userId);
}

function removeIfEmpty(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  householdId: string,
) {
  const left = tx
    .select({ id: schema.householdMember.userId })
    .from(schema.householdMember)
    .where(eq(schema.householdMember.householdId, householdId))
    .get();
  if (!left) {
    tx.delete(schema.household)
      .where(eq(schema.household.id, householdId))
      .run();
  }
}

/** Recipes owned by anyone in the household. */
export function householdRecipeIds(db: Db, householdId: string): string[] {
  const members = householdMemberIds(db, householdId);
  if (!members.length) return [];
  return db
    .select({ id: schema.recipe.id })
    .from(schema.recipe)
    .where(inArray(schema.recipe.ownerId, members))
    .all()
    .map((r) => r.id);
}
