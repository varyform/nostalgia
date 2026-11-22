// Swerve's sound, made in code on @nostalgia/audio, all original: a living crowd around the pitch
// (filtered-noise layers that murmur, swell and roar, a choir of detuned voices through vowel
// formants for the oohs, groans, boos and wordless chants, applause made of flickering noise), the
// ball (kicks by kind and power, bounces, the woodwork's ring, the net's swish), the referee's pea
// whistle, the menus' blips and three 90s Amiga-style football anthems. The context is only made by
// unlock(), which the page calls from a user gesture; the demo never makes one.
//
//   const audio = createAudio({ sound: true });
//   audio.unlock(); audio.music('title'); audio.ui('select');
//   audio.music(null); audio.crowd(1);          // a match: no music, the crowd is the sound
//   audio.match(match.events, match.s);         // every sim step
//   audio.crowd(0);                             // back to the menus: the crowd fades away
//
// Tracks (16th steps, one chord a bar, sections of 4 or 8 bars in a form):
//   title  "Far Post Heroes"   G major,  138 bpm, 36 bars: an octave-bouncing bass, offbeat stabs,
//                              chip arpeggios, a 3-3-2 lead, then the big hook over a dance beat
//   menu   "Transfer Window"   C major,  112 bpm, 32 bars, swung: e-piano sevenths, a walking bass,
//                              rim clicks, a soft lead in the second half
//   win    "Silver in the Rain" C major, 116 bpm, 20 bars: a brass fanfare over timpani and a snare
//                              roll, then the anthem on brass and arpeggios
//
// match(events, s) plays the sim's events (sim.js's list in the contract) and keeps the crowd bed
// in step with the play: the murmur rises as the ball nears a goal (the home side's attack louder
// and brighter than the away side's), an ooh on chances, the woodwork and saves, a roar and
// applause on a goal (the home side's, team 0, by far the loudest; the away side's answered by a
// groan and a small far-off cheer), boos and whistles at the away side's fouls and cards, a hush
// and a heartbeat for penalties and the shoot-out, applause at half and full time, and now and
// then a chant. crowd(level) sets the bed (0 fades it out and stops it).
import { compressor, createSynth, delay, limiter, midi, span } from '@nostalgia/audio';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : 0));
const clamp01 = x => clamp(x, 0, 1);
const smooth = u => {
  u = clamp01(u);
  return u * u * (3 - 2 * u);
};
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

// ---------- the score ----------
// a lead: MIDI note numbers, '.' rest, '-' hold (16 a bar)
const lead = s =>
  s
    .trim()
    .split(/\s+/)
    .map(t => (t === '.' ? 0 : t === '-' ? -1 : +t));
// a chord: 'G', 'Em', 'Fmaj7', 'Am7', 'Bm'
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITY = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11] };
function chord(name) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(name);
  const pc = (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const iv = QUALITY[m[3]] ?? QUALITY[''];
  // voiced around middle C, folded into 55…71 so the chords move by small steps
  const tones = iv.map(i => 60 + ((pc + i) % 12)).map(n => (n > 71 ? n - 12 : n < 55 ? n + 12 : n));
  tones.sort((a, b) => a - b);
  // the arpeggio: the chord's tones an octave and more up, the root on top
  const up = [...iv.slice(0, 3).map(i => 72 + pc + i), 84 + pc].map(n => (n > 91 ? n - 12 : n));
  return { root: 36 + pc, iv, tones, up };
}

