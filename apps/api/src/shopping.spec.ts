import { type App, get, json, send, setup, signUp } from './test-utils.js';

type Added = {
  entry: string;
  match: string;
  combined: boolean;
  listItem: {
    id: string;
    name: string;
    quantity: number | null;
    unit: string | null;
    category: string;
    itemId: string;
  };
  suggestions: { id: string; name: string }[];
};
type List = {
  id: string;
  items: Added['listItem'][];
  recentlyBought: Added['listItem'][];
};

async function add(
  app: App,
  cookie: string,
  items: unknown[],
  list = 'ongoing',
) {
  const res = await send(app, cookie, 'POST', `/api/lists/${list}/items`, {
    items,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Added[];
}

async function list(app: App, cookie: string, id = 'ongoing') {
  const res = await get(app, `/api/lists/${id}`, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as List;
}

describe('shopping list', () => {
  it('matches spellings, combines amounts and groups by aisle', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');

    const first = await add(app, cookie, [
      '2 x milk',
      'mouth wash',
      '200 g beef mince',
      'scallions',
    ]);
    expect(first.map((a) => [a.match, a.combined])).toEqual([
      ['exact', false],
      ['exact', false],
      ['exact', false],
      ['alias', false],
    ]);
    expect(first[0].listItem).toMatchObject({
      name: 'Milk',
      quantity: 2,
      unit: null,
      category: 'dairy',
    });
    expect(first[3].listItem.category).toBe('produce');

    // The same items again, spelt differently, add up instead of duplicating.
    const again = await add(app, cookie, [
      'Mouthwash',
      '1 kg ground beef',
      { name: 'milk', quantity: 1 },
    ]);
    expect(again.map((a) => a.combined)).toEqual([true, true, true]);
    const current = await list(app, cookie);
    expect(current.items).toHaveLength(4);
    const mince = current.items.find((i) => i.name === 'Beef mince');
    expect(mince).toMatchObject({ quantity: 1.2, unit: 'kg' });
    expect(current.items.find((i) => i.name === 'Milk')?.quantity).toBe(3);

    // Amounts that can't be added stay as separate lines.
    await add(app, cookie, ['2 cans tomatoes', '400 g tomatoes']);
    expect(
      (await list(app, cookie)).items.filter(
        (i) => i.itemId === again[0].listItem.itemId,
      ),
    ).toHaveLength(1);
    expect(
      (await list(app, cookie)).items.filter((i) => /tomato/i.test(i.name)),
    ).toHaveLength(2);
  });

  it('suggests close spellings and learns from a merge', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');

    const [typo] = await add(app, cookie, ['mouthwsh']);
    expect(typo.match).toBe('new');
    expect(typo.suggestions[0].name).toBe('mouthwash');

    const merged = await send(app, cookie, 'POST', '/api/items/merge', {
      from: typo.listItem.itemId,
      into: typo.suggestions[0].id,
    });
    expect(merged.status).toBe(200);
    // The line on the list now points at the kept item…
    const [line] = (await list(app, cookie)).items;
    expect(line.itemId).toBe(typo.suggestions[0].id);
    // …and the household's spelling is remembered.
    const [next] = await add(app, cookie, ['Mouthwsh']);
    expect(next).toMatchObject({ match: 'alias', combined: true });
  });

  it('remembers a household moving an item to another aisle', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const [tahini] = await add(app, cookie, ['tahini']);
    expect(tahini.listItem.category).toBe('pantry');
    const moved = await send(
      app,
      cookie,
      'PATCH',
      `/api/lists/ongoing/items/${tahini.listItem.id}`,
      {
        category: 'dairy',
        quantity: 2,
      },
    );
    expect(await json(moved)).toMatchObject({ category: 'dairy', quantity: 2 });

    // Only for this household: someone else still finds it in the cupboard aisle.
    const other = await signUp(app, 'other@example.com');
    const [theirs] = await add(app, other.cookie, ['tahini']);
    expect(theirs.listItem.category).toBe('pantry');
  });

  it('records a purchase when ticked off, and undoes it when unticked', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const [milk] = await add(app, cookie, ['2 l milk']);

    const ticked = await send(app, cookie, 'POST', '/api/lists/ongoing/check', {
      ids: [milk.listItem.id],
    });
    const after = (await ticked.json()) as List;
    expect(after.items).toHaveLength(0);
    expect(after.recentlyBought[0]).toMatchObject({
      name: 'Milk',
      quantity: 2,
      unit: 'l',
    });

    const history = (await (
      await get(app, `/api/purchases?itemId=${milk.listItem.itemId}`, cookie)
    ).json()) as {
      name: string;
      quantity: number;
      by: string;
      source: string;
    }[];
    expect(history).toEqual([
      expect.objectContaining({
        name: 'Milk',
        quantity: 2,
        by: 'cook',
        source: 'list',
      }),
    ]);

    await send(app, cookie, 'POST', '/api/lists/ongoing/check', {
      ids: [milk.listItem.id],
      checked: false,
    });
    expect((await list(app, cookie)).items).toHaveLength(1);
    expect(await (await get(app, '/api/purchases', cookie)).json()).toEqual([]);
  });

  it('adds a recipe’s ingredients, scaled, and says which recipe wanted them', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const recipe = (await (
      await send(app, cookie, 'POST', '/api/recipes', {
        title: 'Dal',
        servings: 2,
        ingredients: [
          '200 g red lentils',
          '2 cloves garlic',
          'Salt, to taste',
          '1 tsp chilli flakes (optional)',
        ],
      })
    ).json()) as { id: string };
    await add(app, cookie, ['100 g red lentils']);

    const res = await send(
      app,
      cookie,
      'POST',
      `/api/recipes/${recipe.id}/to-list`,
      { servings: 4 },
    );
    expect(res.status).toBe(201);
    const added = (await res.json()) as Added[];
    // Salt and the optional chilli are left off.
    expect(added.map((a) => a.listItem.name)).toEqual([
      'Red lentils',
      'Garlic',
    ]);
    const lentils = (await list(app, cookie)).items.find(
      (i) => i.name === 'Red lentils',
    );
    expect(lentils).toMatchObject({
      quantity: 500,
      unit: 'g',
      sources: [{ recipeId: recipe.id, title: 'Dal', servings: 4 }],
    });
  });

  it('keeps extra named lists separate and protects the ongoing one', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const bbq = (await (
      await send(app, cookie, 'POST', '/api/lists', { name: 'BBQ' })
    ).json()) as { id: string };
    await add(app, cookie, ['sausages'], bbq.id);
    const lists = (await (await get(app, '/api/lists', cookie)).json()) as {
      name: string;
      kind: string;
      remaining: number;
    }[];
    expect(lists.map((l) => [l.kind, l.name, l.remaining])).toEqual([
      ['ongoing', 'Shopping list', 0],
      ['named', 'BBQ', 1],
    ]);
    const ongoing = await list(app, cookie);
    expect(
      (await send(app, cookie, 'DELETE', `/api/lists/${ongoing.id}`)).status,
    ).toBe(422);
    expect(
      (await send(app, cookie, 'DELETE', `/api/lists/${bbq.id}`)).status,
    ).toBe(204);
  });
});

