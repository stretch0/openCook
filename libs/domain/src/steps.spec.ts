import { scaleStep, scaleStepText } from './steps.js';

describe('scaleStep', () => {
  it('scales weights and volumes written in the text', () => {
    expect(scaleStepText('Whisk 200 g flour with 250ml milk.', 2)).toBe(
      'Whisk 400 g flour with 500 ml milk.',
    );
    expect(scaleStepText('Add 1 tbsp oil', 0.5)).toBe('Add 1 ½ tsp oil');
  });

  it('leaves times, temperatures and counts alone', () => {
    const text = 'Bake at 180°C for 20 minutes, then cut into 4 pieces.';
    expect(scaleStepText(text, 3)).toBe(text);
  });

  it('marks amounts so the UI can highlight them', () => {
    expect(scaleStep('Add 100g sugar', 1)).toEqual([
      { text: 'Add ' },
      { text: '100 g', amount: true },
      { text: ' sugar' },
    ]);
  });

  it('expands ingredient and quantity tokens', () => {
    const ingredients = [{ id: 'a', name: 'butter', quantity: 50, unit: 'g' }];
    expect(scaleStepText('Melt {{ing:a}} in a pan.', 2, { ingredients })).toBe(
      'Melt 100 g butter in a pan.',
    );
    expect(scaleStepText('Use {{qty:2 cups}} of stock', 2)).toBe(
      'Use 4 cups of stock',
    );
    expect(scaleStepText('Melt {{ing:missing}} now', 2)).toBe('Melt  now');
  });

  it('converts for the reader', () => {
    expect(scaleStepText('Add 1 cup stock', 1, { preference: 'metric' })).toBe(
      'Add 235 ml stock',
    );
  });
});

describe('hostile step text', () => {
  it('stays fast on unclosed tokens', () => {
    const started = Date.now();
    scaleStepText('{{{{ing:' + ' '.repeat(100_000), 2);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('still accepts spaces inside tokens', () => {
    const ingredients = [{ id: 'a', name: 'butter', quantity: 50, unit: 'g' }];
    expect(scaleStepText('Melt {{ing: a }}.', 2, { ingredients })).toBe(
      'Melt 100 g butter.',
    );
  });
});

describe('repeated openers', () => {
  it('stays fast on many unclosed brackets and tokens', () => {
    const started = Date.now();
    scaleStepText('{{ing:' + '{{ing:|'.repeat(30_000), 2);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
