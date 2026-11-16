import { NUMBER_PATTERN, parseNumber } from './quantity.js';

export type FoundDuration = { text: string; seconds: number };

const DURATION = new RegExp(
  `(${NUMBER_PATTERN})(?:\\s*(?:-|–|to)\\s*(${NUMBER_PATTERN}))?\\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\\b`,
  'gi',
);

const UNIT_SECONDS: Record<string, number> = { h: 3600, m: 60, s: 1 };

/**
 * Durations mentioned in a step, for offering timers in cooking mode:
 * "Simmer for 20-25 minutes" → 25 minutes (the longer end, so it's done).
 */
export function findDurations(text: string): FoundDuration[] {
  const out: FoundDuration[] = [];
  for (const m of text.matchAll(DURATION)) {
    const low = parseNumber(m[1]);
    const high = m[2] ? parseNumber(m[2]) : null;
    const unit = m[3].toLowerCase()[0];
    // A bare "m" or "s" after a number is too ambiguous ("2 m" could be metres).
    if (m[3].length === 1 && unit !== 'h') continue;
    const amount = high ?? low;
    if (amount === null || amount <= 0) continue;
    out.push({ text: m[0], seconds: Math.round(amount * UNIT_SECONDS[unit]) });
  }
  return out;
}

/** 90 → "1:30", 3700 → "1:01:40". */
export function formatTimer(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
