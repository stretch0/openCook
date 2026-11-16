import { formatFraction, formatQuantity, parseNumber } from './quantity.js';

describe('parseNumber', () => {
  it.each([
    ['2', 2],
    ['1.5', 1.5],
    ['1,5', 1.5],
    ['1/2', 0.5],
    ['1 1/2', 1.5],
    ['1½', 1.5],
    ['1 ½', 1.5],
    ['¾', 0.75],
  ])('reads %s', (text, n) => {
    expect(parseNumber(text)).toBeCloseTo(n);
  });

  it('rejects nonsense and division by zero', () => {
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('1/0')).toBeNull();
  });
});

describe('formatting', () => {
  it.each([
    [0.5, '½'],
    [0.33, '⅓'],
    [1.5, '1 ½'],
    [2.97, '3'],
    [0.66, '⅔'],
    [0.02, '0.02'],
  ])('shows %s as %s', (n, text) => {
    expect(formatFraction(n)).toBe(text);
  });

  it('uses decimals for metric units and plurals for counted ones', () => {
    expect(formatQuantity(236.6, 'g')).toBe('235 g');
    expect(formatQuantity(3.333, 'g')).toBe('3.3 g');
    expect(formatQuantity(2, 'cup')).toBe('2 cups');
    expect(formatQuantity(1, 'clove')).toBe('1 clove');
    expect(formatQuantity(2, 'clove', 3)).toBe('2–3 cloves');
    expect(formatQuantity(3, null)).toBe('3');
    expect(formatQuantity(1.25, 'kg')).toBe('1.25 kg');
  });
});
