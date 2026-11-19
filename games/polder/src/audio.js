// Procedural sound on the shared engine, every tune written for Polder. The title has "Low
// Water", sixteen bars in four sections (the tune, its answer, a bridge that climbs out of
// the minor, the tune again with the whole band), played twice with the second pass voiced
// differently. Play has three tunes that change every four stages: "Mudflat Reel" (dorian,
// light), "Grey Sound" (E minor, driving) and "Storm Reach" (C minor, gritty). Each tune has
// its own band (LOOK): the lead on FM keys, PWM pulses, a thin supersaw or bells, a supersaw
// pad, an arpeggio, a sub bass and a kit, through a tempo-synced echo, with a compressor on
// the music bus that holds the tunes level with each other and under the effects. The
// effects keep to plainer voices. The context is only made by unlock(), which the page calls
// from a user gesture; the demo never makes one.
//
//   const audio = createAudio({ on: true });
//   audio.unlock();  audio.music('flats');  audio.sfx('claim', { n: 240 });  audio.setOn(false);
import { compressor, createSynth, delay, distortion, line, midi, span } from '@nostalgia/audio';

const CH = { M: [0, 4, 7, 12], m: [0, 3, 7, 12] };

// "Low Water": one chord a bar, Am F C G | Am F C E | Dm G C Am | F G E Am
const THEME_BARS = [
  [57, 'm'], [53, 'M'], [48, 'M'], [55, 'M'],
  [57, 'm'], [53, 'M'], [48, 'M'], [52, 'M'],
  [50, 'm'], [55, 'M'], [48, 'M'], [57, 'm'],
  [53, 'M'], [55, 'M'], [52, 'M'], [57, 'm'],
];
const THEME_TUNE = line(`
  76 - - - 72 - 74 - 76 - - - 69 - - -   72 - - - 69 - 65 - 69 - - - - - . .
  67 - - - 72 - 76 - 79 - - - 77 - 76 -   74 - - - - - 71 - 67 - - - - - - -
  76 - - - 72 - 74 - 76 - - - 81 - - -   79 - 77 - 76 - 72 - 69 - - - 72 - - -
  76 - - - 79 - 76 - 72 - 74 - 76 - - -   76 - - - 71 - 68 - 71 - - - - - - -
  74 - 77 - 81 - - - 79 - 77 - 74 - - -   71 - 74 - 79 - - - 77 - 74 - 71 - - -
  72 - 76 - 79 - - - 84 - - - 83 - 81 -   81 - - - 76 - - - 72 - - - - - - -
  77 - - - 76 - 74 - 72 - - - 69 - 72 -   74 - - - 79 - 77 - 74 - - - 71 - 74 -
  76 - - - 80 - 83 - 80 - 76 - 74 - 71 -   69 - - - - - - - - - - - . . . .`);
// each section: the pad's level and brightness, the lead's voice, the bass (x root, o the
// fifth below), the drums (k kick, s snare, h hat) and the arpeggio
const THEME_SECTIONS = [
  { pad: 0.014, cutoff: 700, lead: 'pulse', bass: 'x.......o.......', drums: '................', arp: null },
  { pad: 0.018, cutoff: 1000, lead: 'keys', bass: 'x.....x.o.......', drums: 'k.......s.......', arp: 'bell' },
  { pad: 0.022, cutoff: 1500, lead: 'saw', bass: 'x...x...o...x...', drums: 'k...h.k.s...h...', arp: 'pulse' },
  { pad: 0.026, cutoff: 1900, lead: 'keys', bass: 'x.....x.o...x...', drums: 'k.h.s.h.k.k.s.hh', arp: 'bell' },
];
const THEME_STEPS = THEME_BARS.length * 16;

