// Contrail's music, all original and made in code on @nostalgia/audio's richer voices.
//
//   title     E minor, 132 bpm, 32 bars: intro, theme, bridge, the theme again at full band, a tag
//   briefing  A minor with a Phrygian rub, 84 bpm, 16 bars: a slow pulse under the map
//   debrief   F major, 76 bpm, 16 bars: electric piano over a warm pad, resolving home
//   victory   E major, 120 bpm: a four-bar fanfare, then a soft loop of bells and pad
//   over      D minor, 66 bpm: a five-bar dirge, then silence
//   flight0   the islands, D Lydian, 72 bpm: open pads, a tresillo pulse, glassy sparkles
//   flight1   the desert, E Phrygian dominant, 80 bpm: a drone, a frame drum, dry plucks
//   flight2   the mountains by night, B minor, 60 bpm: dark pads, a heartbeat, a far bell
//
// The flight beds are ambient (no tune to follow) and sit well under the engine: each track
// has a `gain`, its level after the music bus's compressor (which evens the tracks out against
// each other); the synth glides the music to it as the track starts.
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
  7: [0, 4, 7, 10],
};

// ---------- title ----------
// intro (4) | theme (8) | bridge (8) | return (8) | tag (4), one chord a bar
const TITLE_BARS = [
  [40, 'm'], [40, 'm'], [36, 'M'], [38, 'M'],
  [40, 'm'], [36, 'M'], [43, 'M'], [38, 'M'], [40, 'm'], [36, 'M'], [45, 'm'], [47, 'M'],
  [45, 'm'], [36, 'M'], [43, 'M'], [38, 'M'], [45, 'm'], [36, 'M'], [38, 'M'], [47, 'M'],
  [40, 'm'], [36, 'M'], [43, 'M'], [38, 'M'], [40, 'm'], [36, 'M'], [45, 'm'], [47, 'M'],
  [36, 'M'], [38, 'M'], [40, 'm'], [40, 'm'],
];
const THEME = `
  76 - - - 71 - 76 - 78 - 79 - - - 78 -   76 - - - - - - - . . 72 74 76 - 79 -
  74 - - - 71 - - - 67 - 71 - 74 - 79 -   78 - - - - - - - - - - - 81 - 78 -
  76 - - - 71 - 76 - 79 - - - 81 - 83 -   84 - - - 83 - 79 - 76 - - - 79 - - -
  81 - - - 79 - 76 - 72 - 76 - 81 - - -   78 - - - 75 - - - 71 - - - . . . .`;
const BRIDGE = `
  84 - - - - - - - 83 - 81 - - - - -   79 - - - - - - - 76 - 79 - - - - -
  83 - - - - - - - 81 - 79 - - - 74 -   78 - - - - - - - - - - - . . . .
  84 - - - - - - - 86 - 88 - - - - -   88 - - - 86 - 84 - 79 - - - - - - -
  81 - - - - - - - 78 - 81 - 86 - - -   87 - - - - - - - 83 - - - 78 - - -`;
const TAG = `
  72 - - - 76 - - - 79 - - - 76 - - -   74 - - - 78 - - - 81 - - - 78 - 74 -
  76 - - - - - - - - - - - - - - -   - - - - - - - - . . . . . . . .`;
const rest = bars => Array(bars * 16).fill('.').join(' ');
const TITLE_LEAD = line([rest(4), THEME, BRIDGE, THEME, TAG].join(' '));
// each section: pad level and brightness, bass (x root, X its octave), drums (k kick, s snare,
// h hat, o open hat, t tom), the arpeggio and the lead's voice
const TITLE_SECTIONS = [
  { name: 'intro', bars: 4, pad: 0.016, cutoff: 500, bass: 'x...............', drums: 'k...............', arp: 8 },
  { name: 'theme', bars: 8, pad: 0.02, cutoff: 1500, bass: 'x.x.X.x.x.x.X.x.', drums: 'k.h.s.h.k.k.s.ho' },
  { name: 'bridge', bars: 8, pad: 0.026, cutoff: 1100, bass: 'x.....x.x...x...', drums: 'k.h.h.h.s.h.h.hk' },
  { name: 'return', bars: 8, pad: 0.022, cutoff: 2200, bass: 'x.x.X.x.x.x.X.x.', drums: 'k.hks.hkk.hks.ho', arp: 16 },
  { name: 'tag', bars: 4, pad: 0.02, cutoff: 1600, bass: 'x.x.X.x.x.x.X.x.', drums: 'k.h.s.h.k.k.s.h.' },
];
const TITLE_SECTION_OF = TITLE_SECTIONS.flatMap(sec => Array(sec.bars).fill(sec));
const FILLS = { 3: '....t...t.t.tttt', 19: 'k.h.s.h.s.ssssss', 27: 'k.h.s.h.t.t.tttt' };

