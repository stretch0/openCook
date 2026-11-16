import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

// Later tests reuse the first session: signing in every test trips the
// auth rate limit.
const authFile = join(tmpdir(), `opencook-e2e-auth-${process.pid}.json`);

const cook = {
  name: 'Ada Cook',
  email: 'ada@example.com',
  password: 'correct horse battery',
};

test('first visit sets up the admin account', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Set up openCook' }),
  ).toBeVisible();
  await page.getByLabel('Name').fill(cook.name);
  await page.getByLabel('Email').fill(cook.email);
  await page.getByLabel('Password').fill(cook.password);
  await page.getByRole('button', { name: 'Create admin account' }).click();

  await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
  await expect(page.getByText('Your recipe book is empty')).toBeVisible();
  await page.context().storageState({ path: authFile });
});

test.describe('signed in', () => {
  test.use({ storageState: authFile });

  test('writes a recipe, scales it and cooks it', async ({ page }) => {
    await page.goto('/recipes/new');
    await page.getByLabel('Title').fill('Weeknight dal');
    await page.getByLabel('Serves').fill('2');
    await page
      .getByLabel('Ingredients')
      .fill(
        '200 g red lentils\n1 tbsp oil\n2 cloves garlic, crushed\nSalt, to taste',
      );
    await page
      .getByLabel('Method')
      .fill(
        'Rinse 200 g lentils.\nFry the garlic in 1 tbsp oil, then simmer for 20 minutes.',
      );
    await page.getByLabel('Tags').fill('quick, vegan');
    await page.getByRole('button', { name: 'Save recipe' }).click();

    await expect(
      page.getByRole('heading', { name: 'Weeknight dal' }),
    ).toBeVisible();
    const ingredients = page.locator('section', {
      has: page.getByRole('heading', { name: 'Ingredients' }),
    });
    await expect(ingredients.getByText('200 g')).toBeVisible();

    // Doubling the servings doubles the amounts, in the method too.
    await page.getByRole('button', { name: 'More servings' }).click();
    await page.getByRole('button', { name: 'More servings' }).click();
    await expect(ingredients.getByText('400 g')).toBeVisible();
    await expect(ingredients.getByText('4 cloves')).toBeVisible();
    await expect(page.getByText('Rinse 400 g lentils.')).toBeVisible();
    await expect(
      page.locator('ol').getByText('2 tbsp', { exact: true }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Start cooking' }).click();
    await expect(page.getByText('Step 1 of 2')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(
      page.getByRole('button', { name: 'Start 20 minutes timer' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Start 20 minutes timer' }).click();
    await expect(
      page.getByRole('button', { name: /Step 2 timer/ }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.getByRole('button', { name: 'Log that I cooked this' }).click();
    await expect(page.getByRole('button', { name: 'Logged ✓' })).toBeVisible();
  });

  test('finds recipes by ingredient and tag', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Search recipes').fill('lentil');
    await expect(
      page.getByRole('link', { name: /Weeknight dal/ }),
    ).toBeVisible();
    await page.getByLabel('Search recipes').fill('');
    await page.getByRole('button', { name: 'vegan' }).click();
    await expect(
      page.getByRole('link', { name: /Weeknight dal/ }),
    ).toBeVisible();
  });

  test('edits a recipe and keeps a private note', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Weeknight dal/ }).click();
    await page.getByRole('button', { name: 'Add a note' }).click();
    await page.getByLabel('My notes').fill('Add a squeeze of lime');
    await page.getByRole('button', { name: 'Save note' }).click();
    await expect(page.getByText('Add a squeeze of lime')).toBeVisible();

    await page.getByRole('link', { name: 'Edit' }).click();
    await expect(page.getByLabel('Ingredients')).toHaveValue(
      /2 cloves garlic, crushed/,
    );
    await page.getByLabel('Title').fill('Weeknight red lentil dal');
    await page.getByRole('button', { name: 'Save recipe' }).click();
    await expect(
      page.getByRole('heading', { name: 'Weeknight red lentil dal' }),
    ).toBeVisible();
  });

  test('creates a token for an AI assistant', async ({ page }) => {
    await page.goto('/settings');
    await page.getByLabel('New token name').fill('Claude');
    await page.getByRole('button', { name: 'Create token' }).click();
    await expect(
      page.getByText("Copy your token now. It won't be shown again."),
    ).toBeVisible();
    const token = await page
      .locator('code', { hasText: /^ock_/ })
      .first()
      .textContent();

    // The token works against the MCP endpoint.
    const res = await page.request.post('/mcp', {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.result.tools.map((t: { name: string }) => t.name)).toContain(
      'search_recipes',
    );
  });
});
