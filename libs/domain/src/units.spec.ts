import { bestUnit, compatibleUnits, convert, findUnit } from './units.js';

describe('units', () => {
  it('finds units by their many spellings', () => {
    expect(findUnit('Tablespoons')?.code).toBe('tbsp');
    expect(findUnit('T')?.code).toBe('tbsp');
    expect(findUnit('t')?.code).toBe('tsp');
    expect(findUnit('grams')?.code).toBe('g');
    expect(findUnit('tins')?.code).toBe('can');
    expect(findUnit('onion')).toBeUndefined();
  });

  it('converts within a dimension only', () => {
    expect(convert(1, 'kg', 'g')).toBe(1000);
    expect(convert(3, 'tsp', 'tbsp')).toBeCloseTo(1);
    expect(compatibleUnits('g', 'ml')).toBe(false);
    expect(compatibleUnits('clove', 'clove')).toBe(true);
    expect(compatibleUnits('clove', 'can')).toBe(false);
    expect(() => convert(1, 'g', 'ml')).toThrow();
  });

  it('picks a sensible unit to show', () => {
    expect(bestUnit(1500, 'g')).toEqual({ quantity: 1.5, unit: 'kg' });
    expect(bestUnit(6, 'tsp').unit).toBe('tbsp');
    expect(bestUnit(6, 'tsp').quantity).toBeCloseTo(2);
    expect(bestUnit(16, 'tbsp').unit).toBe('cup');
    expect(bestUnit(250, 'ml', 'imperial').unit).toBe('cup');
    expect(bestUnit(2, 'cup', 'metric').unit).toBe('ml');
    expect(bestUnit(500, 'g', 'imperial').unit).toBe('lb');
    expect(bestUnit(4, 'oz', 'metric').quantity).toBeCloseTo(113.4, 1);
    expect(bestUnit(2, 'tbsp', 'metric').unit).toBe('tbsp');
    expect(bestUnit(3, 'clove', 'imperial')).toEqual({
      quantity: 3,
      unit: 'clove',
    });
  });
});
