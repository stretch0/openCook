import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  max,
  or,
  sql,
} from 'drizzle-orm';
import { type Db, schema } from '@opencook/db';
import { parseIngredientLine, unitDef } from '@opencook/domain';
import {
  type CookLogEntry,
  type CookedInput,
  type Ingredient,
  type Recipe,
  type RecipeListQuery,
  type RecipeSummary,
  type Step,
  type UpdateRecipe,
  recipeInputSchema,
  recipeListQuerySchema,
  updateRecipeSchema,
} from '@opencook/schemas';
import { HttpError, notFound } from './errors.js';
import { imageUrl } from './images.js';
import { resolveItems } from './items.js';

/** Who is asking: their account and the household they cook with. */
export type Viewer = { userId: string; householdId: string };

type RecipeRow = typeof schema.recipe.$inferSelect;

/** Downloads a picture from the web and returns its image id. */
export type ImageFetcher = (url: string, ownerId: string) => Promise<string>;

const like_ = (s: string) => `%${s.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

/** Recipes the viewer can see: their own, and everyone's public ones. */
function visibleTo(viewer: Viewer) {
  return or(
    eq(schema.recipe.ownerId, viewer.userId),
    eq(schema.recipe.visibility, 'public'),
  );
}

export function listRecipes(
  db: Db,
  viewer: Viewer,
  query: RecipeListQuery = {},
): RecipeSummary[] {
  const q = recipeListQuerySchema.parse(query);
  const conditions = [
    q.scope === 'mine'
      ? eq(schema.recipe.ownerId, viewer.userId)
      : visibleTo(viewer),
  ];
  for (const word of (q.q ?? '').trim().split(/\s+/).filter(Boolean)) {
    const pattern = like_(word);
    conditions.push(
      or(
        sql`${schema.recipe.title} like ${pattern} escape '\\'`,
        sql`${schema.recipe.description} like ${pattern} escape '\\'`,
        sql`${schema.recipe.tags} like ${pattern} escape '\\'`,
        exists(
          db
            .select({ one: sql`1` })
            .from(schema.recipeIngredient)
            .where(
              and(
                eq(schema.recipeIngredient.recipeId, schema.recipe.id),
                sql`${schema.recipeIngredient.name} like ${pattern} escape '\\'`,
              ),
            ),
        ),
      ),
    );
  }
  if (q.tag) {
    conditions.push(
      sql`exists (select 1 from json_each(${schema.recipe.tags}) where lower(value) = ${q.tag.toLowerCase()})`,
    );
  }
  const rows = db
    .select({
      recipe: schema.recipe,
      ownerName: schema.user.name,
      hash: schema.image.hash,
    })
    .from(schema.recipe)
    .innerJoin(schema.user, eq(schema.user.id, schema.recipe.ownerId))
    .leftJoin(schema.image, eq(schema.image.id, schema.recipe.imageId))
    .where(and(...conditions))
    .orderBy(desc(schema.recipe.updatedAt))
    .limit(q.limit)
    .all();
  const cooked = lastCooked(
    db,
    viewer.userId,
    rows.map((r) => r.recipe.id),
  );
  return rows.map(({ recipe: r, ownerName }) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    servings: r.servings,
    totalMinutes:
      r.prepMinutes == null && r.cookMinutes == null
        ? null
        : (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0),
    tags: r.tags,
    visibility: r.visibility,
    imageUrl: imageUrl(r.imageId),
    owner: { id: r.ownerId, name: ownerName },
    lastCookedAt: cooked.get(r.id)?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

function lastCooked(db: Db, userId: string, recipeIds: string[]) {
  if (!recipeIds.length) return new Map<string, Date>();
  const rows = db
    .select({
      recipeId: schema.cookLog.recipeId,
      at: max(schema.cookLog.cookedAt),
    })
    .from(schema.cookLog)
    .where(
      and(
        eq(schema.cookLog.userId, userId),
        inArray(schema.cookLog.recipeId, recipeIds),
      ),
    )
    .groupBy(schema.cookLog.recipeId)
    .all();
  return new Map(
    rows.filter((r) => r.at).map((r) => [r.recipeId, r.at as Date]),
  );
}

function loadRow(db: Db, viewer: Viewer, id: string): RecipeRow {
  const row = db
    .select()
    .from(schema.recipe)
    .where(eq(schema.recipe.id, id))
    .get();
  // Unlisted recipes can be opened by anyone with the link.
  if (!row || (row.ownerId !== viewer.userId && row.visibility === 'private')) {
    throw notFound('Recipe not found');
  }
  return row;
}

function loadOwned(db: Db, viewer: Viewer, id: string): RecipeRow {
  const row = loadRow(db, viewer, id);
  if (row.ownerId !== viewer.userId) {
    throw new HttpError(
      403,
      'Only the owner can change this recipe. Fork it to make your own copy.',
    );
  }
  return row;
}

export function getRecipe(db: Db, viewer: Viewer, id: string): Recipe {
  const r = loadRow(db, viewer, id);
  const owner = db
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, r.ownerId))
    .get() ?? { id: r.ownerId, name: 'Unknown' };
  const ingredients = db
    .select()
    .from(schema.recipeIngredient)
    .where(eq(schema.recipeIngredient.recipeId, id))
    .orderBy(asc(schema.recipeIngredient.position))
    .all();
  const steps = db
    .select()
    .from(schema.recipeStep)
    .where(eq(schema.recipeStep.recipeId, id))
    .orderBy(asc(schema.recipeStep.position))
    .all();
  const note = db
    .select({ text: schema.recipeNote.text })
    .from(schema.recipeNote)
    .where(
      and(
        eq(schema.recipeNote.recipeId, id),
        eq(schema.recipeNote.userId, viewer.userId),
      ),
    )
    .get();
  const [cooks] = db
    .select({ n: count(), last: max(schema.cookLog.cookedAt) })
    .from(schema.cookLog)
    .where(
      and(
        eq(schema.cookLog.recipeId, id),
        eq(schema.cookLog.userId, viewer.userId),
      ),
    )
    .all();

  let forkedFrom: Recipe['forkedFrom'] = null;
  if (r.forkedFromId) {
    const parent = db
      .select({
        id: schema.recipe.id,
        title: schema.recipe.title,
        visibility: schema.recipe.visibility,
        ownerId: schema.user.id,
        ownerName: schema.user.name,
      })
      .from(schema.recipe)
      .innerJoin(schema.user, eq(schema.user.id, schema.recipe.ownerId))
      .where(eq(schema.recipe.id, r.forkedFromId))
      .get();
    if (
      parent &&
      (parent.visibility !== 'private' || parent.ownerId === viewer.userId)
    ) {
      forkedFrom = {
        id: parent.id,
        title: parent.title,
        owner: { id: parent.ownerId, name: parent.ownerName },
      };
    }
  }

  return {
    id: r.id,
    title: r.title,
    description: r.description,
    servings: r.servings,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    cuisine: r.cuisine,
    tags: r.tags,
    visibility: r.visibility,
    sourceUrl: r.sourceUrl,
    sourceName: r.sourceName,
    imageId: r.imageId,
    imageUrl: imageUrl(r.imageId),
    owner,
    mine: r.ownerId === viewer.userId,
    forkedFrom,
    ingredients: ingredients.map(
      ({ recipeId: _r, position: _p, ...i }): Ingredient => i,
    ),
    steps: steps.map((s): Step => ({
      section: s.section,
      text: s.text,
      timerSeconds: s.timerSeconds,
    })),
    note: note?.text ?? null,
    lastCookedAt: cooks?.last ? (cooks.last as Date).toISOString() : null,
    timesCooked: cooks?.n ?? 0,
    revision: r.revision,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

type ParsedInput = ReturnType<typeof recipeInputSchema.parse>;

/** Turns ingredient lines and partial objects into complete ingredients. */
function normaliseIngredients(
  db: Db,
  viewer: Viewer,
  input: ParsedInput['ingredients'],
): (Ingredient & { position: number })[] {
  const used = new Set<string>();
  const list = input.map((entry) => {
    if (typeof entry === 'string') {
      return {
        id: undefined as string | undefined,
        section: null,
        ...parseIngredientLine(entry),
      };
    }
    const unit = entry.unit
      ? unitDef(entry.unit)
        ? entry.unit
        : resolveUnitCode(entry.unit)
      : null;
    return {
      id: entry.id,
      section: entry.section ?? null,
      quantity: entry.quantity ?? null,
      quantityMax: entry.quantityMax ?? null,
      unit,
      name: entry.name,
      preparation: entry.preparation ?? null,
      note: entry.note ?? null,
      optional: entry.optional ?? false,
      scaling:
        entry.scaling ?? (entry.quantity == null ? 'to_taste' : 'linear'),
      rawText: entry.rawText ?? null,
    };
  });
  const items = resolveItems(
    db,
    viewer.householdId,
    list.map((i) => i.name),
  );
  return list.map((i, position) => {
    let id = i.id && !used.has(i.id) ? i.id : randomUUID().slice(0, 8);
    while (used.has(id)) id = randomUUID().slice(0, 8);
    used.add(id);
    return { ...i, id, position, itemId: items[position]?.item.id ?? null };
  });
}

/** Accepts unit spellings like "tablespoons" from agents and maps them to codes. */
function resolveUnitCode(unit: string): string | null {
  const parsed = parseIngredientLine(`1 ${unit} x`);
  if (!parsed.unit) {
    throw new HttpError(
      422,
      `Unknown unit "${unit}". Use a unit code like g, ml, tsp, tbsp, cup, clove, can, or leave it empty.`,
    );
  }
  return parsed.unit;
}

function normaliseSteps(input: ParsedInput['steps']) {
  return input.map((s, position) =>
    typeof s === 'string'
      ? { section: null, text: s, timerSeconds: null, position }
      : {
          section: s.section ?? null,
          text: s.text,
          timerSeconds: s.timerSeconds ?? null,
          position,
        },
  );
}

async function imageFor(
  db: Db,
  viewer: Viewer,
  input: ParsedInput,
  fetchImage: ImageFetcher | undefined,
): Promise<string | null | undefined> {
  if (input.imageId) {
    const img = db
      .select()
      .from(schema.image)
      .where(eq(schema.image.id, input.imageId))
      .get();
    if (!img) throw new HttpError(422, 'That image does not exist.');
    return img.id;
  }
  if (input.imageUrl && fetchImage) {
    try {
      return await fetchImage(input.imageUrl, viewer.userId);
    } catch (e) {
      // A recipe is still worth saving without its picture.
      console.warn(
        `Couldn't download recipe image: ${e instanceof Error ? e.message : e}`,
      );
      return null;
    }
  }
  return input.imageId === null ? null : undefined;
}

