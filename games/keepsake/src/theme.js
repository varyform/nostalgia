// The title theme, Wick's serenade under the lamps: sixteen bars in four sections (the tune, its
// answer, a bridge in D minor, the tune again at full band), played twice through with the
// second pass voiced differently, so it runs well over a minute before it repeats. The tune is
// written for Keepsake. It plays on the richer voices of @nostalgia/audio: an FM electric piano
// and music-box bells, a PWM pulse on the bridge, a supersaw pad and a sub bass, through a
// tempo-synced echo and its own compressor, which holds it level with the other tracks.
//
//   const play = themePlayer(v);   // in arrange(v); then step(tr, i, t, dt) → play(i, t, dt)
import { compressor, delay, line, midi, span } from '@nostalgia/audio';

const CH = { M: [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10] };
// one chord a bar: F Am Bb C | F Am Gm C | Dm Bb Gm C7 | F Am Bb C
const BARS = [
  [53, 'M'], [57, 'm'], [58, 'M'], [48, 'M'],
  [53, 'M'], [57, 'm'], [55, 'm'], [48, 'M'],
  [50, 'm'], [58, 'M'], [55, 'm'], [48, '7'],
  [53, 'M'], [57, 'm'], [58, 'M'], [48, 'M'],
];
// sixteen steps a bar; '-' holds, '.' rests
const TUNE = line(`
  77 - - - 76 - 74 - 72 - - - 69 - - -   72 - - - 76 - 79 - 81 - - - 79 - - -
  77 - - - 74 - 70 - 74 - 77 - 79 - - -   81 - - - 79 - 76 - 72 - - - - - - -
  77 - - - 76 - 74 - 72 - - - 69 - 72 -   76 - - - 72 - 69 - 76 - 79 - 81 - - -
  79 - - - 77 - 74 - 70 - 74 - 77 - - -   76 - - - 79 - 77 - 76 - 72 - - - - -
  74 - - - - - 69 - 72 - 74 - 77 - - -   74 - - - 70 - - - 65 - 70 - 74 - - -
  74 - - - 70 - 67 - 70 - 74 - 79 - - -   76 - - - 77 - 79 - 82 - - - 79 - 76 -
  77 - - - 76 - 74 - 72 - - - 69 - - -   72 - - - 76 - 79 - 81 - - - 84 - - -
  82 - - - 81 - 79 - 77 - 74 - 77 - 79 -   81 - - - 79 - 76 - 79 - - - 72 - - -`);
// each section: the pad's level and brightness, the bass (x root, o the fifth below), the
// drums (k kick, s snare, h hat) and the arpeggio, if any
const SECTIONS = [
  { pad: 0.014, cutoff: 650, bass: 'x.......o.......', drums: '................', arp: null },
  { pad: 0.018, cutoff: 950, bass: 'x.....x.o.......', drums: 'k...h...s...h...', arp: 'bell' },
  { pad: 0.022, cutoff: 1300, bass: 'x...x...o...x...', drums: 'k.h.h.k.s.h.h.h.', arp: 'pulse' },
  { pad: 0.026, cutoff: 1900, bass: 'x.....x.o...x...', drums: 'k.h.s.h.k.k.s.hh', arp: 'bell' },
];
const STEPS = BARS.length * 16;
const MAKEUP = -2; // dB: a touch over the in-game tracks, nothing competing with it on the title

export const THEME = { bpm: 96, theme: true };

