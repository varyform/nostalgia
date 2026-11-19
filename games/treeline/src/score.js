// Treeline's music, all original and made in code on @nostalgia/audio's richer voices.
//
//   title     D minor, 108 bpm, 36 bars (80 s): intro, theme, a lift to F, a breakdown of bells,
//             the theme again at full band, a tag; a rotor-like chug of sixteenths under it
//   briefing  C minor, 88 bpm, 16 bars: a 3+3+2 pulse under the map, a far ping, a sparse motif
//   debrief   B♭ major, 72 bpm, 16 bars: electric piano and a plucked arpeggio over a warm pad
//   victory   D major, 116 bpm: a four-bar fanfare, then a soft loop of bells and pad
//   over      G minor, 63 bpm: a five-bar dirge, then silence
//   flight0   Mirewater Delta, E Dorian, 76 bpm: humid pads, log drums, insects, far birds
//   flight1   Amberfold Vale, A Aeolian, 66 bpm: a low plucked ostinato, wind swells, a far bell
//   flight2   Greyhorn Pass, D suspended, 58 bpm: dark fifths, a ticking pulse, glassy swells
//
// The flight beds are ambient (no tune to follow) and sit well under the rotor: each track has a
// `gain`, its level after the music bus's compressor (which evens the tracks out against each
// other); the synth glides the music to it as the track starts.
//
//   const play = score(v);   // in arrange(v): step: play
import { delay, line, midi, span } from '@nostalgia/audio';

const CH = {
  m: [0, 3, 7],
  M: [0, 4, 7],
  m7: [0, 3, 7, 10],
  M7: [0, 4, 7, 11],
  M9: [0, 4, 7, 14],
  sus: [0, 5, 7],
  sus2: [0, 2, 7],
  7: [0, 4, 7, 10],
};

// ---------- title ----------
// intro (4) | theme (8) | lift (8) | breakdown (4) | theme again (8) | tag (4), one chord a bar
const TITLE_BARS = [
  [38, 'm'], [38, 'm'], [46, 'M'], [36, 'M'],
  [38, 'm'], [46, 'M'], [36, 'M'], [45, 'm'], [38, 'm'], [46, 'M'], [43, 'm'], [45, 'M'],
  [41, 'M'], [36, 'M'], [46, 'M'], [38, 'm'], [41, 'M'], [36, 'M'], [43, 'm'], [45, 'M'],
  [46, 'M7'], [41, 'M'], [43, 'm7'], [45, 'sus'],
  [38, 'm'], [46, 'M'], [36, 'M'], [45, 'm'], [38, 'm'], [46, 'M'], [43, 'm'], [45, 'M'],
  [46, 'M'], [36, 'M'], [38, 'm'], [38, 'm'],
];
const THEME = `
  74 - - - 69 - 74 - 76 - 77 - - - 76 74   74 - - - - - 70 - 72 - 74 - - - . .
  72 - - - 67 - 72 - 76 - 79 - - - 77 76   76 - - - - - - - . . 72 - 74 - 76 -
  77 - - - 76 - 74 - 81 - - - 79 - 77 -   77 - - - 74 - - - 70 - 74 - 77 - 79 -
  79 - - - 77 - 74 - 70 - - - 74 - 77 -   76 - - - - - 73 - 69 - - - . . . .`;
const LIFT = `
  81 - - - - - - - 79 - 77 - - - - -   76 - - - - - - - 72 - 76 - 79 - - -
  77 - - - - - - - 74 - 77 - 82 - - -   81 - - - - - - - - - - - . . 79 81
  84 - - - - - - - 81 - 79 - 77 - - -   79 - - - 76 - - - 72 - 76 - 79 - 84 -
  82 - - - - - 79 - 77 - - - 74 - - -   76 - - - - - - - 73 - - - 76 - - -`;
const BREAK = `
  74 - - - - - - - 77 - - - 81 - - -   79 - - - - - - - - - - - 77 - - -
  74 - - - - - - - 77 - - - 82 - - -   81 - - - - - - - - - - - . . . .`;
