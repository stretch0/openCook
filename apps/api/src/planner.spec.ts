import { eq } from 'drizzle-orm';
import { type Db, schema } from '@opencook/db';
import { type App, get, json, send, setup, signUp } from './test-utils.js';

type Need = {
  key: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  status: string;
  reason: string | null;
  sources: { title: string; servings?: number }[];
};

async function recipe(app: App, cookie: string, body: object) {
  const res = await send(app, cookie, 'POST', '/api/recipes', body);
  expect(res.status).toBe(201);
  return (await res.json()) as {
    id: string;
    title: string;
    ingredients: { itemId: string; name: string }[];
  };
}

function householdOf(db: Db, email: string) {
  const user = db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .get();
  return db
    .select()
    .from(schema.householdMember)
    .where(eq(schema.householdMember.userId, user?.id ?? ''))
    .get()?.householdId as string;
}

/** Pretends the household bought something on these days ago. */
function bought(
  db: Db,
  householdId: string,
  itemId: string,
  daysAgo: number[],
) {
  for (const d of daysAgo) {
    db.insert(schema.purchaseEvent)
      .values({
        householdId,
        itemId,
        name: 'x',
        quantity: 1,
        unit: 'l',
        purchasedAt: new Date(Date.now() - d * 86_400_000),
      })
      .run();
  }
}

describe('meal plan', () => {
  it('plans a week, moves meals and logs cooking', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const curry = await recipe(app, cookie, {
      title: 'Curry',
      servings: 4,
      ingredients: ['1 onion'],
    });

    const add = await send(app, cookie, 'POST', '/api/plan', {
      date: '2026-11-17',
      recipeId: curry.id,
      servings: 6,
    });
    expect(add.status).toBe(201);
    const entry = (await add.json()) as { id: string };
    await send(app, cookie, 'POST', '/api/plan', {
      date: '2026-11-18',
      title: 'Leftovers',
    });
    await send(app, cookie, 'POST', '/api/plan', {
      date: '2026-11-16',
      slot: 'lunch',
      title: 'Soup',
    });
    expect(
      (await send(app, cookie, 'POST', '/api/plan', { date: '2026-11-18' }))
        .status,
    ).toBe(400);

    const week = await json(
      await get(app, '/api/plan?from=2026-11-16', cookie),
    );
    expect(week).toMatchObject({ from: '2026-11-16', to: '2026-11-22' });
    expect(
      (week.entries as { title: string; slot: string }[]).map((e) => e.title),
    ).toEqual(['Soup', 'Curry', 'Leftovers']);
    expect((week.entries as object[])[1]).toMatchObject({
      servings: 6,
      recipeServings: 4,
    });

    const moved = await json(
      await send(app, cookie, 'PATCH', `/api/plan/${entry.id}`, {
        date: '2026-11-19',
        cooked: true,
      }),
    );
    expect(moved).toMatchObject({ date: '2026-11-19' });
    expect(moved.cookedAt).toBeTruthy();
    expect(
      (await json(await get(app, `/api/recipes/${curry.id}`, cookie)))
        .timesCooked,
    ).toBe(1);

    expect(
      (await send(app, cookie, 'DELETE', `/api/plan/${entry.id}`)).status,
    ).toBe(204);
  });

  it('is shared within a household, recipes included', async () => {
    const { app } = setup();
    const andrew = await signUp(app, 'andrew@example.com');
    const sam = await signUp(app, 'sam@example.com');
    const { code } = (await (
      await send(app, andrew.cookie, 'POST', '/api/household/invites')
    ).json()) as {
      code: string;
    };
    await send(app, sam.cookie, 'POST', '/api/household/join', { code });

    // Sam plans a private recipe of their own; Andrew can see it and shop for it.
    const dal = await recipe(app, sam.cookie, {
      title: 'Dal',
      ingredients: ['200 g red lentils'],
    });
    await send(app, sam.cookie, 'POST', '/api/plan', {
      date: '2026-11-17',
      recipeId: dal.id,
    });
    const plan = await json(
      await get(app, '/api/plan?from=2026-11-16', andrew.cookie),
    );
    expect((plan.entries as { title: string }[])[0].title).toBe('Dal');
    expect(
      (await get(app, `/api/recipes/${dal.id}`, andrew.cookie)).status,
    ).toBe(200);
    // Only Sam can change it.
    expect(
      (
        await send(app, andrew.cookie, 'PUT', `/api/recipes/${dal.id}`, {
          title: 'Mine',
        })
      ).status,
    ).toBe(403);

    // Someone outside the household can't.
    const other = await signUp(app, 'other@example.com');
    expect(
      (await get(app, `/api/recipes/${dal.id}`, other.cookie)).status,
    ).toBe(404);
    expect(
      (
        (await json(await get(app, '/api/plan?from=2026-11-16', other.cookie)))
          .entries as unknown[]
      ).length,
    ).toBe(0);
  });
});

