// Procedural sound: slow, lamplit music for thinking (soft pads, a sine bass, glass bells picking
// out the chords and a sparse FM melody), a tenser minor version while the board is nearly full,
// and the effects — glass clinks, the roll, the refusal, rising chimes by row length. Every tune
// is written for Quintet. The context is only created by unlock(), from a user gesture; the demo
// never creates one.
//
//   const audio = createAudio({ on: true });
//   audio.unlock();  audio.music('calm');  audio.sfx('clear', { longest: 6, combo: 2 });
import { createSynth, line, midi, span } from '@nostalgia/audio';
import { PRISM } from './sim.js';

const CH = { M7: [0, 4, 7, 11], m7: [0, 3, 7, 10], sus: [0, 5, 7, 10], add9: [0, 4, 7, 14], m: [0, 3, 7, 12], M: [0, 4, 7, 12] };
// bars: [root, chord]; bells: one 16th per character (x rings the next chord tone up); the
// melody one entry per 16th
const TRACKS = {
  title: {
    bpm: 64, bars: [[50, 'M7'], [43, 'M7'], [47, 'm7'], [45, 'sus']], bells: 'x.....x.....x...', vol: 0.034,
    tune: `69 - - - - - 74 - - - 73 - 71 - - -  71 - - - 67 - - - 66 - 67 - 69 - - -
           66 - - - - - 71 - - - 69 - 66 - - -  64 - - - - - - - 69 - - - - - - -`,
  },
  calm: {
    bpm: 70, bars: [[50, 'M7'], [47, 'm7'], [43, 'M7'], [45, 'sus'], [50, 'M7'], [42, 'm7'], [43, 'M7'], [45, 'add9']], bells: 'x..x..x...x..x..', vol: 0.03,
    tune: `74 - - - 73 - 69 - - - 66 - - - - -  71 - - - 69 - 66 - 62 - - - - - - -
           67 - - - 71 - 74 - 78 - - - 76 - - -  76 - - - - - 74 - 73 - - - - - - -
           78 - - - 76 - 74 - 73 - 74 - - - - -  73 - - - 69 - 66 - 69 - - - 73 - - -
           74 - - - 71 - 67 - 66 - 67 - 71 - - -  69 - - - - - - - . . . . . . . .`,
  },
  tight: {
    bpm: 76, bars: [[47, 'm'], [43, 'M'], [40, 'm'], [42, 'M']], bells: 'x.x...x.x...x.x.', vol: 0.03, pulse: true,
    tune: `66 - - - 71 - - - 74 - - - 73 - - -  71 - - - 67 - - - 66 - - - 62 - - -
           64 - - - 67 - - - 71 - - - 69 - - -  70 - - - 66 - - - 61 - - - - - - -`,
  },
};
for (const tr of Object.values(TRACKS)) tr.line = line(tr.tune);
// a major pentatonic run for the chimes
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export function createAudio({ on = true } = {}) {
  return createSynth({
    on, seed: 23, levels: { master: 0.55, music: 0.34, sfx: 0.75 }, tracks: TRACKS,
    attack: 0.006, startDelay: 0.08, echo: { time: 0.34, feedback: 0.32, wet: 0.24, cut: 2400 },
    arrange: ({ tone, hiss, notes, fm, hold }) => {
      const bell = (n, t, dur, vol, bus = 'sfx') => { fm(midi(n), t, dur, vol, 3.01, 1.1, bus); tone(midi(n + 12), midi(n + 12), t, dur * 0.5, vol * 0.25, 'sine', bus, 0); };
      return {
        step(tr, i, t, dt) {
          const bar = Math.floor(i / 16), s = i % 16, [root, kind] = tr.bars[bar % tr.bars.length], ch = CH[kind];
          // the pad swells in at the bar, the bass under it
          if (s === 0) {
            for (const n of ch) tone(midi(root + 12 + n), midi(root + 12 + n), t, dt * 16, 0.016, 'triangle', 'music', 0.6);
            tone(midi(root - 12), midi(root - 12), t, dt * 9, 0.12, 'sine', 'music', 0.05);
          }
          if (s === 8) tone(midi(root - 5), midi(root - 5), t, dt * 7, 0.08, 'sine', 'music', 0.05);
          // glass bells walking up the chord
          if (tr.bells[s] === 'x') {
            const k = tr.bells.slice(0, s).split('x').length - 1, n = root + 24 + ch[k % ch.length] + (k >= ch.length ? 12 : 0);
            fm(midi(n), t, dt * 6, 0.016, 3.01, 0.9);
          }
          if (tr.pulse && (s === 0 || s === 3)) tone(70, 42, t, 0.16, 0.08, 'sine', 'music', 0);
          const n = tr.line[i % tr.line.length];
          if (n > 0) {
            const d = dt * span(tr.line, i, 12);
            fm(midi(n), t, d, tr.vol, 2, 0.6);
            tone(midi(n), midi(n), t, d, tr.vol * 0.4, 'triangle', 'music', 0.03);
          }
        },
        effects: {
          tick: t => tone(1900, 1900, t, 0.025, 0.012, 'sine', 'sfx', 0),
          cursor: t => tone(1500, 1500, t, 0.02, 0.008, 'sine', 'sfx', 0),
          menu: t => bell(84, t, 0.3, 0.05),
          select: (t, e) => { bell(88 + ((e?.c ?? 0) % 7), t, 0.4, 0.06); tone(2600, 3100, t, 0.05, 0.015, 'sine', 'sfx', 0); },
          deselect: t => { bell(81, t, 0.25, 0.04); },
          roll: (t, e) => {
            const steps = Math.max(1, e?.steps ?? 1), dur = e?.dur ?? 0.2;
            hiss(t, dur + 0.05, 0.03, 700, 420, 'lowpass', 'sfx', 1, 0.03);
            for (let k = 0; k < steps; k++) tone(520 + (k % 2) * 40, 480, t + (k * dur) / steps, 0.025, 0.012, 'sine', 'sfx', 0);
          },
          land: t => { tone(240, 160, t, 0.09, 0.07, 'sine', 'sfx', 0); fm(midi(91), t, 0.12, 0.018, 3.01, 0.6, 'sfx'); },
          blocked: t => {
            tone(150, 110, t, 0.12, 0.1, 'triangle', 'sfx', 0); tone(132, 96, t + 0.11, 0.16, 0.09, 'triangle', 'sfx', 0);
            hiss(t, 0.1, 0.03, 900, 300, 'lowpass');
          },
          clear: (t, e) => {
            const n = Math.min(PENTA.length, (e?.longest ?? 5) + 1), up = Math.min(5, Math.max(0, (e?.streak ?? 1) - 1)) * 2, base = 76 + up;
            hold(t + 0.6);
            for (let k = 0; k < n; k++) bell(base + PENTA[k], t + k * 0.055, 0.7, 0.045);
            hiss(t, 0.5, 0.035, 9000, 5000, 'highpass', 'sfx', 1, 0.01);
            if ((e?.combo ?? 1) >= 2) { hold(t + 1.1); notes([base + 12, base + 16, base + 19, base + 24], t + n * 0.055 + 0.05, 0.03, 0.6, 0.03, 'triangle'); }
            if ((e?.longest ?? 5) >= 7) fm(midi(base - 12), t, 1.4, 0.05, 1.5, 2, 'sfx');
          },
          token: t => { bell(93, t + 0.2, 0.3, 0.04); bell(98, t + 0.3, 0.4, 0.04); },
          arrive: (t, e) => {
            (e?.list ?? []).forEach((a, k) => {
              const tt = t + k * 0.1;
              tone(280, 620, tt, 0.07, 0.04, 'sine', 'sfx', 0.005);
              if (a.c === PRISM) for (let j = 0; j < 5; j++) bell(96 + PENTA[j], tt + 0.04 * j, 0.3, 0.02);
            });
          },
          undo: t => { tone(1100, 320, t, 0.28, 0.035, 'sine'); notes([86, 81, 76], t + 0.05, 0.06, 0.18, 0.02, 'triangle'); },
          warn: t => { bell(62, t, 1.2, 0.05); bell(61, t + 0.4, 1.2, 0.04); },
          over: t => { hold(t + 3.4); [81, 78, 74, 71, 69, 66, 62].forEach((n, k) => bell(n, t + k * 0.28, 1.4, 0.05)); },
          start: t => { [74, 78, 81, 86].forEach((n, k) => bell(n, t + k * 0.07, 0.8, 0.04)); },
        },
      };
    },
  });
}
