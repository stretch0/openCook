import type { Recipe } from '@opencook/schemas';
import { presentRecipe } from './server.js';

const recipe: Recipe = {
  id: 'r1',
  title: 'Flapjacks',
  description: null,
  servings: 12,
  prepMinutes: 10,
  cookMinutes: 25,
  cuisine: null,
  tags: ['baking'],
  visibility: 'private',
  sourceUrl: null,
  sourceName: null,
  imageId: null,
  imageUrl: null,
  owner: { id: 'u1', name: 'Andrew' },
  mine: true,
  forkedFrom: null,
  ingredients: [
    {
      id: 'a',
      section: null,
      quantity: 250,
      quantityMax: null,
      unit: 'g',
      name: 'oats',
      itemId: null,
      preparation: null,
      note: null,
      optional: false,
      scaling: 'linear',
      rawText: null,
    },
    {
      id: 'b',
      section: null,
      quantity: 4,
      quantityMax: null,
      unit: 'tbsp',
      name: 'golden syrup',
      itemId: null,
      preparation: null,
      note: null,
      optional: false,
      scaling: 'linear',
      rawText: null,
    },
    {
      id: 'c',
      section: null,
      quantity: null,
      quantityMax: null,
      unit: null,
      name: 'salt',
      itemId: null,
      preparation: null,
      note: null,
      optional: false,
      scaling: 'to_taste',
      rawText: null,
    },
  ],
  steps: [
    {
      section: null,
      text: 'Melt {{ing:b}} with 125 g butter, then bake 25 minutes.',
      timerSeconds: null,
    },
  ],
  note: null,
  lastCookedAt: null,
  timesCooked: 0,
  revision: 3,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

describe('presentRecipe', () => {
  it('scales amounts in ingredients and steps for the agent', () => {
    const shown = presentRecipe(recipe, 'https://cook.example', 6);
    expect(shown).toMatchObject({
      url: 'https://cook.example/recipes/r1',
      servings: 6,
      written_for_servings: 12,
      revision: 3,
    });
    expect(shown.ingredients.map((i) => i.amount)).toEqual([
      '125 g',
      '2 tbsp',
      null,
    ]);
    expect(shown.ingredients[2].to_taste).toBe(true);
    // Times are never scaled; 62.5 g rounds to what a scale shows.
    expect(shown.steps[0].text).toBe(
      'Melt 2 tbsp golden syrup with 63 g butter, then bake 25 minutes.',
    );
  });

  it('converts for US measures when asked', () => {
    const shown = presentRecipe(recipe, 'https://cook.example', 12, 'imperial');
    expect(shown.ingredients[0].amount).toBe('8 ¾ oz');
  });
});
