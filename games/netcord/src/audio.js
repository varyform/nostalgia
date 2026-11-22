// Netcord's sound, made in code on @nostalgia/audio, all original: the court (the racket's pock by
// shot, power and timing, a clank off the frame, the ball's bounce by surface, the net's mesh and
// the tick of the tape, shoe squeaks and scuffs), the umpire's chair as tones (no speech), a tennis
// crowd (a murmur between points that hushes for the serve, silence through the rally but for a
// gasp at a ball on the line, applause after the point, oohs, groans, an ovation for the match),
// the menus' blips and three early-90s sports-TV themes. The context is only made by unlock(),
// which the page calls from a user gesture; the demo never makes one.
//
//   const audio = createAudio({ sound: true });
//   audio.unlock(); audio.music('title'); audio.ui('select');
//   audio.music(null); audio.surface('clay'); audio.crowd(1);   // a match: the crowd is the sound
//   audio.match(match.events, match.s);                         // every sim step
//   audio.crowd(0);                                             // off court: the crowd fades away
//
// Tracks (16th steps, one chord a bar, sections in a form):
//   title  "Baseline Sunrise"  D major,  126 bpm: DX bell arpeggios, an FM slap bass, gated snare,
//                              a pulse verse and a supersaw chorus hook
//   menu   "Changeover"        C major,   96 bpm, swung: e-piano sevenths, a round bass, rim and
//                              shaker, a soft pulse lead
//   win    "Silver Plate"      Eb major, 108 bpm: a brass fanfare over timpani and a snare roll,
//                              then the anthem on brass and bells
//
// match(events, s) plays the sim's events (the contract's list: hit, bounce, net, let, fault, out,
// point, game, set, match, change, serve, swing, step) and keeps the crowd's murmur in step with
// s.phase. The court's sound (bright hard courts, dull clay, soft grass, an echoing hall indoors)
// follows surface(name), else a bounce event's `surface`, else `s.surface`.
import { compressor, createSynth, delay, limiter, midi, span } from '@nostalgia/audio';

const num = (x, d = 0) => (Number.isFinite(x) ? x : d);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, num(x)));
const clamp01 = x => clamp(x, 0, 1);
const smooth = u => {
  u = clamp01(u);
  return u * u * (3 - 2 * u);
};
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const SURFACES = ['hard', 'clay', 'grass', 'indoor'];

// ---------- the score ----------
// a lead: MIDI note numbers, '.' rest, '-' hold (16 a bar)
const lead = s =>
  s
    .trim()
    .split(/\s+/)
    .map(t => (t === '.' ? 0 : t === '-' ? -1 : +t));
// a chord: 'D', 'F#m', 'Cmaj7', 'Am7', 'G7', 'Eb'
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITY = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11] };
function chord(name) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(name);
  const pc = (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const iv = QUALITY[m[3]] ?? QUALITY[''];
  // voiced around middle C, folded into 55…71 so the chords move by small steps
  const tones = iv.map(i => 60 + ((pc + i) % 12)).map(n => (n > 71 ? n - 12 : n < 55 ? n + 12 : n));
  tones.sort((a, b) => a - b);
  // the arpeggio: the chord's tones an octave and more up, folded under 92
  const up = [0, 1, 2, 1].map(j => 72 + pc + iv[j]).map(n => (n > 91 ? n - 12 : n));
  return { root: 36 + pc, iv, tones, up };
}

