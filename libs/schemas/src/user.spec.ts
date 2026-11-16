import { updateMeSchema } from './user.js';
import { createInviteSchema } from './invite.js';

describe('schemas', () => {
  it('rejects unknown units', () => {
    expect(updateMeSchema.safeParse({ units: 'furlongs' }).success).toBe(false);
  });

  it('defaults invite expiry to 14 days', () => {
    expect(createInviteSchema.parse({})).toEqual({ expiresInDays: 14 });
  });
});

import { createTokenSchema } from './token.js';
import { recipeInputSchema } from './recipe.js';

describe('recipe and token schemas', () => {
  it('accepts ingredients as lines or objects', () => {
    const r = recipeInputSchema.parse({
      title: 'Soup',
      ingredients: ['1 onion', { name: 'stock', quantity: 1, unit: 'l' }],
      steps: ['Simmer.'],
    });
    expect(r.servings).toBe(4);
    expect(r.visibility).toBe('private');
  });

  it('only knows real token scopes', () => {
    expect(
      createTokenSchema.safeParse({ name: 'x', scopes: ['admin'] }).success,
    ).toBe(false);
  });
});
