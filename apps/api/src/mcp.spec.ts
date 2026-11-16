import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type App, send, setup, signUp } from './test-utils.js';

async function tokenFor(app: App, cookie: string, scopes: string[]) {
  const res = await send(app, cookie, 'POST', '/api/tokens', {
    name: 'Claude',
    scopes,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { token: string }).token;
}

async function connect(app: App, token: string) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL('http://localhost:3000/mcp'),
    {
      fetch: ((url: string | URL, init?: RequestInit) =>
        app.request(String(url), init)) as typeof fetch,
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    },
  );
  await client.connect(transport);
  return client;
}

function data(result: unknown) {
  const r = result as { content: { text: string }[]; isError?: boolean };
  if (r.isError) throw new Error(r.content[0].text);
  return JSON.parse(r.content[0].text);
}

describe('mcp', () => {
  it('needs a valid token', async () => {
    const { app } = setup();
    const res = await app.request('/mcp', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
    const bad = await app.request('/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer ock_nope' },
      body: '{}',
    });
    expect(bad.status).toBe(401);
  });

  it('only offers the tools a token allows', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const client = await connect(
      app,
      await tokenFor(app, cookie, ['recipes:read']),
    );
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('search_recipes');
    expect(names).not.toContain('create_recipe');
    expect(client.getInstructions()).toContain('Search before creating');
  });

  it('saves, scales, edits and finds recipes like the app does', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const client = await connect(
      app,
      await tokenFor(app, cookie, ['recipes:read', 'recipes:write']),
    );

    const created = data(
      await client.callTool({
        name: 'create_recipe',
        arguments: {
          title: 'Pancakes',
          servings: 4,
          tags: ['breakfast'],
          ingredients: [
            '200 g plain flour',
            '2 eggs',
            '300 ml milk',
            'pinch of salt',
          ],
          steps: [
            'Whisk 200 g flour with 300 ml milk and the eggs.',
            'Fry in batches.',
          ],
        },
      }),
    );
    expect(created).toMatchObject({
      title: 'Pancakes',
      servings: 4,
      yours: true,
    });

    const scaled = data(
      await client.callTool({
        name: 'get_recipe',
        arguments: { id: created.id, servings: 2 },
      }),
    );
    expect(scaled.ingredients.map((i: { amount: string }) => i.amount)).toEqual(
      ['100 g', '1', '150 ml', null],
    );
    expect(scaled.steps[0].text).toBe(
      'Whisk 100 g flour with 150 ml milk and the eggs.',
    );

    const found = data(
      await client.callTool({
        name: 'search_recipes',
        arguments: { query: 'flour' },
      }),
    );
    expect(found.map((r: { id: string }) => r.id)).toEqual([created.id]);

    // A partial update keeps everything not passed.
    const updated = data(
      await client.callTool({
        name: 'update_recipe',
        arguments: {
          id: created.id,
          title: 'Fluffy pancakes',
          expected_revision: 1,
        },
      }),
    );
    expect(updated).toMatchObject({ title: 'Fluffy pancakes', revision: 2 });
    expect(updated.ingredients).toHaveLength(4);

    const stale = (await client.callTool({
      name: 'update_recipe',
      arguments: { id: created.id, title: 'Again', expected_revision: 1 },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(stale.isError).toBe(true);
    expect(stale.content[0].text).toMatch(/changed since/);

    data(
      await client.callTool({
        name: 'add_recipe_note',
        arguments: { id: created.id, text: 'Rest the batter' },
      }),
    );
    data(
      await client.callTool({
        name: 'log_cooked',
        arguments: { id: created.id, rating: 4 },
      }),
    );
    const after = data(
      await client.callTool({
        name: 'get_recipe',
        arguments: { id: created.id },
      }),
    );
    expect(after).toMatchObject({
      your_note: 'Rest the batter',
      times_cooked: 1,
    });

    // Deleting needs confirmation.
    const unconfirmed = (await client.callTool({
      name: 'delete_recipe',
      arguments: { id: created.id },
    })) as { isError?: boolean };
    expect(unconfirmed.isError).toBe(true);
    data(
      await client.callTool({
        name: 'delete_recipe',
        arguments: { id: created.id, confirm: true },
      }),
    );
    expect(
      data(await client.callTool({ name: 'search_recipes', arguments: {} })),
    ).toEqual([]);
  });

  it('lists and revokes tokens', async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, 'cook@example.com');
    const token = await tokenFor(app, cookie, ['recipes:read']);
    const list = (await (
      await app.request('/api/tokens', { headers: { cookie } })
    ).json()) as {
      id: string;
      prefix: string;
    }[];
    expect(list).toHaveLength(1);
    expect(token.startsWith(list[0].prefix)).toBe(true);
    await send(app, cookie, 'DELETE', `/api/tokens/${list[0].id}`);
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });
});
