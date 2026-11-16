import sharp from 'sharp';
import { type App, get, json, send, setup, signUp } from './test-utils.js';

async function createRecipe(app: App, cookie: string, body: object = {}) {
  const res = await send(app, cookie, 'POST', '/api/recipes', {
    title: 'Garlic pasta',
    servings: 2,
    tags: ['Quick', 'pasta'],
    ingredients: [
      '200 g spaghetti',
      '3 cloves garlic, sliced',
      'Salt, to taste',
    ],
    steps: ['Boil 200 g spaghetti.', 'Fry the garlic in 2 tbsp oil.'],
    ...body,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Record<string, any>;
}

describe('recipes', () => {
  it('creates a recipe from ingredient lines and links them to items', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const recipe = await createRecipe(app, cookie);

    expect(recipe).toMatchObject({
      title: 'Garlic pasta',
      servings: 2,
      tags: ['quick', 'pasta'],
      visibility: 'private',
      mine: true,
      revision: 1,
    });
    expect(recipe.ingredients[1]).toMatchObject({
      quantity: 3,
      unit: 'clove',
      name: 'garlic',
      preparation: 'sliced',
      scaling: 'linear',
    });
    expect(recipe.ingredients[2]).toMatchObject({
      name: 'Salt',
      scaling: 'to_taste',
    });
    // "garlic" is in the shared catalogue; every ingredient gets an item.
    const garlic = await json(
      await get(app, '/api/items/match?name=Garlic', cookie),
    );
    expect(recipe.ingredients[1].itemId).toBe(
      (garlic.match as { id: string }).id,
    );
    expect(recipe.steps).toHaveLength(2);
  });

  it('lists, searches and filters by tag', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    await createRecipe(app, cookie);
    await createRecipe(app, cookie, {
      title: 'Tomato soup',
      tags: ['soup'],
      ingredients: ['1 kg tomatoes'],
    });

    const all = (await (
      await get(app, '/api/recipes', cookie)
    ).json()) as unknown[];
    expect(all).toHaveLength(2);
    const byIngredient = (await (
      await get(app, '/api/recipes?q=tomato', cookie)
    ).json()) as { title: string }[];
    expect(byIngredient.map((r) => r.title)).toEqual(['Tomato soup']);
    const byTag = (await (
      await get(app, '/api/recipes?tag=PASTA', cookie)
    ).json()) as { title: string }[];
    expect(byTag.map((r) => r.title)).toEqual(['Garlic pasta']);
    const tags = await (await get(app, '/api/recipes/tags', cookie)).json();
    expect(tags).toContainEqual({ tag: 'pasta', count: 1 });
  });

  it('keeps private recipes private and lets others fork public ones', async () => {
    const { app } = setup();
    const alice = await signUp(app, 'alice@example.com');
    const bob = await signUp(app, 'bob@example.com');
    const secret = await createRecipe(app, alice.cookie);
    const shared = await createRecipe(app, alice.cookie, {
      title: 'Shared',
      visibility: 'public',
    });

    expect(
      (await get(app, `/api/recipes/${secret.id}`, bob.cookie)).status,
    ).toBe(404);
    const visible = (await (
      await get(app, '/api/recipes?scope=all', bob.cookie)
    ).json()) as { id: string }[];
    expect(visible.map((r) => r.id)).toEqual([shared.id]);

    // Bob can't edit Alice's recipe, but can copy it.
    const edit = await send(
      app,
      bob.cookie,
      'PUT',
      `/api/recipes/${shared.id}`,
      { title: 'Mine now' },
    );
    expect(edit.status).toBe(403);
    const fork = await send(
      app,
      bob.cookie,
      'POST',
      `/api/recipes/${shared.id}/fork`,
    );
    expect(fork.status).toBe(201);
    const copy = (await fork.json()) as Record<string, any>;
    expect(copy).toMatchObject({
      title: 'Shared',
      mine: true,
      visibility: 'private',
      forkedFrom: { id: shared.id, owner: { name: 'alice' } },
    });
    expect(copy.ingredients).toHaveLength(3);
  });

  it('detects conflicting edits with the revision', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const recipe = await createRecipe(app, cookie);
    const body = {
      title: 'Better pasta',
      servings: 4,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
    };

    const first = await send(app, cookie, 'PUT', `/api/recipes/${recipe.id}`, {
      ...body,
      expectedRevision: 1,
    });
    expect(first.status).toBe(200);
    const updated = (await first.json()) as Record<string, any>;
    expect(updated).toMatchObject({ title: 'Better pasta', revision: 2 });
    // Ingredient ids survive an edit, so steps can keep referring to them.
    expect(updated.ingredients.map((i: { id: string }) => i.id)).toEqual(
      recipe.ingredients.map((i: { id: string }) => i.id),
    );

    const stale = await send(app, cookie, 'PUT', `/api/recipes/${recipe.id}`, {
      ...body,
      expectedRevision: 1,
    });
    expect(stale.status).toBe(409);
  });

  it('keeps a private note and a cooking history per person', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const recipe = await createRecipe(app, cookie);

    await send(app, cookie, 'PUT', `/api/recipes/${recipe.id}/note`, {
      text: 'Less salt',
    });
    await send(app, cookie, 'POST', `/api/recipes/${recipe.id}/cooked`, {
      rating: 5,
    });
    const again = await json(
      await get(app, `/api/recipes/${recipe.id}`, cookie),
    );
    expect(again).toMatchObject({ note: 'Less salt', timesCooked: 1 });
    expect(again.lastCookedAt).toBeTruthy();

    await send(app, cookie, 'PUT', `/api/recipes/${recipe.id}/note`, {
      text: '',
    });
    expect(
      (await json(await get(app, `/api/recipes/${recipe.id}`, cookie))).note,
    ).toBeNull();
  });

  it('deletes recipes', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const recipe = await createRecipe(app, cookie);
    expect(
      (await send(app, cookie, 'DELETE', `/api/recipes/${recipe.id}`)).status,
    ).toBe(204);
    expect((await get(app, `/api/recipes/${recipe.id}`, cookie)).status).toBe(
      404,
    );
  });

  it('rejects unknown units from structured ingredients', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const res = await send(app, cookie, 'POST', '/api/recipes', {
      title: 'X',
      ingredients: [{ name: 'flour', quantity: 1, unit: 'furlong' }],
    });
    expect(res.status).toBe(422);
    const ok = await send(app, cookie, 'POST', '/api/recipes', {
      title: 'Y',
      ingredients: [{ name: 'flour', quantity: 2, unit: 'Tablespoons' }],
    });
    expect(((await ok.json()) as Record<string, any>).ingredients[0].unit).toBe(
      'tbsp',
    );
  });
});

