// Scorch's sound, made in code on @nostalgia/audio, all original: double-tracked distorted
// guitars (saws through hard clippers and a cabinet, palm-muted chugs and power chords), a
// distorted bass over a punched sub, a PWM / supersaw lead with a dotted echo, and a rock kit;
// the cars' engines as continuous graphs; guns, hits, mines, crashes and the menus. The context
// is only made by unlock(), which the page calls from a user gesture; the demo never makes one.
//
//   const audio = createAudio({ on: true });
//   audio.unlock(); audio.music('race1'); audio.sfx('shot', { car: 2, pan: 0.4, gain: 0.5 });
//   audio.engines([{ rpm, load, boost, pan, gain }, …]); audio.skid(0.6); audio.engines(null);
//
// Tracks (16th steps, 4-bar sections in a form; the guitar riff is doubled by the bass an octave
// down unless a section writes its own bass line):
//   title    "Scorched Earth"   E minor (blues),  104 bpm, 24 bars: half-time, huge chords, the
//                               main theme (E G A B♭ A G E) on the lead
//   paddock  "Grease Pit"       A dorian,          92 bpm, 24 bars, swung: a crunchy boogie, a
//                               walking bass, e-piano chops, a lazy lead
//   race1    "Dust Devil"       D minor,          150 bpm, 32 bars: a chugging riff with a blue
//                               fifth, the hook on a PWM lead
//   race2    "Rust Belt"        F♯ minor,         156 bpm, 32 bars: a syncopated 3+3+3+3+2+2 riff,
//                               a supersaw hook
//   race3    "Black Ice"        A minor,          162 bpm, 32 bars: a pedal-tone riff falling down
//                               the scale, double kick, a harmonic-minor lead
//   final    "Marrow"           C phrygian,       170 bpm, 32 bars: a gallop, ♭2 and tritone
//                               stabs, the champion's motif
//   win      "Last One Burning" E mixolydian,     128 bpm, 24 bars: the main theme in major, an anthem
// Jingles (on the sfx bus; music(name) or the matching event): go, lap, last, finish (by place),
// wreck (the player's), cash. finish and wreck hold the track under them; the others duck it.
// The same jingle twice within a moment plays once.
//
// Effects take the event as opts (sfx(e.k, e)): opts.pan -1…1, opts.gain 0…1 (distance),
// opts.near (it involves the player). Names: the race's shot hit spark drop beep boom bump wall
// pickup {kind} turbo wreck low count {n} go lap last finish {place}, and the menus' move pick
// back buy deny cash pause. Unknown names (done) are ignored.
//
// The engines: engines(list) every frame, [{ rpm 0…1 (speed against top speed), load 0…1
// (throttle), boost, pan, gain, id? }], the player first, then up to three rivals. Each of four
// voices is a firing pulse (a band-limited 30 % pulse through a resonant lowpass that opens with
// the throttle), a sub at half the firing rate (the crank's lope), and combustion noise swung by
// that sub, through a soft clipper, a distance lowpass and a panner; a turbo whine and its air
// spool up while boosting, and blow off after. Five gears are worked out from rpm with
// hysteresis: the pitch climbs through a gear, drops at an up-shift with a short throttle lift,
// so the revs wrap as the car gathers speed. Entries are matched to voices by id, or else by
// likeness (pan, gain, rpm), so a reordered list glides instead of swooping; a voice handed to a
// different car fades out, jumps and fades back in. skid(level) is the tyres' squeal (chattering
// band-passed noise and a wobbling tone), panned to the car sliding most. engines(null) fades
// the whole layer out. All of it moves by setTargetAtTime, so nothing clicks.
import { adsr, compressor, createSynth, delay, distortion, limiter, midi, softclip, span } from '@nostalgia/audio';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : 0));
const clamp01 = x => clamp(x, 0, 1);
const smooth = u => {
  u = clamp01(u);
  return u * u * (3 - 2 * u);
};

// ---------- the score ----------
// a riff bar: '.' rest, '-' hold, 'x' a palm-muted chug (root and fifth), 'P' a power chord
// (root, fifth, octave), 'P3' one on root + 3, '7' a single note root + 7, 'D9' root and root + 9
const tok = s => {
  if (s === '.') return 0;
  if (s === '-') return -1;
  const m = /^([PxD]?)(-?\d*)$/.exec(s);
  return m ? { k: m[1] || 'n', n: +(m[2] || 0) } : 0;
};
const riff = s => s.trim().split(/\s+/).map(tok);
// a lead: MIDI note numbers, '.' rest, '-' hold (any number of bars)
const lead = s => s.trim().split(/\s+/).map(t => (t === '.' ? 0 : t === '-' ? -1 : +t));
const REST = riff('. . . . . . . . . . . . . . . .');

