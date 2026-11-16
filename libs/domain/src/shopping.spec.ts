import { combineAmounts, groupByAisle } from './shopping.js';

describe('combineAmounts', () => {
  it('adds amounts in the same or compatible units', () => {
    expect(
      combineAmounts({ quantity: 2, unit: null }, { quantity: 3, unit: null }),
    ).toEqual({ quantity: 5, unit: null });
    expect(
      combineAmounts({ quantity: 200, unit: 'g' }, { quantity: 1, unit: 'kg' }),
    ).toEqual({ quantity: 1.2, unit: 'kg' });
    expect(
      combineAmounts(
        { quantity: 2, unit: 'clove' },
        { quantity: 1, unit: 'clove' },
      ),
    ).toEqual({ quantity: 3, unit: 'clove' });
  });

  it('keeps an amount when the other has none', () => {
    expect(
      combineAmounts(
        { quantity: null, unit: null },
        { quantity: 2, unit: 'l' },
      ),
    ).toEqual({ quantity: 2, unit: 'l' });
    expect(
      combineAmounts(
        { quantity: 1, unit: 'l' },
        { quantity: null, unit: null },
      ),
    ).toEqual({ quantity: 1, unit: 'l' });
    expect(
      combineAmounts(
        { quantity: null, unit: null },
        { quantity: null, unit: null },
      ),
    ).toEqual({ quantity: null, unit: null });
  });

  it('refuses amounts that cannot be added', () => {
    expect(
      combineAmounts(
        { quantity: 2, unit: 'can' },
        { quantity: 400, unit: 'g' },
      ),
    ).toBeNull();
    expect(
      combineAmounts({ quantity: 2, unit: null }, { quantity: 400, unit: 'g' }),
    ).toBeNull();
    expect(
      combineAmounts(
        { quantity: 1, unit: 'cup' },
        { quantity: 100, unit: 'g' },
      ),
    ).toBeNull();
  });
});

describe('groupByAisle', () => {
  it('orders aisles like a walk round the shop', () => {
    const groups = groupByAisle([
      { name: 'soap', category: 'personal' },
      { name: 'apples', category: 'produce' },
      { name: 'thing', category: 'mystery' },
      { name: 'pears', category: 'produce' },
    ]);
    expect(groups.map((g) => [g.name, g.items.map((i) => i.name)])).toEqual([
      ['Fruit & veg', ['apples', 'pears']],
      ['Toiletries & health', ['soap']],
      ['Other', ['thing']],
    ]);
  });
});
