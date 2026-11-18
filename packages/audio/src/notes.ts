// Note helpers for the scores: pitches, and the two ways the games write a melody line.
// A line is one entry per 16th step: a MIDI note number, 0 for a rest, -1 to hold the
// note before it.

/** Frequency of MIDI note n (69 = A4 = 440 Hz). */
export const midi = (n: number): number => 440 * 2 ** ((n - 69) / 12);

/** "72 - 76 . 79": note numbers, '.' rests, '-' holds. */
export const line = (s: string): number[] =>
  s
    .trim()
    .split(/\s+/)
    .map(t => (t === '.' ? 0 : t === '-' ? -1 : +t));

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C5 . E5 - G#4 | Bb4": note names (C4 = 60), '.' rests, '-' holds, '|' marks bars and is skipped. */
export function seq(s: string): number[] {
  const out: number[] = [];
  for (const tok of s.trim().split(/\s+/)) {
    if (tok === '|') continue;
    if (tok === '.') {
      out.push(0);
      continue;
    }
    if (tok === '-') {
      out.push(-1);
      continue;
    }
    const m = tok.match(/^([A-G])([#b]?)(\d)$/);
    out.push(m ? 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) : 0);
  }
  return out;
}

/** How many steps the note at step i sounds: itself plus the holds after it, at most max. */
export function span(lead: readonly number[], i: number, max = Infinity): number {
  let len = 1;
  while (lead[(i + len) % lead.length] === -1 && len < max) len++;
  return len;
}