describe('shopping for the plan', () => {
  it('adds up the week and sorts what to buy from what you probably have', async () => {
    const { app, db } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const household = householdOf(db, 'cook@example.com');
    const curry = await recipe(app, cookie, {
      title: 'Curry',
      servings: 2,
      ingredients: [
        '1 onion',
        '400 ml coconut milk',
        '1 tsp cumin',
        'Salt, to taste',
        '1 tsp chilli flakes (optional)',
      ],
    });
    const soup = await recipe(app, cookie, {
      title: 'Soup',
      servings: 4,
      ingredients: ['2 onions', '1 l milk', '1 tsp cumin'],
    });
    await send(app, cookie, 'POST', '/api/plan', {
      date: '2026-11-17',
      recipeId: curry.id,
      servings: 4,
    });
    await send(app, cookie, 'POST', '/api/plan', {
      date: '2026-11-19',
      recipeId: soup.id,
    });
    // Outside the range: not counted.
    await send(app, cookie, 'POST', '/api/plan', {
      date: '2026-11-30',
      recipeId: soup.id,
    });

    // Cumin is a staple; milk was bought two days ago and lasts about a week.
    await send(app, cookie, 'PATCH', '/api/pantry', { addStaples: ['cumin'] });
    const milk = soup.ingredients.find((i) => i.name === 'milk')
      ?.itemId as string;
    bought(db, household, milk, [23, 16, 9, 2]);
    // Coconut milk is already on the list.
    await send(app, cookie, 'POST', '/api/lists/ongoing/items', {
      items: ['coconut milk'],
    });

    const res = await send(app, cookie, 'POST', '/api/plan/shopping/preview', {
      from: '2026-11-16',
      to: '2026-11-22',
    });
    expect(res.status).toBe(200);
    const needs = (await res.json()) as Need[];
    const byName = Object.fromEntries(needs.map((n) => [n.name, n]));
    expect(Object.keys(byName).sort()).toEqual([
      'Coconut milk',
      'Cumin',
      'Milk',
      'Onion',
      'Salt',
    ]);
    // 1 onion for 2, doubled for 4, plus 2 from the soup.
    expect(byName.Onion).toMatchObject({
      quantity: 4,
      status: 'need',
      reason: null,
    });
    expect(byName.Onion.sources.map((s) => s.title)).toEqual(['Curry', 'Soup']);
    expect(byName.Cumin).toMatchObject({
      quantity: 3,
      unit: 'tsp',
      status: 'probably_have',
      reason: 'You always have this',
    });
    expect(byName.Milk).toMatchObject({
      status: 'probably_have',
      reason: 'Bought 2 days ago; usually lasts about 7 days',
    });
    expect(byName['Coconut milk'].status).toBe('already_on_list');
    expect(byName.Salt).toMatchObject({ quantity: null, status: 'need' });

    // Adding takes the "need" lines unless told otherwise.
    const added = (await (
      await send(app, cookie, 'POST', '/api/plan/shopping/add', {
        selection: { from: '2026-11-16', to: '2026-11-22' },
      })
    ).json()) as {
      listItem: {
        name: string;
        quantity: number;
        sources: { title: string }[];
      };
    }[];
    expect(added.map((a) => a.listItem.name).sort()).toEqual(['Onion', 'Salt']);
    expect(
      added
        .find((a) => a.listItem.name === 'Onion')
        ?.listItem.sources.map((s) => s.title),
    ).toEqual(['Curry', 'Soup']);

    // Or exactly the chosen ones.
    const milkKey = byName.Milk.key;
    const more = (await (
      await send(app, cookie, 'POST', '/api/plan/shopping/add', {
        selection: { recipes: [{ recipeId: soup.id }] },
        include: [milkKey],
      })
    ).json()) as { listItem: { name: string } }[];
    expect(more.map((a) => a.listItem.name)).toEqual(['Milk']);
  });

  it('skips meals already cooked', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const r = await recipe(app, cookie, {
      title: 'Toast',
      ingredients: ['2 slices bread'],
    });
    const e = (await (
      await send(app, cookie, 'POST', '/api/plan', {
        date: '2026-11-17',
        recipeId: r.id,
      })
    ).json()) as {
      id: string;
    };
    await send(app, cookie, 'PATCH', `/api/plan/${e.id}`, { cooked: true });
    const needs = await (
      await send(app, cookie, 'POST', '/api/plan/shopping/preview', {
        from: '2026-11-16',
        to: '2026-11-22',
      })
    ).json();
    expect(needs).toEqual([]);
  });
});

