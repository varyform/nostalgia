// Procedural sound on the shared engine, all original tunes: a lilting title air, three
// climbing themes that take turns tower by tower, a breezy kite tune, and jingles for the
// crown, the time running out and the end. Pulse lead, soft arpeggio, triangle bass and a
// noise kit, with a little echo for the sea air. The context is only made by unlock(), which
// the page calls from a user gesture; the demo never makes one.
//
//   const audio = createAudio({ on: true });
//   audio.unlock(); audio.music('climb1'); audio.sfx('jump'); audio.setOn(false);
import { createSynth, line, midi, span } from '@nostalgia/audio';

const CH = { M: [0, 4, 7, 12], m: [0, 3, 7, 12] };
// 16 steps a bar, one chord a bar; lead: note numbers, '.' rest, '-' hold
const TRACKS = {
  // "Spindle Air": the title, in D minor
  title: {
    bpm: 100, duty: 0.25, bass: 'x.....x.x.....x.', drums: 'k.....h.s.....h.',
    bars: [[50, 'm'], [46, 'M'], [48, 'M'], [45, 'M'], [50, 'm'], [45, 'M'], [46, 'M'], [50, 'm']],
    lead: line(`62 - - 65 69 - 67 65 64 - 62 - 60 - - -   58 - - 62 65 - 64 62 60 - 62 - 65 - - -
                64 - - 67 72 - 70 69 67 - 65 - 64 - - -   69 - 67 65 64 - 65 - 61 - - - - - - -
                74 - 72 - 69 - 67 65 67 - 69 - 70 - - -   69 - 67 - 65 - 64 62 64 - 65 - 67 - - -
                65 - 64 - 62 - 61 - 62 - 64 - 65 - 69 -   74 - - - 69 - - - 62 - - - - - - -`),
  },
  // "Ledge Walk": towers 1, 4, 7
  climb1: {
    bpm: 132, duty: 0.5, bass: 'x...x.x.x...x.x.', drums: 'k.h.s.h.k.h.s.hh',
    bars: [[43, 'M'], [48, 'M'], [50, 'M'], [43, 'M'], [40, 'm'], [48, 'M'], [50, 'M'], [43, 'M']],
    lead: line(`67 - 71 - 74 - 71 - 74 - 79 - 78 - 74 -   72 - 76 - 79 - 76 - 72 - 69 - 67 - 69 -
                66 - 69 - 74 - 72 - 69 - 66 - 62 - 66 -   67 - - - 71 - 74 - 79 - - - - - - -
                76 - 74 - 71 - 74 - 76 - 79 - 83 - 79 -   76 - 72 - 69 - 72 - 76 - 79 - 81 - 79 -
                78 - 74 - 72 - 69 - 66 - 69 - 72 - 74 -   71 - 67 - 62 - 67 - 71 - - - - - - -`),
  },
  // "Brine Steps": towers 2, 5, 8
  climb2: {
    bpm: 120, duty: 0.25, bass: 'x.x...x.x.x...x.', drums: 'k..hs.h.k.khs..h',
    bars: [[45, 'm'], [41, 'M'], [43, 'M'], [40, 'M'], [45, 'm'], [41, 'M'], [40, 'M'], [45, 'm']],
    lead: line(`69 - 72 - 76 - 72 69 - 72 76 - 81 - 76 -   77 - 76 - 72 - 69 - 65 - 69 72 - 77 - - -
                74 - 71 - 67 - 71 74 - 79 - 77 - 74 - -   76 - 75 - 76 - 80 - 83 - - - 80 - 76 -
                81 - 79 - 76 - 72 - 74 - 76 - 72 - 69 -   72 - 74 - 77 - 81 - 79 - 77 - 76 - 74 -
                76 - - - 71 - 74 - 80 - 76 - 74 - 71 -   69 - - - 64 - 69 - 72 - - - 69 - - -`),
  },
  // "Night Spiral": towers 3 and 6
  climb3: {
    bpm: 144, duty: 0.125, bass: 'x.x.x.x.x.x.x.x.', drums: 'k.hhs.h.k.hhs.hs',
    bars: [[40, 'm'], [48, 'M'], [50, 'M'], [47, 'M'], [40, 'm'], [45, 'm'], [47, 'M'], [40, 'm']],
    lead: line(`64 67 71 - 76 - 71 67 64 67 71 - 79 - 76 -   72 76 79 - 84 - 79 76 72 - 76 - 79 - - -
                74 78 81 - 86 - 81 78 74 - 78 - 81 - - -   75 78 83 - 87 - 83 78 75 - 71 - 66 - - -
                76 - 79 - 83 - 79 - 76 - 74 - 71 - 67 -   69 - 72 - 76 - 81 - 79 - 76 - 72 - 69 -
                71 - 75 - 78 - 83 - 81 - 78 - 75 - 71 -   76 - - - 71 - - - 64 - - - - - - -`),
  },
  // "Kite Wind": the bonus run
  bonus: {
    bpm: 150, duty: 0.25, bass: 'x..x..x.x..x..x.', drums: 'k.h.s.hhk.h.s.h.',
    bars: [[48, 'M'], [45, 'm'], [41, 'M'], [43, 'M']],
    lead: line(`72 76 79 84 - 79 76 79 72 76 79 84 - 79 76 -   69 72 76 81 - 76 72 76 69 72 76 81 - 79 76 -
                65 69 72 77 - 72 69 72 77 - 81 - 79 - 77 -   79 - 77 - 76 - 74 - 71 - 74 - 79 - - -`),
  },
};