const TAG = `
  74 - - - 77 - - - 82 - - - 81 - 79 -   79 - - - 76 - - - 72 - - - 76 - 79 -
  74 - - - - - - - - - - - - - - -   - - - - - - - - . . . . . . . .`;
const rest = bars => Array(bars * 16).fill('.').join(' ');
const TITLE_LEAD = line([rest(4), THEME, LIFT, BREAK, THEME, TAG].join(' '));
// each section: pad level and brightness, bass (x root, X its octave), kick and snare (k, s),
// hats every `hat` steps, the chug (the rotor-like sixteenths) and the arpeggio
const TITLE_SECTIONS = [
  { name: 'intro', bars: 4, pad: 0.016, cutoff: 500, bass: 'x...............', drums: 'k.......k.......', hat: 4, chug: true },
  { name: 'theme', bars: 8, pad: 0.019, cutoff: 1400, bass: 'x.....x...x.....', drums: 'k...s.k...k.s...', hat: 2, chug: true },
  { name: 'lift', bars: 8, pad: 0.025, cutoff: 1900, bass: 'x.......x.....X.', drums: 'k.......s.....k.', hat: 2 },
  { name: 'break', bars: 4, pad: 0.024, cutoff: 900, bass: 'x...............', drums: '................', hat: 0, arp: 8 },
  { name: 'again', bars: 8, pad: 0.021, cutoff: 2200, bass: 'x..x..x.x..x..X.', drums: 'k...s.k.k.k.s..k', hat: 1, chug: true, arp: 16 },
  { name: 'tag', bars: 4, pad: 0.02, cutoff: 1500, bass: 'x.....x...x.....', drums: 'k...s...k...s...', hat: 2 },
];
const TITLE_SECTION_OF = TITLE_SECTIONS.flatMap(sec => Array(sec.bars).fill(sec));
// the martial rolls into each section
const FILLS = { 3: 's...s...s.s.ssss', 11: 'k...s.k...k.s.ss', 19: 'k.......s.ssssss', 23: '........s...s.ss', 31: 'k...s.k.s.s.ssss' };
const CHUG = 'X.xxX.xxX.xxX.xX'; // accents and ghosts of the sixteenths

// ---------- briefing ----------
const BRIEF_BARS = [
  [36, 'm'], [36, 'm'], [44, 'M'], [44, 'M'], [41, 'm'], [41, 'm'], [43, 'M'], [43, 'M'],
  [36, 'm'], [36, 'm'], [44, 'M'], [44, 'M'], [37, 'M'], [37, 'M'], [43, 'sus'], [43, 'M'],
];
const BRIEF_MOTIF = line(`
  . . . . . . . . . . . . . . . .   . . . . . . . . 72 - - - 75 - - -
  74 - - - - - - - 72 - - - . . . .   . . . . . . . . . . . . . . . .
  . . . . . . . . . . . . . . . .   . . . . . . . . 72 - - - 68 - - -
  67 - - - - - - - - - - - . . . .   . . . . . . . . . . . . 71 - - -
  . . . . . . . . . . . . . . . .   . . . . . . . . 72 - - - 75 - - -
  79 - - - - - - - 75 - - - - - - -   . . . . . . . . . . . . . . . .
  . . . . . . . . . . . . . . . .   . . . . . . . . 73 - - - 72 - - -
  71 - - - - - - - - - - - - - - -   67 - - - - - - - - - - - . . . .`);
const PULSE_332 = 'x..x..x.x..x..x.';

// ---------- debrief ----------
const DEBRIEF_BARS = [
  [46, 'M'], [41, 'M'], [43, 'm7'], [39, 'M7'], [46, 'M'], [41, 'sus'], [39, 'M7'], [41, 'M'],
  [43, 'm'], [39, 'M'], [46, 'M'], [41, 'M'], [39, 'M7'], [41, 'M'], [46, 'M'], [46, 'M'],
];
const DEBRIEF_LEAD = line(`
  74 - - - - - - - 72 - - - 70 - - -   72 - - - - - - - 69 - - - - - - -
  70 - - - 74 - - - 77 - - - 74 - - -   75 - - - - - - - 74 - - - 70 - - -
  74 - - - - - - - 77 - - - 79 - - -   77 - - - - - - - 72 - - - - - - -
  75 - - - 74 - - - 72 - - - 70 - - -   72 - - - - - - - - - - - . . . .
  74 - - - - - - - 70 - - - 74 - - -   75 - - - - - - - 79 - - - - - - -
  77 - - - 74 - - - 70 - - - 74 - - -   77 - - - - - - - 72 - - - - - - -
  75 - - - - - - - 74 - - - 72 - - -   72 - - - - - - - 77 - - - 74 - - -
  74 - - - - - - - 72 - - - 70 - - -   70 - - - - - - - - - - - . . . .`);