describe('images', () => {
  it('stores uploads as WebP and serves them', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const png = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: '#c33' },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append(
      'file',
      new File([new Uint8Array(png)], 'dish.png', { type: 'image/png' }),
    );
    const res = await app.request('/api/images', {
      method: 'POST',
      headers: { cookie, origin: 'http://localhost:3000' },
      body: form,
    });
    expect(res.status).toBe(201);
    const image = (await res.json()) as {
      id: string;
      url: string;
      width: number;
    };
    expect(image.width).toBe(1600);

    const served = await app.request(image.url);
    expect(served.headers.get('content-type')).toBe('image/webp');
    const recipe = await createRecipe(app, cookie, { imageId: image.id });
    expect(recipe.imageUrl).toBe(image.url);
  });

  it('needs an account to upload and rejects non-images', async () => {
    const { app } = setup();
    const form = new FormData();
    form.append('file', new File(['hello'], 'a.txt'));
    expect(
      (await app.request('/api/images', { method: 'POST', body: form })).status,
    ).toBe(401);
    const { cookie } = await signUp(app, 'cook@example.com');
    const bad = new FormData();
    bad.append('file', new File(['hello'], 'a.txt'));
    const res = await app.request('/api/images', {
      method: 'POST',
      headers: { cookie, origin: 'http://localhost:3000' },
      body: bad,
    });
    expect(res.status).toBe(422);
  });
});

describe('items', () => {
  it('matches spellings and suggests close ones', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const exact = await json(
      await get(app, '/api/items/match?name=Mouth%20Wash', cookie),
    );
    expect(exact.match).toMatchObject({
      name: 'mouthwash',
      category: 'personal',
      shared: true,
    });
    const alias = await json(
      await get(app, '/api/items/match?name=Scallions', cookie),
    );
    expect(alias.match).toMatchObject({ name: 'spring onion' });
    const typo = await json(
      await get(app, '/api/items/match?name=mouthwsh', cookie),
    );
    expect(typo.match).toBeNull();
    expect((typo.suggestions as { name: string }[])[0].name).toBe('mouthwash');
    const typed = (await (
      await get(app, '/api/items?q=toma', cookie)
    ).json()) as { name: string }[];
    expect(typed[0].name).toBe('tomato');
  });
});

describe('import', () => {
  it('refuses to fetch private addresses', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const res = await send(app, cookie, 'POST', '/api/recipes/import', {
      url: 'http://127.0.0.1:3000/',
    });
    expect(res.status).toBe(502);
    expect((await json(res)).error).toMatch(/public internet/);
  });
});