// The kit, a bar a pattern: k kick; s snare (x), ghost (g); r rim; c clap; h closed (x), open (o);
// t a timpani (1 the root, 5 its fifth); R a snare roll rising through the bar. 'fill' takes the
// second half of a section's last bar.
const KITS = {
  none: {},
  hats: { h: 'x.x.x.x.x.x.x.x.' },
  build: { k: 'x...x...x...x...', h: '..x...x...x...x.' },
  beat: { k: 'x.....x.x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
  beatb: { k: 'x.....x.x...x...', s: '....x.......x..g', h: 'x.x.x.x.x.x.x.xo' },
  dance: { k: 'x...x...x...x...', s: '....x.......x...', c: '....x.......x...', h: '..o...o...o...o.' },
  light: { k: 'x.......x..x....', r: '....x.......x...', h: 'x.xxx.xxx.xxx.xx' },
  lightb: { k: 'x.......x..x..x.', r: '....x.......x.x.', h: 'x.xxx.xxx.xxx.xo' },
  march: { k: 'x...x...x...x...', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
  fanfare: { t: '1.......5...1...', R: 'xxxxxxxxxxxxxxxx' },
  fanfareb: { k: 'x.......x.......', t: '1...1...5.5.1111' },
  fill: { k: 'x.......x.......', s: '....x...x.xxxxxx' },
};
// The bass, a bar a pattern: 0 the root, 5 its fifth, c the octave, 3 the chord's third, b a step
// below the next root; how long its notes may last (steps)
const BASS = {
  none: { p: '................' },
  hold: { p: '0.......0.......', max: 7.5 },
  oct: { p: '0.c.0.c.0.c.0.c.', max: 1.4 },
  drive: { p: '0.0.0.0.0.0.0.05', max: 1.5 },
  pump: { p: '0..0..0.0..0..5.', max: 2.4 },
  walk: { p: '0.....5.c..3..b.', max: 4 },
};
// chord parts: stabs on the offbeats, a pad held through the bar, e-piano hits, brass
const STABS = '..x...x...x...x.';
const EP = 'x.....x...x.....';

// Each track: tempo, level (after the music compressor), how it's played, and its sections
// (chords a bar, the kit and bass per bar, the chord part, arpeggios, a lead and its voice).
const TRACKS = {
  title: {
    bpm: 138,
    gain: 1.35,
    look: { lead: 0.07, bass: 0.085, sub: 0.14, chord: 0.03, pad: 0.022, arp: 0.022, kit: 1 },
    form: 'I A B A B',
    sec: {
      I: {
        chords: 'G C D D',
        kit: ['hats', 'hats', 'build', 'build'],
        bass: 'hold',
        part: 'pad',
        arp: true,
        fill: true,
        soft: true,
      },
      A: {
        chords: 'G C D G Em C D D',
        kit: ['beat', 'beat', 'beat', 'beatb', 'beat', 'beat', 'beat', 'beatb'],
        bass: 'oct',
        part: 'stab',
        fill: true,
        voice: 'pulse',
        lead: lead(`
          74 - - 79 - - 78 - 79 - - - 74 - - -   76 - - 79 - - 78 - 76 - - - 72 - - -
          74 - - 78 - - 81 - 83 - - 81 78 - 76 -  79 - - - - - - - . . 74 - 76 - 78 -
          79 - - 83 - - 81 - 79 - - - 76 - - -   76 - - 79 - - 78 - 76 - - - 72 - - -
          74 - - 76 - - 78 - 81 - - - 79 - 78 -  78 - - - - - - - . . . . 74 - 78 -`),
      },
      B: {
        chords: 'C D Bm Em C D G G',
        kit: 'dance',
        bass: 'drive',
        part: 'pad',
        arp: true,
        fill: true,
        voice: 'saw',
        lead: lead(`
          79 - 79 - 81 - 79 - 76 - - - 72 - 74 -   78 - 78 - 79 - 78 - 74 - - - . . 74 -
          83 - - - 81 - - - 78 - - - 74 - 78 -   79 - - - - - 76 - 79 - - - 83 - - -
          84 - 84 - 83 - 84 - 86 - - - 84 - 83 -   81 - - - 78 - - - 81 - 83 - 84 - 86 -
          86 - - - - - - - 83 - - - 79 - - -   79 - - - - - - - . . . . . . . .`),
      },
    },
  },
  menu: {
    bpm: 112,
    gain: 1.45,
    look: { lead: 0.05, bass: 0.07, sub: 0.12, ep: 0.024, arp: 0, kit: 0.7, swing: 0.12 },
    form: 'A L B L',
    sec: {
      A: { chords: 'Fmaj7 G Em7 Am7 Dm7 G Cmaj7 C', kit: 'light', bass: 'walk', part: 'ep', fill: true, soft: true },
      L: {
        chords: 'Fmaj7 G Em7 Am7 Dm7 G Cmaj7 C',
        kit: ['light', 'light', 'light', 'lightb'],
        bass: 'walk',
        part: 'ep',
        fill: true,
        soft: true,
        voice: 'soft',
        lead: lead(`
          81 - - - 79 - 77 - 76 - - - 72 - - -   74 - - - 76 - 77 - 79 - - - - - . .
          79 - - - 76 - 74 - 76 - - - 71 - - -   72 - - - - - 76 - 81 - - - - - . .
          77 - - - 76 - 74 - 72 - - - 74 - 77 -   79 - - - - - 77 - 74 - - - 71 - 74 -
          76 - - - - - - - 79 - - - 76 - - -   72 - - - - - - - . . . . . . . .`),
      },
      B: {
        chords: 'Fmaj7 G Am7 Am7 Fmaj7 G C C',
        kit: ['light', 'light', 'light', 'lightb'],
        bass: 'pump',
        part: 'ep',
        fill: true,
        voice: 'soft',
        lead: lead(`
          84 - - - 81 - - - 77 - 79 - 81 - - -   83 - - - 79 - - - 74 - 76 - 79 - - -
          81 - - - 76 - - - 72 - 74 - 76 - 79 -   81 - - - - - - - . . 79 - 81 - 83 -
          84 - - - 81 - 84 - 86 - - - 84 - 81 -   83 - - - 79 - 83 - 86 - - - 83 - 79 -
          84 - - - - - - - 79 - - - 76 - 79 -   84 - - - - - - - . . . . . . . .`),
      },
    },
  },
  win: {
    bpm: 116,
    gain: 1.4,
    look: { lead: 0.075, bass: 0.08, sub: 0.14, brass: 0.022, pad: 0.02, arp: 0.02, kit: 0.95 },
    form: 'F A A',
    sec: {
      F: {
        chords: 'C F G C',
        kit: ['fanfare', 'fanfareb', 'fanfare', 'fanfareb'],
        bass: 'hold',
        part: 'brass',
        voice: 'brass',
        lead: lead(`
          67 - 67 67 72 - - - - - 72 - 76 - - -   77 - - - 76 - 77 - 81 - - - 77 - - -
          79 - - - 77 - 76 - 74 - 76 - 77 - 79 -   84 - - - - - - - - - - - . . . .`),
      },
      A: {
        chords: 'C Am F G C Am G C',
        kit: ['march', 'march', 'march', 'beatb', 'march', 'march', 'march', 'beatb'],
        bass: 'drive',
        part: 'pad',
        arp: true,
        fill: true,
        voice: 'brass',
        lead: lead(`
          76 - - - 79 - - - 84 - - - 83 - 81 -   81 - - - 76 - - - 72 - - - 76 - - -
          77 - - - 81 - - - 84 - - - 86 - 84 -   83 - - - - - 79 - 74 - - - 79 - - -
          76 - - - 79 - - - 84 - - - 86 - 88 -   88 - - - 86 - - - 84 - - - 81 - - -
          79 - - - 83 - - - 86 - - - 83 - 86 -   84 - - - - - - - - - - - . . . .`),
      },
    },
  },
};

// flatten each track's form into bars and a lead lane
for (const tr of Object.values(TRACKS)) {
  tr.bars = [];
  tr.lead = [];
  for (const name of tr.form.split(' ')) {
    const S = tr.sec[name];
    const chords = S.chords.split(' ');
    chords.forEach((c, b) => {
      const kit = Array.isArray(S.kit) ? S.kit[b % S.kit.length] : S.kit;
      tr.bars.push({
        ...chord(c),
        next: chord(chords[(b + 1) % chords.length]).root,
        kit: KITS[kit] ?? {},
        bass: BASS[S.bass] ?? BASS.none,
        part: S.part,
        arp: !!S.arp,
        voice: S.voice,
        fill: !!S.fill && b === chords.length - 1,
        crash: b === 0 && !S.soft,
      });
      for (let s = 0; s < 16; s++) tr.lead.push(S.lead ? S.lead[(b * 16 + s) % S.lead.length] : 0);
    });
    // a hold at a section's start would hold the last section's note: make it a rest
    const start = tr.lead.length - chords.length * 16;
    if (tr.lead[start] === -1) tr.lead[start] = 0;
  }
  tr.steps = tr.bars.length * 16;
}

// ---------- the crowd ----------
// vowel formants: [Hz, Q] for F1…F3, and their levels
const VOWELS = {
  oo: [
    [340, 5],
    [780, 6],
    [2450, 9],
  ],
  oh: [
    [470, 5],
    [840, 6],
    [2550, 9],
  ],
  aw: [
    [610, 5],
    [920, 6],
    [2450, 9],
  ],
  ah: [
    [740, 4.5],
    [1180, 6],
    [2550, 9],
  ],
  eh: [
    [560, 5],
    [1750, 7],
    [2550, 9],
  ],
};
const FORMANT_LEVEL = [1, 0.55, 0.22];
// the chants: wordless, [semitones over the base, beats] (null a rest, filled with claps)
const CHANTS = [
  [
    [7, 1],
    [7, 1],
    [9, 1],
    [7, 1],
    [4, 2],
    [null, 2],
  ],
  [
    [0, 1.5],
    [2, 0.5],
    [4, 1],
    [0, 1],
    [7, 3],
    [null, 1],
  ],
  [
    [4, 0.5],
    [4, 0.5],
    [4, 1],
    [2, 1],
    [0, 1],
    [2, 1],
    [4, 2],
    [null, 1],
  ],
];
const HOME = 0; // the home side: the ground is theirs

// ---------- the synth ----------
export function createAudio({ sound, on } = {}) {
  const synth = createSynth({
    on: on ?? sound ?? true,
    seed: 1994,
    tracks: TRACKS,
    noiseLength: 4,
    pulse: true,
    attack: 0.003,
    startDelay: 0.06,
    lead: 0.004,
    levels: { master: 0.9, music: 0.32, sfx: 0.85 },
    // the tunes evened out against each other (each track's gain then sets it), a gentle hold on
    // the ground's sound and a limiter on the whole mix
    inserts: {
      music: ac => compressor(ac, { threshold: -30, ratio: 3, knee: 8, attack: 0.012, release: 0.25, makeup: 6 }),
      sfx: ac => compressor(ac, { threshold: -18, ratio: 2.5, knee: 6, attack: 0.006, release: 0.25 }),
      master: ac => limiter(ac, { ceiling: -1, release: 0.12 }),
    },
    arrange: v => {
      const { tone, hiss, sub } = v;
      const target = b => (b === 'music' ? v.bus.music : b === 'sfx' ? v.bus.sfx : 'fx' in b ? b.fx.input : b);
      const gain = (ac, g) => {
        const n = ac.createGain();
        n.gain.value = g;
        return n;
      };
      const filter = (ac, type, f, q = 0.7) => {
        const n = ac.createBiquadFilter();
        n.type = type;
        n.frequency.value = f;
        n.Q.value = q;
        return n;
      };
      // the noise buffer looping from `offset`, started at t (its own node, so it can start later)
      const noiseAt = (t, offset = Math.random() * 3, rate = 1) => {
        const s = v.ac.createBufferSource();
        s.buffer = v.noise;
        s.loop = true;
        s.playbackRate.value = rate;
        s.start(t, offset);
        return s;
      };
      // a random wobble -1…1 at about `hz` new values a second: the noise buffer played so slowly
      // that each sample lasts a moment (and is glided to the next), smoothed by a lowpass
      const wobble = (t, hz, offset = Math.random() * 3) => {
        const s = noiseAt(t, offset, hz / v.ac.sampleRate),
          lp = filter(v.ac, 'lowpass', hz * 1.2, 0.5);
        s.connect(lp);
        return { src: s, out: lp };
      };
      const ended = (src, nodes) => {
        src.onended = () => nodes.forEach(n => n.disconnect());
      };

      // the music's echo (in time with the track), the snare's room; the ground's echo for the
      // crowd and the whistle
      const echo = v.insert(ac => delay(ac, { time: 0.33, feedback: 0.3, wet: 0.24, cut: 3000, pan: 0.25 }));
      const room = v.insert(ac => delay(ac, { time: 0.045, feedback: 0.3, wet: 0.35, dry: 0, cut: 4200, pan: -0.15 }));
      const stand = v.insert(ac => delay(ac, { time: 0.13, feedback: 0.3, wet: 0.26, cut: 2200, pan: 0.15 }), 'sfx');

      // a panner per position (to a tenth) and destination, on the current context
      const panners = new WeakMap();
      const placed = (pan, to = 'sfx') => {
        const p = Math.round(clamp(pan, -1, 1) * 10);
        if (!p || !v.ac) return to;
        let m = panners.get(v.ac);
        if (!m) panners.set(v.ac, (m = new Map()));
        const key = (to === 'sfx' ? 's' : 'x') + p;
        let node = m.get(key);
        if (!node) {
          node = v.ac.createStereoPanner();
          node.pan.value = p / 10;
          node.connect(target(to));
          m.set(key, node);
        }
        return node;
      };

      // ---------- the band ----------
      const kick = (t, vol, bus = 'music') => {
        sub(50, t, 0.26, vol, { punch: 24, drop: 0.03, drive: 0.5, tone: 2400, attack: 0.001, decay: 0.24, sustain: 0, release: 0.05, bus });
        hiss(t, 0.012, vol * 0.22, 6000, 3000, 'bandpass', bus, 1, 0.0005);
      };
      const snare = (t, vol, bus = 'music') => {
        tone(220, 170, t, 0.08, vol * 0.5, 'triangle', bus, 0.001);
        hiss(t, 0.18, vol * 0.75, 6500, 1900, 'bandpass', bus, 0.6, 0.001);
        if (bus === 'music') hiss(t, 0.16, vol * 0.35, 5000, 1600, 'bandpass', room, 0.6, 0.001);
      };
      const rim = (t, vol) => {
        tone(1750, 1550, t, 0.018, vol * 0.4, 'square', 'music', 0.0005);
        hiss(t, 0.025, vol * 0.5, 4200, 3000, 'bandpass', 'music', 3, 0.0005);
      };
      const clap = (t, vol) => {
        for (let k = 0; k < 3; k++) hiss(t + k * 0.009, 0.02, vol * 0.6, 1800, 1300, 'bandpass', 'music', 1.4, 0.0005);
        hiss(t + 0.02, 0.15, vol * 0.5, 1600, 900, 'bandpass', room, 1, 0.001);
      };
      const hat = (t, vol, open) => hiss(t, open ? 0.15 : 0.03, vol * 1.3, 10500, 8000, 'bandpass', 'music', 0.9, 0.0015);
      const crash = (t, vol) => {
        hiss(t, 1.5, vol, 10000, 4500, 'highpass', 'music', undefined, 0.001);
        hiss(t, 0.8, vol * 0.4, 5200, 3200, 'bandpass', 'music', 1.5, 0.001);
      };
      const timp = (t, vol, f) => {
        sub(f, t, 0.7, vol, { punch: 3, drop: 0.05, drive: 0.3, tone: 900, attack: 0.002, decay: 0.6, sustain: 0, release: 0.2 });
        hiss(t, 0.06, vol * 0.25, 900, 300, 'lowpass', 'music', 0.8, 0.001);
      };
      function bassNote(n, t, d, L) {
        const f = midi(n);
        v.pulse(f, t, d, L.bass, { width: 0.25, pwm: 0.2, rate: 0.4, cutoff: 650, envmod: 2000, reso: 0.3, attack: 0.002, decay: 0.14, sustain: 0.45, release: 0.04 });
        sub(f, t, d, L.sub, { punch: 2, drop: 0.02, drive: 0.2, tone: 420, attack: 0.002, decay: 0.2, sustain: 0.6, release: 0.04 });
      }
      function leadNote(n, t, d, L, voice) {
        const f = midi(n);
        if (voice === 'saw') {
          v.supersaw(f, t, d, L.lead * 0.9, { attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.1, cutoff: 2600, envmod: 1800, reso: 0.15, detune: 0.25, mix: 0.5, width: 0.6, bus: echo });
          v.pulse(f, t, d, L.lead * 0.5, { width: 0.5, pwm: 0.3, cutoff: 3000, envmod: 1200, attack: 0.004, decay: 0.3, sustain: 0.7, release: 0.1, bus: echo });
        } else if (voice === 'brass')
          v.fm(f, t, d, L.lead, { ratio: 1, index: 2.4, modDecay: 0.25, modSustain: 0.6, attack: 0.03, decay: 0.25, sustain: 0.8, release: 0.12, bus: echo });
        else if (voice === 'soft')
          v.pulse(f, t, d, L.lead, { width: 0.6, pwm: 0.35, rate: 0.5, cutoff: 1700, envmod: 900, reso: 0.1, attack: 0.012, decay: 0.4, sustain: 0.6, release: 0.18, bus: echo });
        else v.pulse(f, t, d, L.lead, { width: 0.35, pwm: 0.45, rate: 0.7, cutoff: 2600, envmod: 1500, reso: 0.2, attack: 0.004, decay: 0.3, sustain: 0.7, release: 0.1, bus: echo });
      }
      // the chord part for this step
      function part(B, s, at, dt, L) {
        if (B.part === 'stab' && STABS[s] === 'x')
          for (const n of B.tones)
            v.supersaw(midi(n), at, dt * 1.2, L.chord, { attack: 0.002, decay: 0.12, sustain: 0.3, release: 0.06, cutoff: 2200, envmod: 2000, detune: 0.3, mix: 0.55, width: 0.8 });
        else if (B.part === 'pad' && s === 0)
          for (const n of B.tones)
            v.supersaw(midi(n), at, dt * 15, L.pad, { attack: 0.08, decay: 0.6, sustain: 0.7, release: 0.25, cutoff: 1300, envmod: 600, detune: 0.35, mix: 0.6, width: 0.9 });
        else if (B.part === 'ep' && EP[s] === 'x') {
          const len = s === 0 ? 5 : 3.5;
          for (const n of B.tones)
            v.fm(midi(n), at, dt * len, L.ep, { ratio: 1, index: 1.5, modDecay: 0.15, modSustain: 0.25, attack: 0.003, decay: 0.35, sustain: 0.35, release: 0.15, bus: echo });
        } else if (B.part === 'brass' && (s === 0 || s === 8))
          for (const n of B.tones)
            v.fm(midi(n), at, dt * 7, L.brass, { ratio: 1, index: 2, modDecay: 0.3, modSustain: 0.55, attack: 0.04, decay: 0.3, sustain: 0.75, release: 0.15 });
      }

      function step(tr, i, t, dt) {
        const k = i % tr.steps,
          s = k % 16,
          B = tr.bars[k >> 4],
          L = tr.look,
          at = t + (s % 2 ? dt * (L.swing ?? 0) : 0);
        if (s === 0) echo.fx?.time.setTargetAtTime(dt * 3, t, 0.05); // a dotted eighth
        // the kit (the fill on the second half of a section's last bar)
        const kit = B.fill && s >= 8 ? KITS.fill : B.kit,
          kv = L.kit,
          lane = c => kit[c]?.[s] ?? '.';
        if (lane('k') === 'x') kick(at, 0.4 * kv);
        const sn = lane('s');
        if (sn === 'x') snare(at, 0.28 * kv);
        else if (sn === 'g') snare(at, 0.07 * kv);
        if (lane('r') === 'x') rim(at, 0.12 * kv);
        if (lane('c') === 'x') clap(at, 0.16 * kv);
        const h = lane('h');
        if (h === 'x' || h === 'o') hat(at, (s % 4 === 0 ? 0.11 : 0.075) * kv, h === 'o');
        const tm = lane('t');
        if (tm === '1' || tm === '5') timp(at, 0.3 * kv, midi(B.root + (tm === '5' ? 7 : 0)));
        if (lane('R') === 'x') {
          const u = s / 15;
          snare(at, (0.025 + 0.12 * u) * kv);
          snare(at + dt / 2, (0.02 + 0.12 * u) * kv);
        }
        if (B.crash && s === 0) crash(at, 0.055 * kv);
        // the bass
        const bt = B.bass.p[s];
        if (bt && bt !== '.') {
          let gap = 1;
          while (s + gap < 16 && B.bass.p[s + gap] === '.') gap++;
          const n =
            bt === '0'
              ? B.root
              : bt === '5'
                ? B.root + 7
                : bt === 'c'
                  ? B.root + 12
                  : bt === '3'
                    ? B.root + B.iv[1]
                    : B.next - 2;
          bassNote(n, at, dt * Math.min(gap * 0.85, B.bass.max ?? 2), L);
        }
        part(B, s, at, dt, L);
        // the arpeggio: the chord's tones up, every 16th, into the echo
        if (B.arp && L.arp) {
          const n = B.up[s % 4];
          tone(midi(n), midi(n), at, dt * 0.8, L.arp * (s % 4 === 0 ? 1 : 0.75), 0.125, echo, 0.002);
        }
        // the lead
        const n = tr.lead[k];
        if (n > 0) leadNote(n, at, dt * span(tr.lead, k, 32) * 0.92, L, B.voice);
      }

      // ---------- the crowd's voices ----------
      // a choir of detuned saws through vowel formants: o.notes [[at, semitones]] (the pitch glides
      // there), o.vowel a name or [[at, name]], o.syll [[at, len, level]] for articulated singing
      // (else one swell: attack, a dip to sustain, release), breath noise through the same formants
      function choir(t, o) {
        const ac = v.ac,
          n = o.n ?? 6,
          base = o.base ?? 180,
          spread = o.spread ?? 2,
          dur = o.dur ?? 1.5,
          release = o.release ?? 0.4,
          end = t + dur + release;
        const pre = gain(ac, 0.5 / Math.sqrt(n)),
          env = gain(ac, 0),
          lfo = ac.createOscillator(),
          lfoG = gain(ac, 14 + spread * 4),
          nodes = [pre, env, lfo, lfoG],
          oscs = [lfo],
          srcs = [lfo];
        lfo.frequency.value = rand(4.2, 5.8);
        lfo.connect(lfoG);
        for (let k = 0; k < n; k++) {
          const os = ac.createOscillator(),
            det = (Math.random() * 2 - 1) * spread,
            oct = k % 4 === 3 ? 2 : 1,
            slop = Math.random() * 0.06;
          os.type = 'sawtooth';
          o.notes.forEach(([at, semi], j) => {
            const f = base * oct * 2 ** ((semi + det) / 12);
            if (j === 0) os.frequency.setValueAtTime(f, t);
            else os.frequency.setTargetAtTime(f, t + at + slop, o.glide ?? 0.05);
          });
          lfoG.connect(os.detune);
          os.connect(pre);
          oscs.push(os);
          srcs.push(os);
          nodes.push(os);
        }
        if (o.breath !== 0) {
          const ns = noiseAt(t),
            ng = gain(ac, (o.breath ?? 0.35) * 0.5);
          ns.connect(ng).connect(pre);
          srcs.push(ns);
          nodes.push(ns, ng);
        }
        const vowels = typeof o.vowel === 'string' || !o.vowel ? [[0, o.vowel ?? 'oh']] : o.vowel;
        VOWELS[vowels[0][1]].forEach(([f, q], j) => {
          const b = filter(ac, 'bandpass', f, q),
            g = gain(ac, FORMANT_LEVEL[j] * Math.sqrt(q));
          for (const [at, name] of vowels.slice(1)) b.frequency.setTargetAtTime(VOWELS[name][j][0], t + at, 0.08);
          pre.connect(b).connect(g).connect(env);
          nodes.push(b, g);
        });
        const p = env.gain,
          vol = o.vol;
        p.value = 0;
        p.setValueAtTime(0, t);
        if (o.syll) {
          for (const [at, len, lv = 1] of o.syll) {
            p.setTargetAtTime(vol * lv, t + at, 0.03);
            p.setTargetAtTime(vol * lv * 0.25, t + at + len * 0.8, 0.05);
          }
        } else {
          const a = o.attack ?? 0.15;
          p.linearRampToValueAtTime(vol, t + a);
          p.setTargetAtTime(vol * (o.sustain ?? 0.7), t + a, 0.25);
        }
        p.setTargetAtTime(0, t + dur, release / 4);
        env.connect(target(placed(o.pan ?? 0, o.bus ?? stand)));
        for (const s of oscs) s.start(t);
        for (const s of srcs) s.stop(end + 0.05);
        ended(lfo, nodes);
      }
      // noise through bands ([Hz, Q, level], or a vowel's formants, gliding to others), with an
      // ADSR and an optional flutter (the wobble of many voices): roars, murmurs, gasps
      function crowdNoise(t, dur, vol, o = {}) {
        const ac = v.ac,
          src = noiseAt(t),
          pre = gain(ac, 1),
          env = gain(ac, 0),
          nodes = [src, pre, env],
          srcs = [src];
        let head = pre;
        src.connect(pre);
        if (o.flutter) {
          const fl = gain(ac, 1 - o.flutter[1]),
            w = wobble(t, o.flutter[0]),
            d = gain(ac, o.flutter[1]);
          w.out.connect(d).connect(fl.gain);
          pre.connect(fl);
          head = fl;
          srcs.push(w.src);
          nodes.push(fl, w.src, w.out, d);
        }
        const vowels = typeof o.vowel === 'string' ? [[0, o.vowel]] : o.vowel;
        const bands = vowels ? VOWELS[vowels[0][1]].map(([f, q], j) => [f, q * 0.6, FORMANT_LEVEL[j]]) : o.bands;
        let out = env;
        if (o.lp) {
          out = filter(ac, 'lowpass', o.lp, 0.7);
          env.connect(out);
          nodes.push(out);
        }
        bands.forEach(([f, q, lv], j) => {
          const b = filter(ac, 'bandpass', f, q),
            g = gain(ac, lv * Math.sqrt(q));
          if (vowels) for (const [at, name] of vowels.slice(1)) b.frequency.setTargetAtTime(VOWELS[name][j][0], t + at, 0.1);
          head.connect(b).connect(g).connect(env);
          nodes.push(b, g);
        });
        const p = env.gain,
          a = o.attack ?? 0.1,
          release = o.release ?? 0.5,
          end = t + dur + release;
        p.value = 0;
        p.setValueAtTime(0, t);
        p.linearRampToValueAtTime(vol, t + a);
        p.setTargetAtTime(vol * (o.sustain ?? 0.6), t + a, (o.decay ?? 0.5) / 3);
        p.setTargetAtTime(0, t + dur, release / 4);
        out.connect(target(placed(o.pan ?? 0, o.bus ?? stand)));
        for (const s of srcs) s.stop(end + 0.05);
        ended(src, nodes);
      }
      // applause: noise in three bands, each opened by a peaky wobble (the claps), over a wash
      const CLAP_CURVE = Float32Array.from({ length: 512 }, (_, k) => {
        const x = (2 * k) / 511 - 1;
        return Math.max(0, (x - 0.15) / 0.85) ** 2.2 * 3;
      });
      function applause(t, dur, vol, o = {}) {
        const ac = v.ac,
          env = gain(ac, 0),
          nodes = [env],
          srcs = [];
        for (const [hz, f, q, lv] of [
          [38, 1300, 0.9, 1],
          [75, 2300, 0.9, 0.8],
          [120, 3600, 1, 0.6],
        ]) {
          const s = noiseAt(t),
            b = filter(ac, 'bandpass', f, q),
            claps = gain(ac, 0),
            w = wobble(t, hz),
            ws = ac.createWaveShaper(),
            lg = gain(ac, lv);
          ws.curve = CLAP_CURVE;
          w.out.connect(ws).connect(claps.gain);
          s.connect(b).connect(claps).connect(lg).connect(env);
          srcs.push(s, w.src);
          nodes.push(s, b, claps, w.src, w.out, ws, lg);
        }
        // the far side of the ground: a soft wash of it
        const ws = noiseAt(t),
          wb = filter(ac, 'bandpass', 1800, 0.6),
          wg = gain(ac, 0.12);
        ws.connect(wb).connect(wg).connect(env);
        srcs.push(ws);
        nodes.push(ws, wb, wg);
        const a = o.attack ?? 0.35,
          release = o.release ?? dur * 0.4,
          end = t + dur + release,
          p = env.gain;
        p.value = 0;
        p.setValueAtTime(0, t);
        p.linearRampToValueAtTime(vol, t + a);
        p.setTargetAtTime(vol * 0.75, t + a, 0.6);
        p.setTargetAtTime(0, t + dur, release / 4);
        env.connect(target(placed(o.pan ?? 0, stand)));
        for (const s of srcs) s.stop(end + 0.05);
        ended(srcs[0], nodes);
      }
      // thousands clapping together, once
      const crowdClap = (t, vol) => {
        hiss(t, 0.07, vol, 2000, 1100, 'bandpass', stand, 0.8, 0.002);
        hiss(t + 0.012, 0.06, vol * 0.6, 3600, 2600, 'bandpass', stand, 1, 0.002);
        hiss(t + 0.025, 0.08, vol * 0.4, 1400, 900, 'bandpass', stand, 0.9, 0.003);
      };
      // fans whistling at the referee: shrill, sliding, staggered
      const jeerWhistles = (t, vol, n = 5) => {
        for (let k = 0; k < n; k++) {
          const f = rand(2100, 3300),
            at = t + rand(0, 0.5),
            d = rand(0.5, 1.2);
          tone(f * 0.94, f * rand(0.98, 1.06), at, d, vol * rand(0.5, 1), 'sine', stand, 0.06);
        }
      };

      // ---------- the crowd's reactions ----------
      const last = {}; // when each rate-limited sound last played, and how hard
      const limited = (key, t, gap, force = 0) => {
        const l = last[key];
        if (l && t - l.t < gap && force <= l.f * 1.5) return true;
        last[key] = { t, f: force };
        return false;
      };
      const react = {
        // a chance: the breath drawn in, the ooh rising and falling away
        ooh(t, g) {
          if (limited('ooh', t, 1.6)) return;
          choir(t, { notes: [[0, -2], [0.3, 5], [0.85, 3], [1.5, -3]], dur: 1.5, vol: 0.5 * g, base: 185, n: 7, spread: 2.5, vowel: [[0, 'oo'], [0.9, 'aw']], attack: 0.25, sustain: 0.85, release: 0.7 });
          crowdNoise(t, 1.4, 0.32 * g, { vowel: [[0, 'oo'], [0.9, 'aw']], attack: 0.3, sustain: 0.8, release: 0.8, flutter: [7, 0.3] });
        },
        // disappointment: a falling 'aww'
        groan(t, g) {
          if (limited('groan', t, 1.5)) return;
          choir(t, { notes: [[0, 4], [0.15, 5], [1.1, -4]], dur: 1.2, vol: 0.4 * g, base: 165, n: 7, spread: 2.5, vowel: 'aw', attack: 0.12, sustain: 0.8, release: 0.6 });
          crowdNoise(t, 1.1, 0.24 * g, { vowel: 'aw', attack: 0.12, release: 0.7, flutter: [6, 0.3] });
        },
        // the home end booing
        boo(t, g, dur = 1.4) {
          if (limited('boo', t, 1.2)) return;
          choir(t, { notes: [[0, 0], [dur, -2]], dur, vol: 0.38 * g, base: 128, n: 8, spread: 1.5, vowel: 'oo', attack: 0.2, sustain: 0.9, release: 0.5 });
          crowdNoise(t, dur, 0.2 * g, { vowel: 'oo', attack: 0.2, release: 0.5, flutter: [5, 0.35] });
        },
        // the roar: a wall of shouting, a rising 'yeah', the screams over it; the away end's
        // smaller, darker and off to one side
        roar(t, g, away = false) {
          if (limited(away ? 'roarA' : 'roar', t, 1.2)) return;
          const pan = away ? 0.55 : 0,
            lp = away ? 1600 : 0,
            dur = away ? 2.2 : 4.2;
          crowdNoise(t, dur, 0.9 * g, { vowel: [[0, 'eh'], [0.3, 'ah'], [2.5, 'aw']], attack: 0.15, decay: 1.2, sustain: 0.65, release: 2.2, flutter: [6, 0.25], pan, lp });
          crowdNoise(t, dur * 0.8, 0.32 * g, { bands: [[3300, 0.9, 1]], attack: 0.12, decay: 0.8, sustain: 0.5, release: 1.6, pan, lp });
          choir(t, { notes: [[0, -5], [0.22, 7], [1.6, 6], [dur, 2]], dur, vol: 0.65 * g, base: 205, n: 8, spread: 3, vowel: [[0, 'eh'], [0.3, 'ah']], attack: 0.12, sustain: 0.6, release: 1.6, pan });
          if (!away) crowdNoise(t, 2.5, 0.35 * g, { bands: [[90, 0.8, 1], [180, 0.8, 0.6]], attack: 0.3, release: 1.5, flutter: [9, 0.5], bus: 'sfx' }); // feet on the stands
        },
        // a chant: a phrase sung twice, claps in its rests
        chant(t, k = Math.floor(Math.random() * (CHANTS.length + 1))) {
          if (limited('chant', t, 6)) return 0;
          const beat = rand(0.38, 0.44),
            base = rand(160, 185);
          if (k >= CHANTS.length) {
            // a clapping chant: clap, clap, clap-clap-clap, a shout; three times, growing
            for (let r = 0; r < 3; r++) {
              const t0 = t + r * beat * 5,
                lv = 0.6 + 0.2 * r;
              for (const b of [0, 1, 2, 2.5, 3]) crowdClap(t0 + b * beat, 0.3 * lv);
              choir(t0 + 4 * beat, { notes: [[0, 7]], dur: 0.22, vol: 0.4 * lv, base, n: 7, spread: 2, vowel: 'eh', attack: 0.02, sustain: 0.9, release: 0.15 });
            }
            return beat * 15;
          }
          const phrase = CHANTS[k],
            len = phrase.reduce((a, [, b]) => a + b, 0),
            notes = [],
            syll = [];
          for (let r = 0; r < 2; r++) {
            let at = r * len;
            for (const [semi, b] of phrase) {
              if (semi === null) {
                for (let c = 0; c <= Math.max(b - 1, 0.5); c += 0.5) crowdClap(t + (at + c) * beat, 0.24 + 0.08 * r);
              } else {
                notes.push([at * beat, semi]);
                syll.push([at * beat, b * beat, 0.8 + 0.2 * r]);
              }
              at += b;
            }
          }
          const dur = 2 * len * beat;
          choir(t, { notes, syll, dur, vol: 0.42, base, n: 8, spread: 1.2, vowel: 'oh', release: 0.4, glide: 0.035, breath: 0.25 });
          crowdNoise(t, dur, 0.06, { vowel: 'oh', attack: 0.4, release: 0.5, flutter: [3, 0.3] });
          return dur;
        },
      };

      // ---------- the ball, the players, the referee ----------
      const thud = (f, t, dur, vol, out, o = {}) =>
        sub(f, t, dur, vol, { punch: 10, drop: 0.03, drive: 0.4, tone: 1200, attack: 0.001, decay: dur, sustain: 0, release: 0.04, bus: out, ...o });
      // the referee's pea whistle: a shrill sine trilled by the pea, a breath of air in it
      function whistle(t, dur, vol, pitch = 1) {
        const ac = v.ac,
          f = 2950 * pitch,
          o = ac.createOscillator(),
          o2 = ac.createOscillator(),
          lfo = ac.createOscillator(),
          fm = gain(ac, f * 0.035),
          am = gain(ac, 0.7),
          amD = gain(ac, 0.3),
          h2 = gain(ac, 0.07),
          env = gain(ac, 0),
          ns = noiseAt(t),
          nb = filter(ac, 'bandpass', f, 7),
          ng = gain(ac, 0.5);
        o.type = 'sine';
        o2.type = 'sine';
        lfo.frequency.value = rand(34, 42);
        o.frequency.setValueAtTime(f * 0.9, t);
        o.frequency.setTargetAtTime(f, t, 0.012);
        o2.frequency.setValueAtTime(f * 1.8, t);
        o2.frequency.setTargetAtTime(f * 2, t, 0.012);
        lfo.connect(fm);
        fm.connect(o.frequency);
        lfo.connect(amD).connect(am.gain);
        o.connect(am);
        o2.connect(h2).connect(am);
        ns.connect(nb).connect(ng).connect(am);
        am.connect(env).connect(target(stand));
        const p = env.gain,
          end = t + dur + 0.06;
        p.value = 0;
        p.setValueAtTime(0, t);
        p.linearRampToValueAtTime(vol, t + 0.015);
        p.setTargetAtTime(vol * 0.85, t + 0.015, 0.05);
        p.setTargetAtTime(0, t + dur, 0.015);
        for (const s of [o, o2, lfo]) s.start(t);
        for (const s of [o, o2, lfo, ns]) s.stop(end + 0.05);
        ended(o, [o, o2, lfo, fm, am, amD, h2, env, ns, nb, ng]);
      }
      const blasts = (t, list, vol) => {
        let at = t;
        for (const d of list) {
          whistle(at, d, vol);
          at += d + 0.13;
        }
      };

      const ball = {
        kick(t, e, out) {
          const p = clamp01(e.power ?? 0.5),
            kind = e.kind ?? 'pass';
          if (limited('kick', t, 0.04, p)) return;
          if (kind === 'header') {
            // the forehead: dull, no leather crack
            thud(140, t, 0.08, 0.22 + 0.12 * p, out, { punch: 5, tone: 650 });
            hiss(t, 0.06, 0.12 + 0.08 * p, 900, 300, 'lowpass', out, 0.8, 0.001);
          } else if (kind === 'throw') {
            hiss(t, 0.05, 0.08, 1500, 700, 'bandpass', out, 1.2, 0.002);
            thud(120, t, 0.06, 0.08, out, { punch: 4, tone: 700 });
          } else if (kind === 'pass') {
            // a side-foot: a soft 'tup'
            thud(95, t, 0.09, 0.2 + 0.2 * p, out, { punch: 8, tone: 900 });
            hiss(t, 0.03, 0.1 + 0.12 * p, 2600, 900, 'bandpass', out, 1, 0.0008);
          } else if (kind === 'lob') {
            thud(100, t, 0.1, 0.22 + 0.15 * p, out, { punch: 8, tone: 900 });
            hiss(t, 0.06, 0.12, 1900, 700, 'bandpass', out, 1, 0.001);
            hiss(t + 0.03, 0.3, 0.04 * p, 900, 2400, 'bandpass', out, 2, 0.06); // under the ball
          } else {
            // shot, clear, volley: the laces through it, a crack of leather, the ball rushing off
            const hard = kind === 'volley' ? 1.25 : kind === 'clear' ? 0.9 : 1;
            thud(68, t, 0.15, (0.3 + 0.3 * p) * hard, out, { punch: 18, drop: 0.035, drive: 0.7, tone: 1700 });
            hiss(t, 0.045, (0.2 + 0.2 * p) * hard, kind === 'volley' ? 5200 : 3900, 1200, 'bandpass', out, 0.8, 0.0006);
            hiss(t, 0.12, 0.1 * p, 700, 200, 'lowpass', out, 0.7, 0.001);
            if (p > 0.45) hiss(t + 0.03, 0.28, 0.05 * p, 1200, 3200, 'bandpass', out, 2, 0.05);
          }
        },
        bounce(t, e, out) {
          const sp = clamp(e.speed, 0, 40);
          if (sp < 1.2) return;
          const g = clamp01(sp / 16) ** 0.8;
          if (limited('bounce', t, 0.07, g)) return;
          thud(105, t, 0.07, 0.24 * g, out, { punch: 6, drop: 0.02, tone: 800 });
          hiss(t, 0.035, 0.07 * g, 1400, 500, 'lowpass', out, 0.7, 0.001);
        },
        // the woodwork: a hollow metal ring over a thud
        wood(t, out, f) {
          if (limited('wood', t, 0.15)) return;
          thud(80, t, 0.12, 0.38, out, { punch: 12, tone: 1400 });
          v.fm(f, t, 1.1, 0.16, { ratio: 2.76, index: 3.2, modDecay: 0.06, modSustain: 0.15, attack: 0.0008, decay: 1.1, sustain: 0, release: 0.2, bus: out });
          tone(f * 2.4, f * 2.38, t, 0.7, 0.05, 'sine', out, 0.001);
          hiss(t, 0.03, 0.22, 5200, 2600, 'bandpass', out, 1.2, 0.0006);
        },
        // into the net: the swish and the rattle of the mesh
        net(t, out) {
          if (limited('net', t, 0.4)) return;
          hiss(t, 0.5, 0.3, 5200, 1300, 'bandpass', out, 0.7, 0.008);
          thud(85, t, 0.12, 0.15, out, { punch: 5, tone: 600 });
          for (let k = 0; k < 6; k++) hiss(t + 0.05 + k * 0.045 + Math.random() * 0.02, 0.03, 0.08 * (1 - k / 7), 2600, 2000, 'bandpass', out, 3, 0.001);
        },
        save(t, e, out) {
          const kind = e.kind ?? 'catch';
          if (limited('save', t, 0.1)) return;
          // the gloves on the ball
          hiss(t, 0.045, kind === 'parry' ? 0.32 : 0.26, kind === 'parry' ? 2900 : 1800, 900, 'bandpass', out, 1.1, 0.0006);
          thud(kind === 'catch' ? 115 : 150, t, 0.08, 0.26, out, { punch: 7, tone: 1000 });
          if (kind === 'catch') hiss(t + 0.02, 0.1, 0.1, 700, 250, 'lowpass', out, 0.7, 0.003); // clutched in
          if (kind !== 'catch') {
            // landing on the grass
            thud(58, t + 0.2, 0.16, 0.22, out, { punch: 6, tone: 600 });
            hiss(t + 0.2, 0.22, 0.08, 1500, 400, 'lowpass', out, 0.7, 0.004);
          }
        },
        // the slide: studs and hip through the grass; the ball poked away if it was won
        tackle(t, e, out) {
          if (limited('tackle', t, 0.15)) return;
          hiss(t, 0.32, 0.14, 1700, 450, 'bandpass', out, 0.8, 0.02);
          hiss(t, 0.26, 0.05, 6000, 3500, 'highpass', out, 0.7, 0.03);
          if (e.won) thud(115, t + 0.08, 0.06, 0.16, out, { punch: 6, tone: 900 });
        },
        // the card shown: a TV graphic's swish and two notes
        card(t, red) {
          hiss(t, 0.16, 0.06, 700, 4200, 'bandpass', 'sfx', 1.5, 0.05);
          const n = red ? [64, 57] : [76, 71];
          n.forEach((m, k) => v.pulse(midi(m), t + 0.08 + k * 0.11, 0.1, 0.05, { width: 0.4, pwm: 0, cutoff: 2400, envmod: 800, attack: 0.002, decay: 0.08, sustain: 0.6, release: 0.05, bus: 'sfx' }));
        },
        // the shoot-out's held breath: a slow, low double beat
        heart(t) {
          thud(52, t, 0.18, 0.13, 'sfx', { punch: 4, drop: 0.05, drive: 0.2, tone: 300 });
          thud(50, t + 0.24, 0.16, 0.085, 'sfx', { punch: 4, drop: 0.05, drive: 0.2, tone: 300 });
        },
      };

      // ---------- the menus ----------
      const blip = (f0, f1, t, vol, d = 0.045) => {
        tone(f0, f1, t, d, vol, 0.25, 'sfx', 0.002);
        tone(f0 * 2, f1 * 2, t, d * 0.7, vol * 0.25, 'sine', 'sfx', 0.002);
      };
      const bell = (n, t, vol, d = 0.6) =>
        v.fm(midi(n), t, d, vol, { ratio: 3.5, index: 1.6, modDecay: 0.12, modSustain: 0.15, attack: 0.0025, decay: d, sustain: 0, release: 0.2, bus: 'sfx' });
      const effects = {
        'ui:move': t => blip(1320, 1320, t, 0.13, 0.03),
        'ui:select': t => {
          blip(880, 880, t, 0.12);
          blip(1320, 1320, t + 0.06, 0.13, 0.07);
        },
        'ui:back': t => {
          blip(1320, 1320, t, 0.12);
          blip(880, 880, t + 0.06, 0.12, 0.07);
        },
        'ui:error': t => {
          for (let k = 0; k < 2; k++)
            v.pulse(140, t + k * 0.11, 0.07, 0.14, { width: 0.2, pwm: 0, cutoff: 1200, envmod: 600, attack: 0.003, decay: 0.07, sustain: 0.8, release: 0.03, bus: 'sfx' });
        },
        // a transfer: the coins on the counter, the till's bell
        'ui:coin': t => {
          for (let k = 0; k < 3; k++) hiss(t + k * 0.05, 0.03, 0.06, 9000, 7000, 'bandpass', 'sfx', 4, 0.001);
          bell(88, t + 0.05, 0.09, 0.4);
          bell(95, t + 0.13, 0.09, 0.8);
        },
        // a trophy: the crowd up on its feet, bells on top
        'ui:cheer': t => {
          react.roar(t, 0.8);
          applause(t + 0.5, 3.5, 0.3);
          [84, 88, 91, 96].forEach((n, k) => bell(n, t + 0.1 + k * 0.09, 0.07, k === 3 ? 1.2 : 0.5));
        },
      };

      // ---------- the crowd's bed ----------
      // murmur (two sides, babbling), the ground's low hubbub, an excited shouting layer and the
      // air of it, all on one fader; a slow swell moves through the murmur
      const bank = v.loop(ac => {
        const t = ac.currentTime,
          out = gain(ac, 0),
          srcs = [],
          keep = [out];
        out.connect(v.bus.sfx);
        const murmur = gain(ac, 0),
          swell = gain(ac, 0.8),
          sw = wobble(t, 0.12);
        const swD = gain(ac, 0.25);
        sw.out.connect(swD).connect(swell.gain);
        murmur.connect(swell).connect(out);
        srcs.push(sw.src);
        for (const [side, f1, f2] of [
          [-0.55, 390, 1050],
          [0.55, 450, 1200],
        ]) {
          const s = noiseAt(t),
            b1 = filter(ac, 'bandpass', f1, 1.1),
            b2 = filter(ac, 'bandpass', f2, 1.4),
            g2 = gain(ac, 0.6),
            babble = gain(ac, 0.7),
            w = wobble(t, rand(7, 9)),
            wd = gain(ac, 0.3),
            pan = ac.createStereoPanner();
          pan.pan.value = side;
          s.connect(b1).connect(babble);
          s.connect(b2).connect(g2).connect(babble);
          w.out.connect(wd).connect(babble.gain);
          babble.connect(pan).connect(murmur);
          srcs.push(s, w.src);
        }
        const rs = noiseAt(t),
          rlp = filter(ac, 'lowpass', 170, 0.7),
          rumble = gain(ac, 0);
        rs.connect(rlp).connect(rumble).connect(out);
        srcs.push(rs);
        // the shouting: 'ah' formants, fluttering faster
        const ss = noiseAt(t),
          shout = gain(ac, 0),
          sfl = gain(ac, 0.7),
          sw2 = wobble(t, 5),
          sw2d = gain(ac, 0.3);
        ss.connect(sfl);
        sw2.out.connect(sw2d).connect(sfl.gain);
        VOWELS.ah.forEach(([f, q], j) => {
          const b = filter(ac, 'bandpass', f, q * 0.5),
            g = gain(ac, FORMANT_LEVEL[j] * 1.6);
          sfl.connect(b).connect(g).connect(shout);
        });
        shout.connect(out);
        srcs.push(ss, sw2.src);
        const as = noiseAt(t),
          ahp = filter(ac, 'bandpass', 3200, 0.8),
          air = gain(ac, 0);
        as.connect(ahp).connect(air).connect(out);
        srcs.push(as);
        return {
          out,
          murmur,
          rumble,
          shout,
          air,
          keep,
          at: -1,
          stop() {
            const now = ac.currentTime;
            out.gain.cancelScheduledValues(now);
            out.gain.setTargetAtTime(0, now, 0.25);
            for (const s of srcs) s.stop(now + 1.5);
            srcs[0].onended = () => out.disconnect();
          },
        };
      });
      // where the bed goes: level 0…1, excitement 0…1 (+ which side), hushed for a penalty
      function bed(level, excite, home, hush, force) {
        if (level <= 0) {
          bank.off();
          return;
        }
        const b = bank.on();
        if (!b) return;
        const now = v.ac.currentTime;
        if (!force && now - b.at < 0.1) return;
        b.at = now;
        const x = clamp01(excite),
          q = hush ? 0.4 : 1;
        b.out.gain.setTargetAtTime(0.55 * level, now, 0.7);
        b.murmur.gain.setTargetAtTime((0.32 + 0.12 * x) * q, now, 0.5);
        b.rumble.gain.setTargetAtTime((0.5 + 0.6 * x) * q, now, 0.6);
        b.shout.gain.setTargetAtTime((0.015 + 0.32 * x ** 1.5 * (home ? 1 : 0.6)) * q, now, x > 0.5 ? 0.35 : 0.7);
        b.air.gain.setTargetAtTime((0.02 + 0.12 * x * (home ? 1 : 0.5)) * q, now, 0.6);
      }

      // ---------- the match ----------
      const st = {
        level: 0, // the bed's level, from crowd()
        excite: 0,
        home: true,
        glow: 0, // after a goal: the ground stays up, fading
        glowAt: 0,
        chantAt: -1,
        kickAt: -1,
        heartAt: 0,
        whistleAt: -1,
        endAt: -1,
        fullAt: -1,
      };
      const glowNow = t => st.glow * Math.exp(-(t - st.glowAt) / 6);
      const raise = (g, t) => {
        st.glow = Math.max(glowNow(t), g);
        st.glowAt = t;
      };
      const teamOf = (s, i) => s?.players?.[i]?.team ?? -1;
      const panAt = x => clamp((Number.isFinite(x) ? x : 34) / 34 - 1, -1, 1) * 0.5;

      function play(e, s, t) {
        const out = placed(panAt(s?.ball?.x), 'sfx');
        switch (e.type) {
          case 'kick':
            ball.kick(t, e, placed(panAt(s?.players?.[e.player]?.x ?? s?.ball?.x)));
            st.kickAt = t;
            break;
          case 'bounce':
            ball.bounce(t, e, out);
            break;
          case 'post':
          case 'bar':
            ball.wood(t, out, e.type === 'bar' ? 540 : 470);
            react.ooh(t + 0.05, teamOf(s, s?.ball?.last) === HOME ? 1 : 0.6);
            break;
          case 'net':
            ball.net(t, out);
            break;
          case 'save': {
            ball.save(t, e, out);
            const keeper = teamOf(s, e.player);
            if (s?.phase !== 'pens') react.ooh(t + 0.08, keeper === HOME ? 0.55 : 1);
            if (keeper === HOME && s?.phase !== 'pens') applause(t + 1, 2.2, 0.18);
            break;
          }
          case 'tackle':
            ball.tackle(t, e, placed(panAt(s?.players?.[e.player]?.x)));
            break;
          case 'foul':
            if (teamOf(s, e.player) === HOME) break;
            react.boo(t + 0.25, 0.6, 1);
            jeerWhistles(t + 0.2, 0.012, 4);
            break;
          case 'card': {
            const red = e.colour === 'red',
              home = teamOf(s, e.player) === HOME;
            ball.card(t, red);
            if (home) react.boo(t + 0.15, red ? 1 : 0.7, red ? 2 : 1.3);
            else {
              applause(t + 0.1, red ? 3 : 1.8, red ? 0.3 : 0.18);
              if (red) react.roar(t + 0.1, 0.45);
            }
            if (home) jeerWhistles(t + 0.1, red ? 0.02 : 0.013, red ? 8 : 5);
            break;
          }
          case 'whistle': {
            const kind = e.kind;
            if (kind === 'foul') whistle(t, 0.2, 0.11);
            else if (kind === 'out') whistle(t, 0.12, 0.05);
            else if (kind === 'start') whistle(t, 0.45, 0.11);
            else if (kind === 'goal') whistle(t, 0.4, 0.09);
            else if (kind === 'half') blasts(t, [0.3, 0.95], 0.11);
            else if (kind === 'full') {
              blasts(t, [0.3, 0.3, 1.1], 0.12);
              st.fullAt = t;
            } else whistle(t, 0.2, 0.1);
            st.whistleAt = t;
            break;
          }
          case 'out':
            if (e.kind === 'corner') raise(0.35, t);
            break;
          case 'goal': {
            if (s?.phase === 'pens') break; // the shoot-out has its own reactions (pen)
            if (limited('goal', t, 2)) break;
            if (e.team === HOME) {
              react.roar(t, 1);
              applause(t + 1, 6, 0.4);
              raise(1, t);
              st.chantAt = t + rand(5, 7);
            } else {
              react.groan(t, 0.85);
              react.roar(t + 0.15, 0.4, true);
              applause(t + 1.2, 3, 0.12, { pan: 0.55 });
              raise(0.2, t);
            }
            break;
          }
          case 'chance':
            react.ooh(t, e.team === HOME ? 1 : 0.6);
            if (e.team === HOME) applause(t + 1.5, 2, 0.14);
            break;
          case 'kickoff':
            applause(t, 2.5, 0.16);
            break;
          case 'halftime':
            applause(t + 0.3, 5, 0.3);
            break;
          case 'fulltime':
            ending(t + 0.3, s);
            break;
          case 'penalty':
            if (e.team === HOME) {
              react.roar(t, 0.5);
              st.chantAt = Math.max(st.chantAt, t + 20);
            } else {
              react.boo(t + 0.1, 1, 2.2);
              jeerWhistles(t + 0.2, 0.02, 9);
            }
            break;
          case 'pen':
            if (e.scored) {
              if (e.team === HOME) {
                react.roar(t + 0.1, 0.8);
                applause(t + 0.8, 2.5, 0.25);
              } else {
                react.groan(t + 0.1, 0.7);
                react.roar(t + 0.2, 0.35, true);
              }
            } else if (e.team === HOME) react.groan(t + 0.05, 1);
            else {
              react.roar(t + 0.05, 0.85);
              applause(t + 0.8, 2.5, 0.25);
            }
            break;
          case 'end':
            if (t - st.fullAt > 3) blasts(t, [0.3, 0.3, 1.1], 0.12);
            if (t - st.endAt > 5) ending(t + 0.3, s);
            break;
          default:
        }
      }
      // the final whistle: applause, and the home end's verdict on the score (and the pens)
      function ending(t, s) {
        if (t - st.endAt < 5) return;
        st.endAt = t;
        const sc = s?.score ?? [0, 0],
          pens = s?.pens,
          d = sc[0] - sc[1] || (pens ? pens[0] - pens[1] : 0);
        if (d > 0) {
          react.roar(t, 0.75);
          applause(t + 0.5, 8, 0.4);
          st.chantAt = t + 4;
        } else if (d < 0) {
          react.groan(t, 0.8);
          react.boo(t + 1, 0.5, 2);
          applause(t + 1.5, 4, 0.14);
        } else applause(t, 6, 0.3);
      }

      // what the ground feels: the ball near a goal (the home side's attack the louder), a
      // corner, a goal's glow; hushed for a penalty, quiet away from play
      function feel(s, now) {
        const phase = s?.phase,
          b = s?.ball;
        let x = 0,
          home = true;
        if ((phase === 'play' || phase === 'setpiece' || phase === 'kickoff') && b) {
          const y = clamp(b.y, 0, 105),
            homeUp = (s.up ?? 0) === HOME,
            dHome = homeUp ? y : 105 - y, // to the goal the home side attacks
            dAway = 105 - dHome,
            wide = 1 - 0.4 * smooth((Math.abs(clamp(b.x, 0, 68) - 34) - 10) / 20);
          const h = smooth(1 - dHome / 38) * wide,
            a = smooth(1 - dAway / 38) * wide * 0.75;
          x = Math.max(h, a);
          home = h >= a;
        }
        const glow = glowNow(now);
        if (glow > x) {
          x = glow;
          home = true;
        }
        // the excitement rises quickly and settles slowly
        st.excite += (x - st.excite) * (x > st.excite ? 0.12 : 0.03);
        st.home = home;
        return phase === 'pens' || s?.setpiece?.kind === 'penalty';
      }

      function matchStep(list, s, on) {
        if (!v.ac || !on) return;
        const now = v.ac.currentTime + 0.005;
        if (Array.isArray(list)) for (const e of list) if (e && typeof e.type === 'string') play(e, s, now);
        if (!s) return;
        const tense = feel(s, now);
        bed(st.level, st.excite, st.home, tense, false);
        if (st.level <= 0) return;
        // the held breath before a penalty: until the kick, and a moment after
        if (tense && now - st.kickAt > 2.5 && now >= st.heartAt) {
          ball.heart(now);
          st.heartAt = now + 1.05;
        }
        // now and then a chant, in the quieter spells of play
        if (st.chantAt < 0) st.chantAt = now + rand(18, 30);
        const calm = (s.phase === 'play' || s.phase === 'setpiece') && st.excite < 0.45 && !tense;
        if (now >= st.chantAt && calm) {
          const d = react.chant(now);
          const lead = (s.score?.[0] ?? 0) - (s.score?.[1] ?? 0);
          st.chantAt = now + d + rand(lead > 0 ? 22 : 35, lead > 0 ? 45 : 70);
        }
      }

      return {
        step,
        effects,
        methods: {
          matchStep,
          bedLevel(level, on) {
            st.level = clamp01(level);
            if (!on) {
              bank.off();
              return;
            }
            if (v.ac) bed(st.level, st.excite, st.home, false, true);
          },
          bedOff() {
            bank.off();
          },
        },
      };
    },
  });

  let level = 0;
  return {
    unlock() {
      synth.unlock();
      if (level > 0) synth.bedLevel(level, synth.on);
    },
    get on() {
      return synth.on;
    },
    setOn(b) {
      synth.setOn(!!b);
      synth.bedLevel(level, !!b);
    },
    destroy() {
      synth.bedOff();
      synth.destroy();
    },
    match(events, s) {
      synth.matchStep(events, s, synth.on);
    },
    crowd(l) {
      level = clamp01(l);
      synth.bedLevel(level, synth.on);
    },
    ui(name) {
      synth.sfx('ui:' + name);
    },
    music(track) {
      synth.music(track && TRACKS[track] ? track : null);
    },
  };
}