// ---------- victory ----------
const FANFARE_BARS = [[38, 'M'], [43, 'M'], [45, '7'], [38, 'M']];
const FANFARE = line(`
  62 - 69 - 74 - - - 73 - 74 - 76 - 78 -   79 - - - - - 78 - 76 - 74 - 71 - 74 -
  76 - - - 73 - 76 - 81 - - - 79 - 78 -   74 - - - - - - - - - - - - - - -`);
const FANFARE_STEPS = FANFARE_BARS.length * 16;
const CALM_BARS = [[38, 'M9'], [43, 'M9'], [47, 'm7'], [45, 'sus']]; // four bars each

// ---------- game over ----------
const OVER_BARS = [[43, 'm'], [39, 'M'], [36, 'm'], [38, 'M'], [43, 'm']];
const DIRGE = line(`
  74 - - - - - - - 72 - - - 70 - - -   70 - - - - - - - 67 - - - - - - -
  67 - - - 70 - - - 72 - - - 75 - - -   74 - - - - - - - 66 - - - - - - -
  67 - - - - - - - - - - - - - - -`);
const OVER_STEPS = OVER_BARS.length * 16;

// ---------- flight beds: a chord every four bars ----------
const BEDS = {
  flight0: { chords: [[40, 'm7'], [38, 'M'], [36, 'M7'], [45, 'sus']], scale: [76, 78, 79, 81, 83, 85, 86, 88], cutoff: 820, pad: 0.017 },
  flight1: { chords: [[45, 'm7'], [41, 'M7'], [36, 'M'], [43, 'sus2']], scale: [81, 83, 84, 86, 88, 91, 93], cutoff: 640, pad: 0.018 },
  flight2: { chords: [[38, 'sus2'], [43, 'sus2'], [47, 'm'], [45, 'sus']], scale: [86, 88, 93, 95, 98], cutoff: 470, pad: 0.02 },
};

// gain: the track's level after the music compressor (1: the title's level)
export const TRACKS = {
  title: { bpm: 108, kind: 'title', gain: 1 },
  briefing: { bpm: 88, kind: 'briefing', gain: 1.5 },
  debrief: { bpm: 72, kind: 'debrief', gain: 1.19 },
  victory: { bpm: 116, kind: 'victory', gain: 1.35 },
  over: { bpm: 63, kind: 'over', gain: 1.21 },
  flight0: { bpm: 76, kind: 'flight0', gain: 0.52 },
  flight1: { bpm: 66, kind: 'flight1', gain: 0.58 },
  flight2: { bpm: 58, kind: 'flight2', gain: 0.51 },
};

