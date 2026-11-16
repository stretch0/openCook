import {
  displayAmount,
  ingredientLine,
  parseIngredientLine,
  scaleAmount,
  servingsFactor,
} from './ingredient.js';

const parse = (line: string) => {
  const { rawText: _, ...rest } = parseIngredientLine(line);
  return rest;
};

describe('parseIngredientLine', () => {
  it('reads amount, unit, name and preparation', () => {
    expect(parse('1 ½ cups plain flour, sifted')).toEqual({
      quantity: 1.5,
      quantityMax: null,
      unit: 'cup',
      name: 'plain flour',
      preparation: 'sifted',
      note: null,
      optional: false,
      scaling: 'linear',
    });
  });

  it('reads ranges', () => {
    expect(parse('2-3 cloves garlic, crushed')).toMatchObject({
      quantity: 2,
      quantityMax: 3,
      unit: 'clove',
      name: 'garlic',
      preparation: 'crushed',
    });
    expect(parse('2 to 3 tbsp olive oil')).toMatchObject({
      quantity: 2,
      quantityMax: 3,
      unit: 'tbsp',
    });
  });

  it('reads units stuck to the number', () => {
    expect(parse('200g unsalted butter')).toMatchObject({
      quantity: 200,
      unit: 'g',
      name: 'unsalted butter',
    });
    expect(parse('1.5kg potatoes')).toMatchObject({
      quantity: 1.5,
      unit: 'kg',
      name: 'potatoes',
    });
  });

  it('keeps sizes as notes', () => {
    expect(parse('1 (400g) can chopped tomatoes')).toMatchObject({
      quantity: 1,
      unit: 'can',
      name: 'chopped tomatoes',
      note: '400g',
    });
    expect(parse('2 x 400g tins chickpeas, drained')).toMatchObject({
      quantity: 2,
      unit: 'can',
      name: 'chickpeas',
      note: '400g',
      preparation: 'drained',
    });
    expect(parse('1 14-oz can coconut milk')).toMatchObject({
      unit: 'can',
      note: '14 oz',
      name: 'coconut milk',
    });
    expect(parse('2 400g potatoes')).toMatchObject({
      quantity: 2,
      unit: null,
      name: '400g potatoes',
    });
  });

  it('handles things with no unit', () => {
    expect(parse('3 large eggs')).toMatchObject({
      quantity: 3,
      unit: null,
      name: 'large eggs',
    });
    expect(parse('Salt and pepper, to taste')).toMatchObject({
      quantity: null,
      name: 'Salt and pepper',
      scaling: 'to_taste',
    });
    expect(parse('a pinch of salt')).toMatchObject({
      quantity: 1,
      unit: 'pinch',
      name: 'salt',
    });
    expect(parse('fresh basil')).toMatchObject({
      quantity: null,
      name: 'fresh basil',
    });
  });

  it('spots optional ingredients and US abbreviations', () => {
    expect(parse('1 tsp chilli flakes (optional)')).toMatchObject({
      optional: true,
      unit: 'tsp',
      name: 'chilli flakes',
    });
    expect(parse('2 T butter')).toMatchObject({ unit: 'tbsp', name: 'butter' });
    expect(parse('1 t salt')).toMatchObject({ unit: 'tsp', name: 'salt' });
    expect(parse('1 tomato')).toMatchObject({ unit: null, name: 'tomato' });
    expect(parse('4 fl oz milk')).toMatchObject({ unit: 'floz', name: 'milk' });
  });

  it('keeps the original line', () => {
    expect(parseIngredientLine('  - 1 onion ').rawText).toBe('- 1 onion');
  });
});

describe('scaling', () => {
  it('scales linear amounts and leaves fixed ones', () => {
    const factor = servingsFactor(4, 6);
    expect(scaleAmount({ quantity: 200, unit: 'g' }, factor).quantity).toBe(
      300,
    );
    expect(
      scaleAmount(
        { quantity: 1, unit: 'leaf', scaling: 'fixed' as const },
        factor,
      ).quantity,
    ).toBe(1);
    expect(
      scaleAmount({ quantity: 2, quantityMax: 3, unit: 'clove' }, 2),
    ).toMatchObject({ quantity: 4, quantityMax: 6 });
  });

  it('shows scaled amounts in friendly units', () => {
    expect(displayAmount({ quantity: 2, unit: 'tsp' }, 1.5)).toBe('1 tbsp');
    expect(displayAmount({ quantity: 600, unit: 'g' }, 2)).toBe('1.2 kg');
    expect(displayAmount({ quantity: 1, unit: 'cup' }, 0.5)).toBe('½ cup');
    expect(displayAmount({ quantity: 1, unit: 'cup' }, 1, 'metric')).toBe(
      '235 ml',
    );
    expect(displayAmount({ quantity: 3, unit: null }, 1 / 3)).toBe('1');
    expect(displayAmount({ quantity: null, unit: null }, 2)).toBe('');
  });
});

describe('ingredientLine', () => {
  it.each([
    '1 ½ cups plain flour, sifted',
    '2-3 cloves garlic, crushed',
    '200 g butter',
    '3 eggs',
    'Salt, to taste',
    '1 tsp chilli flakes (optional)',
  ])('round-trips "%s"', (line) => {
    const parsed = parseIngredientLine(line);
    expect(parseIngredientLine(ingredientLine(parsed))).toEqual({
      ...parsed,
      rawText: ingredientLine(parsed),
    });
  });
});

describe('hostile input', () => {
  it('stays fast on long runs of spaces', () => {
    const started = Date.now();
    parseIngredientLine('1' + ' '.repeat(100_000) + 'x');
    parseIngredientLine('salt,' + ' '.repeat(100_000) + 'optional!');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('repeated brackets', () => {
  it('stays fast on many unclosed brackets', () => {
    const started = Date.now();
    parseIngredientLine('(' + '(('.repeat(50_000));
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