// the in-play tunes: 16 steps a bar, one chord a bar
const TRACKS = {
  title: { bpm: 92, theme: true },
  // "Mudflat Reel": stages 1–4, D dorian
  flats: {
    bpm: 112, duty: 0.25, bass: 'x.....x.x...x...', drums: 'k...h.k.s...h..h',
    bars: [[50, 'm'], [55, 'M'], [50, 'm'], [48, 'M'], [46, 'M'], [48, 'M'], [45, 'm'], [50, 'm']],
    lead: line(`69 - 74 - 77 - 76 74 - 72 74 - 69 - - -   71 - 74 - 79 - 77 76 - 74 71 - 67 - - -
                69 - 74 - 77 - 81 - 79 - 77 - 76 - 74 -   72 - 76 - 79 - 76 - 72 - - - 67 - - -
                70 - 74 - 77 - 74 - 82 - 81 - 77 - 74 -   72 - 76 - 79 - 84 - 83 - 79 - 76 - 72 -
                76 - 72 - 69 - 72 - 76 - 81 - 79 - 76 -   74 - - - 69 - 65 - 62 - - - - - - -`),
  },
  // "Grey Sound": stages 5–8, E minor
  sound: {
    bpm: 124, duty: 0.5, bass: 'x.x...x.x.x...x.', drums: 'k.h.s.h.k.hhs.h.',
    bars: [[52, 'm'], [48, 'M'], [55, 'M'], [50, 'M'], [52, 'm'], [48, 'M'], [50, 'M'], [47, 'M']],
    lead: line(`76 . 76 79 - 76 . 74 - 71 . 74 - 76 - -   72 . 72 76 - 72 . 71 - 67 . 71 - 72 - -
                74 . 74 79 - 83 . 81 - 79 . 78 - 79 - -   78 - 74 - 69 - 74 - 78 - 81 - 78 - - -
                79 - 76 - 71 - 76 - 79 - 83 - 88 - 86 -   84 - 79 - 76 - 79 - 84 - 83 - 79 - 76 -
                78 - 81 - 86 - 81 - 78 - 74 - 81 - 78 -   75 - - - 78 - - - 83 - - - 71 - - -`),
  },
  // "Storm Reach": stages 9–12, C minor
  storm: {
    bpm: 136, duty: 0.125, bass: 'x.x.x.x.x.x.x.x.', drums: 'k.hhs.h.k.hhs.hs',
    bars: [[48, 'm'], [44, 'M'], [46, 'M'], [43, 'M'], [48, 'm'], [51, 'M'], [46, 'M'], [43, 'M']],
    lead: line(`72 72 . 75 . 72 79 - 77 75 . 74 . 72 - -   72 72 . 75 . 72 80 - 79 77 . 75 . 72 - -
                74 74 . 77 . 74 82 - 80 79 . 77 . 74 - -   71 - 74 - 79 - 83 - 86 - 83 - 79 - 74 -
                84 - - 82 - 79 - - 75 - 79 - 82 - 84 -   82 - - 79 - 75 - - 70 - 75 - 79 - 82 -
                80 - 79 - 77 - 74 - 77 - 79 - 80 - 82 -   83 - - - 79 - - - 74 - - - 71 - 74 -`),
  },
};
// how each tune is played: the lead's voice and what doubles it, the pad, the arpeggio, the
// bass's drive, grit on the lead
const LOOK = {
  flats: { lead: 'keys', double: 'bell', pad: 0.014, cutoff: 1100, arp: 'bell', drive: 0.15 },
  sound: { lead: 'pulse', double: 'keys', pad: 0.013, cutoff: 1500, arp: 'pulse', drive: 0.35 },
  storm: { lead: 'saw', double: 'pulse', pad: 0.012, cutoff: 2000, arp: 'pulse', drive: 0.55, grit: true },
};
for (const [name, tr] of Object.entries(TRACKS)) tr.look = LOOK[name];
const MAKEUP = -7; // dB after the compressor: the music well under the effects

