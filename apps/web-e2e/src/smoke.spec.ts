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

test.describe('shared shopping list', () => {
  test('two people in one household see each other’s changes live', async ({
    browser,
  }) => {
    // Andrew (the admin from the first test) invites Sam.
    const andrewContext = await browser.newContext({ storageState: authFile });
    const andrew = await andrewContext.newPage();
    await andrew.goto('/settings');
    await andrew.getByRole('button', { name: 'Invite someone' }).click();
    const linkBox = andrew.locator('code', { hasText: '/join/' });
    await expect(linkBox).toHaveText(/\/join\/[\w-]+$/);
    const link = await linkBox.innerText();

    // Sam opens the link signed out, creates an account and is brought back.
    const samContext = await browser.newContext();
    const sam = await samContext.newPage();
    await sam.goto(new URL(link as string).pathname);
    await sam.getByRole('link', { name: 'Create an account' }).click();
    await sam.getByLabel('Name').fill('Sam');
    await sam.getByLabel('Email').fill('sam@example.com');
    await sam.getByLabel('Password').fill('correct horse battery');
    await sam.getByRole('button', { name: /Create/ }).click();
    await sam.getByRole('button', { name: /^Join / }).click();
    await expect(
      sam.getByRole('heading', { name: 'Shopping list' }),
    ).toBeVisible();

    // Andrew adds milk; it appears on Sam's phone without a reload.
    await andrew.goto('/list');
    await andrew.getByLabel('Add to list').fill('2 x milk');
    await andrew.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(andrew.getByText('Milk')).toBeVisible();
    await expect(
      sam.getByRole('checkbox', { name: 'Bought Milk' }),
    ).toBeVisible();

    // Adding "mouth wash" and then "Mouthwash" makes one line.
    await sam.getByLabel('Add to list').fill('mouth wash');
    await sam.getByRole('button', { name: 'Add', exact: true }).click();
    await sam.getByLabel('Add to list').fill('Mouthwash');
    await sam.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(
      andrew.getByRole('checkbox', { name: /^Bought mouth/i }),
    ).toHaveCount(1);

    // Sam ticks the milk off in the shop; it leaves Andrew's list too.
    // A ticked line leaves the list at once, so click rather than check().
    await sam.getByRole('checkbox', { name: 'Bought Milk' }).click();
    await expect(
      andrew.getByRole('checkbox', { name: 'Bought Milk' }),
    ).toHaveCount(0);
    await andrew.getByRole('button', { name: /Recently bought/ }).click();
    await expect(andrew.getByText('2 Milk')).toBeVisible();

    await andrewContext.close();
    await samContext.close();
  });

  test('adds a recipe’s ingredients to the list', async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile });
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('link', { name: /dal/i }).first().click();
    await page
      .getByRole('button', { name: 'Add ingredients to shopping list' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Add to shopping list' });
    // Salt is "to taste", so it starts unticked.
    await expect(
      dialog.getByRole('checkbox', { name: /Salt/ }),
    ).not.toBeChecked();
    await dialog.getByRole('button', { name: /^Add \d+ items?$/ }).click();
    await dialog.getByRole('link', { name: 'View list' }).click();
    await expect(
      page.getByText('for Weeknight red lentil dal').first(),
    ).toBeVisible();
    await context.close();
  });
});

test.describe('meal plan', () => {
  test.use({ storageState: authFile });

  test('plans a recipe and shops for the week, skipping staples', async ({
    page,
  }) => {
    // Salt is something we always have.
    await page.goto('/pantry');
    const common = page.getByRole('region', { name: 'Common staples' });
    await common.getByRole('checkbox', { name: 'salt', exact: true }).check();
    await common.getByRole('button', { name: /^Save/ }).click();
    await expect(
      page.getByRole('region', { name: 'Staples' }).getByText('salt'),
    ).toBeVisible();

    // A recipe that's on nobody's list yet; plan it for today.
    const created = await page.request.post('/api/recipes', {
      headers: { origin: new URL(page.url()).origin },
      data: {
        title: 'Tomato spaghetti',
        servings: 2,
        ingredients: [
          '200 g spaghetti',
          '400 g chopped tomatoes',
          'Salt, to taste',
        ],
      },
    });
    expect(created.ok()).toBe(true);
    await page.goto('/');
    await page.getByRole('link', { name: /Tomato spaghetti/ }).click();
    await page.getByRole('button', { name: 'Add to meal plan' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add to meal plan' });
    await sheet
      .getByRole('button', { name: /^Plan for \d+ on today$/ })
      .click();
    await sheet.getByRole('link', { name: 'View plan' }).click();
    await expect(
      page.getByRole('heading', { name: 'Meal plan' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Tomato spaghetti/ }),
    ).toBeVisible();

    // Shop for the week: salt is "probably got", so it isn't ticked.
    await page.getByRole('button', { name: /Shop for this week/ }).click();
    const shop = page.getByRole('dialog', { name: 'Shop for these meals' });
    const probably = shop.getByRole('region', { name: 'Probably got' });
    await expect(probably.getByText('You always have this')).toBeVisible();
    await expect(probably.getByRole('checkbox')).not.toBeChecked();
    const toBuy = shop.getByRole('region', { name: 'To buy' });
    await expect(
      toBuy.getByRole('checkbox', { name: /Spaghetti/ }),
    ).toBeChecked();
    await shop.getByRole('button', { name: /^Add \d+ to list$/ }).click();
    await shop.getByRole('link', { name: 'View list' }).click();
    await expect(
      page.getByRole('checkbox', { name: 'Bought Spaghetti' }),
    ).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: 'Bought Salt' }),
    ).toHaveCount(0);

    // Cooking it from the plan logs it on the recipe.
    await page.goto('/plan');
    await page.getByRole('button', { name: /Tomato spaghetti/ }).click();
    await page.getByRole('button', { name: 'Mark as cooked' }).click();
    await expect(page.getByText(/· cooked/)).toBeVisible();
  });
});