describe('pantry', () => {
  it('offers common staples and remembers the ones ticked', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const before = await json(await get(app, '/api/pantry', cookie));
    const suggested = before.suggestedStaples as {
      itemId: string;
      name: string;
    }[];
    expect(suggested.map((s) => s.name)).toEqual(
      expect.arrayContaining(['salt', 'olive oil', 'cumin']),
    );

    const salt = suggested.find((s) => s.name === 'salt')?.itemId as string;
    const after = await json(
      await send(app, cookie, 'PATCH', '/api/pantry', {
        addStaples: [salt, 'Olive Oil'],
        status: [{ item: 'eggs', status: 'low' }],
      }),
    );
    expect(after.items).toEqual([
      expect.objectContaining({ name: 'egg', staple: false, status: 'low' }),
      expect.objectContaining({
        name: 'olive oil',
        staple: true,
        status: 'have',
      }),
      expect.objectContaining({ name: 'salt', staple: true, status: 'have' }),
    ]);
    expect(
      (after.suggestedStaples as { name: string }[]).map((s) => s.name),
    ).not.toContain('salt');

    // Buying eggs puts them back to "have", and the row goes.
    const [eggs] = (await (
      await send(app, cookie, 'POST', '/api/lists/ongoing/items', {
        items: ['eggs'],
      })
    ).json()) as {
      listItem: { id: string };
    }[];
    await send(app, cookie, 'POST', '/api/lists/ongoing/check', {
      ids: [eggs.listItem.id],
    });
    const later = await json(await get(app, '/api/pantry', cookie));
    expect(
      (later.items as { name: string; status: string }[]).find(
        (i) => i.name === 'egg',
      )?.status,
    ).toBe('have');
  });

  it('suggests restocking what is usually bought by now', async () => {
    const { app, db } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const household = householdOf(db, 'cook@example.com');
    const [milk, bread] = (await (
      await send(app, cookie, 'POST', '/api/lists/ongoing/items', {
        items: ['milk', 'bread'],
      })
    ).json()) as { listItem: { id: string; itemId: string } }[];
    await send(app, cookie, 'POST', '/api/lists/ongoing/remove', {
      ids: [milk.listItem.id, bread.listItem.id],
    });
    bought(db, household, milk.listItem.itemId, [27, 20, 13, 6]); // weekly, 6 days ago: due
    bought(db, household, bread.listItem.itemId, [30, 20, 10, 1]); // every 10 days, yesterday: not due

    const suggestions = (await (
      await get(app, '/api/pantry/restock', cookie)
    ).json()) as {
      name: string;
      intervalDays: number;
      daysSince: number;
    }[];
    expect(suggestions).toEqual([
      expect.objectContaining({
        name: 'Milk',
        intervalDays: 7,
        daysSince: 6,
        lastQuantity: 1,
        lastUnit: 'l',
      }),
    ]);

    // Once it's on the list, it isn't suggested.
    await send(app, cookie, 'POST', '/api/lists/ongoing/items', {
      items: ['milk'],
    });
    expect(
      await (await get(app, '/api/pantry/restock', cookie)).json(),
    ).toEqual([]);
  });
});