export function themePlayer(v) {
  const { sub, supersaw, pulse, fm, hiss } = v;
  const out = v.insert(ac => compressor(ac, { threshold: -30, ratio: 2.5, knee: 8, attack: 0.015, release: 0.3, makeup: MAKEUP }));
  const space = v.insert(ac => delay(ac, { time: 0.47, feedback: 0.35, wet: 0.26, cut: 2400, pan: 0.3 }), out);
  return (i, t, dt) => {
    const k = i % STEPS,
      bar = k >> 4,
      s = k % 16,
      sec = bar >> 2,
      look = SECTIONS[sec],
      second = Math.floor(i / STEPS) % 2 === 1,
      [root, kind] = BARS[bar],
      ch = CH[kind];
    if (s === 0) {
      space.fx?.time.setTargetAtTime(dt * 3, t, 0.05); // a dotted eighth at the track's tempo
      for (const iv of ch.length > 3 ? ch.slice(1) : ch)
        supersaw(midi(root + 12 + iv), t, dt * 15, look.pad, {
          attack: dt * 5, decay: dt * 8, sustain: 0.8, release: dt * 8,
          cutoff: look.cutoff, envmod: 700, detune: 0.35, mix: 0.65, width: 0.9, bus: space,
        });
    }
    const b = look.bass[s];
    if (b === 'x' || b === 'o')
      sub(midi(root - (b === 'x' ? 12 : 17)), t, dt * (sec === 0 ? 7 : 2), 0.2, {
        punch: 3, drop: 0.03, drive: 0.15, tone: 900, decay: 0.4, sustain: 0.6, release: 0.08, bus: out,
      });

    const n = TUNE[k];
    if (n > 0) {
      const d = dt * span(TUNE, k, 12);
      if (sec === 2) {
        // the bridge: a reedy pulse, and on the second pass a piano an octave under it
        pulse(midi(n), t, d * 0.95, 0.05, {
          width: 0.25, pwm: 0.5, rate: 0.6, cutoff: 1400, envmod: 1800, reso: 0.2,
          decay: 0.3, sustain: 0.6, release: 0.12, bus: space,
        });
        if (second) fm(midi(n - 12), t, d * 0.95, 0.04, { ratio: 1, index: 1.5, modDecay: 0.3, decay: 0.8, sustain: 0.3, release: 0.3, bus: space });
      } else if (second && sec === 0) {
        // the second time round the tune opens on a music box
        fm(midi(n + 12), t, d + 0.6, 0.035, { ratio: 3.5, index: 2.5, modDecay: 0.3, modSustain: 0.1, decay: 0.7, sustain: 0.1, release: 0.5, bus: space });
        fm(midi(n), t, d * 0.95, 0.025, { ratio: 1, index: 1.2, decay: 0.8, sustain: 0.3, release: 0.3, bus: space });
      } else {
        fm(midi(n), t, d * 0.95, 0.075, { ratio: 1, index: 2, modDecay: 0.35, modSustain: 0.25, decay: 0.9, sustain: 0.35, release: 0.35, bus: space });
        if (sec === 3) {
          supersaw(midi(n), t, d * 0.95, 0.022, { detune: 0.2, mix: 0.4, cutoff: 2200, envmod: 1400, attack: 0.02, release: 0.3, bus: space });
          if (second) fm(midi(n + 12), t, d + 0.4, 0.02, { ratio: 3.5, index: 2, modDecay: 0.25, decay: 0.6, sustain: 0.1, release: 0.4, bus: space });
        }
      }
    }

    if (s % 2 === 0 && look.arp === 'bell')
      fm(midi(root + 24 + ch[(s / 2) % 3]), t, dt * 2, second ? 0.022 : 0.016, {
        ratio: 3.5, index: 1.2, modDecay: 0.2, decay: 0.4, sustain: 0.1, release: 0.3, bus: space,
      });
    if (s % 2 === 0 && look.arp === 'pulse')
      pulse(midi(root + 12 + ch[[0, 1, 2, 1][(s / 2) % 4]]), t, dt * 1.1, 0.028, {
        width: 0.5, cutoff: 800, envmod: 2400, decay: dt, sustain: 0.2, release: 0.06, bus: space,
      });

    // drums; the bridge's last half-bar is a snare roll, swelling into the tune's return
    const dr = bar === 11 && s >= 8 ? 's' : look.drums[s];
    if (dr === 'k') sub(55, t, 0.14, 0.26, { punch: 22, drop: 0.04, drive: 0.3, tone: 3000, decay: 0.16, sustain: 0, release: 0.04, bus: out });
    if (dr === 's') hiss(t, 0.14, bar === 11 && s >= 8 ? 0.02 + 0.006 * (s - 8) : 0.05, 5000, 1500, 'bandpass', out, 0.8);
    if (dr === 'h') hiss(t, 0.025, 0.02, 10000, 7500, 'highpass', out);
  };
}