// The kit, a bar a pattern: k kick; s snare (x), ghost (g), rim (r); h closed (x), open (o), ride
// (d); t toms 1 high … 3 low. 'fill' takes the second half of a section's last bar.
const KITS = {
  none: {},
  hats: { h: 'x.x.x.x.x.x.x.x.' },
  build: { k: 'x.......x.......', h: 'x.x.x.x.x.x.x.x.' },
  half: { k: 'x.....x...x.....', s: '........x.......', h: 'x.x.x.x.x.x.x.x.' },
  halfb: { k: 'x.....x...x..x..', s: '........x.....g.', h: 'x.x.x.x.x.x.x.xo' },
  drive: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
  driveb: { k: 'x.x.....x.x...x.', s: '....x..g....x...', h: 'x.x.x.x.x.x.x.xo' },
  push: { k: 'x.x.x.x.x.x.x.x.', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
  double: { k: 'xxxxxxxxxxxxxxxx', s: '....x.......x...', h: 'd...d...d...d...' },
  gallop: { k: 'x.xxx.xxx.xxx.xx', s: '....x.......x...', h: 'd.d.d.d.d.d.d.d.' },
  shuffle: { k: 'x.....x...x.....', s: '....r.......r..g', h: 'x.xxx.xxx.xxx.xx' },
  shuffleb: { k: 'x.....x.x.x.....', s: '....x.......x..g', h: 'x.xxx.xxx.xxx.xo' },
  anthem: { k: 'x.......x.x.....', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx' },
  fill: { k: 'x.......x.......', s: '....x...x.xx....', t: '............1233' },
};

// Each track: tempo, level (after the music compressor: the race tracks a few dB under the menus',
// so the engines ride over them), how it's played, and its sections
// (four bars: the guitar's roots, the riff bars cycled, the kit per bar, a lead, a bass line).
const TRACKS = {
  title: {
    bpm: 104, gain: 1.06,
    look: { gtr: 0.09, bass: 0.15, sub: 0.2, lead: 0.075, voice: 'pulse', kit: 0.95, echo: 3 },
    form: 'I A A B B C',
    sec: {
      I: { roots: [40, 40, 36, 38], kit: ['none', 'none', 'build', 'build'], fill: true,
        riff: [riff('P - - - - - - - - - - - - - - -')] },
      A: { roots: [40, 40, 36, 38], kit: 'half', fill: true,
        riff: [riff('P - - - - - x x P - - - P3 - P5 -'), riff('P - - - - - x x P6 - P5 - P3 - x x')],
        lead: lead(`76 - - - 79 - 81 - 82 - - 81 - 79 - -   76 - - - - - 74 - 76 - - - . . . .
                    76 - - - 79 - 81 - 82 - - 84 - 86 - -   83 - - - - - 81 - 79 - - - 78 - 79 -`) },
      B: { roots: [36, 38, 40, 40], kit: 'halfb', fill: true,
        riff: [riff('P - - - x x x x P - - - x x x x'), riff('P - - - x x x x P - - - P5 - P3 -')],
        lead: lead(`84 - - - 83 - 81 - 79 - - - 81 - 83 -   84 - - - - - 86 - 88 - - - 86 - 84 -
                    83 - - - 81 - 79 - 78 - - - 79 - 81 -   83 - - - - - - - - - - - 71 - 74 -`) },
      C: { roots: [40, 40, 36, 38], kit: 'half', fill: true,
        riff: [riff('P - - - - - x x P - - - P3 - P5 -'), riff('P - - - - - x x P6 - P5 - P3 - x x')],
        lead: lead(`88 - - - 91 - 93 - 94 - - 93 - 91 - -   88 - - - - - 86 - 88 - - - . . . .
                    88 - - - 91 - 93 - 94 - - 93 - 91 88 -   86 - - - 83 - - - 79 - 76 - - - . .`) },
    },
  },
  paddock: {
    bpm: 92, gain: 1,
    look: { gtr: 0.07, crunch: true, bass: 0.12, sub: 0.16, clean: true, lead: 0.05, voice: 'fm', kit: 0.7, echo: 3, swing: 0.16, keys: 0.03 },
    form: 'A A B A B C',
    sec: {
      A: { roots: [45, 45, 50, 45], chords: ['m7', 'm7', '7', 'm7'], kit: 'shuffle', soft: true,
        riff: [riff('D7 - . D7 D9 - . D7 D10 - D9 - D7 - . .'), riff('D7 - . D7 D9 - . D7 D10 - D9 - 12 - 10 7')],
        bass: [riff('0 - . 0 7 - . 7 10 - . 10 12 - 10 7'), riff('0 - . 0 7 - . 7 10 - 9 - 7 - 3 2')] },
      B: { roots: [50, 50, 45, 52], chords: ['7', '7', 'm7', '7'], kit: 'shuffleb', soft: true,
        riff: [riff('D7 - . D7 D9 - . D7 D10 - D9 - D7 - . .')],
        bass: [riff('0 - . 0 7 - . 7 10 - . 10 12 - 10 7'), riff('0 - . 0 7 - . 7 10 - 9 - 7 - 4 5')],
        lead: lead(`.  . . . 76 - 79 - 81 - - - 79 - 76 -   74 - 72 - - - 69 - - - - - . . . .
                    .  . . . 76 - 79 - 81 - 83 - 84 - 83 -   81 - - - 79 - 78 - 76 - - - 75 - 76 -`) },
      C: { roots: [45, 45, 50, 52], chords: ['m7', 'm7', '7', '7'], kit: 'shuffleb', fill: true, soft: true,
        riff: [riff('D7 - . D7 D9 - . D7 D10 - D9 - D7 - . .'), riff('D7 - . D7 D9 - . D7 D10 - D9 - 12 - 10 7')],
        bass: [riff('0 - . 0 7 - . 7 10 - . 10 12 - 10 7')],
        lead: lead(`81 - - - 79 - 76 - 74 - 72 - 69 - - -   72 - - - 69 - 67 - 69 - - - . . . .
                    81 - - - 84 - 83 - 81 - 79 - 76 - - -   78 - - - - - 79 - 80 - - - . . . .`) },
    },
  },
  race1: {
    bpm: 150, gain: 0.8,
    look: { gtr: 0.09, bass: 0.15, sub: 0.2, lead: 0.07, voice: 'pulse', kit: 1, echo: 3 },
    form: 'I A A B C C B D',
    sec: {
      I: { roots: [38, 38, 38, 38], kit: ['none', 'none', 'hats', 'build'], fill: true, soft: true,
        riff: [riff('P . x x P . x x 3 . 5 . x x 6 5'), riff('P . x x P . x x 10 - 8 - 7 - 5 3')] },
      A: { roots: [38, 38, 38, 38], kit: ['drive', 'drive', 'drive', 'driveb'], fill: true,
        riff: [riff('P . x x P . x x 3 . 5 . x x 6 5'), riff('P . x x P . x x 10 - 8 - 7 - 5 3')] },
      B: { roots: [34, 36, 38, 38], kit: 'push', fill: true,
        riff: [riff('P - - - x x x x P - - - P - x x'), riff('P - - - x x x x P - - - P5 - P3 -')] },
      C: { roots: [38, 38, 34, 36], kit: ['drive', 'driveb', 'drive', 'driveb'], fill: true,
        riff: [riff('P . x x P . x x 3 . 5 . x x 6 5'), riff('P . x x P . x x 10 - 8 - 7 - 5 3')],
        lead: lead(`74 - - 77 - - 76 - 74 - 72 - 69 - - -   70 - - 69 - - 67 - 69 - - - . . . .
                    74 - - 77 - - 79 - 81 - 79 - 77 - 76 -   74 - - - - - - - - - - - 72 - 76 -`) },
      D: { roots: [38, 38, 41, 43], kit: ['push', 'push', 'push', 'push'], fill: true,
        riff: [riff('P . x x P . x x 3 . 5 . x x 6 5')],
        lead: lead(`86 - - 89 - - 88 - 86 - 84 - 81 - - -   82 - - 81 - - 79 - 81 - - - . . . .
                    86 - - 89 - - 91 - 93 - 91 - 89 - 88 -   86 - - - - - - - 84 - 81 - 79 - 77 -`) },
    },
  },
  race2: {
    bpm: 156, gain: 0.75,
    look: { gtr: 0.09, bass: 0.15, sub: 0.2, lead: 0.06, voice: 'saw', kit: 1, echo: 3 },
    form: 'I A A B C C B D',
    sec: {
      I: { roots: [42, 42, 42, 42], kit: ['hats', 'hats', 'build', 'build'], fill: true, soft: true,
        riff: [riff('x x x x x x x x x x x x x x x x'), riff('x x x x x x x x x x x x P3 - P5 -')] },
      A: { roots: [42, 42, 42, 42], kit: ['push', 'push', 'push', 'driveb'], fill: true,
        riff: [riff('P - . x x . P - . x x . P3 - P5 -'), riff('P - . x x . P - . x x . P-2 - P-4 -')] },
      B: { roots: [38, 40, 42, 42], kit: 'drive', fill: true,
        riff: [riff('P - - - - - x x P - - - x x x x'), riff('P - - - - - x x P3 - - - P5 - - -')] },
      C: { roots: [42, 42, 38, 40], kit: ['push', 'driveb', 'push', 'driveb'], fill: true,
        riff: [riff('P - . x x . P - . x x . P3 - P5 -'), riff('P - . x x . P - . x x . P-2 - P-4 -')],
        lead: lead(`78 - 81 - 83 - 81 - 78 - - - 76 - 78 -   81 - - - 80 - - - 76 - - - . . . .
                    78 - 81 - 83 - 85 - 86 - 85 - 83 - 81 -   80 - - - - - 81 - 80 - 76 - 73 - - -`) },
      D: { roots: [42, 42, 38, 40], kit: 'push', fill: true,
        riff: [riff('P - . x x . P - . x x . P3 - P5 -')],
        lead: lead(`85 - 83 - 81 - 83 - 85 - - - 88 - 86 -   85 - - - 83 - - - 81 - - - . . . .
                    78 - 81 - 83 - 85 - 86 - 88 - 90 - 88 -   85 - - - - - - - 81 - - - - - . .`) },
    },
  },
  race3: {
    bpm: 162, gain: 0.68,
    look: { gtr: 0.09, bass: 0.15, sub: 0.2, lead: 0.07, voice: 'pulse', kit: 1, echo: 3 },
    form: 'I A A B C C B D',
    sec: {
      I: { roots: [45, 45, 45, 45], kit: ['none', 'hats', 'build', 'build'], fill: true, soft: true,
        riff: [riff('x x 12 x x 10 x x 8 x x 7 - 5 - 3'), riff('x x 12 x x 10 x x 8 x x 10 - 12 - 15')] },
      A: { roots: [45, 45, 45, 45], kit: ['double', 'push', 'double', 'push'], fill: true,
        riff: [riff('x x 12 x x 10 x x 8 x x 7 - 5 - 3'), riff('x x 12 x x 10 x x 8 x x 10 - 12 - 15')] },
      B: { roots: [41, 43, 45, 45], kit: 'drive', fill: true,
        riff: [riff('P - - - x x x x P - - - x x P - '), riff('P - - - x x x x P - - - P-1 - - -')] },
      C: { roots: [45, 45, 41, 43], kit: ['push', 'double', 'push', 'double'], fill: true,
        riff: [riff('x x 12 x x 10 x x 8 x x 7 - 5 - 3'), riff('x x 12 x x 10 x x 8 x x 10 - 12 - 15')],
        lead: lead(`81 - - - 79 - 77 - 76 - - - 72 - 74 -   76 - - - - - - - 69 - 71 - 72 - 74 -
                    76 - - - 79 - 81 - 84 - - - 83 - 81 -   83 - - - - - 80 - 81 - - - . . . .`) },
      D: { roots: [45, 45, 41, 44], kit: 'double', fill: true,
        riff: [riff('x x 12 x x 10 x x 8 x x 7 - 5 - 3'), riff('P - - - x x x x P - - - P - - -')],
        lead: lead(`93 - - - 91 - 89 - 88 - - - 84 - 86 -   88 - - - - - - - 81 - 83 - 84 - 86 -
                    88 - - - 89 - 91 - 93 - - - 91 - 89 -   88 - - - - - - - - - - - . . . .`) },
    },
  },
  final: {
    bpm: 170, gain: 0.74,
    look: { gtr: 0.09, bass: 0.15, sub: 0.22, lead: 0.07, voice: 'saw', kit: 1.05, echo: 3 },
    form: 'I A A B C C B D',
    sec: {
      I: { roots: [36, 36, 37, 36], kit: ['none', 'none', 'build', 'build'], fill: true, soft: true,
        riff: [riff('P - - - - - - - - - - - - - - -'), riff('P - - - - - - - P6 - - - - - - -')] },
      A: { roots: [36, 36, 36, 36], kit: ['gallop', 'gallop', 'gallop', 'push'], fill: true,
        riff: [riff('P - x x P - x x P - x x P1 - P -'), riff('P - x x P - x x P6 - P5 - P3 - P1 -')] },
      B: { roots: [37, 37, 42, 43], kit: 'drive', fill: true,
        riff: [riff('P - - - - - x x P - - - x x x x'), riff('P - - - x x x x P - - - P-1 - - -')] },
      C: { roots: [36, 36, 36, 36], kit: ['gallop', 'push', 'gallop', 'push'], fill: true,
        riff: [riff('P - x x P - x x P - x x P1 - P -'), riff('P - x x P - x x P6 - P5 - P3 - P1 -')],
        lead: lead(`72 - - - - - 78 - 79 - - - 75 - 73 -   72 - - - - - - - . . . . 67 - 68 -
                    72 - - - - - 78 - 79 - - - 82 - 80 -   79 - - - 78 - - - 79 - - - - - . .`) },
      D: { roots: [36, 36, 37, 43], kit: 'double', fill: true,
        riff: [riff('P - x x P - x x P - x x P1 - P -'), riff('P - x x P - x x P6 - P5 - P3 - P1 -')],
        lead: lead(`84 - - - - - 90 - 91 - - - 87 - 85 -   84 - - - - - - - . . . . 79 - 80 -
                    84 - - - - - 90 - 91 - - - 94 - 92 -   91 - - - 90 - - - 91 - - - - - - -`) },
    },
  },
  win: {
    bpm: 128, gain: 1,
    look: { gtr: 0.09, bass: 0.15, sub: 0.2, lead: 0.065, voice: 'saw', kit: 0.95, echo: 3 },
    form: 'I A A B A B',
    sec: {
      I: { roots: [40, 38, 45, 40], kit: ['build', 'build', 'build', 'build'], fill: true,
        riff: [riff('P - - - - - - - - - - - P - - -')] },
      A: { roots: [40, 38, 45, 40], kit: 'anthem', fill: true,
        riff: [riff('P - - - - - x x P - - - P - x x')],
        lead: lead(`76 - - - 80 - 81 - 83 - - - 81 - 80 -   76 - - - - - 74 - 76 - - - . . . .
                    76 - - - 80 - 81 - 83 - - 85 - 88 - -   86 - - - - - 83 - 81 - - - 80 - 81 -`) },
      B: { roots: [45, 47, 40, 40], kit: 'anthem', fill: true,
        riff: [riff('P - - - x x x x P - - - P - x x'), riff('P - - - - - - - P - - - - - - -')],
        lead: lead(`85 - - - 83 - 81 - 83 - - - 86 - 88 -   88 - - - - - - - 86 - 83 - - - . .
                    88 - - - 86 - 85 - 83 - - - 81 - 80 -   81 - - - 80 - - - 76 - - - - - . .`) },
    },
  },
};

// flatten a track's form into bars and step lanes
const CHORDS = { m7: [3, 7, 10, 14], 7: [4, 7, 10, 14], m: [3, 7, 12], M: [4, 7, 12] };
for (const tr of Object.values(TRACKS)) {
  tr.bars = [];
  tr.riff = [];
  tr.bass = [];
  tr.lead = [];
  for (const name of tr.form.split(' ')) {
    const S = tr.sec[name];
    for (let b = 0; b < 4; b++) {
      const kit = Array.isArray(S.kit) ? S.kit[b] : S.kit;
      tr.bars.push({ root: S.roots[b], chord: S.chords?.[b], kit: KITS[kit] ?? {}, fill: !!S.fill && b === 3, crash: b === 0 && !S.soft, follow: !S.bass });
      tr.riff.push(...(S.riff?.[b % S.riff.length] ?? REST));
      tr.bass.push(...(S.bass?.[b % S.bass.length] ?? REST));
      for (let s = 0; s < 16; s++) tr.lead.push(S.lead ? S.lead[(b * 16 + s) % S.lead.length] : 0);
    }
  }
  // a hold at a section's start would hold the last section's note: make it a rest
  for (let k = 0; k < tr.lead.length; k += 64) if (tr.lead[k] === -1) tr.lead[k] = 0;
  tr.steps = tr.bars.length * 16;
}

// how long each jingle holds the music (hold) or ducks it (duck), seconds
const JINGLES = { go: { duck: 1.2 }, lap: { duck: 0.9 }, last: { duck: 1.4 }, finish: { hold: 3 }, wreck: { hold: 3.2 }, cash: { duck: 0.8 } };

// ---------- the engines ----------
const VOICES = 4;
const SHIFT = [0.16, 0.33, 0.52, 0.74, 1.15]; // speed (of top speed) at the redline in each gear
const F_RED = 165; // Hz: the firing rate at the redline
const PITCH = [1, 0.89, 1.11, 0.95]; // each voice its own engine note
const LEVEL = [0.24, 0.15, 0.15, 0.15]; // the player's engine, the rivals'
const SWAP = 0.9; // a match worse than this is another car: fade out, jump, fade in

function engineLayer(v) {
  const bank = v.loop(build);
  let skidLevel = 0,
    skidPan = 0;
  const filter = (ac, type, f, q) => {
    const b = ac.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  };
  const gain = (ac, g) => {
    const n = ac.createGain();
    n.gain.value = g;
    return n;
  };
  const osc = (ac, type, f) => {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = f;
    return o;
  };
  // the firing pulse: 30 % duty, band-limited (made once per context)
  const waves = new WeakMap();
  const pulseWave = ac => {
    let w = waves.get(ac);
    if (!w) {
      const n = 40, re = new Float32Array(n), im = new Float32Array(n);
      for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.3) * (1 - k / (n + 8));
      w = ac.createPeriodicWave(re, im);
      waves.set(ac, w);
    }
    return w;
  };

  function voice(ac, out, k, srcs) {
    const hz = ac.createConstantSource();
    hz.offset.value = 55 * PITCH[k];
    const pulse = ac.createOscillator();
    pulse.setPeriodicWave(pulseWave(ac));
    pulse.frequency.value = 0;
    hz.connect(pulse.frequency);
    const sub = osc(ac, 'sine', 0), half = gain(ac, 0.5);
    hz.connect(half).connect(sub.frequency);
    // a little unsteadiness, so it's an engine and not a tone
    const fl1 = osc(ac, 'sine', 7.3 + k * 0.41), fl1d = gain(ac, 5),
      fl2 = osc(ac, 'sine', 0.83 + k * 0.17), fl2d = gain(ac, 9);
    fl1.connect(fl1d);
    fl2.connect(fl2d);
    for (const d of [fl1d, fl2d]) {
      d.connect(pulse.detune);
      d.connect(sub.detune);
    }
    const lp = filter(ac, 'lowpass', 500, 2.2), pG = gain(ac, 0.6);
    pulse.connect(lp).connect(pG);
    const sG = gain(ac, 0.4);
    sub.connect(sG);
    // combustion noise, swung once a crank turn by the sub
    const ns = v.noiseSource(0.29 + 0.37 * k), bp = filter(ac, 'bandpass', 300, 1.1),
      am = gain(ac, 0.5), amD = gain(ac, 0.45), nG = gain(ac, 0.15);
    ns.connect(bp).connect(am).connect(nG);
    sub.connect(amD).connect(am.gain);
    const pre = gain(ac, 0.5), clip = softclip(ac, { drive: 2 });
    for (const g of [pG, sG, nG]) g.connect(pre);
    pre.connect(clip.input);
    const dark = filter(ac, 'lowpass', 4000, 0.7), hp = filter(ac, 'highpass', 52, 0.7),
      level = gain(ac, 0), pan = ac.createStereoPanner();
    clip.output.connect(dark).connect(hp).connect(level).connect(pan).connect(out);
    // the turbo: its whine and the rush of its air, in the same car (and as far off)
    const wh = osc(ac, 'triangle', 1400), whG = gain(ac, 0),
      wn = v.noiseSource(1.11 + 0.23 * k), wbp = filter(ac, 'bandpass', 3200, 1.6), wnG = gain(ac, 0);
    wh.connect(whG).connect(dark);
    wn.connect(wbp).connect(wnG).connect(dark);
    for (const s of [hz, pulse, sub, fl1, fl2, wh]) s.start(ac.currentTime);
    srcs.push(hz, pulse, sub, fl1, fl2, wh, ns, wn);
    return {
      k, hz, lp, pG, nG, bp, dark, level, pan, wh, whG, wnG,
      // what it plays: the car's last values, its gear, and whether it's sounding
      active: false, rpm: 0, load: 0, gain: 0, panV: 0, boost: false, gear: 0, lift: 0, swapAt: 0, offAt: -1, at: -1,
    };
  }

  function build(ac) {
    const t = ac.currentTime, out = gain(ac, 0), srcs = [];
    out.gain.setTargetAtTime(1, t, 0.04);
    out.connect(v.bus.sfx);
    const voices = Array.from({ length: VOICES }, (_, k) => voice(ac, out, k, srcs));
    // the tyres: chattering band-passed noise and a wobbling squeal
    const sn = v.noiseSource(0.61), sbp = filter(ac, 'bandpass', 1900, 7), chat = gain(ac, 0.55),
      chatL = osc(ac, 'sine', 17), chatD = gain(ac, 0.4), snG = gain(ac, 0.9);
    sn.connect(sbp).connect(chat).connect(snG);
    chatL.connect(chatD).connect(chat.gain);
    const sq = osc(ac, 'sine', 1150), sq2 = osc(ac, 'triangle', 1150 * 1.51), sq2G = gain(ac, 0.18),
      vib = osc(ac, 'sine', 5.7), vibD = gain(ac, 28), sqG = gain(ac, 0.3);
    vib.connect(vibD);
    vibD.connect(sq.detune);
    vibD.connect(sq2.detune);
    sq.connect(sqG);
    sq2.connect(sq2G).connect(sqG);
    const skLvl = gain(ac, 0), skPan = ac.createStereoPanner();
    snG.connect(skLvl);
    sqG.connect(skLvl);
    skLvl.connect(skPan).connect(out);
    for (const s of [chatL, sq, sq2, vib]) s.start(t);
    srcs.push(sn, chatL, sq, sq2, vib);
    const skid = { sbp, sq, sq2, skLvl, skPan };
    return {
      voices, skid, skidAt: -1,
      stop() {
        const now = ac.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setTargetAtTime(0, now, 0.04);
        for (const s of srcs) s.stop(now + 0.4);
      },
    };
  }

  // a param to a value: a glide, or at once (only while the voice is silent)
  const set = (p, x, now, tc) => {
    if (tc > 0) p.setTargetAtTime(x, now, tc);
    else {
      p.cancelScheduledValues(now);
      p.setValueAtTime(x, now);
    }
  };

  function drive(vo, e, now) {
    if (!e) {
      if (vo.active) {
        vo.level.gain.setTargetAtTime(0, now, 0.03);
        vo.whG.gain.setTargetAtTime(0, now, 0.03);
        vo.wnG.gain.setTargetAtTime(0, now, 0.03);
        vo.offAt = now;
      }
      vo.active = false;
      vo.gain = 0;
      return;
    }
    if (now < vo.swapAt) return; // fading out for another car
    // silent long enough to jump to a new car's values; a voice still fading glides there
    const fresh = !vo.active && now - vo.offAt > 0.1;
    // the gear: up past the redline, down with some room (so it doesn't hunt)
    let g = vo.gear;
    if (!vo.active) g = Math.max(0, SHIFT.findIndex(top => e.rpm < top * 0.97));
    while (g < SHIFT.length - 1 && e.rpm > SHIFT[g] * 0.97) g++;
    while (g > 0 && e.rpm < SHIFT[g - 1] * 0.8) g--;
    const up = g > vo.gear && vo.active;
    if (up) vo.lift = now + 0.085; // the throttle lifts for the shift
    const load = now < vo.lift ? 0.1 : e.load;
    let revs = e.rpm / SHIFT[g] + 0.03 * load;
    if (g === 0) revs = Math.max(revs, 0.12 + 0.5 * load * (1 - e.rpm / SHIFT[0])); // idle, or revving on the grid
    revs = clamp01(revs);
    const blowOff = vo.boost && !e.boost;
    vo.gear = g;
    vo.rpm = e.rpm;
    vo.load = e.load;
    vo.gain = e.gain;
    vo.panV = e.pan;
    vo.boost = e.boost;
    vo.active = true;
    // the params move every 25 ms or so (smoothly between), at once on a shift or a new car
    if (!fresh && !up && !blowOff && now - vo.at < 0.025) return;
    vo.at = now;
    const tc = fresh ? 0 : 0.05, f = F_RED * PITCH[vo.k] * (0.28 + 0.72 * revs);
    set(vo.hz.offset, f, now, fresh ? 0 : up ? 0.03 : 0.06);
    set(vo.lp.frequency, Math.min(7000, f * (2.6 + 6 * load) + 300), now, tc);
    set(vo.pG.gain, 0.45 + 0.55 * load, now, tc);
    set(vo.nG.gain, 0.06 + 0.4 * load * (0.4 + 0.6 * revs), now, tc);
    set(vo.bp.frequency, f * 5.5, now, tc);
    set(vo.dark.frequency, 600 + 5200 * e.gain ** 0.8, now, tc);
    set(vo.pan.pan, e.pan, now, fresh ? 0 : 0.05);
    // the level always glides (from silence when fresh)
    vo.level.gain.setTargetAtTime(LEVEL[vo.k] * e.gain * (0.7 + 0.3 * revs) * (0.8 + 0.2 * load), now, fresh ? 0.03 : 0.05);
    // the turbo spools up slowly while boosting, then winds down
    vo.whG.gain.setTargetAtTime(e.boost ? 0.1 : 0, now, e.boost ? 0.15 : 0.35);
    vo.wh.frequency.setTargetAtTime(e.boost ? 2400 + 1400 * revs : 1300, now, e.boost ? 0.35 : 0.5);
    vo.wnG.gain.setTargetAtTime(e.boost ? 0.25 : 0, now, e.boost ? 0.12 : 0.2);
    if (blowOff && e.gain > 0.05) v.hiss(now, 0.38, 0.07 * e.gain, 6500, 1800, 'bandpass', vo.pan, 1.1, 0.008);
  }

  // which voice plays which entry: by id, else by likeness; the player keeps the first voice
  function match(voices, list) {
    const pairs = new Map(), free = new Set(voices);
    const cost = (vo, e) =>
      !vo.active ? SWAP * 0.95 : e.id !== undefined ? (vo.id === e.id ? 0 : 9) : Math.abs(vo.panV - e.pan) + Math.abs(vo.gain - e.gain) + 0.5 * Math.abs(vo.rpm - e.rpm);
    list.forEach((e, k) => {
      let best = null, bc = Infinity;
      if (k === 0 && e.id === undefined) best = voices[0];
      else for (const vo of free) {
        if (vo === voices[0] && list[0].id === undefined) continue;
        const c = cost(vo, e);
        if (c < bc) [best, bc] = [vo, c];
      }
      if (!best) return;
      free.delete(best);
      pairs.set(best, { e, swap: best.active && k > 0 && bc > SWAP });
    });
    return pairs;
  }

  function engines(list) {
    if (!Array.isArray(list) || !list.length) {
      bank.off();
      return;
    }
    const b = bank.on();
    if (!b) return; // before unlock()
    const now = v.ac.currentTime;
    const entries = list.slice(0, VOICES).map(e => ({
      rpm: clamp(e?.rpm, 0, 1.2), load: clamp01(e?.load), boost: !!e?.boost, pan: clamp(e?.pan, -1, 1),
      gain: clamp01(e?.gain ?? 1), slip: clamp01(e?.slip), id: e?.id,
    }));
    const pairs = match(b.voices, entries);
    for (const vo of b.voices) {
      const p = pairs.get(vo);
      if (p?.swap && now >= vo.swapAt) {
        // another car: fade out, then come back in as that one
        vo.level.gain.setTargetAtTime(0, now, 0.02);
        vo.whG.gain.setTargetAtTime(0, now, 0.02);
        vo.wnG.gain.setTargetAtTime(0, now, 0.02);
        vo.active = false;
        vo.offAt = now - 0.1;
        vo.swapAt = now + 0.1;
        vo.boost = false;
      }
      vo.id = p?.e.id;
      drive(vo, p?.e, now);
    }
    // the squeal sits with the car sliding most
    let most = -1;
    for (const e of entries)
      if (e.slip * e.gain > most) {
        most = e.slip * e.gain;
        skidPan = e.pan;
      }
    if (now - b.skidAt > 0.025) tyres(b, now);
  }

  function tyres(b, now) {
    b.skidAt = now;
    const L = skidLevel, s = b.skid;
    s.skLvl.gain.setTargetAtTime(0.05 * smooth((L - 0.12) / 0.7), now, L > 0.12 ? 0.04 : 0.08);
    s.sq.frequency.setTargetAtTime(1080 + 380 * L, now, 0.1);
    s.sq2.frequency.setTargetAtTime((1080 + 380 * L) * 1.51, now, 0.1);
    s.sbp.frequency.setTargetAtTime(1700 + 800 * L, now, 0.1);
    s.skPan.pan.setTargetAtTime(skidPan, now, 0.06);
  }

  return {
    engines,
    skid(level) {
      const L = clamp01(level);
      if (Math.abs(L - skidLevel) < 0.01 && L > 0) return;
      skidLevel = L;
      const b = bank.live;
      if (b && v.ac) tyres(b, v.ac.currentTime);
    },
  };
}

// ---------- the synth ----------
export function createAudio({ on = true } = {}) {
  let lastJingle = { name: null, at: -1 };
  let duck = null; // the music's duck gain on the current context
  const synth = createSynth({
    on, seed: 1996, tracks: TRACKS, noiseLength: 2, attack: 0.003, startDelay: 0.06, lead: 0.004,
    levels: { master: 0.9, music: 0.3, sfx: 0.85 },
    // the tunes evened out against each other (each track's gain then sets it exactly), a duck
    // for the jingles, a gentle hold on the effects and a limiter on the whole mix
    inserts: {
      music: ac => {
        const g = ac.createGain();
        duck = { ac, g };
        return [compressor(ac, { threshold: -30, ratio: 3, knee: 8, attack: 0.012, release: 0.25, makeup: 6 }), { input: g, output: g }];
      },
      sfx: ac => compressor(ac, { threshold: -16, ratio: 2.5, knee: 6, attack: 0.005, release: 0.2 }),
      master: ac => limiter(ac, { ceiling: -1, release: 0.12 }),
    },
    arrange: v => {
      const { tone, hiss, fm, sub, supersaw, hold } = v;
      const target = b => (b === 'music' ? v.bus.music : b === 'sfx' ? v.bus.sfx : 'fx' in b ? b.fx.input : b);
      const bq = (ac, type, f, q = 0.7, g = 0) => {
        const n = ac.createBiquadFilter();
        n.type = type;
        n.frequency.value = f;
        n.Q.value = q;
        n.gain.value = g;
        return { input: n, output: n };
      };
      const panFx = (ac, p) => {
        const n = ac.createStereoPanner();
        n.pan.value = p;
        return { input: n, output: n };
      };
      // the guitars: a saw into a hard clipper and a cabinet (a resonant lowpass, the fizz taken
      // off), one take hard left and one right; a lighter crunch for the garage
      const amp = (pan, amount, ceiling, to) =>
        v.insert(ac => [bq(ac, 'highpass', 90), distortion(ac, { amount, ceiling }), bq(ac, 'peaking', 1600, 0.8, 3), bq(ac, 'lowpass', 3400, 1.2), bq(ac, 'lowpass', 6000, 0.5), panFx(ac, pan)], to);
      const heavy = [amp(-0.75, 0.85, 0.1, 'music'), amp(0.75, 0.85, 0.1, 'music')];
      const crunch = [amp(-0.6, 0.45, 0.07, 'music'), amp(0.6, 0.45, 0.07, 'music')];
      const jheavy = [amp(-0.7, 0.85, 0.12, 'sfx'), amp(0.7, 0.85, 0.12, 'sfx')];
      // the bass: a saw into its own clipper, dark; the sub under it clean
      const fuzz = v.insert(ac => [bq(ac, 'highpass', 35), distortion(ac, { amount: 0.6, ceiling: 0.08, mix: 0.8 }), bq(ac, 'lowpass', 1100, 0.9)]);
      // the lead: a little grit, then a dotted echo in time with the track
      const echo = v.insert(ac => delay(ac, { time: 0.3, feedback: 0.3, wet: 0.22, cut: 3200, pan: 0.25 }));
      const grit = v.insert(ac => distortion(ac, { amount: 0.4, ceiling: 0.09, mix: 0.4 }), echo);
      const keysEcho = v.insert(ac => delay(ac, { time: 0.33, feedback: 0.25, wet: 0.2, cut: 2400, pan: -0.3 }));
      // the snare's room (wet only), and the jingles' echo
      const room = v.insert(ac => delay(ac, { time: 0.045, feedback: 0.3, wet: 0.35, dry: 0, cut: 4200, pan: 0.15 }));
      const jecho = v.insert(ac => delay(ac, { time: 0.18, feedback: 0.32, wet: 0.26, cut: 3000, pan: -0.25 }), 'sfx');
      const jgrit = v.insert(ac => distortion(ac, { amount: 0.4, ceiling: 0.1, mix: 0.4 }), jecho);
      // the effects' street: a short slap off the walls for booms and crashes (wet only)
      const street = v.insert(ac => delay(ac, { time: 0.11, feedback: 0.35, wet: 0.5, dry: 0, cut: 1400, pan: 0.2 }), 'sfx');

      // one saw note through an ADSR (and a lowpass for a palm mute) into a target
      const PICK = { attack: 0.002, decay: 0.25, sustain: 0.55, release: 0.05 };
      const MUTE = { attack: 0.002, decay: 0.07, sustain: 0.15, release: 0.03 };
      function saw(f, t, dur, vol, bus, env, det = 0, cut = 0, f1 = 0) {
        const ac = v.ac, o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, t);
        if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        o.detune.value = det;
        const end = adsr(g.gain, t, t + dur, vol, env);
        let head = o;
        const parts = [g];
        if (cut) {
          const lp = ac.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = cut;
          lp.Q.value = 1.2;
          o.connect(lp);
          head = lp;
          parts.push(lp);
        }
        head.connect(g).connect(target(bus));
        o.start(t);
        o.stop(end + 0.05);
        o.onended = () => parts.forEach(n => n.disconnect());
      }
      // a guitar hit on a root: both takes, the right a hair late and a little sharp
      function guitar(root, g, t, d, vol, amps = heavy, dive = 0) {
        const r = root + (g.k === 'D' ? 0 : g.n);
        const notes = g.k === 'P' ? [r, r + 7, r + 12] : g.k === 'x' ? [r, r + 7] : g.k === 'D' ? [root, root + g.n] : [r];
        const mute = g.k === 'x', env = mute ? MUTE : PICK, dur = mute ? Math.min(d, 0.12) : d;
        for (const n of notes) {
          const f = midi(n), f1 = dive ? midi(n - dive) : 0;
          saw(f, t, dur, vol, amps[0], env, -6, mute ? 650 : 0, f1);
          saw(f, t + 0.007, dur, vol, amps[1], env, 6, mute ? 650 : 0, f1);
        }
      }
      function bass(n, t, d, L, bus = 'music') {
        const f = midi(n);
        sub(f, t, d, L.sub, { punch: 4, drop: 0.02, drive: L.clean ? 0.15 : 0.45, tone: 500, attack: 0.002, decay: 0.25, sustain: 0.7, release: 0.05, bus });
        if (!L.clean) saw(f, t, d, L.bass, fuzz, { attack: 0.002, decay: 0.2, sustain: 0.7, release: 0.04 });
        else saw(f * 2, t, d, L.bass * 0.25, bus, { attack: 0.004, decay: 0.15, sustain: 0.3, release: 0.05 }, 0, 900);
      }
      function leadNote(n, t, d, L, bus = grit) {
        const f = midi(n);
        if (L.voice === 'saw')
          supersaw(f, t, d, L.lead, { attack: 0.006, decay: 0.3, sustain: 0.75, release: 0.12, cutoff: 2800, envmod: 1600, reso: 0.2, detune: 0.28, mix: 0.5, width: 0.6, bus });
        else if (L.voice === 'fm')
          fm(f, t, d, L.lead, { ratio: 1, index: 1.6, modDecay: 0.25, modSustain: 0.3, attack: 0.004, decay: 0.5, sustain: 0.5, release: 0.2, bus: keysEcho });
        else v.pulse(f, t, d, L.lead, { width: 0.35, pwm: 0.45, rate: 0.6, cutoff: 2600, envmod: 1500, reso: 0.25, attack: 0.005, decay: 0.3, sustain: 0.75, release: 0.12, bus });
      }
      // the kit
      const kick = (t, vol, bus = 'music') => {
        sub(52, t, 0.3, vol, { punch: 26, drop: 0.035, drive: 0.55, tone: 2600, attack: 0.001, decay: 0.26, sustain: 0, release: 0.05, bus });
        hiss(t, 0.012, vol * 0.25, 6000, 3000, 'bandpass', bus, 1, 0.0005);
      };
      const snare = (t, vol, bus = 'music') => {
        tone(210, 165, t, 0.09, vol * 0.5, 'triangle', bus, 0.001);
        hiss(t, 0.2, vol * 0.75, 6000, 1800, 'bandpass', bus, 0.6, 0.001);
        hiss(t, 0.05, vol * 0.45, 8000, 5500, 'bandpass', bus, 0.8, 0.002);
        if (bus === 'music') hiss(t, 0.18, vol * 0.4, 5000, 1500, 'bandpass', room, 0.6, 0.001);
      };
      const rim = (t, vol, bus = 'music') => {
        tone(1700, 1500, t, 0.02, vol * 0.4, 'square', bus, 0.0005);
        hiss(t, 0.03, vol * 0.5, 4200, 3000, 'bandpass', bus, 3, 0.0005);
      };
      const hat = (t, vol, open, bus = 'music') => hiss(t, open ? 0.16 : 0.035, vol * 1.3, 10500, 8000, 'bandpass', bus, 0.9, 0.0015);
      const ride = (t, vol, bus = 'music') => {
        hiss(t, 0.3, vol * 0.7, 9500, 7000, 'bandpass', bus, 0.9, 0.0015);
        tone(4100, 4000, t, 0.25, vol * 0.08, 'sine', bus, 0.001);
      };
      const crash = (t, vol, bus = 'music') => {
        hiss(t, 1.6, vol, 10000, 4500, 'highpass', bus, undefined, 0.001);
        hiss(t, 0.9, vol * 0.4, 5200, 3200, 'bandpass', bus, 1.5, 0.001);
      };
      const tom = (t, vol, f, bus = 'music') => {
        sub(f, t, 0.28, vol, { punch: 9, drop: 0.07, drive: 0.4, tone: 1400, attack: 0.001, decay: 0.25, sustain: 0, release: 0.06, bus });
        hiss(t, 0.04, vol * 0.2, 2400, 900, 'bandpass', bus, 1, 0.001);
      };
      const TOMS = { 1: 180, 2: 132, 3: 96 };

      // ---------- the score ----------
      function step(tr, i, t, dt) {
        const k = i % tr.steps, s = k % 16, B = tr.bars[k >> 4], L = tr.look,
          at = t + (s % 2 ? dt * (L.swing ?? 0) : 0);
        if (s === 0) echo.fx?.time.setTargetAtTime(dt * L.echo, t, 0.05); // in time with the tune
        // the kit (the fill on the second half of a section's last bar)
        const kit = B.fill && s >= 8 ? KITS.fill : B.kit, kv = L.kit;
        const lane = c => kit[c]?.[s] ?? '.';
        if (lane('k') === 'x') kick(at, 0.42 * kv);
        const sn = lane('s');
        if (sn === 'x') snare(at, 0.3 * kv);
        else if (sn === 'g') snare(at, 0.07 * kv);
        else if (sn === 'r') rim(at, 0.12 * kv);
        const h = lane('h');
        if (h === 'x' || h === 'o') hat(at, (s % 4 === 0 ? 0.13 : 0.09) * kv, h === 'o');
        else if (h === 'd') ride(at, 0.12 * kv);
        const tm = lane('t');
        if (TOMS[tm]) tom(at, 0.3 * kv, TOMS[tm]);
        if (B.crash && s === 0) crash(at, 0.07 * kv);
        // the guitars (the bass doubling them an octave down, unless it has its own line)
        const g = tr.riff[k];
        if (g && g !== -1) {
          const d = dt * span(tr.riff, k, 16 - s) * 0.92;
          guitar(B.root, g, at, d, L.gtr, L.crunch ? crunch : heavy);
          if (B.follow) bass(B.root - 12 + (g.k === 'D' ? 0 : g.n), at, g.k === 'x' ? Math.min(d, dt * 0.9) : d, L);
        }
        const bn = tr.bass[k];
        if (!B.follow && bn && bn !== -1) bass(B.root - 12 + bn.n, at, dt * span(tr.bass, k, 16 - s) * 0.9, L);
        // the garage's keys: a chord chopped on the offbeats
        if (B.chord && L.keys && (s === 6 || s === 14))
          for (const iv of CHORDS[B.chord])
            fm(midi(B.root + 12 + iv), at, dt * 1.4, L.keys, { ratio: 1, index: 1.4, modDecay: 0.15, modSustain: 0.25, attack: 0.003, decay: 0.3, sustain: 0.3, release: 0.12, bus: keysEcho });
        // the lead
        const n = tr.lead[k];
        if (n > 0) leadNote(n, at, dt * span(tr.lead, k, 32) * 0.95, L);
      }

      // ---------- the effects ----------
      // a panner per position (to a tenth), on the current context, into the sfx bus
      const panners = new WeakMap();
      const placed = pan => {
        const p = Math.round(clamp(pan, -1, 1) * 10);
        if (!p || !v.ac) return 'sfx';
        let m = panners.get(v.ac);
        if (!m) panners.set(v.ac, (m = new Map()));
        let node = m.get(p);
        if (!node) {
          node = v.ac.createStereoPanner();
          node.pan.value = p / 10;
          node.connect(v.bus.sfx);
          m.set(p, node);
        }
        return node;
      };
      const thud = (f, t, dur, vol, out, o = {}) =>
        sub(f, t, dur, vol, { punch: 12, drop: 0.04, drive: 0.6, tone: 1400, attack: 0.001, decay: dur, sustain: 0, release: 0.05, bus: out, ...o });
      const clank = (f, t, dur, vol, out, ratio = 2.41, index = 5) =>
        fm(f, t, dur, vol, { ratio, index, modDecay: 0.03, modSustain: 0.1, attack: 0.0006, decay: dur, sustain: 0, release: 0.04, bus: out });
      const bell = (n, t, vol, out, d = 0.6) =>
        fm(midi(n), t, d, vol, { ratio: 3.5, index: 1.6, modDecay: 0.12, modSustain: 0.15, attack: 0.0025, decay: d, sustain: 0, release: 0.2, bus: out });
      const blip = (f0, f1, t, vol, out = 'sfx', d = 0.04) => {
        tone(f0, f1, t, d, vol, 'triangle', out, 0.002);
        tone(f0 * 2, f1 * 2, t, d * 0.7, vol * 0.25, 'sine', out, 0.002);
      };
      const RR = [1, 0.94, 1.06, 0.97, 1.03]; // round-robin pitches, so a burst isn't one sound
      let round = 0;
      const last = {}; // when each rate-limited sound last played, and how hard
      const limited = (key, t, gap, force) => {
        const l = last[key];
        if (l && t - l.t < gap && force <= l.f * 1.5) return true;
        last[key] = { t, f: force };
        return false;
      };
      function boom(t, out, g, big) {
        hiss(t, 0.05, 0.45 * g, 7000, 2500, 'bandpass', out, 0.7, 0.0008); // the crack
        hiss(t, big ? 1.8 : 1.1, 0.5 * g, 2600, 60, 'lowpass', out, 0.8, 0.002); // the blast
        thud(46, t, big ? 0.9 : 0.6, 0.5 * g, out, { punch: 20, drop: 0.15, drive: 0.7, tone: 900 });
        hiss(t + 0.01, big ? 1.4 : 0.9, 0.22 * g, 1500, 80, 'lowpass', street, 0.7, 0.003);
        for (let k = 0; k < (big ? 7 : 4); k++) hiss(t + 0.12 + k * 0.09 + (k % 3) * 0.02, 0.03, (0.08 - k * 0.008) * g, 5000 - k * 400, 1800, 'bandpass', out, 2, 0.001); // debris
      }

      const effects = {
        // ---------- the race ----------
        // a round from the machine gun: a crack, a punch and the action's click; rivals' further off
        shot: (t, e, out, g) => {
          const who = e.car ?? 0;
          if (limited('shot' + who, t, 0.04, 0)) return;
          const p = RR[round++ % RR.length], me = who === 0;
          hiss(t, 0.035, (me ? 0.3 : 0.22) * g, 5200 * p, 1800 * p, 'bandpass', out, 0.9, 0.0006);
          thud(110 * p, t, 0.05, (me ? 0.3 : 0.2) * g, out, { punch: 14, drop: 0.015, drive: 0.8, tone: 1800, decay: 0.045 });
          tone(2400 * p, 2000 * p, t + 0.004, 0.012, 0.025 * g, 'square', out, 0.0005);
          if (me) hiss(t, 0.09, 0.06, 1800, 400, 'lowpass', out, 0.7, 0.002); // the body of it, close
        },
        // a round striking a car: a metal tink and a thud; on us heavier, a crunch
        hit: (t, e, out, g) => {
          const p = RR[round++ % RR.length], dmg = clamp01((e.dmg ?? 4) / 10), me = e.car === 0;
          clank((me ? 520 : 680) * p, t, 0.1, (0.16 + 0.08 * dmg) * g, out);
          hiss(t, 0.03, 0.24 * g, 4200 * p, 2400, 'bandpass', out, 1.2, 0.0005);
          thud((me ? 90 : 140) * p, t, 0.08, (me ? 0.3 : 0.16) * g, out, { punch: 8, drop: 0.02, tone: 1200 });
          if (me) hiss(t, 0.1, 0.08, 2400, 600, 'lowpass', out, 0.8, 0.001);
        },
        // a round off a wall: a ping, now and then the ricochet's whine
        spark: (t, e, out, g) => {
          if (limited('spark', t, 0.03, 0)) return;
          const p = RR[round++ % RR.length];
          tone(3300 * p, 2400 * p, t, 0.05, 0.16 * g, 'triangle', out, 0.0008);
          hiss(t, 0.03, 0.4 * g, 7000, 4000, 'bandpass', out, 2, 0.0008);
          if (round % 3 === 0) tone(2700 * p, 1200 * p, t + 0.015, 0.28, 0.04 * g, 'sine', out, 0.01);
        },
        // a mine dropped: a clunk on the road, a rattle, and its beep as it arms
        drop: (t, e, out, g) => {
          clank(240, t, 0.09, 0.12 * g, out, 1.41, 3);
          thud(95, t, 0.1, 0.2 * g, out, { punch: 6, drop: 0.02, tone: 900 });
          hiss(t + 0.03, 0.08, 0.05 * g, 3000, 1500, 'bandpass', out, 1.5, 0.002);
          effects.beep(t + 0.6, e, out, g);
        },
        beep: (t, e, out, g) => {
          tone(1900, 1900, t, 0.06, 0.15 * g, 'sine', out, 0.002);
          tone(3800, 3800, t, 0.04, 0.035 * g, 'sine', out, 0.002);
        },
        boom: (t, e, out, g) => boom(t, out, g, false),
        // car on car: a crunch by how hard (a thud, torn metal, a clank)
        bump: (t, e, out, g) => {
          const f = clamp01((e.force ?? 6) / 14);
          if (limited('bump', t, 0.09, f)) return;
          const vol = (0.25 + 0.75 * f) * g;
          thud(72, t, 0.15, 0.4 * vol, out, { punch: 9, drop: 0.03, tone: 1000 });
          hiss(t, 0.12 + 0.1 * f, 0.22 * vol, 2200, 700, 'bandpass', out, 0.8, 0.001);
          clank(330 * RR[round++ % RR.length], t, 0.12, 0.1 * vol, out, 1.73, 4);
          if (f > 0.6) for (let k = 0; k < 3; k++) hiss(t + 0.03 + k * 0.03, 0.03, 0.04 * vol, 8000, 6000, 'bandpass', out, 3, 0.001);
        },
        // into the barrier: a duller thud and a scrape of grit
        wall: (t, e, out, g) => {
          const f = clamp01((e.force ?? 6) / 14);
          if (limited('wall' + (e.car ?? 0), t, 0.12, f)) return;
          const vol = (0.2 + 0.8 * f) * g;
          thud(58, t, 0.16, 0.38 * vol, out, { punch: 8, drop: 0.04, tone: 700 });
          hiss(t, 0.14 + 0.12 * f, 0.18 * vol, 1800, 400, 'lowpass', out, 0.8, 0.002);
          hiss(t + 0.01, 0.12 + 0.1 * f, 0.06 * vol, 3200, 2600, 'bandpass', out, 3, 0.004);
        },
        // a pickup by kind: cash rings, ammo racks, a repair ratchets, turbo whooshes
        pickup: (t, e, out, g) => {
          const kind = e.kind;
          if (kind === 'cash') {
            bell(88, t, 0.11 * g, out, 0.4);
            bell(95, t + 0.07, 0.11 * g, out, 0.7);
            for (let k = 0; k < 4; k++) hiss(t + 0.05 + k * 0.04, 0.03, 0.06 * g, 9000, 7000, 'bandpass', out, 4, 0.001);
          } else if (kind === 'ammo') {
            clank(900, t, 0.05, 0.16 * g, out, 1.48, 2.5);
            hiss(t + 0.02, 0.08, 0.14 * g, 2500, 4000, 'bandpass', out, 2, 0.01); // the slide
            clank(760, t + 0.11, 0.07, 0.2 * g, out, 1.48, 2.5);
          } else if (kind === 'repair') {
            for (let k = 0; k < 6; k++) hiss(t + k * 0.035, 0.02, 0.16 * g, 3600, 2600, 'bandpass', out, 4, 0.0008);
            bell(76, t + 0.22, 0.1 * g, out, 0.4);
            bell(83, t + 0.3, 0.1 * g, out, 0.6);
          } else if (kind === 'turbo') {
            hiss(t, 0.35, 0.35 * g, 900, 5000, 'bandpass', out, 1.3, 0.06);
            bell(83, t + 0.15, 0.1 * g, out, 0.5);
          } else blip(1200, 1600, t, 0.08 * g, out);
        },
        // the turbo kicks in: a whoomp, the air rushing, a rising rasp
        turbo: (t, e, out, g) => {
          thud(64, t, 0.3, 0.25 * g, out, { punch: 14, drop: 0.08, drive: 0.5, tone: 800 });
          hiss(t, 0.6, 0.18 * g, 700, 5000, 'bandpass', out, 1.3, 0.05);
          tone(380, 1500, t, 0.45, 0.012 * g, 'sawtooth', out, 0.05);
        },
        // a car wrecked: a big blast, torn metal and glass, fire after; ours with the sting
        wreck: (t, e, out, g) => {
          boom(t, out, g, true);
          clank(260, t + 0.02, 0.3, 0.12 * g, out, 1.73, 6);
          for (let k = 0; k < 6; k++) hiss(t + 0.04 + k * 0.035, 0.04, 0.05 * g, 9000 - k * 300, 6500, 'bandpass', out, 3, 0.001); // glass
          for (let k = 0; k < 10; k++) hiss(t + 0.5 + k * 0.13 + (k % 4) * 0.03, 0.02, 0.03 * g * (1 - k / 12), 3000, 1500, 'bandpass', out, 2, 0.001); // fire crackling
          if (e.car === 0) jingles.wreck(t + 0.2);
        },
        // under a quarter of the armour: a two-tone warning
        low: t => {
          for (let k = 0; k < 2; k++) {
            tone(880, 880, t + k * 0.24, 0.09, 0.05, 'triangle', 'sfx', 0.003);
            tone(660, 660, t + k * 0.24 + 0.11, 0.09, 0.05, 'triangle', 'sfx', 0.003);
          }
        },
        // the start lights: three low beeps, then the high one and the go stab
        count: t => {
          tone(740, 740, t, 0.16, 0.06, 'sine', 'sfx', 0.003);
          tone(740, 740, t, 0.16, 0.015, 'square', 'sfx', 0.003);
        },
        go: t => {
          tone(1480, 1480, t, 0.4, 0.06, 'sine', 'sfx', 0.003);
          tone(1480, 1480, t, 0.3, 0.015, 'square', 'sfx', 0.003);
          jingles.go(t);
        },
        lap: t => jingles.lap(t),
        last: t => jingles.last(t),
        finish: (t, e) => jingles.finish(t, e.place),
        cash: t => jingles.cash(t),

        // ---------- the menus ----------
        move: t => {
          tone(1500, 1500, t, 0.035, 0.17, 'triangle', 'sfx', 0.002);
          hiss(t, 0.015, 0.1, 5000, 3000, 'bandpass', 'sfx', 2, 0.002);
        },
        pick: t => {
          blip(990, 990, t, 0.14);
          blip(1480, 1480, t + 0.06, 0.15, 'sfx', 0.07);
        },
        back: t => {
          blip(1480, 1480, t, 0.13);
          blip(990, 990, t + 0.06, 0.13, 'sfx', 0.07);
        },
        // money spent: the till's drawer and a coin
        buy: t => {
          clank(420, t, 0.08, 0.08, 'sfx', 1.41, 3);
          thud(110, t, 0.08, 0.15, 'sfx', { punch: 6, tone: 900 });
          bell(91, t + 0.1, 0.04, 'sfx', 0.5);
        },
        // no: a short double buzz
        deny: t => {
          for (let k = 0; k < 2; k++)
            v.pulse(150, t + k * 0.12, 0.08, 0.16, { width: 0.2, pwm: 0, cutoff: 1300, envmod: 600, attack: 0.004, decay: 0.08, sustain: 0.8, release: 0.03, bus: 'sfx' }); // two short buzzes
        },
        // pause: a gear lever into neutral
        pause: t => {
          clank(300, t, 0.06, 0.14, 'sfx', 1.41, 2.5);
          hiss(t, 0.05, 0.1, 2500, 1200, 'bandpass', 'sfx', 1.5, 0.002);
          blip(660, 440, t + 0.05, 0.1, 'sfx', 0.08);
        },
      };

      // ---------- the jingles ----------
      const jingle = (t, name) => {
        // music(name) and the event in the same moment play it once
        if (lastJingle.name === name && t - lastJingle.at < 0.3) return false;
        lastJingle = { name, at: t };
        const J = JINGLES[name];
        if (J.hold) hold(t + J.hold);
        if (J.duck && duck?.ac === v.ac) {
          duck.g.gain.setTargetAtTime(0.4, t, 0.03);
          duck.g.gain.setTargetAtTime(1, t + J.duck, 0.25);
        }
        return true;
      };
      const stab = (root, t, d, vol = 0.1, kind = 'P', n = 0, dive = 0) => guitar(root, { k: kind, n }, t, d, vol, jheavy, dive);
      const jlead = (n, t, d, vol = 0.06) =>
        v.pulse(midi(n), t, d, vol, { width: 0.35, pwm: 0.4, cutoff: 2800, envmod: 1500, reso: 0.25, attack: 0.004, decay: 0.3, sustain: 0.75, release: 0.15, bus: jgrit });
      const jingles = {
        go(t) {
          if (!jingle(t, 'go')) return;
          kick(t, 0.4, 'sfx');
          crash(t, 0.07, 'sfx');
          stab(40, t, 0.7);
          [76, 83, 88].forEach((n, k) => jlead(n, t + k * 0.06, k === 2 ? 0.6 : 0.06));
        },
        lap(t) {
          if (!jingle(t, 'lap')) return;
          stab(45, t, 0.1, 0.1, 'x');
          stab(45, t + 0.12, 0.1, 0.1, 'x');
          stab(47, t + 0.24, 0.45);
          kick(t + 0.24, 0.3, 'sfx');
          jlead(83, t + 0.24, 0.4);
        },
        last(t) {
          if (!jingle(t, 'last')) return;
          [40, 43, 45].forEach((r, k) => {
            stab(r, t + k * 0.13, k === 2 ? 0.6 : 0.11);
            kick(t + k * 0.13, 0.3, 'sfx');
          });
          for (let k = 0; k < 6; k++) snare(t + 0.26 + k * 0.05, 0.08 + k * 0.025, 'sfx');
          crash(t + 0.56, 0.07, 'sfx');
          [88, 91, 88, 91].forEach((n, k) => jlead(n, t + 0.39 + k * 0.08, 0.07, 0.045));
        },
        finish(t, place = 1) {
          if (!jingle(t, 'finish')) return;
          if (place === 1 || !Number.isFinite(place)) {
            // first: the theme's climb on the guitars, a big chord, the lead on top
            [40, 43, 45, 47].forEach((r, k) => {
              stab(r, t + k * 0.12, 0.1);
              kick(t + k * 0.12, 0.28, 'sfx');
            });
            stab(52, t + 0.48, 1.6, 0.11);
            kick(t + 0.48, 0.45, 'sfx');
            crash(t + 0.48, 0.09, 'sfx');
            jlead(83, t + 0.48, 0.15);
            jlead(88, t + 0.66, 1.3);
          } else {
            // placed: two stabs, settling on a lower chord
            stab(45, t, 0.15);
            stab(43, t + 0.2, 0.15);
            stab(40, t + 0.42, 1.1, 0.1);
            kick(t, 0.3, 'sfx');
            kick(t + 0.42, 0.35, 'sfx');
            crash(t + 0.42, 0.06, 'sfx');
            jlead(place === 2 ? 79 : 76, t + 0.42, 0.9, 0.05);
          }
        },
        wreck(t) {
          if (!jingle(t, 'wreck')) return;
          // the chord diving away under a slow toll
          stab(40, t, 1.5, 0.1, 'P', 0, 7);
          thud(41, t, 1.2, 0.3, 'sfx', { punch: 14, drop: 0.3, drive: 0.6, tone: 600 });
          crash(t, 0.05, 'sfx');
          stab(46, t + 1.5, 1.2, 0.08);
          jlead(70, t + 1.5, 0.5, 0.04);
          jlead(64, t + 2.05, 0.9, 0.04);
        },
        cash(t) {
          if (!jingle(t, 'cash')) return;
          bell(88, t, 0.15, jecho, 0.4);
          bell(95, t + 0.08, 0.15, jecho, 0.9);
          clank(420, t, 0.08, 0.12, 'sfx', 1.41, 3);
          for (let k = 0; k < 6; k++) hiss(t + 0.06 + k * 0.035, 0.03, 0.06, 9500, 7000, 'bandpass', 'sfx', 4, 0.001);
        },
      };
      // music(jingle) plays them as 'j:<name>' (sfx('wreck') is a car blowing up, the sting only ours)
      for (const name of Object.keys(JINGLES)) effects['j:' + name] = t => jingles[name](t);

      // every effect gets its opts (never undefined), where to play (opts.pan) and how loud (opts.gain)
      for (const [name, fn] of Object.entries(effects))
        effects[name] = (t, e) => {
          const o = e && typeof e === 'object' ? e : {};
          const g = o.gain === undefined ? 1 : clamp01(o.gain);
          if (g < 0.02) return;
          fn(t, o, placed(o.pan), g);
        };
      return { step, effects, methods: engineLayer(v) };
    },
  });
  return {
    unlock: () => synth.unlock(),
    // a jingle as music: it plays over (or holds) the track, which goes on after it
    music(name) {
      if (name && name in JINGLES) synth.sfx('j:' + name);
      else synth.music(name);
    },
    sfx: (name, opts) => synth.sfx(name, opts),
    engines: list => synth.engines(list),
    skid: level => synth.skid(level),
    setOn: b => synth.setOn(b),
    get on() {
      return synth.on;
    },
    destroy: () => synth.destroy(),
  };
}
