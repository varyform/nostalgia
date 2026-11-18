// The HD version's score: the VGA tracks (../audio.js) re-orchestrated for a modern synth.
// A punched sub bass and a clipped kick under each bar, a slow supersaw pad on the chord,
// the arpeggio as PWM pulses or FM bells, the lead an FM electric piano doubled by a thin
// supersaw. The melodic parts share a tempo-synced echo; in the heavier zones the arpeggio is
// clipped or folded first; a compressor on the music bus evens the tracks out against each
// other. The effects are the VGA ones.
//
//   const audio = createHdAudio({ on: true });   // the same API as createAudio
import { compressor, createSynth, delay, distortion, midi } from '@nostalgia/audio';
import { CH, TRACKS, sounds } from '../audio.js';

// How each track is voiced: the pad's brightness and level, the arpeggio's instrument (and its
// grit: clipped or folded), how hard the bass is driven, and whether the hats open off the beat.
const LOOK = {
  title: { pad: 0.03, cutoff: 900, arp: 'bell', drive: 0.15, octave: 12 },
  zone0: { pad: 0.022, cutoff: 1300, arp: 'pulse', width: 0.2, drive: 0.35 },
  zone1: { pad: 0.03, cutoff: 650, arp: 'bell', drive: 0.1, octave: 12 },
  zone2: { pad: 0.02, cutoff: 1800, arp: 'pulse', width: 0.55, drive: 0.55, open: true, grit: 'clip' },
  boss: { pad: 0.022, cutoff: 2200, arp: 'pulse', width: 0.7, drive: 0.75, open: true, grit: 'fold' },
  final: { pad: 0.024, cutoff: 1600, arp: 'bell', drive: 0.6, octave: 0, open: true },
  victory: { pad: 0.03, cutoff: 1400, arp: 'bell', drive: 0.2, octave: 12 },
};

const MAKEUP = -4; // dB: the music sits a little over the VGA score against the effects
const NAMES = new Map(Object.entries(TRACKS).map(([k, tr]) => [tr, k]));

export function createHdAudio({ on = true } = {}) {
  return createSynth({
    on,
    seed: 7,
    levels: { master: 0.6, music: 0.4, sfx: 0.7 },
    tracks: TRACKS,
    // the quiet tracks up, the busy ones down: within a few dB of each other
    inserts: { music: ac => compressor(ac, { threshold: -30, ratio: 3, knee: 8, attack: 0.01, release: 0.25, makeup: MAKEUP }) },
    arrange: v => {
      const { hiss, sub, supersaw, pulse, fm } = v;
      // a dotted-eighth echo, darker each repeat, a little to the left
      const space = v.insert(ac => delay(ac, { time: 0.3, feedback: 0.38, wet: 0.3, cut: 2600, pan: -0.35 }));
      const grit = {
        clip: v.insert(ac => distortion(ac, { amount: 0.5, ceiling: 0.04, mix: 0.6 }), space),
        fold: v.insert(ac => distortion(ac, { amount: 0.35, shape: 0.4, ceiling: 0.04, mix: 0.5, gain: 0.8 }), space),
      };
      return {
        step(tr, i, t, dt) {
          const look = LOOK[NAMES.get(tr)];
          const [root, kind] = tr.bars[Math.floor(i / 16) % tr.bars.length],
            ch = CH[kind],
            s = i % 16;
          if (s === 0) space.fx?.time.setTargetAtTime(dt * 3, t, 0.05); // in time with the track
          // the pad: the chord's three lower notes, swelling in over the bar
          if (s === 0) {
            const base = root < 50 ? root + 12 : root;
            for (const iv of ch.slice(0, 3))
              supersaw(midi(base + iv), t, dt * 15, look.pad, {
                attack: dt * 4,
                decay: dt * 8,
                sustain: 0.8,
                release: dt * 6,
                cutoff: look.cutoff,
                envmod: 900,
                reso: 0.1,
                detune: 0.4,
                mix: 0.7,
                bus: space,
              });
          }
          if (tr.bass[s] === 'x')
            sub(midi(root - 12), t, dt * 1.3, 0.2, {
              punch: 5,
              drop: 0.03,
              drive: look.drive,
              tone: 700 + 1400 * look.drive,
              decay: 0.25,
              sustain: 0.55,
              release: 0.04,
            });
          if (s % 2 === 0) {
            const n = root + 12 + ch[tr.arp[(s / 2) % tr.arp.length]];
            if (look.arp === 'pulse')
              pulse(midi(n), t, dt * 1.2, 0.05, {
                width: look.width,
                pwm: 0.6,
                rate: 0.4,
                cutoff: 900,
                envmod: 3000,
                reso: 0.3,
                decay: dt * 1.5,
                sustain: 0.25,
                release: 0.08,
                bus: look.grit ? grit[look.grit] : space,
              });
            else
              fm(midi(n + look.octave), t, dt * 1.5, 0.045, {
                ratio: tr.ratio,
                index: tr.index * 1.6,
                modDecay: 0.25,
                modSustain: 0.15,
                decay: 0.5,
                sustain: 0.15,
                release: 0.35,
                bus: space,
              });
          }
          if (tr.lead) {
            const n = tr.lead[i % tr.lead.length];
            if (n) {
              fm(midi(n), t, dt * 3, 0.07, { ratio: 1, index: 2.2, modDecay: 0.4, modSustain: 0.25, decay: 0.8, sustain: 0.4, release: 0.4, bus: space });
              supersaw(midi(n), t, dt * 3, 0.02, { detune: 0.2, mix: 0.4, cutoff: 2400, envmod: 1500, attack: 0.02, release: 0.3, bus: space });
            }
          }
          const d = tr.drums[s];
          if (d === 'k')
            sub(52, t, 0.16, 0.4, { punch: 26, drop: 0.045, drive: 0.6, tone: 4000, decay: 0.2, sustain: 0, release: 0.05 });
          if (d === 's') {
            hiss(t, 0.16, 0.14, 7000, 1400, 'lowpass', 'music');
            hiss(t, 0.05, 0.08, 2200, 1800, 'bandpass', 'music', 2);
          }
          if (d === 'h') hiss(t, 0.03, 0.035, 11000, 8000, 'highpass', 'music');
          else if (look.open && s % 4 === 2) hiss(t, 0.12, 0.025, 10000, 6000, 'highpass', 'music');
        },
        ...sounds(v),
      };
    },
  });
}