// The kit, a bar a pattern: k kick; s snare (x), ghost (g); r rim; c clap; h closed (x), open (o);
// z a shaker; T toms (1 high, 2 mid, 3 low); t a timpani (1 the root, 5 its fifth); R a snare roll
// rising through the bar. 'fill' takes the second half of a section's last bar.
const KITS = {
  none: {},
  hats: { h: 'x.x.x.x.x.x.x.x.' },
  build: { k: 'x.......x.......', h: 'xxxxxxxxxxxxxxxx' },
  pop: { k: 'x.....x...x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
  popb: { k: 'x.....x...x...x.', s: '....x.......x.g.', h: 'x.x.x.x.x.x.x.xo' },
  lift: { k: 'x...x...x...x...', s: '....x.......x...', c: '....x.......x...', h: '..o...o...o...o.' },
  soft: { k: 'x.......x.x.....', r: '....x.......x...', z: 'xxxxxxxxxxxxxxxx' },
  softb: { k: 'x.......x.x...x.', r: '....x.......x..x', z: 'xxxxxxxxxxxxxxxx' },
  march: { k: 'x.......x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
  fanfare: { t: '1.......5...1...', R: 'xxxxxxxxxxxxxxxx' },
  fanfareb: { k: 'x.......x.......', t: '1...1...5.5.1111' },
  fill: { k: 'x.......x.......', T: '........1.1.2.33' },
  rimfill: { k: 'x.......x.......', r: '....x...x.x.xxxx' },
};
// The bass, a bar a pattern: 0 the root, 5 its fifth, c the octave, 3 the chord's third, b a step
// below the next root; how long its notes may last (steps)
const BASS = {
  none: { p: '................' },
  hold: { p: '0.......0.......', max: 7.5 },
  oct: { p: '0.c.0.c.0.c.0.c.', max: 1.3 },
  slap: { p: '0..c..0.0.c..05.', max: 1.6 },
  round: { p: '0.....5.c.....3b', max: 4 },
  drive: { p: '0.0.0.0.0.0.0.05', max: 1.5 },
};
// chord parts: stabs on the offbeats, a pad held through the bar, e-piano hits, brass
const STABS = '..x..x....x..x..';
const EP = 'x.....x...x.....';

// Each track: tempo, level (after the music compressor), how it's played, and its sections
// (chords a bar, the kit and bass per bar, the chord part, arpeggios, a lead and its voice).
const TRACKS = {
  title: {
    bpm: 126,
    gain: 1.35,
    look: { lead: 0.07, bass: 0.07, sub: 0.13, chord: 0.026, pad: 0.02, arp: 0.03, kit: 1, bell: true },
    form: 'I A B A B',
    sec: {
      I: {
        chords: 'D Bm G A',
        kit: ['hats', 'hats', 'build', 'build'],
        bass: 'hold',
        part: 'pad',
        arp: true,
        fill: true,
        soft: true,
      },
      A: {
        chords: 'D A Bm G D A G A',
        kit: ['pop', 'pop', 'pop', 'popb', 'pop', 'pop', 'pop', 'popb'],
        bass: 'slap',
        part: 'stab',
        arp: true,
        fill: true,
        voice: 'pulse',
        lead: lead(`
          81 - - 78 - - 74 - 76 - 78 - 81 - - -   79 - - 76 - - 73 - 76 - - - . . 73 76
          78 - - 74 - - 71 - 74 - 78 - 83 - 81 -   79 - - - - - . . 78 - 79 - 81 - 83 -
          86 - - 81 - - 78 - 81 - 83 - 86 - - -   85 - - 81 - - 76 - 78 - 81 - 85 - 83 -
          83 - - 79 - - 74 - 79 - 81 - 83 - 86 -   85 - - - - - - - . . 81 - 83 - 85 -`),
      },
      B: {
        chords: 'G A F#m Bm G A D D',
        kit: 'lift',
        bass: 'oct',
        part: 'pad',
        arp: true,
        fill: true,
        voice: 'saw',
        lead: lead(`
          86 - 86 - 83 - 79 - 83 - 86 - 88 - - -   85 - 85 - 81 - 76 - 81 - 85 - 88 - - -
          90 - - - 88 - 85 - 81 - - - 85 - 88 -   86 - - - - - 83 - 78 - - - . . 83 85
          86 - 86 - 83 - 79 - 83 - 86 - 88 - 90 -   88 - - - 85 - 81 - 85 - 88 - 90 - - -
          86 - - - - - - - 81 - 83 - 85 - 86 -   86 - - - - - - - . . . . . . . .`),
      },
    },
  },
  menu: {
    bpm: 96,
    gain: 1.45,
    look: { lead: 0.05, bass: 0.065, sub: 0.12, ep: 0.024, arp: 0, kit: 0.7, swing: 0.14 },
    form: 'A L B L',
    sec: {
      A: {
        chords: 'Cmaj7 Am7 Dm7 G7 Cmaj7 Am7 Dm7 G7',
        kit: ['soft', 'soft', 'soft', 'softb'],
        bass: 'round',
        part: 'ep',
        fill: true,
        soft: true,
      },
      L: {
        chords: 'Cmaj7 Am7 Dm7 G Em7 Am7 Dm7 G7',
        kit: ['soft', 'soft', 'soft', 'softb'],
        bass: 'round',
        part: 'ep',
        fill: true,
        soft: true,
        voice: 'soft',
        lead: lead(`
          76 - - - 79 - - 83 - - - - 81 - 79 -   76 - - - - - 72 - 74 - 76 - 79 - - -
          77 - - - 76 - 74 - 72 - - - 69 - 72 -   74 - - - - - - - . . 71 - 74 - 77 -
          79 - - - 83 - - 81 - - - - 79 - 76 -   81 - - - - - 79 - 76 - 72 - 76 - - -
          77 - - - 81 - 79 - 77 - 76 - 74 - - -   79 - - - - - - - . . . . . . . .`),
      },
      B: {
        chords: 'Fmaj7 Em7 Dm7 G7 Fmaj7 Em7 Dm7 G7',
        kit: ['soft', 'soft', 'soft', 'softb'],
        bass: 'round',
        part: 'ep',
        fill: true,
        voice: 'soft',
        lead: lead(`
          81 - - - 77 - - - 72 - 76 - 77 - - -   79 - - - 76 - - - 71 - 74 - 76 - - -
          77 - - - 74 - - - 69 - 72 - 74 - 77 -   79 - - - - - 77 - 74 - - - 71 - - -
          84 - - - 81 - 77 - 81 - 84 - 88 - - -   86 - - - 83 - 79 - 76 - - - 79 - 83 -
          81 - - - 77 - 74 - 77 - 81 - 84 - 83 -   83 - - - - - - - 79 - - - 77 - 74 -`),
      },
    },
  },
  win: {
    bpm: 108,
    gain: 1.4,
    look: { lead: 0.075, bass: 0.075, sub: 0.13, brass: 0.022, pad: 0.02, arp: 0.022, kit: 0.95, bell: true },
    form: 'F A A',
    sec: {
      F: {
        chords: 'Eb Ab Bb Eb',
        kit: ['fanfare', 'fanfareb', 'fanfare', 'fanfareb'],
        bass: 'hold',
        part: 'brass',
        voice: 'brass',
        lead: lead(`
          75 - - 79 - - 82 - - - - - 87 - - -   84 - - 80 - - 84 - 87 - - - 84 - - -
          82 - 84 - 86 - 87 - 89 - - - 86 - 82 -   87 - - - - - - - - - - - . . . .`),
      },
      A: {
        chords: 'Eb Cm Ab Bb Eb Gm Ab Bb',
        kit: ['march', 'march', 'march', 'popb', 'march', 'march', 'march', 'popb'],
        bass: 'drive',
        part: 'pad',
        arp: true,
        fill: true,
        voice: 'brass',
        lead: lead(`
          79 - - - 82 - - - 87 - - - 86 - 84 -   84 - - - 79 - - - 75 - - - 79 - - -
          80 - - - 84 - - - 87 - - - 89 - 87 -   86 - - - - - 82 - 77 - - - 82 - - -
          79 - - - 82 - - - 87 - - - 89 - 91 -   91 - - - 89 - - - 86 - - - 82 - - -
          84 - - - 87 - - - 89 - - - 87 - 84 -   86 - - - - - - - 82 - - - . . . .`),
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
        kit: KITS[kit] ?? {},
        next: chord(chords[(b + 1) % chords.length]).root,
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

// ---------- the crowd's vowels ----------
// formants: [Hz, Q] for F1…F3, and their levels
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
  ee: [
    [300, 5],
    [2250, 8],
    [3000, 9],
  ],
};
const FORMANT_LEVEL = [1, 0.55, 0.22];

// the court's lines (contract units): singles sidelines, baselines, service lines
const SIDE = 4.115,
  BASE = 11.885,
  SERVICE = 6.4;

// ---------- the synth ----------
export function createAudio({ sound, on, surface } = {}) {
  const synth = createSynth({
    on: on ?? sound ?? true,
    seed: 1990,
    tracks: TRACKS,
    noiseLength: 4,
    pulse: true,
    attack: 0.003,
    startDelay: 0.06,
    lead: 0.004,
    levels: { master: 0.9, music: 0.32, sfx: 0.85 },
    // the tunes evened out against each other (each track's gain then sets it), a gentle hold on
    // the court's sound and a limiter on the whole mix
    inserts: {
      music: ac => compressor(ac, { threshold: -30, ratio: 3, knee: 8, attack: 0.012, release: 0.25, makeup: 6 }),
      sfx: ac => compressor(ac, { threshold: -18, ratio: 2.5, knee: 6, attack: 0.004, release: 0.2 }),
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
      // that each sample lasts a moment, smoothed by a lowpass
      const wobble = (t, hz, offset = Math.random() * 3) => {
        const s = noiseAt(t, offset, hz / v.ac.sampleRate),
          lp = filter(v.ac, 'lowpass', hz * 1.2, 0.5);
        s.connect(lp);
        return { src: s, out: lp };
      };
      const ended = (src, nodes) => {
        src.onended = () => nodes.forEach(n => n.disconnect());
      };

      // the music's echo (in time with the track), the gated snare's room; the court's air: a
      // slap off the stands outdoors, a hall indoors; the stands' own echo for the crowd
      const echo = v.insert(ac => delay(ac, { time: 0.36, feedback: 0.3, wet: 0.22, cut: 3200, pan: 0.25 }));
      const room = v.insert(ac => delay(ac, { time: 0.028, feedback: 0.55, wet: 0.42, dry: 0, cut: 5200, pan: -0.15 }));
      const yard = v.insert(ac => delay(ac, { time: 0.11, feedback: 0.12, wet: 0.1, cut: 2600, pan: -0.2 }), 'sfx');
      const hall = v.insert(
        ac => [
          delay(ac, { time: 0.067, feedback: 0.42, wet: 0.3, cut: 2400, pan: 0.3 }),
          delay(ac, { time: 0.151, feedback: 0.35, wet: 0.2, cut: 1800, pan: -0.3 }),
        ],
        'sfx',
      );
      const stand = v.insert(ac => delay(ac, { time: 0.13, feedback: 0.28, wet: 0.24, cut: 2200, pan: 0.15 }), 'sfx');

      const st = {
        surface: SURFACES.includes(surface) ? surface : 'hard',
        level: 1, // the crowd's level, from crowd()
        phase: '',
        hushAt: -Infinity, // the server bouncing the ball: the crowd falls silent
        murmurAt: 0, // after the applause, the talk comes back from then
        rally: 0, // hits this point
        lastHit: '',
        lastHitAt: -1,
        feet: [],
        bedAt: -1,
      };
      const indoor = () => st.surface === 'indoor';
      const air = () => (indoor() ? hall : yard);
      const crowdOut = () => (indoor() ? hall : stand);

      // a panner per position (to a tenth) and destination, on the current context
      const panners = new WeakMap();
      const DEST = { sfx: 's', music: 'm' };
      const placed = (pan, to = 'sfx') => {
        const p = Math.round(clamp(pan, -1, 1) * 10);
        if (!v.ac) return to;
        let m = panners.get(v.ac);
        if (!m) panners.set(v.ac, (m = new Map()));
        const name = DEST[to] ?? (to === yard ? 'y' : to === hall ? 'h' : to === stand ? 'a' : null);
        if (!name) return to;
        if (!p) return to;
        const key = name + p;
        let node = m.get(key);
        if (!node) {
          node = v.ac.createStereoPanner();
          node.pan.value = p / 10;
          node.connect(target(to));
          m.set(key, node);
        }
        return node;
      };
      // where a sound on court sits: across by x, quieter and darker at the far end (the TV
      // camera is behind the near baseline)
      const panX = x => clamp(num(x) / 6, -1, 1) * 0.7;
      const nearness = z => 0.6 + 0.4 * smooth((num(z) + BASE + 1) / (2 * BASE + 2));
      const at = (x, z) => ({ out: placed(panX(x), air()), g: nearness(z) });

      // ---------- the band ----------
      const kick = (t, vol, bus = 'music') => {
        sub(52, t, 0.24, vol, { punch: 22, drop: 0.028, drive: 0.5, tone: 2400, attack: 0.001, decay: 0.22, sustain: 0, release: 0.05, bus });
        hiss(t, 0.012, vol * 0.22, 6000, 3000, 'bandpass', bus, 1, 0.0005);
      };
      // the 80s-into-90s gated snare: a crack, then the room cut short
      const snare = (t, vol, bus = 'music') => {
        tone(230, 175, t, 0.07, vol * 0.5, 'triangle', bus, 0.001);
        hiss(t, 0.16, vol * 0.75, 7000, 2000, 'bandpass', bus, 0.6, 0.001);
        if (bus === 'music') hiss(t + 0.004, 0.14, vol * 0.45, 5200, 2400, 'bandpass', room, 0.6, 0.001);
      };
      const rim = (t, vol) => {
        tone(1650, 1500, t, 0.018, vol * 0.4, 'square', 'music', 0.0005);
        hiss(t, 0.025, vol * 0.5, 4200, 3000, 'bandpass', 'music', 3, 0.0005);
      };
      const clap = (t, vol) => {
        for (let k = 0; k < 3; k++) hiss(t + k * 0.009, 0.02, vol * 0.6, 1800, 1300, 'bandpass', 'music', 1.4, 0.0005);
        hiss(t + 0.02, 0.15, vol * 0.5, 1600, 900, 'bandpass', room, 1, 0.001);
      };
      const hat = (t, vol, open) => hiss(t, open ? 0.15 : 0.03, vol * 1.3, 10500, 8000, 'bandpass', 'music', 0.9, 0.0015);
      const shaker = (t, vol) => hiss(t, 0.045, vol, 8000, 6000, 'bandpass', 'music', 1.2, 0.012);
      const crash = (t, vol) => {
        hiss(t, 1.5, vol, 10000, 4500, 'highpass', 'music', undefined, 0.001);
        hiss(t, 0.8, vol * 0.4, 5200, 3200, 'bandpass', 'music', 1.5, 0.001);
      };
      const TOMS = { 1: 196, 2: 147, 3: 110 };
      const tom = (t, vol, f) => {
        sub(f, t, 0.3, vol, { punch: 2.5, drop: 0.07, drive: 0.35, tone: 1400, attack: 0.001, decay: 0.28, sustain: 0, release: 0.08 });
        hiss(t, 0.04, vol * 0.2, 2400, 900, 'bandpass', 'music', 0.8, 0.001);
      };
      const timp = (t, vol, f) => {
        sub(f, t, 0.7, vol, { punch: 3, drop: 0.05, drive: 0.3, tone: 900, attack: 0.002, decay: 0.6, sustain: 0, release: 0.2 });
        hiss(t, 0.06, vol * 0.25, 900, 300, 'lowpass', 'music', 0.8, 0.001);
      };
      // a DX-style bell: FM with an inharmonic-ish ratio, struck and ringing out
      const bellVoice = (f, t, d, vol, bus = 'music') =>
        v.fm(f, t, d, vol, { ratio: 3.5, index: 1.8, modDecay: 0.1, modSustain: 0.12, attack: 0.002, decay: d, sustain: 0, release: 0.2, bus });
      function bassNote(n, t, d, L, slap) {
        const f = midi(n);
        // an FM bass with a thumbed attack, the sub under it
        v.fm(f, t, d, L.bass, { ratio: 1, index: slap ? 3.2 : 1.6, modDecay: 0.07, modSustain: 0.25, attack: 0.002, decay: 0.16, sustain: 0.5, release: 0.05 });
        sub(f, t, d, L.sub, { punch: 2, drop: 0.02, drive: 0.2, tone: 420, attack: 0.002, decay: 0.2, sustain: 0.6, release: 0.04 });
      }
      function leadNote(n, t, d, L, voice) {
        const f = midi(n);
        if (voice === 'saw') {
          v.supersaw(f, t, d, L.lead * 0.9, { attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.1, cutoff: 2800, envmod: 1800, reso: 0.15, detune: 0.22, mix: 0.5, width: 0.6, bus: echo });
          bellVoice(f * 2, t, Math.min(0.4, d), L.lead * 0.25, echo);
        } else if (voice === 'brass')
          v.fm(f, t, d, L.lead, { ratio: 1, index: 2.4, modDecay: 0.25, modSustain: 0.6, attack: 0.03, decay: 0.25, sustain: 0.8, release: 0.12, bus: echo });
        else if (voice === 'soft')
          v.pulse(f, t, d, L.lead, { width: 0.6, pwm: 0.35, rate: 0.5, cutoff: 1700, envmod: 900, reso: 0.1, attack: 0.012, decay: 0.4, sustain: 0.6, release: 0.18, bus: echo });
        else v.pulse(f, t, d, L.lead, { width: 0.3, pwm: 0.4, rate: 0.6, cutoff: 2700, envmod: 1500, reso: 0.2, attack: 0.004, decay: 0.3, sustain: 0.7, release: 0.1, bus: echo });
      }
      // the chord part for this step
      function part(B, s, t, dt, L) {
        if (B.part === 'stab' && STABS[s] === 'x')
          for (const n of B.tones)
            v.supersaw(midi(n), t, dt * 1.1, L.chord, { attack: 0.002, decay: 0.1, sustain: 0.3, release: 0.06, cutoff: 2400, envmod: 2000, detune: 0.3, mix: 0.55, width: 0.8 });
        else if (B.part === 'pad' && s === 0)
          for (const n of B.tones)
            v.supersaw(midi(n), t, dt * 15, L.pad, { attack: 0.08, decay: 0.6, sustain: 0.7, release: 0.25, cutoff: 1300, envmod: 600, detune: 0.35, mix: 0.6, width: 0.9 });
        else if (B.part === 'ep' && EP[s] === 'x') {
          const len = s === 0 ? 5 : 3.5;
          for (const n of B.tones)
            v.fm(midi(n), t, dt * len, L.ep, { ratio: 1, index: 1.5, modDecay: 0.15, modSustain: 0.25, attack: 0.003, decay: 0.35, sustain: 0.35, release: 0.15, bus: echo });
        } else if (B.part === 'brass' && (s === 0 || s === 8))
          for (const n of B.tones)
            v.fm(midi(n), t, dt * 7, L.brass, { ratio: 1, index: 2, modDecay: 0.3, modSustain: 0.55, attack: 0.04, decay: 0.3, sustain: 0.75, release: 0.15 });
      }

      function step(tr, i, t, dt) {
        const k = i % tr.steps,
          s = k % 16,
          B = tr.bars[k >> 4],
          L = tr.look,
          when = t + (s % 2 ? dt * (L.swing ?? 0) : 0);
        if (s === 0) echo.fx?.time.setTargetAtTime(dt * 3, t, 0.05); // a dotted eighth
        // the kit (the fill on the second half of a section's last bar)
        const kit = B.fill && s >= 8 ? (B.kit.z ? KITS.rimfill : KITS.fill) : B.kit,
          kv = L.kit,
          lane = c => kit[c]?.[s] ?? '.';
        if (lane('k') === 'x') kick(when, 0.4 * kv);
        const sn = lane('s');
        if (sn === 'x') snare(when, 0.28 * kv);
        else if (sn === 'g') snare(when, 0.07 * kv);
        if (lane('r') === 'x') rim(when, 0.12 * kv);
        if (lane('c') === 'x') clap(when, 0.15 * kv);
        if (lane('z') === 'x') shaker(when, (s % 4 === 2 ? 0.07 : 0.04) * kv);
        const h = lane('h');
        if (h === 'x' || h === 'o') hat(when, (s % 4 === 0 ? 0.1 : 0.07) * kv, h === 'o');
        const tm = lane('T');
        if (TOMS[tm]) tom(when, 0.3 * kv, TOMS[tm]);
        const tp = lane('t');
        if (tp === '1' || tp === '5') timp(when, 0.3 * kv, midi(B.root + (tp === '5' ? 7 : 0)));
        if (lane('R') === 'x') {
          const u = s / 15;
          snare(when, (0.025 + 0.12 * u) * kv);
          snare(when + dt / 2, (0.02 + 0.12 * u) * kv);
        }
        if (B.crash && s === 0) crash(when, 0.05 * kv);
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
          bassNote(n, when, dt * Math.min(gap * 0.85, B.bass.max ?? 2), L, B.bass === BASS.slap);
        }
        part(B, s, when, dt, L);
        // the arpeggio, every 16th into the echo: DX bells, or a thin chip pulse
        if (B.arp && L.arp) {
          const n = B.up[s % 4],
            lv = L.arp * (s % 4 === 0 ? 1 : 0.7);
          if (L.bell) bellVoice(midi(n), when, dt * 2.5, lv * 0.8, echo);
          else tone(midi(n), midi(n), when, dt * 0.8, lv, 0.125, echo, 0.002);
        }
        // the lead
        const n = tr.lead[k];
        if (n > 0) leadNote(n, when, dt * span(tr.lead, k, 32) * 0.92, L, B.voice);
      }

      // ---------- the crowd's voices ----------
      // a choir of detuned saws through vowel formants: o.notes [[at, semitones]] (the pitch glides
      // there), o.vowel a name or [[at, name]], breath noise through the same formants
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
          o.notes.forEach(([when, semi], j) => {
            const f = base * oct * 2 ** ((semi + det) / 12);
            if (j === 0) os.frequency.setValueAtTime(f, t);
            else os.frequency.setTargetAtTime(f, t + when + slop, o.glide ?? 0.05);
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
          for (const [when, name] of vowels.slice(1)) b.frequency.setTargetAtTime(VOWELS[name][j][0], t + when, 0.08);
          pre.connect(b).connect(g).connect(env);
          nodes.push(b, g);
        });
        const p = env.gain,
          a = o.attack ?? 0.15;
        p.value = 0;
        p.setValueAtTime(0, t);
        p.linearRampToValueAtTime(o.vol, t + a);
        p.setTargetAtTime(o.vol * (o.sustain ?? 0.7), t + a, 0.25);
        p.setTargetAtTime(0, t + dur, release / 4);
        env.connect(target(placed(o.pan ?? 0, o.bus ?? crowdOut())));
        for (const s of oscs) s.start(t);
        for (const s of srcs) s.stop(end + 0.05);
        ended(lfo, nodes);
      }
      // noise through bands ([Hz, Q, level], or a vowel's formants, gliding to others), with an
      // envelope and an optional flutter (the wobble of many voices): murmurs, gasps
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
        bands.forEach(([f, q, lv], j) => {
          const b = filter(ac, 'bandpass', f, q),
            g = gain(ac, lv * Math.sqrt(q));
          if (vowels) for (const [when, name] of vowels.slice(1)) b.frequency.setTargetAtTime(VOWELS[name][j][0], t + when, 0.1);
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
        env.connect(target(placed(o.pan ?? 0, o.bus ?? crowdOut())));
        for (const s of srcs) s.stop(end + 0.05);
        ended(src, nodes);
      }
      // applause: noise in three bands, each opened by a peaky wobble (the claps), over a wash; a
      // tennis crowd's, so the single claps stay distinct
      const CLAP_CURVE = Float32Array.from({ length: 512 }, (_, k) => {
        const x = (2 * k) / 511 - 1;
        return Math.max(0, (x - 0.2) / 0.8) ** 2.4 * 3.4;
      });
      function applause(t, dur, vol, o = {}) {
        const ac = v.ac,
          env = gain(ac, 0),
          nodes = [env],
          srcs = [];
        for (const [hz, f, q, lv] of [
          [26, 1250, 0.9, 1],
          [52, 2200, 0.9, 0.85],
          [90, 3500, 1, 0.6],
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
        // the far stand: a soft wash of it
        const ws = noiseAt(t),
          wb = filter(ac, 'bandpass', 1900, 0.6),
          wg = gain(ac, 0.08);
        ws.connect(wb).connect(wg).connect(env);
        srcs.push(ws);
        nodes.push(ws, wb, wg);
        const a = o.attack ?? 0.25,
          release = o.release ?? dur * 0.45,
          end = t + dur + release,
          p = env.gain;
        p.value = 0;
        p.setValueAtTime(0, t);
        p.linearRampToValueAtTime(vol, t + a);
        p.setTargetAtTime(vol * 0.7, t + a, 0.5);
        p.setTargetAtTime(0, t + dur, release / 4);
        env.connect(target(placed(o.pan ?? 0, crowdOut())));
        for (const s of srcs) s.stop(end + 0.05);
        ended(srcs[0], nodes);
      }
      // fans whistling their approval: two fingers, a rising sweep, staggered
      const whistles = (t, vol, n = 3) => {
        for (let k = 0; k < n; k++) {
          const f = rand(2200, 3000),
            when = t + rand(0, 0.8),
            d = rand(0.35, 0.8);
          tone(f * 0.8, f * rand(1.05, 1.15), when, d, vol * rand(0.5, 1), 'sine', placed(rand(-0.6, 0.6), crowdOut()), 0.05);
        }
      };
      // single voices calling out: a 'whoo' or two, rising
      const whoops = (t, vol, n = 2) => {
        for (let k = 0; k < n; k++)
          choir(t + rand(0, 0.6), {
            notes: [[0, 0], [0.12, 7], [0.45, 10]],
            dur: rand(0.4, 0.7),
            vol: vol * rand(0.6, 1),
            base: rand(260, 340),
            n: 2,
            spread: 0.6,
            vowel: [[0, 'oo'], [0.3, 'oh']],
            attack: 0.05,
            sustain: 0.85,
            release: 0.25,
            breath: 0.2,
            pan: rand(-0.6, 0.6),
          });
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
        // a ball on the line, mid-rally: a quick breath drawn in
        gasp(t, g) {
          if (limited('gasp', t, 0.8)) return;
          crowdNoise(t, 0.16, 0.22 * g, { vowel: 'ah', attack: 0.04, sustain: 0.5, decay: 0.2, release: 0.35, flutter: [10, 0.3] });
          choir(t, { notes: [[0, 2], [0.12, 5]], dur: 0.2, vol: 0.1 * g, base: 210, n: 6, spread: 3, vowel: 'ah', attack: 0.04, sustain: 0.6, release: 0.3, breath: 0.9 });
        },
        // a net cord, a close call: the 'ooh' rising and falling away
        ooh(t, g) {
          if (limited('ooh', t, 1.4)) return;
          choir(t, { notes: [[0, -2], [0.25, 5], [0.7, 3], [1.2, -3]], dur: 1.2, vol: 0.42 * g, base: 190, n: 7, spread: 2.5, vowel: [[0, 'oo'], [0.8, 'aw']], attack: 0.2, sustain: 0.85, release: 0.6 });
          crowdNoise(t, 1.1, 0.24 * g, { vowel: [[0, 'oo'], [0.8, 'aw']], attack: 0.25, sustain: 0.8, release: 0.7, flutter: [7, 0.3] });
        },
        // disappointment: a falling 'aww'
        groan(t, g) {
          if (limited('groan', t, 1.5)) return;
          choir(t, { notes: [[0, 4], [0.15, 5], [1, -4]], dur: 1.1, vol: 0.36 * g, base: 170, n: 7, spread: 2.5, vowel: 'aw', attack: 0.12, sustain: 0.8, release: 0.6 });
          crowdNoise(t, 1, 0.2 * g, { vowel: 'aw', attack: 0.12, release: 0.6, flutter: [6, 0.3] });
        },
        // the stands on their feet: a rising 'yeah', the cheering over the claps
        cheer(t, g, dur = 2.6) {
          if (limited('cheer', t, 1.2)) return;
          crowdNoise(t, dur, 0.55 * g, { vowel: [[0, 'eh'], [0.3, 'ah'], [dur * 0.6, 'aw']], attack: 0.15, decay: 1, sustain: 0.6, release: 1.6, flutter: [6, 0.25] });
          choir(t, { notes: [[0, -5], [0.2, 7], [1.2, 5], [dur, 2]], dur, vol: 0.4 * g, base: 215, n: 8, spread: 3, vowel: [[0, 'eh'], [0.3, 'ah']], attack: 0.12, sustain: 0.6, release: 1.2 });
          whistles(t + 0.2, 0.018 * g, Math.round(2 + 3 * g));
          whoops(t + 0.3, 0.12 * g, Math.round(1 + 2 * g));
        },
      };
      // the applause a point earns: g 0…1+; the talk comes back once it's dying away
      function clapFor(t, g, dur) {
        applause(t, dur, 0.34 * g);
        st.murmurAt = Math.max(st.murmurAt, t + dur * 0.8);
      }

      // ---------- the court ----------
      const thud = (f, t, dur, vol, out, o = {}) =>
        sub(f, t, dur, vol, { punch: 6, drop: 0.02, drive: 0.3, tone: 1000, attack: 0.001, decay: dur, sustain: 0, release: 0.03, bus: out, ...o });
      // the pock: the strings' pitched 'pong', the felt's click, the hollow ball's thump. kind sets
      // the colour, power the weight, quality the timing (a mishit off the frame clanks)
      const SHOTS = {
        //        pitch  dur   vol   click  bright brush  thump
        drive: [580, 0.05, 0.3, 0.3, 4200, 0, 0.16],
        slice: [460, 0.045, 0.26, 0.08, 1500, 0.05, 0.16],
        lob: [500, 0.05, 0.2, 0.08, 2000, 0, 0.1],
        drop: [440, 0.035, 0.15, 0.05, 1500, 0.03, 0.08],
        volley: [600, 0.028, 0.27, 0.2, 2800, 0, 0.22],
        smash: [700, 0.045, 0.36, 0.36, 4600, 0, 0.24],
        serve: [640, 0.055, 0.36, 0.3, 4000, 0, 0.22],
      };
      const court = {
        hit(t, e, s) {
          const p = clamp01(num(e.power, 0.6)),
            q = clamp01(num(e.quality, 0.7)),
            kind = SHOTS[e.kind] ? e.kind : 'drive',
            [f, dur, vol0, click, bright, brush, thumpV] = SHOTS[kind],
            pl = s?.players?.[e.player],
            b = s?.ball,
            { out, g } = at(b?.x ?? pl?.x, b?.z ?? pl?.z);
          if (limited('hit', t, 0.05)) return;
          const w = g * (0.55 + 0.6 * p),
            pitch = f * (0.92 + 0.2 * p) * rand(0.97, 1.03);
          if (q < 0.22 || e.frame) {
            // off the frame: a dull tonk with a metallic ring, no string 'pong'
            v.fm(pitch * 1.7, t, 0.12, 0.09 * w, { ratio: 2.76, index: 4, modDecay: 0.03, modSustain: 0.1, attack: 0.0005, decay: 0.12, sustain: 0, release: 0.05, bus: out });
            tone(pitch * 0.55, pitch * 0.45, t, 0.04, 0.16 * w, 'triangle', out, 0.0005);
            hiss(t, 0.02, 0.18 * w, 5000, 2500, 'bandpass', out, 1.6, 0.0004);
            thud(150, t, 0.05, 0.12 * w, out, { punch: 4, tone: 700 });
            return;
          }
          // a well-timed one rings truer and a touch brighter
          const sweet = 0.75 + 0.35 * q;
          tone(pitch, pitch * 0.82, t, dur * (0.8 + 0.4 * q), vol0 * w * sweet, 'sine', out, 0.0006);
          tone(pitch * 2.02, pitch * 1.7, t, dur * 0.5, vol0 * 0.25 * w, 'triangle', out, 0.0005);
          hiss(t, 0.012, click * w, bright * (0.8 + 0.4 * p), bright * 0.5, 'bandpass', out, 1.1, 0.0003);
          thud(kind === 'smash' ? 120 : 140, t, 0.05, thumpV * w, out, { punch: 5, tone: 900 });
          if (brush) hiss(t + 0.004, 0.09, brush * w, 2400, 900, 'bandpass', out, 1.2, 0.008); // strings brushed under it
          if (kind === 'smash' || kind === 'serve') {
            // the crack: the racket's full weight through it, the ball tearing away
            hiss(t, 0.02, (kind === 'smash' ? 0.2 : 0.14) * w * p, 7500, 4000, 'highpass', out, 0.7, 0.0003);
            if (p > 0.4) hiss(t + 0.02, 0.22, 0.04 * w * p, 1300, 3600, 'bandpass', out, 2, 0.04);
          }
          // the strings' faint ring
          tone(1850 * (0.95 + 0.1 * p), 1800, t, 0.07, 0.012 * w * q, 'sine', out, 0.0008);
        },
        // the racket cutting the air: rising into the contact, falling away after
        swing(t, e, s) {
          const pl = s?.players?.[e.player],
            { out, g } = at(pl?.x, pl?.z),
            mv = String(e.move ?? ''),
            big = /smash|serve/.test(mv) ? 1.5 : /drop|bounce|lunge/.test(mv) ? 0.5 : 1;
          if (/^(ready|split|run|shuffle|backpedal|walk|celebrate|dejected|bow|bounceBall)$/.test(mv)) return;
          if (limited('swing' + e.player, t, 0.25)) return;
          hiss(t + 0.08, 0.26, 0.035 * big * g, 500, 2600, 'bandpass', out, 1.8, 0.16);
        },
        bounce(t, e, s) {
          const b = s?.ball,
            sp = Math.hypot(num(b?.vx), num(b?.vy), num(b?.vz)),
            speed = num(e.speed, sp || 12),
            surf = SURFACES.includes(e.surface) ? e.surface : st.surface,
            { out, g: near } = at(e.x ?? b?.x, e.z ?? b?.z);
          if (speed < 0.6) return;
          const g = clamp01(speed / 28) ** 0.7 * near;
          if (limited('bounce', t, 0.04, g)) return;
          if (surf === 'clay') {
            // a dull thud, the grit of the clay under it
            thud(92, t, 0.08, 0.32 * g, out, { punch: 3, tone: 450 });
            hiss(t, 0.05, 0.14 * g, 700, 250, 'lowpass', out, 0.7, 0.001);
            hiss(t + 0.004, 0.07, 0.022 * g, 2200, 1200, 'bandpass', out, 0.9, 0.004);
          } else if (surf === 'grass') {
            // soft: the turf takes it
            thud(95, t, 0.06, 0.24 * g, out, { punch: 3, tone: 500 });
            hiss(t, 0.04, 0.08 * g, 650, 250, 'lowpass', out, 0.7, 0.001);
            hiss(t, 0.05, 0.02 * g, 2400, 1500, 'bandpass', out, 1, 0.003);
          } else {
            // hard and indoor: a bright, hollow pong off the acrylic (the hall gives it the echo)
            tone(440 * rand(0.97, 1.03), 310, t, 0.05, 0.2 * g, 'sine', out, 0.0006);
            tone(1250, 1100, t, 0.02, 0.05 * g, 'triangle', out, 0.0004);
            thud(135, t, 0.045, 0.18 * g, out, { punch: 5, tone: 1300 });
            hiss(t, 0.014, 0.18 * g, 3400, 1800, 'bandpass', out, 1.1, 0.0004);
          }
        },
        net(t, e, s) {
          const b = s?.ball,
            { out, g } = at(b?.x, 0);
          if (e.cord) {
            // the tape: a tick and the cable's short thrum
            if (limited('cord', t, 0.2)) return;
            hiss(t, 0.008, 0.2 * g, 5200, 3200, 'bandpass', out, 1.4, 0.0003);
            tone(920, 860, t, 0.03, 0.08 * g, 'triangle', out, 0.0004);
            v.fm(96, t, 0.35, 0.06 * g, { ratio: 3.01, index: 2, modDecay: 0.05, modSustain: 0.1, attack: 0.001, decay: 0.35, sustain: 0, release: 0.1, bus: out });
            return;
          }
          // into the mesh: a soft thump, the netting's rustle and rattle
          if (limited('net', t, 0.3)) return;
          thud(85, t, 0.1, 0.2 * g, out, { punch: 3, tone: 500 });
          hiss(t, 0.28, 0.12 * g, 2400, 700, 'bandpass', out, 0.8, 0.006);
          for (let k = 0; k < 5; k++) hiss(t + 0.03 + k * 0.04 + Math.random() * 0.02, 0.025, 0.05 * g * (1 - k / 6), 1900, 1500, 'bandpass', out, 3, 0.001);
        },
        // a footfall: squeaks on hard and indoor (more on a turn or a stop), scuffs on clay, a
        // muffled tread on grass
        step(t, e, s) {
          const i = num(e.player, -1),
            pl = s?.players?.[i];
          if (!pl) return;
          const { out, g } = at(pl.x, pl.z),
            vx = num(pl.vx),
            vz = num(pl.vz),
            sp = Math.hypot(vx, vz),
            prev = st.feet[i] ?? { vx, vz, t: -1 },
            dv = Math.hypot(vx - prev.vx, vz - prev.vz);
          st.feet[i] = { vx, vz, t };
          if (t - prev.t < 0.09) return;
          const effort = clamp01(sp / 6),
            turn = clamp01((dv - 0.8) / 3.5),
            surf = st.surface;
          if (surf === 'clay') {
            const slide = turn > 0.35;
            hiss(t, slide ? 0.24 : 0.07, (0.06 + 0.07 * effort + 0.05 * turn) * g, 2000, slide ? 700 : 1000, 'bandpass', out, 1.6, slide ? 0.02 : 0.004);
            for (let k = 0; k < (slide ? 4 : 2); k++) hiss(t + Math.random() * (slide ? 0.2 : 0.05), 0.006, 0.014 * g, 3600, 3000, 'bandpass', out, 3, 0.0005);
          } else if (surf === 'grass') {
            thud(75, t, 0.05, (0.04 + 0.04 * effort) * g, out, { punch: 2, tone: 300 });
            hiss(t, 0.04, 0.015 * g, 600, 250, 'lowpass', out, 0.7, 0.002);
          } else {
            thud(90, t, 0.04, (0.04 + 0.05 * effort) * g, out, { punch: 3, tone: 600 });
            hiss(t, 0.02, 0.025 * g, 1400, 700, 'bandpass', out, 1, 0.001);
            if (Math.random() < 0.06 + 0.25 * effort * 0.5 + 0.7 * turn) squeak(t + 0.01, (0.025 + 0.035 * turn) * g, out, turn);
          }
        },
      };
      // rubber on acrylic: a stick-slip chirp, buzzed by its own judder
      function squeak(t, vol, out, turn) {
        const ac = v.ac,
          f = rand(1700, 2600),
          dur = 0.05 + 0.1 * turn + Math.random() * 0.04,
          o = ac.createOscillator(),
          lfo = ac.createOscillator(),
          lg = gain(ac, f * 0.06),
          bp = filter(ac, 'bandpass', f * 1.4, 2.5),
          env = gain(ac, 0);
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, t);
        o.frequency.linearRampToValueAtTime(f * rand(0.85, 1.25), t + dur);
        lfo.frequency.value = rand(35, 70);
        lfo.connect(lg).connect(o.frequency);
        o.connect(bp).connect(env).connect(target(out));
        const p = env.gain;
        p.value = 0;
        p.setValueAtTime(0, t);
        p.linearRampToValueAtTime(vol, t + 0.008);
        p.setTargetAtTime(vol * 0.6, t + 0.008, dur / 3);
        p.setTargetAtTime(0, t + dur, 0.01);
        o.start(t);
        lfo.start(t);
        o.stop(t + dur + 0.08);
        lfo.stop(t + dur + 0.08);
        ended(o, [o, lfo, lg, bp, env]);
      }

      // ---------- the chair: calls as tones ----------
      const beep = (f, t, d, vol, out = air()) => {
        tone(f, f, t, d, vol, 'sine', out, 0.004);
        tone(f * 2, f * 2, t, d * 0.8, vol * 0.18, 'triangle', out, 0.004);
      };
      const chime = (list, t, vol, gap = 0.16) =>
        list.forEach((n, k) => bellVoice(midi(n), t + k * gap, k === list.length - 1 ? 1.4 : 0.7, vol, air()));
      const calls = {
        // the service line's electronic beep
        fault(t) {
          if (!limited('call', t, 0.35)) beep(1480, t, 0.2, 0.07);
        },
        double(t) {
          if (limited('call', t, 0.35)) return;
          beep(1480, t, 0.14, 0.065);
          beep(990, t + 0.2, 0.26, 0.065);
        },
        // the line judge: two tones, down
        out(t) {
          if (limited('call', t, 0.35)) return;
          [76, 69].forEach((n, k) => v.pulse(midi(n), t + k * 0.12, 0.1, 0.075, { width: 0.35, pwm: 0, cutoff: 2200, envmod: 800, attack: 0.003, decay: 0.08, sustain: 0.7, release: 0.05, bus: air() }));
        },
        // the net sensor: three quick ticks
        let(t) {
          if (limited('call', t, 0.35)) return;
          for (let k = 0; k < 3; k++) beep(2090, t + k * 0.07, 0.035, 0.065);
        },
        game: t => chime([79, 86], t, 0.06),
        set: t => chime([79, 83, 86], t, 0.065),
        match: t => chime([79, 83, 86, 91], t, 0.07, 0.14),
      };

      // ---------- the match ----------
      // how near a bounce is to a line it can be judged on (m); serves by the service box
      function lineGap(x, z, serve) {
        const ax = Math.abs(num(x, 99)),
          az = Math.abs(num(z, 99));
        if (serve) return Math.min(Math.abs(ax - SIDE), Math.abs(az - SERVICE), ax);
        return Math.min(Math.abs(ax - SIDE), Math.abs(az - BASE));
      }
      const humanSide = s => {
        const p = s?.players;
        if (!Array.isArray(p)) return -1;
        return p.findIndex(q => q?.human) ?? -1;
      };
      const crowdOn = () => st.level > 0;

      function play(e, s, t) {
        const L = st.level;
        switch (e.type) {
          case 'hit':
            court.hit(t, e, s);
            st.rally++;
            st.lastHit = e.kind ?? '';
            st.lastHitAt = t;
            break;
          case 'swing':
            court.swing(t, e, s);
            break;
          case 'bounce': {
            court.bounce(t, e, s);
            if (!crowdOn() || s?.phase === 'point' || (s?.phase === 'serve' && st.lastHit !== 'serve')) break;
            const gap = lineGap(e.x ?? s?.ball?.x, e.z ?? s?.ball?.z, st.lastHit === 'serve');
            // only the first bounce after a hit is judged
            if (num(s?.ball?.bounces, 1) > 1) break;
            if (e.in !== false && gap < 0.12) react.gasp(t + 0.05, L);
            else if (e.in === false && gap < 0.3) react.ooh(t + 0.25, 0.8 * L);
            break;
          }
          case 'net':
            court.net(t, e, s);
            if (e.cord && crowdOn()) react.ooh(t + 0.1, L);
            break;
          case 'let':
            calls.let(t + 0.05);
            break;
          case 'fault': {
            const second = num(e.serveNo, s?.score?.serveNo ?? 1) >= 2;
            if (second) calls.double(t + 0.05);
            else calls.fault(t + 0.05);
            if (!crowdOn()) break;
            if (second) react.groan(t + 0.3, L);
            else if (lineGap(s?.bounce?.x, s?.bounce?.z, true) < 0.25) react.ooh(t + 0.2, 0.6 * L);
            break;
          }
          case 'out':
            calls.out(t + 0.05);
            break;
          case 'point': {
            const rally = st.rally;
            st.rally = 0;
            if (!crowdOn()) break;
            const how = e.how,
              human = humanSide(s),
              w = num(e.winner, -1);
            if (how === 'double') {
              react.groan(t + 0.2, L);
              break;
            }
            let g = how === 'ace' || how === 'winner' ? 1 : how === 'error' ? 0.55 : 0.6;
            g *= 1 + 0.6 * smooth((rally - 4) / 14); // a long rally earns more
            if (human >= 0) g *= w === human ? 1.3 : 0.7;
            g = Math.min(g, 1.6);
            const big = g > 1.1;
            clapFor(t + (how === 'ace' ? 0.45 : 0.2), g * L, 2 + 1.5 * clamp01(g - 0.5));
            if (how === 'ace') react.ooh(t + 0.05, 0.7 * L);
            if (big) {
              whistles(t + 0.4, 0.014 * L, 2);
              if (g > 1.35) whoops(t + 0.5, 0.1 * L, 1);
            }
            break;
          }
          case 'game':
            calls.game(t + 0.5);
            break;
          case 'set': {
            calls.set(t + 0.5);
            if (!crowdOn()) break;
            const human = humanSide(s),
              g = human < 0 ? 0.8 : num(e.winner, -1) === human ? 1 : 0.55;
            react.cheer(t + 0.3, g * 0.8 * L, 2);
            clapFor(t + 0.5, g * 1.1 * L, 4);
            break;
          }
          case 'match': {
            calls.match(t + 0.6);
            if (!crowdOn()) break;
            // the ovation: on their feet for the champion
            const human = humanSide(s),
              g = human < 0 ? 1 : num(e.winner, -1) === human ? 1.15 : 0.7;
            react.cheer(t + 0.2, g * L, 4);
            clapFor(t + 0.4, g * 1.25 * L, 9);
            whistles(t + 1.5, 0.02 * L, 4);
            break;
          }
          case 'change':
            st.murmurAt = Math.min(st.murmurAt, t + 1);
            break;
          case 'serve':
            st.hushAt = t; // the toss: not a sound
            st.rally = 0;
            st.lastHit = '';
            break;
          case 'step':
            court.step(t, e, s);
            break;
          default:
        }
      }

      // ---------- the crowd's murmur ----------
      // two sides babbling, a low hubbub, one fader; a slow swell moves through it
      const bank = v.loop(ac => {
        const t = ac.currentTime,
          out = gain(ac, 0),
          srcs = [];
        out.connect(target(crowdOut()));
        const swell = gain(ac, 0.8),
          sw = wobble(t, 0.15),
          swD = gain(ac, 0.25);
        sw.out.connect(swD).connect(swell.gain);
        swell.connect(out);
        srcs.push(sw.src);
        for (const [side, f1, f2] of [
          [-0.55, 420, 1150],
          [0.55, 480, 1300],
        ]) {
          const s = noiseAt(t),
            b1 = filter(ac, 'bandpass', f1, 1.2),
            b2 = filter(ac, 'bandpass', f2, 1.5),
            g2 = gain(ac, 0.55),
            babble = gain(ac, 0.6),
            w = wobble(t, rand(6, 8)),
            wd = gain(ac, 0.4),
            pan = ac.createStereoPanner();
          pan.pan.value = side;
          s.connect(b1).connect(babble);
          s.connect(b2).connect(g2).connect(babble);
          w.out.connect(wd).connect(babble.gain);
          babble.connect(pan).connect(swell);
          srcs.push(s, w.src);
        }
        const rs = noiseAt(t),
          rlp = filter(ac, 'lowpass', 200, 0.7),
          rumble = gain(ac, 0.35);
        rs.connect(rlp).connect(rumble).connect(swell);
        srcs.push(rs);
        return {
          out,
          ac,
          stop() {
            const now = ac.currentTime;
            out.gain.cancelScheduledValues(now);
            out.gain.setTargetAtTime(0, now, 0.25);
            for (const s of srcs) s.stop(now + 1.5);
            srcs[0].onended = () => out.disconnect();
          },
        };
      });
      // where the murmur goes for the phase: silent through the rally, hushed for the serve
      function feel(s, now) {
        const phase = s?.phase,
          server = s?.players?.[s?.server];
        const ready = server?.move === 'bounceBall' || server?.move === 'serve' || now - st.hushAt < 6;
        if (phase === 'rally') return [0, 0.12];
        if (phase === 'serve') return ready ? [0.01, 0.25] : [0.22, 1];
        if (phase === 'point') return now < st.murmurAt ? [0.05, 0.6] : [0.3, 1.2];
        if (phase === 'change') return [0.42, 1.5];
        if (phase === 'over') return [0.32, 1.5];
        return [0.25, 1];
      }
      function bed(s, now, force) {
        if (st.level <= 0) return bank.off();
        const b = bank.on();
        if (!b) return;
        const phase = s?.phase ?? '';
        if (!force && phase === st.phase && now - st.bedAt < 0.1) return;
        if (phase === 'serve' && st.phase !== 'serve') st.hushAt = -Infinity;
        st.phase = phase;
        st.bedAt = now;
        const [lv, tc] = feel(s, now);
        b.out.gain.setTargetAtTime(lv * 1.4 * st.level, now, tc);
      }

      function matchStep(list, s, on) {
        if (!v.ac || !on) return;
        const now = v.ac.currentTime + 0.005;
        if (typeof s?.surface === 'string' && SURFACES.includes(s.surface)) st.surface = s.surface;
        if (Array.isArray(list))
          for (const e of list)
            if (e && typeof e.type === 'string') {
              if (e.type === 'bounce' && SURFACES.includes(e.surface)) st.surface = e.surface;
              play(e, s, now);
            }
        if (s && typeof s === 'object') bed(s, now, false);
      }

      // ---------- the menus ----------
      const blip = (f0, f1, t, vol, d = 0.045) => {
        tone(f0, f1, t, d, vol, 0.25, 'sfx', 0.002);
        tone(f0 * 2, f1 * 2, t, d * 0.7, vol * 0.25, 'sine', 'sfx', 0.002);
      };
      const effects = {
        // a light pock of a blip
        'ui:move': t => {
          tone(1180, 980, t, 0.03, 0.15, 'triangle', 'sfx', 0.0008);
          hiss(t, 0.008, 0.05, 3200, 2000, 'bandpass', 'sfx', 1.2, 0.0004);
        },
        'ui:select': t => {
          blip(784, 784, t, 0.14);
          blip(1175, 1175, t + 0.06, 0.15, 0.08);
        },
        'ui:back': t => {
          blip(1175, 1175, t, 0.14);
          blip(784, 784, t + 0.06, 0.14, 0.08);
        },
        'ui:error': t => {
          for (let k = 0; k < 2; k++)
            v.pulse(147, t + k * 0.11, 0.07, 0.13, { width: 0.2, pwm: 0, cutoff: 1200, envmod: 600, attack: 0.003, decay: 0.07, sustain: 0.8, release: 0.03, bus: 'sfx' });
        },
        // prize money: coins on the counter, two bells
        'ui:coin': t => {
          for (let k = 0; k < 3; k++) hiss(t + k * 0.05, 0.03, 0.06, 9000, 7000, 'bandpass', 'sfx', 4, 0.001);
          bellVoice(midi(88), t + 0.05, 0.4, 0.08, 'sfx');
          bellVoice(midi(95), t + 0.13, 0.8, 0.08, 'sfx');
        },
        // a trophy lifted: the stands up, bells on top
        'ui:cheer': t => {
          react.cheer(t, 0.8, 2.5);
          applause(t + 0.4, 3.5, 0.28);
          [86, 91, 95, 98].forEach((n, k) => bellVoice(midi(n), t + 0.1 + k * 0.09, k === 3 ? 1.2 : 0.5, 0.06, 'sfx'));
        },
      };

      return {
        step,
        effects,
        methods: {
          matchStep,
          bedLevel(level, on) {
            st.level = clamp01(level);
            if (!on || st.level <= 0) {
              bank.off();
              return;
            }
            // only a match's state builds the murmur; a level change re-aims a live one
            if (v.ac && bank.live) bed({ phase: st.phase }, v.ac.currentTime, true);
          },
          bedOff() {
            bank.off();
          },
          setSurface(name) {
            if (SURFACES.includes(name) && name !== st.surface) {
              const was = indoor();
              st.surface = name;
              if (was !== indoor()) bank.off(); // the murmur moves to the new room's echo
            }
          },
        },
      };
    },
  });

  let level = 1;
  return {
    unlock() {
      synth.unlock();
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
      // no music in play
      if (s?.phase === 'serve' || s?.phase === 'rally') synth.music(null);
      synth.matchStep(events, s, synth.on);
    },
    crowd(l) {
      level = clamp01(l);
      synth.bedLevel(level, synth.on);
    },
    surface(name) {
      synth.setSurface(name);
    },
    ui(name) {
      synth.sfx('ui:' + name);
    },
    music(track) {
      const name = track && TRACKS[track] ? track : null;
      // the menus' music: the court's murmur goes
      if (name) synth.bedOff();
      synth.music(name);
    },
  };
}
