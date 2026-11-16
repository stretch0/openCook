import {
  SUGGESTED_STAPLES,
  addDays,
  aggregateNeeds,
  classifyNeed,
  restockState,
  weekStart,
} from './planning.js';
import { CATALOGUE } from './catalogue.js';
import { normalItemKey } from './items.js';

const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n, 9));
const now = day(30);

describe('dates', () => {
  it('moves by days and finds the Monday', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(weekStart('2026-11-19')).toBe('2026-11-16'); // Thursday → Monday
    expect(weekStart('2026-11-22')).toBe('2026-11-16'); // Sunday → Monday
    expect(weekStart('2026-11-16')).toBe('2026-11-16');
  });
});

describe('restockState', () => {
  it('needs three shops before guessing how often', () => {
    expect(restockState([day(20), day(26)], now)).toMatchObject({
      intervalDays: null,
      due: false,
      daysSince: 4,
    });
  });

  it('uses the median gap and says when it is due', () => {
    // Bought every 6 days, with one late shop that shouldn't skew it.
    const bought = [day(0), day(6), day(12), day(25)];
    expect(restockState(bought, day(29))).toMatchObject({
      intervalDays: 6,
      daysSince: 4,
      due: false,
    });
    expect(restockState(bought, day(31))).toMatchObject({
      intervalDays: 6,
      daysSince: 6,
      due: true,
    });
  });

  it('counts two purchases on the same shop once', () => {
    const bought = [
      day(0),
      new Date(day(0).getTime() + 3600_000),
      day(7),
      day(14),
    ];
    expect(restockState(bought, day(15)).intervalDays).toBe(7);
  });
});

describe('aggregateNeeds', () => {
  it('adds the same item from several recipes', () => {
    const lines = aggregateNeeds([
      {
        itemId: 'onion',
        name: 'onion',
        quantity: 1,
        unit: null,
        sources: [{ recipeId: 'a', title: 'Curry' }],
      },
      {
        itemId: 'onion',
        name: 'red onion',
        quantity: 2,
        unit: null,
        sources: [{ recipeId: 'b', title: 'Dal' }],
      },
      {
        itemId: 'flour',
        name: 'flour',
        quantity: 200,
        unit: 'g',
        sources: [{ recipeId: 'a', title: 'Curry' }],
      },
      {
        itemId: 'flour',
        name: 'flour',
        quantity: 1,
        unit: 'cup',
        sources: [{ recipeId: 'b', title: 'Dal' }],
      },
    ]);
    expect(lines).toEqual([
      expect.objectContaining({
        itemId: 'onion',
        quantity: 3,
        sources: [
          { recipeId: 'a', title: 'Curry' },
          { recipeId: 'b', title: 'Dal' },
        ],
      }),
      expect.objectContaining({ itemId: 'flour', quantity: 200, unit: 'g' }),
      expect.objectContaining({ itemId: 'flour', quantity: 1, unit: 'cup' }),
    ]);
  });
});

describe('classifyNeed', () => {
  it('puts what is already on the list aside', () => {
    expect(classifyNeed({ onList: true, purchases: [] }, now).status).toBe(
      'already_on_list',
    );
  });

  it('trusts staples unless marked low or overdue', () => {
    expect(
      classifyNeed(
        {
          onList: false,
          purchases: [],
          pantry: { staple: true, status: 'have' },
        },
        now,
      ),
    ).toEqual({
      status: 'probably_have',
      reason: 'You always have this',
    });
    expect(
      classifyNeed(
        {
          onList: false,
          purchases: [],
          pantry: { staple: true, status: 'low' },
        },
        now,
      ).status,
    ).toBe('need');
    const overdue = [day(0), day(7), day(14), day(21)];
    expect(
      classifyNeed(
        {
          onList: false,
          purchases: overdue,
          pantry: { staple: true, status: 'have' },
        },
        day(29),
      ).status,
    ).toBe('need');
  });

  it('uses how recently and how often it was bought', () => {
    const weekly = [day(0), day(7), day(14), day(21)];
    expect(classifyNeed({ onList: false, purchases: weekly }, day(23))).toEqual(
      {
        status: 'probably_have',
        reason: 'Bought 2 days ago; usually lasts about 7 days',
      },
    );
    expect(classifyNeed({ onList: false, purchases: weekly }, day(28))).toEqual(
      {
        status: 'need',
        reason: "You usually buy it every 7 days; it's been 7 days",
      },
    );
    expect(classifyNeed({ onList: false, purchases: [day(29)] }, now)).toEqual({
      status: 'probably_have',
      reason: 'Bought yesterday',
    });
    expect(classifyNeed({ onList: false, purchases: [day(10)] }, now)).toEqual({
      status: 'need',
      reason: null,
    });
  });
});

describe('suggested staples', () => {
  it('are all in the catalogue', () => {
    const keys = new Set(
      CATALOGUE.flatMap((c) => [c.name, ...c.aliases]).map(normalItemKey),
    );
    expect(
      SUGGESTED_STAPLES.filter((s) => !keys.has(normalItemKey(s))),
    ).toEqual([]);
  });
});