// ---------- briefing ----------
const BRIEF_BARS = [
  [45, 'm'], [45, 'm'], [41, 'M'], [41, 'M'], [38, 'm'], [38, 'm'], [40, 'M'], [40, 'M'],
  [45, 'm'], [45, 'm'], [46, 'M'], [46, 'M'], [38, 'm'], [38, 'm'], [40, 'sus'], [40, 'M'],
];
const BRIEF_MOTIF = line(`
  . . . . . . . . . . . . . . . .   . . . . . . . . 76 - - - 77 - - -
  76 - - - - - - - - - - - . . . .   . . . . . . . . . . . . . . . .
  . . . . . . . . . . . . . . . .   . . . . . . . . 74 - - - 77 - - -
  76 - - - - - - - 75 - - - - - - -   . . . . . . . . . . . . . . . .
  . . . . . . . . . . . . . . . .   . . . . . . . . 76 - - - 77 - - -
  81 - - - - - - - 77 - - - - - - -   . . . . . . . . . . . . . . . .
  . . . . . . . . . . . . . . . .   . . . . . . . . 74 - - - 72 - - -
  71 - - - - - - - - - - - - - - -   68 - - - - - - - - - - - . . . .`);

// ---------- debrief ----------
const DEBRIEF_BARS = [
  [41, 'M7'], [36, 'M'], [38, 'm7'], [46, 'M7'], [41, 'M'], [45, 'm'], [46, 'M7'], [36, 'sus'],
  [41, 'M7'], [36, 'M'], [38, 'm7'], [46, 'M7'], [41, 'M'], [45, 'm7'], [46, 'M'], [36, '7'],
];
const DEBRIEF_LEAD = line(`
  69 - - - - - - - 72 - - - 74 - - -   72 - - - - - - - - - - - . . . .
  69 - - - 72 - - - 77 - - - 76 - - -   74 - - - - - - - 70 - - - - - - -
  72 - - - - - - - 77 - - - 79 - - -   76 - - - - - - - 72 - - - - - - -
  74 - - - 72 - - - 70 - - - 69 - - -   67 - - - - - - - - - - - . . . .
  81 - - - - - - - 79 - - - 77 - - -   76 - - - - - - - 72 - - - - - - -
  74 - - - 77 - - - 81 - - - 79 - - -   77 - - - - - - - 74 - - - - - - -
  72 - - - - - - - 74 - - - 77 - - -   76 - - - - - - - 79 - - - 76 - - -
  74 - - - - - - - 70 - - - 72 - - -   72 - - - - - - - - - - - . . . .`);

// ---------- victory ----------
const FANFARE_BARS = [[40, 'M'], [45, 'M'], [47, '7'], [40, 'M']];
const FANFARE = line(`
  64 - 71 - 76 - - - 75 - 76 - 78 - 80 -   81 - - - - - 80 - 78 - 76 - 73 - 76 -
  78 - - - 75 - 78 - 83 - - - 81 - 80 -   76 - - - - - - - - - - - - - - -`);
const FANFARE_STEPS = FANFARE_BARS.length * 16;
const CALM_BARS = [[40, 'M9'], [45, 'M9'], [40, 'M9'], [47, 'sus']]; // four bars each

// ---------- game over ----------
const OVER_BARS = [[38, 'm'], [46, 'M'], [43, 'm'], [45, 'M'], [38, 'm']];
const DIRGE = line(`
  69 - - - - - - - 67 - - - 65 - - -   65 - - - - - - - 62 - - - - - - -
  62 - - - 65 - - - 67 - - - 70 - - -   69 - - - - - - - 61 - - - - - - -
  62 - - - - - - - - - - - - - - -`);