function writeChildren(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  recipeId: string,
  ingredients: ReturnType<typeof normaliseIngredients>,
  steps: ReturnType<typeof normaliseSteps>,
) {
  tx.delete(schema.recipeIngredient)
    .where(eq(schema.recipeIngredient.recipeId, recipeId))
    .run();
  tx.delete(schema.recipeStep)
    .where(eq(schema.recipeStep.recipeId, recipeId))
    .run();
  if (ingredients.length) {
    tx.insert(schema.recipeIngredient)
      .values(ingredients.map((i) => ({ ...i, recipeId })))
      .run();
  }
  if (steps.length) {
    tx.insert(schema.recipeStep)
      .values(steps.map((s) => ({ ...s, recipeId })))
      .run();
  }
}

export async function createRecipe(
  db: Db,
  viewer: Viewer,
  raw: unknown,
  { fetchImage }: { fetchImage?: ImageFetcher } = {},
): Promise<Recipe> {
  const input = recipeInputSchema.parse(raw);
  const imageId = await imageFor(db, viewer, input, fetchImage);
  const ingredients = normaliseIngredients(db, viewer, input.ingredients);
  const steps = normaliseSteps(input.steps);
  const id = db.transaction((tx) => {
    const [row] = tx
      .insert(schema.recipe)
      .values({
        ownerId: viewer.userId,
        title: input.title,
        description: input.description ?? null,
        servings: input.servings,
        prepMinutes: input.prepMinutes ?? null,
        cookMinutes: input.cookMinutes ?? null,
        cuisine: input.cuisine ?? null,
        tags: cleanTags(input.tags),
        visibility: input.visibility,
        sourceUrl: input.sourceUrl ?? null,
        sourceName: input.sourceName ?? null,
        imageId: imageId ?? null,
      })
      .returning()
      .all();
    writeChildren(tx, row.id, ingredients, steps);
    return row.id;
  });
  return getRecipe(db, viewer, id);
}