describe('households', () => {
  async function couple(app: App) {
    const andrew = await signUp(app, 'andrew@example.com');
    const sam = await signUp(app, 'sam@example.com');
    return { andrew, sam };
  }

  it('shares one list after joining with an invite link', async () => {
    const { app } = setup();
    const { andrew, sam } = await couple(app);
    await add(app, andrew.cookie, ['eggs']);
    await add(app, sam.cookie, ['bread']);

    const invite = (await (
      await send(app, andrew.cookie, 'POST', '/api/household/invites')
    ).json()) as { code: string };
    const preview = await json(
      await get(app, `/api/household/invites/${invite.code}`, sam.cookie),
    );
    expect(preview).toMatchObject({
      householdName: 'andrew’s kitchen',
      invitedBy: 'andrew',
      alreadyMember: false,
    });

    const joined = await json(
      await send(app, sam.cookie, 'POST', '/api/household/join', {
        code: invite.code,
      }),
    );
    expect((joined.members as { name: string }[]).map((m) => m.name)).toEqual([
      'andrew',
      'sam',
    ]);

    // Sam's bread came along, and both see the same list.
    const forAndrew = await list(app, andrew.cookie);
    const forSam = await list(app, sam.cookie);
    expect(forAndrew.id).toBe(forSam.id);
    expect(forAndrew.items.map((i) => i.name).sort()).toEqual([
      'Bread',
      'Eggs',
    ]);

    // An invite works once.
    const third = await signUp(app, 'third@example.com');
    expect(
      (
        await send(app, third.cookie, 'POST', '/api/household/join', {
          code: invite.code,
        })
      ).status,
    ).toBe(404);
  });

  it("keeps other households' lists private", async () => {
    const { app } = setup();
    const { andrew, sam } = await couple(app);
    const mine = await list(app, andrew.cookie);
    expect((await get(app, `/api/lists/${mine.id}`, sam.cookie)).status).toBe(
      404,
    );
    expect(
      (
        await send(app, sam.cookie, 'POST', `/api/lists/${mine.id}/items`, {
          items: ['x'],
        })
      ).status,
    ).toBe(404);
  });

  it('lets someone leave for a household of their own', async () => {
    const { app } = setup();
    const { andrew, sam } = await couple(app);
    const { code } = (await (
      await send(app, andrew.cookie, 'POST', '/api/household/invites')
    ).json()) as { code: string };
    await send(app, sam.cookie, 'POST', '/api/household/join', { code });
    const left = await json(
      await send(app, sam.cookie, 'POST', '/api/household/leave'),
    );
    expect((left.members as unknown[]).length).toBe(1);
    expect(
      (await send(app, andrew.cookie, 'POST', '/api/household/leave')).status,
    ).toBe(422);
  });
});

describe('live updates', () => {
  it('tells an open list page when someone else changes the list', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const res = await get(app, '/api/lists/ongoing/events', cookie);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const readUntil = async (marker: string) => {
      let text = '';
      while (!text.includes(marker)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
      return text;
    };
    expect(await readUntil('event: ready')).toContain('event: ready');
    await add(app, cookie, ['bananas']);
    expect(await readUntil('event: changed')).toContain('event: changed');
    await reader.cancel();
  });
});