const OVER_STEPS = OVER_BARS.length * 16;

// ---------- flight beds: a chord every four bars ----------
const BEDS = {
  flight0: { chords: [[38, 'M9'], [47, 'm7'], [43, 'M7'], [45, 'sus']], scale: [62, 64, 66, 69, 71, 74, 76, 78] },
  flight1: { chords: [[40, 'M'], [41, 'M'], [40, 'M'], [38, 'm']], scale: [52, 53, 56, 57, 59, 60, 62, 64] },
  flight2: { chords: [[47, 'm'], [43, 'M'], [40, 'm'], [42, 'M']], scale: [78, 81, 83, 85, 86, 90] },
};

// gain: the track's level after the music compressor (1: the title's level)
export const TRACKS = {
  title: { bpm: 132, kind: 'title', gain: 1 },
  briefing: { bpm: 84, kind: 'briefing', gain: 1.39 },
  debrief: { bpm: 76, kind: 'debrief', gain: 1.23 },
  victory: { bpm: 120, kind: 'victory', gain: 1.43 },
  over: { bpm: 66, kind: 'over', gain: 1.3 },
  flight0: { bpm: 72, kind: 'flight0', gain: 0.55 },
  flight1: { bpm: 80, kind: 'flight1', gain: 0.55 },
  flight2: { bpm: 60, kind: 'flight2', gain: 0.55 },
};

