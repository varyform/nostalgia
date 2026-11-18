// Procedural sound on the shared engine, all original tunes: a lilting title air, three
// climbing themes that take turns tower by tower, a breezy kite tune, and jingles for the
// crown, the time running out and the end. Each tune has its own band (LOOK): the lead on an
// FM piano, PWM pulses, a supersaw or bells, a supersaw pad that fills in over the second
// half, an arpeggio, a sub bass and a kit, through a dotted-eighth echo for the sea air and a
// compressor that holds the tunes level with each other. The jingles and effects keep their
// chiptune voices. The context is only made by unlock(), which the page calls from a user
// gesture; the demo never makes one.
//
//   const audio = createAudio({ on: true });
//   audio.unlock(); audio.music('climb1'); audio.sfx('jump'); audio.setOn(false);
import { compressor, createSynth, delay, distortion, line, midi, span } from '@nostalgia/audio';

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

// How each tune is played: the lead's instrument (keys: FM piano, pulse, saw: a thin
// supersaw, bell) and what doubles it, the pad's level and brightness, the arpeggio's voice,
// how hard the bass is driven, and the kit (soft for the title).
const LOOK = {
  title: { lead: 'keys', double: 'pulse', pad: 0.016, cutoff: 900, arp: 'bell', drive: 0.1, soft: true },
  climb1: { lead: 'pulse', double: 'keys', pad: 0.013, cutoff: 1400, arp: 'bell', drive: 0.3 },
  climb2: { lead: 'pulse', double: 'bell', pad: 0.015, cutoff: 1000, arp: 'pulse', drive: 0.25 },
  climb3: { lead: 'saw', grit: true, pad: 0.013, cutoff: 1800, arp: 'pulse', drive: 0.5 },
  bonus: { lead: 'bell', double: 'pulse', pad: 0.012, cutoff: 2200, arp: 'pulse', drive: 0.3 },
};
for (const [name, tr] of Object.entries(TRACKS)) tr.look = LOOK[name];
const MAKEUP = -6; // dB, after the compressor: the tunes at the level they had

export function createAudio({ on = true } = {}) {
  return createSynth({
    on, seed: 31, tracks: TRACKS, pulse: true, attack: 0.005, startDelay: 0.06,
    levels: { master: 0.55, music: 0.3, sfx: 0.72 },
    inserts: { music: ac => compressor(ac, { threshold: -34, ratio: 3, knee: 8, attack: 0.012, release: 0.25, makeup: MAKEUP }) },
    arrange: v => {
      const { tone, hiss, notes, hold, sub, supersaw, pulse, fm } = v;
      const jingle = (t, secs) => hold(t + secs);
      // the sea air: a dotted-eighth echo, darker each time, a little right of centre
      const space = v.insert(ac => delay(ac, { time: 0.3, feedback: 0.34, wet: 0.24, cut: 2600, pan: 0.3 }));
      const grit = v.insert(ac => distortion(ac, { amount: 0.45, ceiling: 0.05, mix: 0.5 }), space);
      // one note of the lead on an instrument; d is its length, vol scales it (a doubling is quieter)
      const play = (what, n, t, d, vol, tr, bus = space) => {
        const f = midi(n);
        if (what === 'keys') fm(f, t, d, 0.075 * vol, { ratio: 1, index: 2, modDecay: 0.3, modSustain: 0.25, decay: 0.7, sustain: 0.4, release: 0.25, bus });
        if (what === 'bell') fm(midi(n + 12), t, d + 0.3, 0.04 * vol, { ratio: 3.5, index: 2.2, modDecay: 0.25, modSustain: 0.1, decay: 0.6, sustain: 0.15, release: 0.4, bus });
        if (what === 'pulse')
          pulse(f, t, d, 0.06 * vol, { width: (0.5 - tr.duty) / 0.45, pwm: 0.5, rate: 0.5, cutoff: 1500, envmod: 2000, reso: 0.2, decay: 0.3, sustain: 0.65, release: 0.1, bus });
        if (what === 'saw') supersaw(f, t, d, 0.04 * vol, { detune: 0.2, mix: 0.35, width: 0.5, cutoff: 2000, envmod: 2400, reso: 0.15, attack: 0.008, decay: 0.25, sustain: 0.6, release: 0.15, bus });
      };
      return {
        step(tr, i, t, dt) {
          const bars = tr.bars.length, bar = Math.floor(i / 16) % bars, s = i % 16,
            [root, kind] = tr.bars[bar], ch = CH[kind], look = tr.look,
            full = bars < 8 || bar >= bars / 2; // the second half of the tune fills in
          if (s === 0) {
            space.fx?.time.setTargetAtTime(dt * 3, t, 0.05); // in time with the tune
            for (const iv of ch.slice(0, 3))
              supersaw(midi(root + 12 + iv), t, dt * 15, look.pad * (full ? 1 : 0.55), {
                attack: dt * 4, decay: dt * 8, sustain: 0.8, release: dt * 6, cutoff: look.cutoff * (full ? 1 : 0.7),
                envmod: 800, detune: 0.35, mix: 0.65, width: 0.9, bus: space,
              });
          }
          const n = tr.lead[i % tr.lead.length];
          if (n > 0) {
            const d = dt * span(tr.lead, i, 8) * 0.95;
            play(look.lead, n, t, d, 1, tr, look.grit ? grit : space);
            if (look.double && full) play(look.double, n, t, d, 0.4, tr);
          }
          if (tr.bass[s] === 'x')
            sub(midi(root - 12), t, dt * 1.6, 0.2, { punch: 4, drop: 0.03, drive: look.drive, tone: 700 + 1600 * look.drive, decay: 0.25, sustain: 0.5, release: 0.05 });
          if (s % 2 === 1) {
            const a = root + 12 + ch[((s - 1) / 2) % 4];
            if (look.arp === 'bell') fm(midi(a + 12), t, dt * 1.5, full ? 0.016 : 0.011, { ratio: 3.5, index: 1.2, modDecay: 0.2, decay: 0.35, sustain: 0.1, release: 0.25, bus: space });
            else pulse(midi(a), t, dt * 0.9, full ? 0.026 : 0.018, { width: 0.5, cutoff: 900, envmod: 2600, decay: dt, sustain: 0.2, release: 0.05, bus: space });
          }
          // the kit; a snare run into the top of the tune on its last bar
          const roll = !look.soft && bar === bars - 1 && s >= 12;
          const d = roll ? 's' : tr.drums[s], soft = look.soft ? 0.6 : 1;
          if (d === 'k') sub(54, t, 0.14, 0.3 * soft, { punch: 24, drop: 0.04, drive: 0.5, tone: 3500, decay: 0.16, sustain: 0, release: 0.04 });
          if (d === 's') {
            hiss(t, 0.12, (roll ? 0.03 + 0.008 * (s - 12) : 0.07) * soft, 6000, 1400, 'bandpass', 'music', 0.9);
            if (!roll) tone(210, 150, t, 0.06, 0.04 * soft, 'triangle', 'music');
          }
          if (d === 'h') hiss(t, 0.025, 0.028 * soft, 10000, 7500, 'highpass', 'music');
          else if (full && !look.soft && s % 4 === 2) hiss(t, 0.1, 0.016, 9000, 6000, 'highpass', 'music');
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