export function createAudio({ on = true } = {}) {
  return createSynth({
    on, seed: 31, tracks: TRACKS, pulse: true, attack: 0.005, startDelay: 0.06, echo: { time: 0.21, feedback: 0.28, wet: 0.22, cut: 2600 },
    levels: { master: 0.55, music: 0.3, sfx: 0.72 },
    arrange: ({ tone, hiss, notes, hold }) => {
      const jingle = (t, secs) => hold(t + secs);
      return {
        step(tr, i, t, dt) {
          const [root, kind] = tr.bars[Math.floor(i / 16) % tr.bars.length], s = i % 16, ch = CH[kind];
          const n = tr.lead[i % tr.lead.length];
          if (n > 0) tone(midi(n), midi(n), t, dt * span(tr.lead, i, 8) * 0.95, 0.07, tr.duty, 'music');
          if (tr.bass[s] === 'x') tone(midi(root - 12), midi(root - 12), t, dt * 1.8, 0.15, 'triangle', 'music');
          if (s % 2 === 1) { const f = midi(root + 12 + ch[((s - 1) / 2) % 4]); tone(f, f, t, dt * 0.9, 0.026, 0.5, 'music'); }
          const d = tr.drums[s];
          if (d === 'k') tone(150, 45, t, 0.11, 0.2, 'sine', 'music');
          if (d === 's') hiss(t, 0.09, 0.07, 5500, 1400, 'bandpass', 'music');
          if (d === 'h') hiss(t, 0.025, 0.03, 9000, 7000, 'highpass', 'music');
        },
        effects: {
          jump: t => tone(330, 720, t, 0.11, 0.05, 0.25),
          land: (t, e) => { if ((e?.v ?? 0) > 6) { tone(120, 60, t, 0.08, 0.08, 'sine'); hiss(t, 0.06, 0.03, 1200, 300); } },
          step: t => tone(520, 640, t, 0.04, 0.025, 0.25),
          foot: (t, e) => (e?.slip ? hiss(t, 0.05, 0.012, 5000, 3000, 'highpass') : tone(180, 140, t, 0.025, 0.02, 'triangle')),
          shoot: t => { tone(900, 1500, t, 0.07, 0.04, 'sine'); tone(1300, 2100, t + 0.05, 0.05, 0.025, 'sine'); },
          poof: t => hiss(t, 0.05, 0.02, 4000, 1500, 'bandpass'),
          pop: t => { tone(1200, 200, t, 0.14, 0.06, 0.5); hiss(t, 0.12, 0.05, 6000, 800); notes([84, 88], t + 0.06, 0.05, 0.06, 0.04, 0.125); },
          stun: t => { for (let k = 0; k < 5; k++) tone(600 + (k % 2) * 140, 600 + (k % 2) * 140, t + k * 0.05, 0.04, 0.03, 'sine'); },
          push: t => { tone(240, 120, t, 0.1, 0.07, 0.5); hiss(t, 0.06, 0.04, 2000, 500); },
          crabfall: t => tone(700, 120, t, 0.5, 0.05, 0.25),
          crabsplash: t => hiss(t, 0.35, 0.06, 3000, 300),
          hit: t => { tone(400, 90, t, 0.3, 0.08, 0.5); hiss(t, 0.15, 0.06, 2500, 400); },
          bonk: t => tone(200, 150, t, 0.05, 0.05, 0.5),
          splash: t => { jingle(t, 1.6); hiss(t, 0.7, 0.12, 4000, 250); tone(500, 90, t, 0.5, 0.05, 'sine'); notes([67, 66, 65, 0, 60], t + 0.6, 0.14, 0.14, 0.06, 0.25); },
          door: t => { hiss(t, 0.5, 0.05, 300, 2500, 'bandpass', 'sfx', 3); tone(140, 280, t, 0.5, 0.04, 'triangle'); },
          doorout: t => tone(420, 300, t, 0.1, 0.03, 0.25),
          lift: t => { for (let k = 0; k < 3; k++) tone(110, 110, t + k * 0.07, 0.05, 0.04, 0.5); },
          liftstop: t => tone(160, 90, t, 0.06, 0.06, 0.5),
          creak: t => hiss(t, 0.15, 0.03, 1500, 600, 'bandpass', 'sfx', 4),
          crumble: t => { hiss(t, 0.3, 0.07, 1800, 200); tone(100, 50, t, 0.2, 0.05, 'triangle'); },
          regrow: t => tone(500, 700, t, 0.06, 0.015, 'sine'),
          drip: t => tone(1400, 500, t, 0.06, 0.03, 'sine'),
          squall: (t, e) => hiss(t, 0.8, 0.04, e?.side > 0 ? 800 : 2400, e?.side > 0 ? 2400 : 800, 'bandpass', 'sfx', 6),
          foeback: t => tone(300, 400, t, 0.05, 0.012, 'sine'),
          tick: (t, e) => tone(e?.n <= 3 ? 1320 : 990, e?.n <= 3 ? 1320 : 990, t, 0.05, 0.04, 0.25),
          timeup: t => { jingle(t, 2); notes([72, 0, 71, 0, 70, 0, 69], t, 0.12, 0.14, 0.07, 0.5); },
          life: t => notes([79, 83, 86, 91, 86, 91], t, 0.07, 0.12, 0.06, 0.25),
          respawn: t => notes([62, 66, 69, 74], t, 0.06, 0.1, 0.04, 0.125),
          go: t => notes([67, 72, 76], t, 0.07, 0.1, 0.05, 0.25),
          crown: t => { jingle(t, 3.2); notes([72, 76, 79, 84, 0, 79, 84, 88, 0, 91, 0, 96], t + 0.05, 0.11, 0.18, 0.07, 0.25); },
          tally: t => tone(1760, 1760, t, 0.025, 0.02, 0.125),
          sunk: t => { hiss(t, 1.2, 0.08, 900, 120); tone(80, 40, t, 1.0, 0.1, 'sine'); },
          gem: (t, e) => { const b = 84 + Math.min(10, e?.streak ?? 1); notes([b, b + 7], t, 0.05, 0.09, 0.05, 0.125); },
          skim: t => hiss(t, 0.25, 0.05, 3000, 600),
          bonus: () => {},
          bonusdone: (t, e) => { jingle(t, 2.4); notes(e?.perfect ? [72, 76, 79, 84, 88, 91, 96] : [72, 76, 79, 84], t, 0.09, 0.16, 0.07, 0.25); },
          over: t => { jingle(t, 3.4); notes([69, 0, 68, 0, 67, 0, 66, 0, 0, 62], t + 0.2, 0.18, 0.3, 0.07, 0.25); },
          move: t => tone(1100, 1100, t, 0.025, 0.03, 0.125),
          select: t => tone(660, 990, t, 0.08, 0.05, 0.25),
        },
      };
    },
  });
}