// the same "random" every time round
const hash = i => (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296;
const padBase = root => (root >= 43 ? root + 12 : root + 24);
const bassOf = root => (root >= 40 ? root - 12 : root);

export function score(v) {
  const { sub, supersaw, pulse, fm, hiss } = v;
  // a dotted-eighth echo for the melodic parts, and a long dark one for the beds' far sounds
  const space = v.insert(ac => delay(ac, { time: 0.34, feedback: 0.36, wet: 0.28, cut: 2600, pan: -0.3 }));
  const far = v.insert(ac => delay(ac, { time: 0.75, feedback: 0.5, wet: 0.4, cut: 1500, pan: 0.35 }));
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
    sub(52, t, 0.16, vol, { punch: 26, drop: 0.045, drive: 0.6, tone: 4000, decay: 0.2, sustain: 0, release: 0.05 });
  const snare = (t, vol = 0.12) => {
    hiss(t, 0.16, vol, 7000, 1400, 'lowpass', 'music');
    hiss(t, 0.06, vol * 0.6, 2200, 1800, 'bandpass', 'music', 2);
    sub(196, t, 0.06, vol * 0.8, { punch: 7, drop: 0.02, drive: 0.2, tone: 1500, decay: 0.07, sustain: 0, release: 0.03 });
  };
  const hat = (t, vol = 0.03, open = false) =>
    hiss(t, open ? 0.16 : 0.03, vol, 11000, open ? 6000 : 8000, 'highpass', 'music');
  const tom = (t, n, vol = 0.24) =>
    sub(midi(n), t, 0.22, vol, { punch: 7, drop: 0.08, drive: 0.35, tone: 1800, decay: 0.25, sustain: 0, release: 0.06 });
  const crash = (t, vol = 0.05) => hiss(t, 1.6, vol, 12000, 4000, 'highpass', 'music', undefined, 0.002);
  const bass = (n, t, len, vol = 0.2, drive = 0.3) =>
    sub(midi(n), t, len, vol, { punch: 4, drop: 0.03, drive, tone: 900, decay: 0.3, sustain: 0.6, release: 0.05 });

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
      if ([4, 12, 20, 28].includes(bar)) crash(t);
    }
    const b = sec.bass[s];
    if (sec.name === 'intro') {
      if (s === 0 && bar < 3) bass(bassOf(root), t, dt * 14, 0.18, 0.15);
    } else if (sec.name === 'tag' && bar === 31) {
      if (s === 0) bass(bassOf(root), t, dt * 12, 0.2, 0.2);
    } else if (b === 'x' || b === 'X') bass(bassOf(root) + (b === 'X' ? 12 : 0), t, dt * 1.4, 0.2, 0.35);

    // arpeggio: eighths opening up through the intro, sixteenths under the return
    if (sec.arp && s % (16 / sec.arp) === 0) {
      const at = sec.arp === 8 ? s / 2 : s;
      const n = root + 24 + [0, 12, ch[1], ch[2], 12, ch[1], ch[2], 0][at % 8];
      pulse(midi(n), t, dt * 1.1, sec.arp === 8 ? 0.022 + bar * 0.006 : 0.02, {
        width: 0.4, pwm: 0.5, rate: 0.3, cutoff: sec.arp === 8 ? 500 + bar * 250 : 1100, envmod: 2400, reso: 0.25,
        decay: dt, sustain: 0.2, release: 0.06, bus: space,
      });
    }

    const n = TITLE_LEAD[k];
    if (n > 0) {
      const d = dt * span(TITLE_LEAD, k, 32) * 0.95;
      if (sec.name === 'theme') {
        pulse(midi(n), t, d, 0.05, { width: 0.25, pwm: 0.4, rate: 0.5, cutoff: 1800, envmod: 1800, reso: 0.2, attack: 0.008, decay: 0.3, sustain: 0.7, release: 0.12, bus: space });
        fm(midi(n), t, d, 0.04, { ratio: 1, index: 1.6, modDecay: 0.3, modSustain: 0.3, decay: 0.6, sustain: 0.45, release: 0.2, bus: space });
      } else if (sec.name === 'bridge') {
        // brass an octave down, a bell on top
        fm(midi(n - 12), t, d, 0.07, { ratio: 1, index: 3, modDecay: 0.5, modSustain: 0.5, attack: 0.03, decay: 0.8, sustain: 0.6, release: 0.3, bus: space });
        supersaw(midi(n - 12), t, d, 0.018, { detune: 0.2, mix: 0.4, width: 0.5, cutoff: 1800, envmod: 1200, attack: 0.03, release: 0.3, bus: space });
        fm(midi(n), t, d + 0.3, 0.012, { ratio: 3.5, index: 1.5, modDecay: 0.3, decay: 0.6, sustain: 0.1, release: 0.4, bus: space });
      } else {
        supersaw(midi(n), t, d, 0.03, { detune: 0.25, mix: 0.45, width: 0.6, cutoff: 2600, envmod: 1600, attack: 0.01, decay: 0.4, sustain: 0.7, release: 0.2, bus: space });
        pulse(midi(n), t, d, 0.035, { width: 0.3, cutoff: 2000, envmod: 1500, attack: 0.008, decay: 0.3, sustain: 0.7, release: 0.12, bus: space });
        if (sec.name === 'return') fm(midi(n + 12), t, d, 0.014, { ratio: 3.5, index: 1.4, modDecay: 0.25, decay: 0.5, sustain: 0.1, release: 0.3, bus: space });
      }
    }

    const dr = (FILLS[bar] ?? (bar === 31 ? '................' : sec.drums))[s];
    if (dr === 'k') kick(t);
    if (dr === 's') snare(t, bar === 19 && s >= 10 ? 0.06 + 0.012 * (s - 10) : 0.12);
    if (dr === 'h') hat(t);
    if (dr === 'o') hat(t, 0.03, true);
    if (dr === 't') tom(t, 50 - (s >> 2) * 3 - (s % 4));
    if (sec.name === 'intro' && bar < 3 && s % 4 === 2) hat(t, 0.012 + bar * 0.006);
  }

  function briefing(i, t, dt) {
    const k = i % BRIEF_MOTIF.length,
      bar = k >> 4,
      s = k % 16,
      [root, kind] = BRIEF_BARS[bar];
    if (s === 0 && bar % 2 === 0) pad(root, kind, t, dt * 30, 0.024, 700, { attack: dt * 8, decay: dt * 16, release: dt * 8 });
    if (s === 0 || s === 8) bass(bassOf(root), t, dt * 6, s ? 0.08 : 0.12, 0.2);
    // the ostinato: muted eighths with a half-step rub on the A bars
    if (s % 2 === 0) {
      const rub = root === 45 && s === 6 ? 1 : 0;
      pulse(midi(root + 12 + rub), t, dt * 1.2, 0.032, { width: 0.3, pwm: 0.3, rate: 0.2, cutoff: 520, envmod: 1600, reso: 0.3, decay: dt, sustain: 0.1, release: 0.05, bus: space });
    }
    if (s % 4 === 0) hiss(t, 0.02, 0.012, 9000, 7000, 'highpass', 'music');
    const n = BRIEF_MOTIF[k];
    if (n > 0)
      fm(midi(n), t, dt * span(BRIEF_MOTIF, k, 16), 0.045, { ratio: 3.5, index: 1.8, modDecay: 0.4, modSustain: 0.1, decay: 1.2, sustain: 0.15, release: 0.8, bus: far });
    // the last two bars tighten towards the loop
    if (bar === 14 && s === 0) hiss(t, dt * 32, 0.025, 300, 2400, 'bandpass', space, 2, dt * 28);
    if (bar >= 14 && s % 4 === 3) hiss(t, 0.03, 0.01 + (bar - 14) * 0.006, 6000, 4000, 'highpass', 'music');
  }

  function debrief(i, t, dt) {
    const k = i % DEBRIEF_LEAD.length,
      bar = k >> 4,
      s = k % 16,
      [root, kind] = DEBRIEF_BARS[bar],
      ch = CH[kind];
    if (s === 0) pad(root, kind, t, dt * 15, 0.017, 1100, { attack: dt * 4, decay: dt * 8, release: dt * 6, detune: 0.3 });
    if (s === 0) bass(bassOf(root), t, dt * 9, 0.16, 0.1);
    if (s === 10) bass(bassOf(root) + 7, t, dt * 4, 0.1, 0.1);
    // electric piano arpeggio in eighths
    if (s % 2 === 0) {
      const n = root + 12 + [0, ch[1], ch[2], 12, ch.at(-1), ch[2], ch[1], 12][s / 2];
      fm(midi(n + (n < 55 ? 12 : 0)), t, dt * 2.5, 0.026, { ratio: 1, index: 1.2, modDecay: 0.3, modSustain: 0.2, decay: 0.6, sustain: 0.2, release: 0.4, bus: space });
    }
    const n = DEBRIEF_LEAD[k];
    if (n > 0) {
      const d = dt * span(DEBRIEF_LEAD, k, 16) * 0.95;
      fm(midi(n), t, d, 0.05, { ratio: 1, index: 2, modDecay: 0.4, modSustain: 0.25, decay: 0.9, sustain: 0.35, release: 0.5, bus: space });
      fm(midi(n + 12), t, d, 0.01, { ratio: 3.5, index: 1.2, modDecay: 0.3, decay: 0.6, sustain: 0.1, release: 0.4, bus: space });
    }
    if (s === 0) kick(t, 0.14);
    if (s % 2 === 0) hiss(t, 0.04, s % 4 ? 0.01 : 0.014, 8000, 5000, 'highpass', 'music');
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
        supersaw(midi(n), t, d, 0.028, { detune: 0.25, mix: 0.45, width: 0.7, cutoff: 3000, envmod: 1400, attack: 0.02, release: 0.3, bus: space });
      }
      const dr = bar === 3 ? 'k...............' : bar === 2 ? 'k...s...k.k.s.ss' : 'k...s...k.k.s...';
      if (dr[s] === 'k') kick(t, 0.32);
      if (dr[s] === 's') snare(t, 0.1);
      if (bar < 3 && s % 2 === 0) hat(t, 0.025);
      if (bar === 3 && s === 0) tom(t, 40, 0.3);
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
      pad(root, kind, t, dt * 60, 0.022, 1200, { attack: dt * 12, decay: dt * 24, release: dt * 16 });
      bass(bassOf(root), t, dt * 56, 0.07, 0.05);
    }
    if (s % 4 === 0 && hash(j) < 0.45)
      fm(midi(root + 36 + ch[Math.floor(hash(j + 7) * ch.length)]), t, 0.3, 0.026, { ratio: 3.5, index: 1.4, modDecay: 0.3, decay: 0.8, sustain: 0.05, release: 0.8, bus: far });
  }

  function over(i, t, dt) {
    if (i >= OVER_STEPS + 16) return; // and then silence
    const bar = i >> 4,
      s = i % 16;
    if (bar < OVER_BARS.length && s === 0) {
      const [root, kind] = OVER_BARS[bar],
        last = bar === OVER_BARS.length - 1;
      pad(root, kind, t, dt * (last ? 24 : 15), 0.022, 700, { attack: dt * 4, decay: dt * 8, release: dt * (last ? 16 : 4) });
      bass(bassOf(root), t, dt * (last ? 20 : 14), 0.13, 0.15);
      tom(t, 38, 0.26);
    }
    const n = DIRGE[i];
    if (n > 0) {
      const d = dt * span(DIRGE, i, 16) * 0.95;
      fm(midi(n), t, d, 0.06, { ratio: 1, index: 2.2, modDecay: 0.6, modSustain: 0.4, attack: 0.05, decay: 1, sustain: 0.6, release: 0.6, bus: space });
      fm(midi(n - 12), t, d, 0.03, { ratio: 2, index: 1, attack: 0.08, decay: 1, sustain: 0.5, release: 0.6, bus: space });
    }
  }

  // the beds: a chord every four bars, a drone, a little motion and a few far notes
  function bed(tr, i, t, dt) {
    const look = BEDS[tr.kind],
      bar = i >> 4,
      s = i % 16,
      [root, kind] = look.chords[(bar >> 2) % look.chords.length],
      h = hash(i);
    if (s === 0 && bar % 4 === 0) {
      const dark = tr.kind === 'flight2';
      pad(root, kind, t, dt * 62, dark ? 0.02 : 0.018, dark ? 480 : tr.kind === 'flight1' ? 650 : 850, {
        attack: dt * 16, decay: dt * 32, release: dt * 20, envmod: 400, detune: 0.45, bus: far,
      });
      sub(midi(bassOf(root)), t, dt * 62, 0.08, { punch: 0, drive: 0.08, tone: 400, attack: dt * 8, decay: 2, sustain: 0.8, release: dt * 12 });
    }
    if (tr.kind === 'flight0') {
      if ('x..x..x.........'[s] === 'x')
        pulse(midi(root + 12), t, dt * 1.5, 0.024, { width: 0.35, pwm: 0.6, rate: 0.15, cutoff: 360, envmod: 1400, reso: 0.25, decay: dt, sustain: 0.15, release: 0.1, bus: space });
      if (s % 2 === 0 && h < 0.07)
        fm(midi(look.scale[Math.floor(hash(i + 3) * look.scale.length)] + 12), t, 0.2, 0.02, { ratio: 3, index: 1.2, modDecay: 0.2, decay: 0.5, sustain: 0, release: 0.6, bus: far });
    } else if (tr.kind === 'flight1') {
      // a frame drum and dry low plucks on the Phrygian-dominant scale
      const d = 'k.....k...k.....'[s];
      if (d === 'k') sub(midi(40), t, 0.25, s ? 0.1 : 0.14, { punch: 9, drop: 0.06, drive: 0.25, tone: 700, decay: 0.25, sustain: 0, release: 0.08 });
      if (s % 2 === 0 && h < 0.16)
        fm(midi(look.scale[Math.floor(hash(i + 5) * look.scale.length)]), t, 0.15, 0.03, { ratio: 2, index: 2.5, modDecay: 0.08, modSustain: 0.05, decay: 0.25, sustain: 0, release: 0.2, bus: space });
      if (s === 0 && bar % 2 === 1) pulse(midi(52 + 7), t, dt * 30, 0.012, { width: 0.2, pwm: 0.7, rate: 0.1, cutoff: 500, envmod: 300, attack: dt * 8, decay: 1, sustain: 0.8, release: dt * 8, bus: far });
    } else {
      // a slow heartbeat and a far bell, now and then
      if (s === 0 || s === 3) sub(midi(35), t, 0.22, s ? 0.08 : 0.11, { punch: 8, drop: 0.05, drive: 0.15, tone: 500, decay: 0.2, sustain: 0, release: 0.08 });
      if (s === 8 && bar % 2 === 1 && h < 0.7)
        fm(midi(look.scale[Math.floor(hash(i + 9) * look.scale.length)]), t, 0.3, 0.022, { ratio: 3.5, index: 2, modDecay: 0.4, modSustain: 0.1, decay: 1.4, sustain: 0.05, release: 1, bus: far });
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