export function createAudio({ on = true } = {}) {
  return createSynth({
    on, seed: 53, tracks: TRACKS, pulse: true, attack: 0.005, startDelay: 0.06,
    levels: { master: 0.55, music: 0.32, sfx: 0.72 },
    inserts: { music: ac => compressor(ac, { threshold: -32, ratio: 3, knee: 8, attack: 0.012, release: 0.25, makeup: MAKEUP }) },
    arrange: v => {
      const { tone, hiss, notes, hold, sub, supersaw, pulse, fm } = v;
      // the salt air: a dotted-eighth echo, darker each repeat, a little left of centre
      const space = v.insert(ac => delay(ac, { time: 0.33, feedback: 0.34, wet: 0.26, cut: 2400, pan: -0.25 }));
      const grit = v.insert(ac => distortion(ac, { amount: 0.4, ceiling: 0.05, mix: 0.45 }), space);
      const play = (what, n, t, d, vol, duty = 0.25, bus = space) => {
        const f = midi(n);
        if (what === 'keys') fm(f, t, d, 0.075 * vol, { ratio: 1, index: 2, modDecay: 0.3, modSustain: 0.25, decay: 0.8, sustain: 0.35, release: 0.3, bus });
        if (what === 'bell') fm(midi(n + 12), t, d + 0.3, 0.04 * vol, { ratio: 3.5, index: 2.2, modDecay: 0.25, modSustain: 0.1, decay: 0.6, sustain: 0.15, release: 0.4, bus });
        if (what === 'pulse')
          pulse(f, t, d, 0.06 * vol, { width: (0.5 - duty) / 0.45, pwm: 0.5, rate: 0.5, cutoff: 1500, envmod: 2000, reso: 0.2, decay: 0.3, sustain: 0.65, release: 0.1, bus });
        if (what === 'saw') supersaw(f, t, d, 0.04 * vol, { detune: 0.2, mix: 0.35, width: 0.5, cutoff: 2000, envmod: 2400, reso: 0.15, attack: 0.008, decay: 0.25, sustain: 0.6, release: 0.15, bus });
      };
      const kit = (d, t, soft = 1, roll = 0) => {
        if (d === 'k') sub(54, t, 0.14, 0.28 * soft, { punch: 24, drop: 0.04, drive: 0.45, tone: 3200, decay: 0.16, sustain: 0, release: 0.04 });
        if (d === 's') { hiss(t, 0.12, (roll || 0.065) * soft, 6000, 1400, 'bandpass', 'music', 0.9); if (!roll) tone(200, 150, t, 0.06, 0.035 * soft, 'triangle', 'music'); }
        if (d === 'h') hiss(t, 0.025, 0.026 * soft, 10000, 7500, 'highpass', 'music');
      };
      const pad = (root, ch, t, dt, level, cutoff) => {
        for (const iv of ch.slice(0, 3))
          supersaw(midi(root + 12 + iv), t, dt * 15, level, { attack: dt * 4, decay: dt * 8, sustain: 0.8, release: dt * 7, cutoff, envmod: 800, detune: 0.35, mix: 0.65, width: 0.9, bus: space });
      };

      function theme(i, t, dt) {
        const k = i % THEME_STEPS, bar = k >> 4, s = k % 16, sec = bar >> 2, look = THEME_SECTIONS[sec], second = Math.floor(i / THEME_STEPS) % 2 === 1;
        const [root, kind] = THEME_BARS[bar], ch = CH[kind];
        if (s === 0) { space.fx?.time.setTargetAtTime(dt * 3, t, 0.05); pad(root, ch, t, dt, look.pad, look.cutoff); }
        const b = look.bass[s];
        if (b === 'x' || b === 'o') sub(midi(root - (b === 'x' ? 12 : 17)), t, dt * (sec === 0 ? 7 : 2), 0.2, { punch: 3, drop: 0.03, drive: 0.12, tone: 900, decay: 0.4, sustain: 0.6, release: 0.08 });
        const n = THEME_TUNE[k];
        if (n > 0) {
          const d = dt * span(THEME_TUNE, k, 12) * 0.95;
          // the second time round the tune opens on a music box, and the bridge gets keys under it
          const lead = second && sec === 0 ? 'bell' : look.lead;
          play(lead, n, t, d, lead === 'bell' ? 1.1 : 1, 0.3);
          if (sec === 3) play('bell', n, t, d, second ? 0.7 : 0.45);
          if (sec === 2 && second) play('keys', n - 12, t, d, 0.5);
        }
        if (s % 2 === 0 && look.arp === 'bell') fm(midi(root + 24 + ch[(s / 2) % 3]), t, dt * 2, second ? 0.02 : 0.015, { ratio: 3.5, index: 1.2, modDecay: 0.2, decay: 0.4, sustain: 0.1, release: 0.3, bus: space });
        if (s % 2 === 0 && look.arp === 'pulse') pulse(midi(root + 12 + ch[[0, 1, 2, 1][(s / 2) % 4]]), t, dt * 1.1, 0.026, { width: 0.5, cutoff: 800, envmod: 2400, decay: dt, sustain: 0.2, release: 0.06, bus: space });
        // the bridge's last half-bar rolls into the tune's return
        const roll = bar === 11 && s >= 8;
        kit(roll ? 's' : look.drums[s], t, 0.8, roll ? 0.02 + 0.006 * (s - 8) : 0);
      }

      return {
        step(tr, i, t, dt) {
          if (tr.theme) return theme(i, t, dt);
          const bars = tr.bars.length, bar = Math.floor(i / 16) % bars, s = i % 16, [root, kind] = tr.bars[bar], ch = CH[kind], look = tr.look;
          const full = bar >= bars / 2; // the second half of the tune fills in
          if (s === 0) { space.fx?.time.setTargetAtTime(dt * 3, t, 0.05); pad(root, ch, t, dt, look.pad * (full ? 1 : 0.55), look.cutoff * (full ? 1 : 0.7)); }
          const n = tr.lead[i % tr.lead.length];
          if (n > 0) {
            const d = dt * span(tr.lead, i, 8) * 0.95;
            play(look.lead, n, t, d, 1, tr.duty, look.grit ? grit : space);
            if (full) play(look.double, n, t, d, 0.4, tr.duty);
          }
          if (tr.bass[s] === 'x') sub(midi(root - 12), t, dt * 1.6, 0.2, { punch: 4, drop: 0.03, drive: look.drive, tone: 700 + 1600 * look.drive, decay: 0.25, sustain: 0.5, release: 0.05 });
          if (s % 2 === 1) {
            const a = root + 12 + ch[((s - 1) / 2) % 4];
            if (look.arp === 'bell') fm(midi(a + 12), t, dt * 1.5, full ? 0.016 : 0.011, { ratio: 3.5, index: 1.2, modDecay: 0.2, decay: 0.35, sustain: 0.1, release: 0.25, bus: space });
            else pulse(midi(a), t, dt * 0.9, full ? 0.024 : 0.016, { width: 0.5, cutoff: 900, envmod: 2600, decay: dt, sustain: 0.2, release: 0.05, bus: space });
          }
          const roll = bar === bars - 1 && s >= 12;
          kit(roll ? 's' : tr.drums[s], t, 1, roll ? 0.03 + 0.008 * (s - 12) : 0);
          if (full && !roll && s % 4 === 2) hiss(t, 0.1, 0.014, 9000, 6000, 'highpass', 'music');
        },
        effects: {
          tick: t => tone(660, 660, t, 0.03, 0.03, 0.5),
          select: t => tone(620, 930, t, 0.07, 0.05, 0.25),
          card: t => notes([69, 72, 76, 81], t, 0.09, 0.24, 0.05, 'triangle'),
          go: t => notes([76, 81], t, 0.07, 0.12, 0.045, 0.25),
          respawn: t => notes([64, 69, 72], t, 0.06, 0.1, 0.04, 0.125),
          // pushing off the land onto the water
          launch: t => { hiss(t, 0.2, 0.06, 2400, 500, 'bandpass', 'sfx', 1.2); tone(280, 520, t, 0.12, 0.04, 'triangle'); },
          // each stake of the dyke, quietly rising as it gets longer
          wake: (t, e) => { const f = 480 * 2 ** (Math.min(72, e?.n ?? 0) / 48); tone(f, f * 0.94, t, 0.035, 0.014, 'sine'); },
          // the dyke closes (a thunk), the water drains away (a gurgle as long as the sweep), and a run of notes as big as the cut
          claim: (t, e) => {
            const n = e?.n ?? 20, big = Math.min(1, n / 600), len = 0.35 + Math.min(1.1, n / 900);
            tone(150, 55, t, 0.2, 0.12, 'sine'); hiss(t, 0.08, 0.05, 900, 200);
            hiss(t + 0.04, len, 0.03 + 0.05 * big, 1400, 160, 'lowpass', 'sfx', 2.5, len * 0.3);
            const run = [69, 73, 76, 81, 85, 88, 93].slice(0, 2 + Math.min(5, Math.floor(n / 90)));
            notes(run, t + 0.06, 0.055, 0.2, 0.035 + 0.02 * big, 'triangle');
            if (n > 300) fm(midi(93), t + 0.06 + run.length * 0.055, 0.8, 0.03, 3.5, 1.4, 'sfx');
          },
          pearl: t => { notes([88, 93, 96], t, 0.05, 0.22, 0.045, 'sine'); fm(midi(100), t + 0.15, 0.6, 0.025, 3.5, 1.3, 'sfx'); },
          slack: t => { tone(200, 95, t, 1.1, 0.07, 'sine'); tone(400, 190, t + 0.05, 1.0, 0.025, 'triangle'); hiss(t, 1.0, 0.03, 600, 2000, 'bandpass', 'sfx', 4, 0.3); },
          slackend: t => tone(220, 330, t, 0.3, 0.03, 'triangle'),
          bounce: (t, e) => { const f = e?.who === 'nettle' ? 900 : 640; tone(f, f * 0.75, t, 0.08, 0.016, 'sine'); },
          tide: t => { fm(midi(84), t, 0.9, 0.05, 3.5, 2, 'sfx'); fm(midi(79), t + 0.3, 1.2, 0.045, 3.5, 2, 'sfx'); },
          undertow: t => { tone(70, 42, t, 1.3, 0.1, 'sine'); hiss(t, 1.2, 0.05, 500, 140, 'lowpass', 'sfx', undefined, 0.3); },
          death: (t, e) => {
            hold(t + 1.6);
            hiss(t, 0.6, 0.13, 3200, 200);
            tone(330, 70, t, 0.55, 0.08, 'triangle');
            if (e?.cause === 'crab') { tone(1500, 900, t, 0.06, 0.04, 0.25); tone(1500, 900, t + 0.08, 0.06, 0.04, 0.25); }
            notes([64, 63, 62, 60], t + 0.35, 0.16, 0.26, 0.055, 0.25);
          },
          clear: t => { hold(t + 3.2); notes([69, 73, 76, 81, 0, 76, 81, 85], t, 0.11, 0.3, 0.065, 0.25); notes([57, 61, 64, 69], t, 0.22, 0.42, 0.06, 'triangle'); },
          life: t => notes([81, 85, 88, 93, 88, 93], t, 0.07, 0.13, 0.055, 0.25),
          over: t => { hold(t + 3.4); notes([69, 0, 67, 0, 65, 64, 62, 0, 57], t + 0.2, 0.19, 0.34, 0.065, 0.25); },
        },
      };
    },
  });
}
