import { findDurations, formatTimer } from './timers.js';

describe('findDurations', () => {
  it('finds times in steps', () => {
    expect(
      findDurations('Simmer for 20-25 minutes, then rest 1 hour.'),
    ).toEqual([
      { text: '20-25 minutes', seconds: 1500 },
      { text: '1 hour', seconds: 3600 },
    ]);
    expect(findDurations('Bake 1½ hrs')).toEqual([
      { text: '1½ hrs', seconds: 5400 },
    ]);
    expect(findDurations('Roll to 2 m long')).toEqual([]);
    expect(findDurations('Add 200 g flour')).toEqual([]);
  });

  it('formats timers', () => {
    expect(formatTimer(90)).toBe('1:30');
    expect(formatTimer(3700)).toBe('1:01:40');
  });
});
