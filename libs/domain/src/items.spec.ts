import { CATALOGUE } from './catalogue.js';
import {
  type ItemCandidate,
  editDistance,
  matchItem,
  normalItemKey,
  singular,
} from './items.js';

describe('normalItemKey', () => {
  it('treats spacing, hyphens and case as the same item', () => {
    const keys = ['Mouth wash', 'mouthwash', 'Mouth-Wash', ' MOUTHWASH '].map(
      normalItemKey,
    );
    expect(new Set(keys)).toEqual(new Set(['mouthwash']));
  });

  it('ignores plurals, accents and descriptions', () => {
    expect(normalItemKey('Tomatoes')).toBe(normalItemKey('tomato'));
    expect(normalItemKey('Large Free-Range Eggs')).toBe('egg');
    expect(normalItemKey('Crème fraîche')).toBe(normalItemKey('creme fraiche'));
    expect(normalItemKey('Berries')).toBe('berry');
    expect(normalItemKey('peaches')).toBe('peach');
    expect(normalItemKey('Asparagus')).toBe('asparagus');
    expect(normalItemKey('Bay leaves')).toBe('bayleaf');
    expect(normalItemKey('Cookies')).toBe('cookie');
  });

  it('singularises consistently', () => {
    for (const [plural, one] of [
      ['lentils', 'lentil'],
      ['potatoes', 'potato'],
      ['glasses', 'glass'],
      ['anchovies', 'anchovy'],
    ]) {
      expect(singular(plural)).toBe(one);
    }
  });
});

describe('matchItem', () => {
  const candidates: ItemCandidate[] = [
    { id: '1', name: 'Mouthwash', keys: ['mouthwash'] },
    {
      id: '2',
      name: 'Spring onion',
      keys: ['springonion', 'scallion', 'greenonion'],
    },
    { id: '3', name: 'Milk', keys: ['milk'] },
  ];

  it('matches exactly by key or alias', () => {
    expect(matchItem('mouth wash', candidates)).toMatchObject({
      kind: 'exact',
      item: { id: '1' },
    });
    expect(matchItem('Scallions', candidates)).toMatchObject({
      kind: 'exact',
      item: { id: '2' },
    });
  });

  it('only suggests close spellings, never merges them', () => {
    const typo = matchItem('mouthwsh', candidates);
    expect(typo.kind).toBe('new');
    expect(typo.kind === 'new' && typo.suggestions.map((s) => s.id)).toEqual([
      '1',
    ]);
    const prefix = matchItem('mouth', candidates);
    expect(prefix.kind === 'new' && prefix.suggestions[0]?.id).toBe('1');
    expect(matchItem('bread', candidates)).toEqual({
      kind: 'new',
      suggestions: [],
    });
  });

  it('computes edit distance', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('abc', 'abc')).toBe(0);
  });
});

describe('catalogue', () => {
  it('has no two items with the same key', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const item of CATALOGUE) {
      for (const name of [item.name, ...item.aliases]) {
        const key = normalItemKey(name);
        const owner = seen.get(key);
        if (owner && owner !== item.name) clashes.push(`${name} (${owner})`);
        seen.set(key, item.name);
      }
    }
    expect(clashes).toEqual([]);
  });
});