// the same "random" every time round
const hash = i => (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296;
const padBase = root => (root >= 43 ? root + 12 : root + 24);
const bassOf = root => (root >= 40 ? root - 12 : root);

export function score(v) {
  const { sub, supersaw, pulse, fm, hiss, tone } = v;
  // a dotted-eighth echo for the melodic parts, and a long dark one for the beds' far sounds
  const space = v.insert(ac => delay(ac, { time: 0.42, feedback: 0.34, wet: 0.26, cut: 2600, pan: -0.3 }));
  const far = v.insert(ac => delay(ac, { time: 0.8, feedback: 0.5, wet: 0.42, cut: 1500, pan: 0.35 }));
  let playing = null,
    on = null;

  // ---------- the parts ----------
  const pad = (root, kind, t, len, vol, cutoff, o = {}) => {
    const ch = CH[kind],
      base = padBase(root);
    for (const iv of ch.length > 3 ? ch.slice(-3) : ch)
      supersaw(midi(base + iv), t, len, vol, {
        attack: o.attack ?? 0.3,
        decay: o.decay ?? 1,
        sustain: 0.8,
        release: o.release ?? 0.6,
        cutoff,
        envmod: o.envmod ?? 800,
        reso: 0.1,
        detune: o.detune ?? 0.4,
        mix: 0.65,
        width: 0.9,
        bus: o.bus ?? space,
      });
  };
  const kick = (t, vol = 0.36) =>
    sub(50, t, 0.18, vol, { punch: 24, drop: 0.05, drive: 0.6, tone: 3600, decay: 0.22, sustain: 0, release: 0.05 });
  // a field snare: tight, with a rattle of wires
  const snare = (t, vol = 0.12) => {
    hiss(t, 0.13, vol, 8000, 1800, 'lowpass', 'music');
    hiss(t, 0.05, vol * 0.7, 3200, 2600, 'bandpass', 'music', 3);
    sub(220, t, 0.05, vol * 0.7, { punch: 7, drop: 0.015, drive: 0.25, tone: 1800, decay: 0.06, sustain: 0, release: 0.03 });
  };
  const hat = (t, vol = 0.026, open = false) =>
    hiss(t, open ? 0.15 : 0.025, vol, 11000, open ? 6000 : 8500, 'highpass', 'music');
  const tom = (t, n, vol = 0.24) =>
    sub(midi(n), t, 0.24, vol, { punch: 7, drop: 0.08, drive: 0.35, tone: 1600, decay: 0.26, sustain: 0, release: 0.06 });
  const crash = (t, vol = 0.05) => hiss(t, 1.6, vol, 12000, 4000, 'highpass', 'music', undefined, 0.002);
  const bass = (n, t, len, vol = 0.2, drive = 0.3) =>
    sub(midi(n), t, len, vol, { punch: 4, drop: 0.03, drive, tone: 900, decay: 0.3, sustain: 0.6, release: 0.05 });
  const bellm = (n, t, vol, bus = far, len = 0.3) =>
    fm(midi(n), t, len, vol, { ratio: 3.5, index: 1.5, modDecay: 0.3, decay: 0.9, sustain: 0.05, release: 0.8, bus });

  // ---------- the tracks ----------
  function title(i, t, dt) {
    const k = i % TITLE_LEAD.length,
      bar = k >> 4,
      s = k % 16,
      sec = TITLE_SECTION_OF[bar],
      [root, kind] = TITLE_BARS[bar],
      ch = CH[kind];
    if (s === 0) {
      const cutoff = sec.name === 'intro' ? 500 + bar * 300 : sec.cutoff;
      pad(root, kind, t, dt * 15, sec.pad, cutoff, { attack: dt * 3, decay: dt * 8, release: dt * 4 });
      if ([4, 12, 24, 32].includes(bar)) crash(t);
    }
    // the bass
    const b = sec.bass[s];
    if (sec.name === 'intro' || sec.name === 'break') {
      if (s === 0) bass(bassOf(root), t, dt * 14, 0.17, 0.15);
    } else if (bar === 35) {
      if (s === 0) bass(bassOf(root), t, dt * 12, 0.2, 0.2);
    } else if (b === 'x' || b === 'X') bass(bassOf(root) + (b === 'X' ? 12 : 0), t, dt * 1.6, 0.2, 0.35);

    // the chug: muted sixteenths on the root and its fifth, like blades going round
    if (sec.chug && bar < 35) {
      const c = CHUG[s];
      if (c !== '.') {
        const intro = sec.name === 'intro',
          n = root + 12 + (s === 14 ? 7 : 0),
          vol = (c === 'X' ? 0.03 : 0.016) * (intro ? 0.5 + bar * 0.17 : 1);
        pulse(midi(n), t, dt * 0.8, vol, {
          width: 0.35, pwm: 0.3, rate: 0.25, cutoff: intro ? 300 + bar * 150 : 520, envmod: 1500, reso: 0.3,
          attack: 0.002, decay: dt * 0.7, sustain: 0.1, release: 0.04, bus: 'music',
        });
      }
    }
    // the arpeggio: eighths of bells in the breakdown, sixteenths under the last theme
    if (sec.arp && s % (16 / sec.arp) === 0) {
      const at = sec.arp === 8 ? s / 2 : s;
      const n = root + 24 + [0, ch[1], ch[2], 12, ch[2], ch[1], 12, ch[1]][at % 8];
      if (sec.arp === 8) bellm(n + 12, t, 0.014, space, 0.2);
      else
        pulse(midi(n), t, dt * 1.1, 0.018, {
          width: 0.4, pwm: 0.5, rate: 0.3, cutoff: 1100, envmod: 2400, reso: 0.25, decay: dt, sustain: 0.2, release: 0.06, bus: space,
        });
    }

    // the lead
    const n = TITLE_LEAD[k];
    if (n > 0) {
      const d = dt * span(TITLE_LEAD, k, 32) * 0.95;
      if (sec.name === 'theme') {
        // a horn, and a thin pulse doubling it
        fm(midi(n), t, d, 0.05, { ratio: 1, index: 2.4, modDecay: 0.3, modSustain: 0.4, attack: 0.02, decay: 0.6, sustain: 0.55, release: 0.2, bus: space });
        pulse(midi(n), t, d, 0.026, { width: 0.3, pwm: 0.4, rate: 0.5, cutoff: 1700, envmod: 1600, reso: 0.2, attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.12, bus: space });
      } else if (sec.name === 'lift') {
        // brass an octave down with strings, broad
        fm(midi(n - 12), t, d, 0.07, { ratio: 1, index: 3, modDecay: 0.5, modSustain: 0.5, attack: 0.04, decay: 0.8, sustain: 0.6, release: 0.3, bus: space });
        supersaw(midi(n), t, d, 0.02, { detune: 0.22, mix: 0.45, width: 0.7, cutoff: 2200, envmod: 1000, attack: 0.05, release: 0.35, bus: space });
      } else if (sec.name === 'break') {
        bellm(n, t, 0.04, far, d * 0.6);
        fm(midi(n - 12), t, d, 0.022, { ratio: 1, index: 0.8, attack: 0.15, decay: 1, sustain: 0.6, release: 0.6, bus: space });
      } else if (sec.name === 'again') {
        supersaw(midi(n), t, d, 0.028, { detune: 0.25, mix: 0.45, width: 0.6, cutoff: 2600, envmod: 1600, attack: 0.01, decay: 0.4, sustain: 0.7, release: 0.2, bus: space });
        fm(midi(n), t, d, 0.04, { ratio: 1, index: 2.6, modDecay: 0.3, modSustain: 0.4, attack: 0.015, decay: 0.6, sustain: 0.55, release: 0.2, bus: space });
        fm(midi(n + 12), t, d, 0.012, { ratio: 3.5, index: 1.4, modDecay: 0.25, decay: 0.5, sustain: 0.1, release: 0.3, bus: space });
      } else {
        fm(midi(n), t, d, 0.055, { ratio: 1, index: 2.2, modDecay: 0.4, modSustain: 0.45, attack: 0.03, decay: 0.7, sustain: 0.55, release: 0.4, bus: space });
      }
    }

    // the drums
    const dr = (FILLS[bar] ?? (bar === 35 ? 'k...............' : sec.drums))[s];
    const roll = FILLS[bar] && s >= 8;
    if (dr === 'k') kick(t, sec.name === 'intro' ? 0.22 + bar * 0.04 : 0.36);
    if (dr === 's') snare(t, roll ? 0.05 + 0.01 * (s - 8) : 0.12);
    if (sec.hat && s % sec.hat === 0 && bar !== 35) hat(t, sec.hat === 1 ? (s % 4 === 2 ? 0.028 : 0.014) : 0.024, sec.name !== 'intro' && s === 14);
    if (sec.name === 'break' && s === 0) tom(t, bar % 2 ? 40 : 38, 0.2);
  }

  function briefing(i, t, dt) {
    const k = i % BRIEF_MOTIF.length,
      bar = k >> 4,
      s = k % 16,
      [root, kind] = BRIEF_BARS[bar];
    if (s === 0 && bar % 2 === 0) pad(root, kind, t, dt * 30, 0.022, 650, { attack: dt * 8, decay: dt * 16, release: dt * 8 });
    // the pulse: muted 3+3+2 on the root, the bass under its first beat
    if (PULSE_332[s] === 'x') {
      pulse(midi(root + 12), t, dt * 1.2, s % 8 === 0 ? 0.034 : 0.024, { width: 0.3, pwm: 0.3, rate: 0.2, cutoff: 480, envmod: 1500, reso: 0.3, decay: dt, sustain: 0.1, release: 0.05, bus: space });
      if (s === 0 || s === 8) bass(bassOf(root), t, dt * 5, s ? 0.08 : 0.12, 0.2);
    }
    // the radio's tick, and the plot's ping every four bars
    if (s % 4 === 2) hiss(t, 0.015, 0.01, 7000, 5000, 'bandpass', 'music', 2);
    if (bar % 4 === 0 && s === 8) bellm(86, t, 0.022, far, 0.12);
    const n = BRIEF_MOTIF[k];
    if (n > 0)
      fm(midi(n), t, dt * span(BRIEF_MOTIF, k, 16), 0.045, { ratio: 2, index: 1.6, modDecay: 0.4, modSustain: 0.2, attack: 0.04, decay: 1.2, sustain: 0.3, release: 0.8, bus: far });
    // the last two bars tighten towards the loop
    if (bar === 14 && s === 0) hiss(t, dt * 32, 0.022, 300, 2200, 'bandpass', space, 2, dt * 28);
    if (bar >= 14 && s % 2 === 1) hiss(t, 0.02, 0.008 + (bar - 14) * 0.005, 6000, 4000, 'highpass', 'music');
  }

  function debrief(i, t, dt) {
    const k = i % DEBRIEF_LEAD.length,
      bar = k >> 4,
      s = k % 16,
      [root, kind] = DEBRIEF_BARS[bar],
      ch = CH[kind];
    if (s === 0) pad(root, kind, t, dt * 15, 0.016, 1000, { attack: dt * 4, decay: dt * 8, release: dt * 6, detune: 0.3 });
    if (s === 0) bass(bassOf(root), t, dt * 9, 0.16, 0.1);
    if (s === 10) bass(bassOf(root) + 7, t, dt * 4, 0.1, 0.1);
    // a plucked arpeggio in eighths
    if (s % 2 === 0) {
      const n = root + 12 + [0, ch[2], 12, ch[1] + 12, ch[2] + 12, 12, ch[2], ch[1]][s / 2];
      pulse(midi(n + (n < 55 ? 12 : 0)), t, dt * 2, 0.02, { width: 0.2, pwm: 0.2, rate: 0.2, cutoff: 900, envmod: 2400, reso: 0.15, attack: 0.002, decay: 0.25, sustain: 0.1, release: 0.3, bus: space });
    }
    const n = DEBRIEF_LEAD[k];
    if (n > 0) {
      const d = dt * span(DEBRIEF_LEAD, k, 16) * 0.95;
      fm(midi(n), t, d, 0.05, { ratio: 1, index: 1.8, modDecay: 0.4, modSustain: 0.25, decay: 0.9, sustain: 0.35, release: 0.5, bus: space });
      fm(midi(n + 12), t, d, 0.01, { ratio: 3.5, index: 1.2, modDecay: 0.3, decay: 0.6, sustain: 0.1, release: 0.4, bus: space });
    }
    if (s === 0 || s === 10) kick(t, s ? 0.08 : 0.13);
    if (s % 4 === 2) hiss(t, 0.04, 0.012, 8000, 5000, 'highpass', 'music');
  }

  function victory(i, t, dt) {
    if (i < FANFARE_STEPS) {
      const bar = i >> 4,
        s = i % 16,
        [root, kind] = FANFARE_BARS[bar];
      if (s === 0) {
        pad(root, kind, t, dt * (bar === 3 ? 30 : 15), 0.026, 2400, { attack: 0.02, decay: dt * 8, release: dt * (bar === 3 ? 16 : 4) });
        bass(bassOf(root), t, dt * (bar === 3 ? 24 : 7), 0.2, 0.3);
        if (bar === 0 || bar === 3) crash(t, 0.06);
      }
      if (bar < 3 && s === 8) bass(bassOf(root), t, dt * 6, 0.18, 0.3);
      const n = FANFARE[i];
      if (n > 0) {
        const d = dt * span(FANFARE, i, 32) * 0.95;
        fm(midi(n), t, d, 0.07, { ratio: 1, index: 3.2, modDecay: 0.4, modSustain: 0.55, attack: 0.02, decay: 0.8, sustain: 0.6, release: 0.3, bus: space });
        supersaw(midi(n), t, d, 0.026, { detune: 0.25, mix: 0.45, width: 0.7, cutoff: 3000, envmod: 1400, attack: 0.02, release: 0.3, bus: space });
      }
      const dr = bar === 3 ? 'k...............' : bar === 2 ? 'k...s...k.s.s.ss' : 'k...s...k.k.s...';
      if (dr[s] === 'k') kick(t, 0.32);
      if (dr[s] === 's') snare(t, 0.1);
      if (bar < 3 && s % 2 === 0) hat(t, 0.022);
      if (bar === 3 && s === 0) tom(t, 38, 0.3);
      return;
    }
    // then rest: a chord every four bars, bells over it
    const j = i - FANFARE_STEPS - 32, // two bars of the fanfare's ring-out first
      bar = Math.floor(j / 16),
      s = ((j % 16) + 16) % 16;
    if (j < 0) return;
    const [root, kind] = CALM_BARS[(bar >> 2) % 4],
      ch = CH[kind];
    if (s === 0 && bar % 4 === 0) {
      pad(root, kind, t, dt * 60, 0.021, 1200, { attack: dt * 12, decay: dt * 24, release: dt * 16 });
      bass(bassOf(root), t, dt * 56, 0.07, 0.05);
    }
    if (s % 4 === 0 && hash(j) < 0.45) bellm(root + 36 + ch[Math.floor(hash(j + 7) * ch.length)], t, 0.025);
  }

  function over(i, t, dt) {
    if (i >= OVER_STEPS + 16) return; // and then silence
    const bar = i >> 4,
      s = i % 16;
    if (bar < OVER_BARS.length && s === 0) {
      const [root, kind] = OVER_BARS[bar],
        last = bar === OVER_BARS.length - 1;
      pad(root, kind, t, dt * (last ? 24 : 15), 0.022, 650, { attack: dt * 4, decay: dt * 8, release: dt * (last ? 16 : 4) });
      bass(bassOf(root), t, dt * (last ? 20 : 14), 0.13, 0.15);
      tom(t, 36, 0.26);
    }
    const n = DIRGE[i];
    if (n > 0) {
      const d = dt * span(DIRGE, i, 16) * 0.95;
      fm(midi(n), t, d, 0.06, { ratio: 1, index: 2, modDecay: 0.6, modSustain: 0.4, attack: 0.06, decay: 1, sustain: 0.6, release: 0.6, bus: space });
      fm(midi(n - 12), t, d, 0.03, { ratio: 2, index: 1, attack: 0.08, decay: 1, sustain: 0.5, release: 0.6, bus: space });
    }
  }

  // the beds: a chord every four bars, a drone, a little motion and a few far sounds
  function bed(tr, i, t, dt) {
    const look = BEDS[tr.kind],
      bar = i >> 4,
      s = i % 16,
      [root, kind] = look.chords[(bar >> 2) % look.chords.length],
      h = hash(i);
    if (s === 0 && bar % 4 === 0) {
      pad(root, kind, t, dt * 62, look.pad, look.cutoff, { attack: dt * 16, decay: dt * 32, release: dt * 20, envmod: 400, detune: 0.45, bus: far });
      sub(midi(bassOf(root)), t, dt * 62, 0.08, { punch: 0, drive: 0.08, tone: 400, attack: dt * 8, decay: 2, sustain: 0.8, release: dt * 12 });
    }
    const pick = (seed, list = look.scale) => list[Math.floor(hash(i + seed) * list.length)];
    if (tr.kind === 'flight0') {
      // Mirewater: log drums, insects in bursts and a bird far off over the water
      const d = 'a..b..a...b.a...'[s];
      if (d === 'a' || d === 'b')
        sub(midi(d === 'a' ? 57 : 52), t, 0.16, s ? 0.05 : 0.07, { punch: 5, drop: 0.02, drive: 0.2, tone: 1400, decay: 0.18, sustain: 0, release: 0.08, bus: space });
      if (d === '.' && s % 2 === 1 && h < 0.08) sub(midi(55), t, 0.12, 0.03, { punch: 4, drop: 0.02, tone: 1200, decay: 0.12, sustain: 0, release: 0.06 });
      if (s === 4 && h < 0.4) {
        const f = 3800 + 900 * hash(i + 1);
        for (let k = 0; k < 7; k++) tone(f, f * 1.08, t + k * 0.03, 0.018, 0.003, 'sine', far, 0.004);
      }
      if (s === 10 && bar % 2 === 1 && h < 0.5) {
        const f = 1500 + 600 * hash(i + 2);
        tone(f, f * 1.45, t, 0.22, 0.005, 'triangle', far, 0.03);
        tone(f * 1.3, f, t + 0.3, 0.18, 0.004, 'triangle', far, 0.03);
      }
    } else if (tr.kind === 'flight1') {
      // Amberfold: a low plucked ostinato, the wind swelling down the valley, a far bell
      if (s === 0 || s === 6 || (s === 10 && bar % 2 === 1)) {
        const n = padBase(root) - 12 + (s === 6 ? 7 : s === 10 ? 12 : 0);
        fm(midi(n), t, 0.3, s ? 0.024 : 0.032, { ratio: 1, index: 1.4, modDecay: 0.1, modSustain: 0.1, attack: 0.002, decay: 0.6, sustain: 0, release: 0.5, bus: space });
      }
      if (s === 0 && bar % 8 === 2) hiss(t, dt * 96, 0.026, 300, 1300, 'bandpass', far, 2.2, dt * 48);
      if (s === 8 && bar % 2 === 0 && h < 0.55) bellm(pick(5), t, 0.018);
    } else {
      // Greyhorn: a ticking low pulse, a far timpani swell, glassy harmonics in the mist
      if (s % 2 === 0)
        pulse(midi(root + 12 + (s % 4 ? 7 : 0)), t, dt * 0.9, s % 8 === 0 ? 0.016 : 0.009, { width: 0.4, pwm: 0.3, rate: 0.1, cutoff: 360, envmod: 900, reso: 0.3, attack: 0.003, decay: dt * 0.8, sustain: 0.05, release: 0.05, bus: 'music' });
      if (s === 0 && bar % 4 === 3)
        for (let k = 0; k < 8; k++)
          sub(midi(38), t + k * dt * 0.5, 0.18, 0.02 + k * 0.009, { punch: 3, drop: 0.03, drive: 0.15, tone: 300, decay: 0.2, sustain: 0, release: 0.1 });
      if (s === 0 && bar % 2 === 1)
        fm(midi(pick(11)), t, dt * 20, 0.012, { ratio: 2, index: 0.6, modDecay: 2, modSustain: 0.5, attack: dt * 10, decay: 2, sustain: 0.6, release: dt * 12, bus: far });
    }
  }

  const PLAY = { title, briefing, debrief, victory, over };
  return (tr, i, t, dt) => {
    // a new track (or a new context): the echoes go to its tempo (its level, `gain`, the synth sets)
    if (tr !== playing || on !== v.ac) {
      playing = tr;
      on = v.ac;
      space.fx?.time.setTargetAtTime(dt * 3, t, 0.05);
      far.fx?.time.setTargetAtTime(dt * 6, t, 0.05);
    }
    if (PLAY[tr.kind]) PLAY[tr.kind](i, t, dt);
    else bed(tr, i, t, dt);
  };
}