function cleanTags(tags: string[]) {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/** Replaces a recipe. With expectedRevision, fails if someone saved in between. */
export async function updateRecipe(
  db: Db,
  viewer: Viewer,
  id: string,
  raw: UpdateRecipe | unknown,
  { fetchImage }: { fetchImage?: ImageFetcher } = {},
): Promise<Recipe> {
  const { expectedRevision, ...input } = updateRecipeSchema.parse(raw);
  const current = loadOwned(db, viewer, id);
  if (expectedRevision !== undefined && expectedRevision !== current.revision) {
    throw new HttpError(409, 'This recipe was changed since you opened it.', {
      revision: current.revision,
    });
  }
  const imageId = await imageFor(db, viewer, input, fetchImage);
  const ingredients = normaliseIngredients(db, viewer, input.ingredients);
  const steps = normaliseSteps(input.steps);
  db.transaction((tx) => {
    tx.update(schema.recipe)
      .set({
        title: input.title,
        description: input.description ?? null,
        servings: input.servings,
        prepMinutes: input.prepMinutes ?? null,
        cookMinutes: input.cookMinutes ?? null,
        cuisine: input.cuisine ?? null,
        tags: cleanTags(input.tags),
        visibility: input.visibility,
        sourceUrl: input.sourceUrl ?? null,
        sourceName: input.sourceName ?? null,
        ...(imageId === undefined ? {} : { imageId }),
        revision: current.revision + 1,
      })
      .where(eq(schema.recipe.id, id))
      .run();
    writeChildren(tx, id, ingredients, steps);
  });
  return getRecipe(db, viewer, id);
}

export function deleteRecipe(db: Db, viewer: Viewer, id: string) {
  loadOwned(db, viewer, id);
  db.delete(schema.recipe).where(eq(schema.recipe.id, id)).run();
}

/** Sets (or, with empty text, removes) the viewer's private note. */
export function setNote(db: Db, viewer: Viewer, id: string, text: string) {
  loadRow(db, viewer, id);
  const where = and(
    eq(schema.recipeNote.recipeId, id),
    eq(schema.recipeNote.userId, viewer.userId),
  );
  if (!text.trim()) {
    db.delete(schema.recipeNote).where(where).run();
    return null;
  }
  db.insert(schema.recipeNote)
    .values({ recipeId: id, userId: viewer.userId, text })
    .onConflictDoUpdate({
      target: [schema.recipeNote.recipeId, schema.recipeNote.userId],
      set: { text, updatedAt: new Date() },
    })
    .run();
  return text;
}

export function logCooked(
  db: Db,
  viewer: Viewer,
  id: string,
  input: CookedInput,
): CookLogEntry {
  loadRow(db, viewer, id);
  const [row] = db
    .insert(schema.cookLog)
    .values({
      recipeId: id,
      userId: viewer.userId,
      cookedAt: input.cookedAt ? new Date(input.cookedAt) : new Date(),
      servings: input.servings ?? null,
      rating: input.rating ?? null,
      note: input.note ?? null,
    })
    .returning()
    .all();
  return toCookLog(row);
}

export function cookHistory(
  db: Db,
  viewer: Viewer,
  id: string,
): CookLogEntry[] {
  loadRow(db, viewer, id);
  return db
    .select()
    .from(schema.cookLog)
    .where(
      and(
        eq(schema.cookLog.recipeId, id),
        eq(schema.cookLog.userId, viewer.userId),
      ),
    )
    .orderBy(desc(schema.cookLog.cookedAt))
    .all()
    .map(toCookLog);
}

function toCookLog(r: typeof schema.cookLog.$inferSelect): CookLogEntry {
  return {
    id: r.id,
    cookedAt: r.cookedAt.toISOString(),
    servings: r.servings,
    rating: r.rating,
    note: r.note,
  };
}

/** Copies a recipe the viewer can see into their own, remembering where it came from. */
export function forkRecipe(
  db: Db,
  viewer: Viewer,
  id: string,
  instanceOrigin?: string,
): Recipe {
  const source = getRecipe(db, viewer, id);
  const newId = db.transaction((tx) => {
    const [row] = tx
      .insert(schema.recipe)
      .values({
        ownerId: viewer.userId,
        title: source.title,
        description: source.description,
        servings: source.servings,
        prepMinutes: source.prepMinutes,
        cookMinutes: source.cookMinutes,
        cuisine: source.cuisine,
        tags: source.tags,
        visibility: 'private',
        sourceUrl: source.sourceUrl,
        sourceName: source.sourceName,
        imageId: source.imageId,
        forkedFromId: source.id,
        origin: {
          recipeId: source.id,
          author: source.owner.name,
          instance: instanceOrigin,
          revision: source.revision,
        },
      })
      .returning()
      .all();
    writeChildren(
      tx,
      row.id,
      source.ingredients.map((i, position) => ({ ...i, position })),
      source.steps.map((s, position) => ({ ...s, position })),
    );
    return row.id;
  });
  return getRecipe(db, viewer, newId);
}

/** Every tag the viewer has used, most used first. */
export function listTags(
  db: Db,
  viewer: Viewer,
): { tag: string; count: number }[] {
  return db.all<{ tag: string; count: number }>(sql`
    select lower(value) as tag, count(*) as count
    from ${schema.recipe}, json_each(${schema.recipe.tags})
    where ${schema.recipe.ownerId} = ${viewer.userId}
    group by lower(value) order by count desc, tag`);
}
