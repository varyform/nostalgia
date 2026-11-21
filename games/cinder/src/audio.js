// Cinder's sound, made in code on @nostalgia/audio, all original: a breathy bamboo-like flute
// (a soft wave with a scoop into each note, delayed vibrato and breath noise), a plucked
// koto-like string, a mouth-organ pad, a low drone and taiko-like drums (sub-heavy dons, rim
// clicks, ash-dry shakers), through two mountain echoes. The context is only made by unlock(),
// which the page calls from a user gesture; the demo never makes one.
//
//   const audio = createAudio({ on: true });
//   audio.unlock(); audio.music('path'); audio.sfx('hit', { h: 'high', move: 'kickHigh', pan: -0.3 });
//
// Tracks (16th steps, one chord a bar, the second half of each tune fuller than the first):
//   title   "Lantern at Dusk"     D minor,  66 bpm, 16 bars: slow, wistful flute over koto and pad
//   path    "Switchback Path"     A, open fifths, 96 bpm, 16 bars: a walking koto, the flute above
//   keep    "Inside the Keep"     E (in scale), 76 bpm, 16 bars: low flute, a heartbeat, far bells
//   duel    "Crossed Shadows"     D phrygian, 126 bpm, 16 bars: a koto ostinato and taiko, the flute later
//   regent  "The Ash Regent"      C phrygian, 150 bpm, 16 bars (an 8-bar lead twice, doubled the
//                                 second time): a burnt drone, heavy drums, a fast lead
//   dawn    "First Light"         F major,  80 bpm, 16 bars: warm, resolving, the koto flowing
// Jingles: clear, die, over, win, as music(name) (the track stops) or sfx(name) (the track waits
// under it, then goes on); the same jingle twice within a moment plays once.
//
// Effects take the event as opts (sfx(e.k, e)); opts.pan (-1…1) places a positional one. Names:
// the sim's events (intro stance step swing hit block ko fall bow foe regen gateShake gateSlam crush
// draw dart dartHit dartBlock clear die life win over), the menus' move pick back, and pause.
import { adsr, compressor, createSynth, delay, distortion, limiter, line, midi, span } from '@nostalgia/audio';
import { isKick, MOVES } from './moves.js';

// chord tones for the koto (index 0…5 in an arp line), and the pad's three
const ARP = {
  5: [0, 7, 12, 19, 24, 14],
  m: [0, 7, 12, 15, 19, 24],
  M: [0, 7, 12, 16, 19, 24],
  p: [0, 7, 12, 13, 15, 19], // phrygian: the flat second against the root
  s: [0, 7, 12, 14, 17, 19],
};
const PAD = { 5: [0, 7, 12], m: [0, 7, 15], M: [0, 7, 16], p: [0, 7, 12], s: [0, 7, 14] };
// '45.' is an open fifth on A, '38m' D minor: a root's note number and the chord
const bars = s => s.trim().split(/\s+/).map(b => [+b.slice(0, -1), b.at(-1) === '.' ? '5' : b.at(-1)]);

// lead: note numbers, '.' rest, '-' hold. arp: a digit plucks that chord tone. drums: O a big
// don, o a small one, x a rim click, r a two-stroke roll. ash: n a dry shaker. bass: x the root.
// gain: the track's level after the music compressor (the synth glides to it).
const TRACKS = {
  title: {
    bpm: 66, gain: 1.6,
    bars: bars('38m 34M 41M 36M 38m 43m 34M 45M 38m 34M 41M 36M 38m 43m 34M 45M'),
    lead: line(`69 - - - - - 74 - 72 - 69 - - - 67 -   65 - - - - - - - 62 - 65 - 67 - - -
                69 - - - - - 72 - 74 - - - 77 - 76 -   74 - - - 72 - - - 67 - - - - - . .
                69 - - - - - 74 - 76 - 77 - - - 76 74   74 - - - - - 70 - 69 - 67 - - - 65 -
                67 - - - 65 - - - 62 - - - 65 - 67 -   69 - - - - - - - 64 - - - 61 - . .
                81 - - - - - 79 - 77 - 76 - - - 74 -   77 - - - - - 74 - 70 - - - 72 - 74 -
                72 - - - 69 - - - 72 - 77 - 81 - 79 -   79 - - - - - - - 76 - 72 - - - . .
                74 - - - 77 - - - 81 - - - 79 - 77 -   79 - - - - - 74 - 70 - - - 67 - 69 -
                70 - - - - - 69 - 67 - 65 - - - 64 -   64 - - - - - 61 - 62 - - - - - . .`),
    arp: '0..1..2...3..2..', drums: 'O...............................', ash: '', bass: 'x...............',
  },
  path: {
    bpm: 96, gain: 1.6,
    bars: bars('45. 45. 43. 45. 50. 52. 45. 45. 42m 50. 43. 45. 50. 52. 45. 45.'),
    lead: line(`76 - - - 74 - 76 - 81 - - - 79 - 76 -   74 - - - - - 71 - 69 - - - - - . .
                71 - - - 74 - - - 79 - 78 - 76 - 74 -   76 - - - - - - - - - - - . . . .
                78 - - - 81 - - - 83 - 81 - 78 - 76 -   79 - - - 76 - - - 74 - 71 - - - 74 -
                76 - - - - - 74 - 71 - 69 - - - - -   . . . . . . . . 69 - 71 - 74 - 76 -
                78 - - - 76 - 78 - 81 - - - 83 - 81 -   78 - - - - - 74 - 76 - - - 78 - 79 -
                79 - - - - - 78 - 76 - - - 74 - 71 -   76 - - - - - - - - - - - 74 - 76 -
                81 - - - - - 78 - 76 - 74 - - - 71 -   74 - - - 76 - - - 71 - - - 69 - 71 -
                69 - - - - - - - - - - - . . . .   . . . . . . . . . . . . . . . .`),
    arp: '0.1.2.1.3.1.2.1.', drums: 'o.......o...x...', ash: '....n.......n...', bass: 'x.........x.....',
  },
  keep: {
    bpm: 76, gain: 1.65,
    bars: bars('40. 40. 41. 40. 45m 48M 47. 40. 40. 40. 41. 40. 45m 48M 47. 40.'),
    lead: line(`64 - - - - - 65 - 64 - - - 59 - - -   60 - - - - - 59 - 57 - - - - - . .
                65 - - - 69 - - - 71 - 72 - 71 - 69 -   71 - - - - - - - 64 - - - . . . .
                69 - - - 72 - - - 76 - - - 77 - 76 -   72 - - - - - 71 - 69 - - - 65 - - -
                64 - - - 65 - - - 71 - - - 69 - 65 -   64 - - - - - - - - - - - . . . .
                76 - - - - - 77 - 76 - 71 - - - 72 -   71 - - - 69 - - - 65 - - - 64 - - -
                65 - - - - - 69 - 72 - - - 77 - 76 -   76 - - - - - - - 71 - - - . . . .
                69 - - - - - 72 - 71 - 69 - 65 - - -   64 - - - - - 65 - 69 - - - 72 - 71 -
                71 - - - - - 69 - 65 - - - 64 - 65 -   64 - - - - - - - - - - - . . . .`),
    arp: '0...3...1...4...', drums: 'O..o........x...O..o.....x..x...', ash: '', bass: 'x.......x.......',
  },
  duel: {
    bpm: 126, gain: 1.65,
    bars: bars('38p 38p 38p 38p 38p 38p 39M 38p 38p 34M 36s 38p 38p 34M 36s 38p'),
    lead: line(`.  . . . . . . . . . . . . . . .   .  . . . . . . . . . . . . . . .
                .  . . . . . . . . . . . . . . .   .  . . . . . . . . . . . . . . .
                74 - - - - - - - 75 - - - 74 - - -   72 - - - - - - - 69 - - - - - - -
                74 - - - - - - - 77 - - - 75 - 74 -   75 - - - - - - - - - - - . . . .
                86 - - 84 86 - 87 - 86 - - - 81 - - -   82 - - 81 82 - 84 - 81 - - - 77 - - -
                79 - 81 - 82 - 81 - 79 - 77 - 75 - 77 -   74 - - - - - - - - - - - . . . .
                86 - - 84 86 - 87 - 89 - - - 87 - 86 -   84 - - 82 84 - 86 - 82 - - - 81 - - -
                77 - 79 - 81 - 82 - 84 - 82 - 81 - 79 -   81 - - - - - - - 75 - - - 74 - . .`),
    arp: '2123210121243210', drums: 'O..xo.O.x.o.O.x.O..xo.O.x.ooO.xr', ash: '.n.n.n.n.n.n.n.n', bass: 'x..x..x...x..x..',
  },
  regent: {
    bpm: 150, gain: 1.4,
    bars: bars('36p 36p 37M 36p 32M 37M 36p 31M 36p 36p 37M 36p 32M 37M 36p 31M'),
    lead: line(`72 - - 71 72 - 73 - 72 - - - 67 - - -   68 - - - 67 - 65 - 63 - - - 61 - 60 -
                72 - - 71 72 - 75 - 73 - - - 72 - 70 -   68 - - - - - - - 67 - - - - - . .
                79 - - - 80 - 79 - 75 - 77 - 79 - - -   80 - 79 - 77 - 75 - 73 - 72 - - - - -
                84 - - 83 84 - 85 - 84 - 80 - 79 - 77 -   79 - - - - - - - - - - - 71 - 72 -`),
    arp: '0202320102024321', drums: 'O.xOo.xOO.xOo.xrO.xOo.xOO.xOoorr', ash: 'nnnnnnnnnnnnnnnn', bass: 'x.xx..x.x.xx..x.',
  },
  dawn: {
    bpm: 80, gain: 1.6,
    bars: bars('41M 36M 38m 46M 41M 36M 46M 36M 38m 45m 46M 41M 43m 36M 41M 41M'),
    lead: line(`72 - - - 69 - 72 - 77 - - - 76 - 74 -   76 - - - - - 72 - 67 - - - - - . .
                74 - - - 77 - - - 81 - - - 79 - 77 -   77 - - - - - 74 - 70 - - - 72 - 74 -
                72 - - - 69 - 72 - 77 - - - 79 - 81 -   79 - - - - - 76 - 72 - - - 74 - 76 -
                77 - - - 76 - 74 - 72 - - - 70 - 69 -   67 - - - - - - - - - - - . . . .
                81 - - - - - 79 - 77 - - - 81 - 84 -   84 - - - 81 - - - 76 - - - 79 - 81 -
                82 - - - 81 - 79 - 77 - - - 74 - 77 -   81 - - - - - - - 77 - - - . . 76 77
                79 - - - - - 77 - 74 - - - 70 - 74 -   76 - - - 77 - 79 - 76 - - - 72 - - -
                77 - - - - - - - 72 - 76 - 79 - - -   77 - - - - - - - - - - - . . . .`),
    arp: '0.2.3.4.5.4.3.2.', drums: 'O...............................', ash: '', bass: 'x.......x.......',
  },
};

// How each tune is played: the flute's level, vibrato (cents) and breath, the koto's level and
// octave (and which half it plays in), the pad, the drone (burnt for the Regent), the kit's level
// and the echo's length in steps.
const LOOK = {
  title: { flute: 0.07, vib: 16, breath: 0.5, koto: 0.05, kotoUp: 12, pad: 0.012, cut: 700, drone: 0.08, kit: 0.5, echo: 3 },
  path: { flute: 0.065, vib: 14, breath: 0.45, koto: 0.055, kotoUp: 12, pad: 0.009, cut: 900, drone: 0.07, kit: 0.45, echo: 3 },
  keep: { flute: 0.07, vib: 18, breath: 0.6, koto: 0.05, kotoUp: 12, kotoFull: true, bells: 0.02, pad: 0.012, cut: 520, drone: 0.11, kit: 0.7, echo: 4 },
  duel: { flute: 0.06, vib: 10, breath: 0.35, koto: 0.042, kotoUp: 12, pad: 0.007, cut: 600, drone: 0.08, kit: 1, echo: 3, roll: true },
  regent: { flute: 0.055, vib: 9, breath: 0.3, koto: 0.04, kotoUp: 12, pad: 0.007, cut: 900, drone: 0.1, burn: true, kit: 1.1, echo: 2, roll: true, double: true },
  dawn: { flute: 0.068, vib: 13, breath: 0.4, koto: 0.05, kotoUp: 24, pad: 0.014, cut: 1100, drone: 0.06, bells: 0.014, kit: 0.4, echo: 3 },
};
for (const [name, tr] of Object.entries(TRACKS)) tr.look = LOOK[name];
const JINGLES = { clear: 2.2, die: 2.6, over: 4.2, win: 4.6 }; // how long each holds the music
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : 0));

export function createAudio({ on = true } = {}) {
  let lastJingle = { name: null, at: -1 };
  const synth = createSynth({
    on, seed: 1984, tracks: TRACKS, noiseLength: 2, attack: 0.004, startDelay: 0.06, lead: 0.004,
    levels: { master: 0.9, music: 0.4, sfx: 0.85 },
    // the tunes evened out against each other (each track's gain then sets it exactly), and a
    // limiter on the whole mix that only catches what would go over
    inserts: {
      music: ac => compressor(ac, { threshold: -32, ratio: 3, knee: 8, attack: 0.015, release: 0.3, makeup: 6 }),
      master: ac => limiter(ac, { ceiling: -1, release: 0.15 }),
    },
    arrange: v => {
      const { tone, hiss, fm, sub, supersaw, hold } = v;
      // the valley: a dotted-eighth echo a little left, and a longer, darker one right for the flute
      const space = v.insert(ac => delay(ac, { time: 0.34, feedback: 0.36, wet: 0.26, cut: 2400, pan: -0.25 }));
      const far = v.insert(ac => delay(ac, { time: 0.62, feedback: 0.3, wet: 0.2, cut: 1500, pan: 0.35 }), space);
      const burn = v.insert(ac => distortion(ac, { amount: 0.6, ceiling: 0.06, mix: 0.75 }), space);
      // the effects' rooms: a stone hall for booms and falls, a bright one for bells; wet only
      // (the dry sound goes straight out, panned), so a send is a second, quieter copy
      const hall = v.insert(ac => delay(ac, { time: 0.19, feedback: 0.42, wet: 0.5, dry: 0, cut: 1100, pan: 0.2 }), 'sfx');
      const ring = v.insert(ac => delay(ac, { time: 0.29, feedback: 0.4, wet: 0.5, dry: 0, cut: 3200, pan: -0.3 }), 'sfx');
      // jingles: on the sfx bus (the music waits under them), with their own echo
      const jspace = v.insert(ac => delay(ac, { time: 0.33, feedback: 0.34, wet: 0.28, cut: 2400, pan: -0.2 }), 'sfx');

      // ---------- the instruments ----------
      // the flute's wave: a strong fundamental, weak upper partials (cached per context)
      const waves = new WeakMap();
      const fluteWave = ac => {
        let w = waves.get(ac);
        if (!w) {
          const h = [0, 1, 0.3, 0.12, 0.05, 0.025], re = new Float32Array(h.length);
          w = ac.createPeriodicWave(re, Float32Array.from(h));
          waves.set(ac, w);
        }
        return w;
      };
      // where a voice of our own plays: a bus, an insert or a node, as the synth's voices take them
      const target = b => (b === 'music' ? v.bus.music : b === 'sfx' ? v.bus.sfx : 'fx' in b ? b.fx.input : b);
      const gainNode = (ac, g) => {
        const n = ac.createGain();
        n.gain.value = g;
        return n;
      };
      // a breath-blown flute: scoops up into the note, vibrato (pitch and a little level) that
      // comes in after a moment on a long note, breath noise near its second partial, and a chiff
      function flute(n, t, d, vol, bus, o = {}) {
        const ac = v.ac, f = midi(n), vib = o.vib ?? 14, breath = o.breath ?? 0.4;
        const osc = ac.createOscillator();
        osc.setPeriodicWave(fluteWave(ac));
        osc.frequency.value = f;
        osc.detune.setValueAtTime(-40, t);
        osc.detune.linearRampToValueAtTime(0, t + 0.07);
        const amp = ac.createGain(), trem = gainNode(ac, 1), out = gainNode(ac, 1);
        const end = adsr(amp.gain, t, t + d, vol, { attack: 0.05, decay: 0.4, sustain: 0.82, release: 0.14 });
        // the vibrato, rising in after the first quarter second (none on short notes)
        const lfo = ac.createOscillator(), depth = ac.createGain(), tdepth = ac.createGain();
        lfo.frequency.value = 5 + 0.6 * ((n * 0.37) % 1);
        const on = t + Math.min(0.28, d * 0.5), full = on + Math.min(0.5, d * 0.5);
        depth.gain.value = 0;
        depth.gain.setValueAtTime(0, on);
        depth.gain.linearRampToValueAtTime(d > 0.3 ? vib : 0, full);
        tdepth.gain.value = 0;
        tdepth.gain.setValueAtTime(0, on);
        tdepth.gain.linearRampToValueAtTime(d > 0.3 ? 0.08 : 0, full);
        lfo.connect(depth).connect(osc.detune);
        lfo.connect(tdepth).connect(trem.gain);
        osc.connect(amp).connect(trem).connect(out).connect(target(bus));
        // breath: noise in a band around the second partial, following the note; and a chiff
        const ns = ac.createBufferSource(), bp = ac.createBiquadFilter(), ng = ac.createGain();
        ns.buffer = v.noise;
        ns.loop = true;
        bp.type = 'bandpass';
        bp.frequency.value = Math.min(9000, f * 2.1);
        bp.Q.value = 1.6;
        adsr(ng.gain, t, t + d, vol * 0.55 * breath, { attack: 0.03, decay: 0.2, sustain: 0.45, release: 0.1 });
        ns.connect(bp).connect(ng).connect(out);
        hiss(t, 0.06, vol * 0.5 * breath, Math.min(9000, f * 4), f * 2, 'bandpass', bus, 2, 0.006);
        const stop = end + 0.05;
        osc.start(t);
        lfo.start(t);
        ns.start(t, (n * 0.137) % 1.5);
        for (const s of [osc, lfo, ns]) s.stop(stop);
        osc.onended = () => [amp, trem, out, depth, tdepth, bp, ng].forEach(x => x.disconnect());
      }
      // a plucked koto-like string: a bright FM pluck that mellows, and the plectrum's tick
      function koto(n, t, vol, bus, ringFor = 1) {
        const f = midi(n);
        fm(f, t, ringFor, vol, { ratio: 1, index: 2.8, modDecay: 0.06, modSustain: 0.1, attack: 0.002, decay: ringFor, sustain: 0, release: 0.15, bus });
        fm(f * 3.01, t, 0.12, vol * 0.18, { ratio: 1, index: 1, modDecay: 0.03, attack: 0.001, decay: 0.12, sustain: 0, release: 0.05, bus });
        hiss(t, 0.012, vol * 0.5, Math.min(9000, f * 6), f * 3, 'bandpass', bus, 3, 0.001);
      }
      // a bowl-like bell: inharmonic FM, a long ring
      const bell = (n, t, vol, bus, d = 1.4) =>
        fm(midi(n), t, d, vol, { ratio: 2.76, index: 1.4, modDecay: 0.2, modSustain: 0.2, attack: 0.002, decay: d, sustain: 0, release: 0.3, bus });
      // the drums: a taiko-like don (a punched sub with the skin's thud), a rim click, a shaker
      const don = (t, vol, f = 58, bus = 'music') => {
        sub(f, t, 0.5, vol, { punch: 9, drop: 0.05, drive: 0.35, tone: 800, attack: 0.002, decay: 0.45, sustain: 0, release: 0.12, bus });
        hiss(t, 0.08, vol * 0.22, 1100, 180, 'lowpass', bus, 0.7, 0.001);
      };
      const rim = (t, vol, bus = 'music') => {
        tone(1250, 1050, t, 0.025, vol * 0.5, 'triangle', bus, 0.0008);
        hiss(t, 0.02, vol * 0.7, 3600, 2600, 'bandpass', bus, 3, 0.0005);
      };
      const shaker = (t, vol, bus = 'music') => hiss(t, 0.035, vol, 9000, 6500, 'highpass', bus, undefined, 0.006);

      // ---------- the score ----------
      function step(tr, i, t, dt) {
        const n = tr.bars.length, bar = Math.floor(i / 16) % n, s = i % 16,
          [root, kind] = tr.bars[bar], look = tr.look, full = bar >= n / 2;
        if (s === 0) {
          space.fx?.time.setTargetAtTime(dt * look.echo, t, 0.05); // in time with the tune
          far.fx?.time.setTargetAtTime(dt * (look.echo * 2 + 1), t, 0.05);
          // the pad: a soft mouth-organ chord, swelling in and out over the bar
          for (const iv of PAD[kind])
            supersaw(midi(root + 12 + iv), t, dt * 15, look.pad * (full ? 1 : 0.7), {
              attack: dt * 5, decay: dt * 8, sustain: 0.8, release: dt * 5, cutoff: look.cut, envmod: 500,
              detune: 0.25, mix: 0.5, width: 0.9, bus: space,
            });
          // the drone: the root (and its fifth) held under the bar, burnt for the Regent
          const dv = look.drone * (full ? 1 : 0.85);
          if (look.burn) {
            supersaw(midi(root), t, dt * 15.5, dv * 0.5, { attack: 0.02, decay: dt * 6, sustain: 0.7, release: dt * 1.5, cutoff: 600, envmod: 1400, reso: 0.3, detune: 0.3, mix: 0.4, width: 0.4, bus: burn });
            sub(midi(root - 12), t, dt * 15.5, dv, { punch: 0, drive: 0.5, tone: 300, attack: 0.03, decay: 0.5, sustain: 0.9, release: dt * 1.5 });
          } else {
            sub(midi(root - 12), t, dt * 15.5, dv, { punch: 0, drive: 0.15, tone: 260, attack: dt * 3, decay: 1, sustain: 0.9, release: dt * 3 });
            if (kind === '5' || kind === 'p') sub(midi(root - 5), t, dt * 15.5, dv * 0.35, { punch: 0, drive: 0.1, tone: 400, attack: dt * 4, decay: 1, sustain: 0.9, release: dt * 3 });
          }
          if (look.bells && full && bar % 2 === 1) bell(root + 36 + ARP[kind][1], t + dt * 6, look.bells, far, 2.4);
        }
        // the flute (with a koto an octave down on its attacks for the Regent's second half)
        const note = tr.lead[i % tr.lead.length];
        if (note > 0) {
          const d = dt * span(tr.lead, i, 16) * 0.96;
          flute(note, t, d, look.flute, far, look);
          if (look.double && full) koto(note - 12, t, look.koto * 0.9, burn, 0.3);
        }
        // the koto: an arpeggio (an ostinato in the fights), in the second half only in the Keep
        const a = tr.arp[s];
        if (a && a !== '.' && (!look.kotoFull || full || s % 4 === 0)) {
          const tones = ARP[kind], accent = s % 4 === 0 ? 1 : 0.75;
          koto(root + look.kotoUp + tones[+a], t, look.koto * accent * (full ? 1 : 0.85), space, look.roll ? 0.35 : 1.1);
        }
        if (tr.bass[s] === 'x' && (look.roll || look.burn))
          sub(midi(root - 12), t, dt * 1.4, 0.13, { punch: 7, drop: 0.03, drive: look.burn ? 0.6 : 0.3, tone: 900, decay: 0.2, sustain: 0.4, release: 0.05 });
        else if (tr.bass[s] === 'x' && s)
          sub(midi(root - 12), t, dt * 6, 0.07, { punch: 2, drop: 0.04, drive: 0.1, tone: 500, attack: 0.01, decay: 0.5, sustain: 0.3, release: 0.15 });
        // the drums; a roll into the top of the tune on its last bar in the fights
        const k = look.kit, roll = look.roll && bar === n - 1 && s >= 12;
        const dr = roll ? (s % 2 ? 'o' : 'O') : tr.drums[i % tr.drums.length];
        if (dr === 'O') don(t, 0.32 * k, full || look.roll ? 56 : 60);
        if (dr === 'o') don(t, 0.2 * k, 72);
        if (dr === 'r') {
          don(t, 0.14 * k, 76);
          don(t + dt / 2, 0.16 * k, 74);
        }
        if (dr === 'x' || (full && look.roll && s % 8 === 4)) rim(t, 0.05 * k);
        if (tr.ash && tr.ash[i % tr.ash.length] === 'n' && (full || !look.burn || s % 2 === 0))
          shaker(t, (s % 4 === 1 ? 0.022 : 0.014) * k * (full ? 1 : 0.8));
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
        sub(f, t, dur, vol, { punch: 10, drop: 0.04, drive: 0.55, tone: 1400, attack: 0.001, decay: dur, sustain: 0, release: 0.05, bus: out, ...o });
      const HIGH = { high: 1.3, mid: 1, low: 0.76 }; // a strike's pitch by its height
      const kick = m => isKick(m ?? '');
      const jingle = (t, name) => hold(t + JINGLES[name]);
      let foot = 0; // footfalls take turns, so a run doesn't hammer one sound

      const effects = {
        // a scene's title: a temple bell, lower as the climb goes on, bright at dawn
        intro: (t, e) => {
          const sc = clamp(e.scene, 0, 6), n = [57, 55, 53, 52, 50, 48, 62][sc];
          fm(midi(n), t, 3, 0.07, { ratio: 1.41, index: 2.2, modDecay: 0.6, modSustain: 0.15, attack: 0.002, decay: 3, sustain: 0, release: 0.5, bus: 'sfx' });
          fm(midi(n + 12), t, 1.6, 0.025, { ratio: 2.76, index: 1, modDecay: 0.3, attack: 0.002, decay: 1.6, sustain: 0, release: 0.3, bus: ring });
          hiss(t, 0.05, 0.03, 2500, 900, 'bandpass', 'sfx', 1.5, 0.001);
        },
        // the stance switch: the sash snapping and a foot set down (heavier into guard)
        stance: (t, e, out) => {
          const guard = e.to === 'guard';
          hiss(t, 0.07, guard ? 0.05 : 0.035, guard ? 1800 : 2600, guard ? 3200 : 4200, 'bandpass', out, 1.4, 0.012);
          thud(guard ? 95 : 130, t + 0.04, 0.06, guard ? 0.08 : 0.05, out, { punch: 4, drive: 0.2, tone: 700 });
        },
        // a footfall: soft, low, never the same twice running; the foes' quieter
        step: (t, e, out) => {
          foot++;
          const r = [1, 0.92, 1.07, 0.96, 1.03][foot % 5], vol = (e.who === 'hero' ? 1 : 0.7) * (foot % 2 ? 0.8 : 1);
          thud(82 * r, t, 0.05, 0.075 * vol, out, { punch: 5, drop: 0.02, drive: 0.15, tone: 380 });
          hiss(t, 0.045, 0.05 * vol, 1600 * r, 500, 'bandpass', out, 0.8, 0.002); // the scuff
          if (foot % 3 === 0) hiss(t + 0.02, 0.03, 0.008 * vol, 5200 * r, 3800, 'bandpass', out, 2, 0.004); // grit underfoot
        },
        // a strike thrown: a short swish for a punch, a deeper whoosh for a kick, and the
        // Regent's palm a slow, heavy rush
        swing: (t, e, out) => {
          const m = e.move ?? '', h = HIGH[/High/.test(m) ? 'high' : /Low/.test(m) ? 'low' : 'mid'];
          if (m === 'palm') {
            hiss(t, 0.4, 0.28, 400, 2200, 'bandpass', out, 1.2, 0.25);
            tone(70, 110, t, 0.4, 0.04, 'sine', out, 0.2);
          } else if (MOVES[m]?.fx) {
            // a special: a long whoosh round the turn, rising into the blow
            const on = MOVES[m].on;
            hiss(t, on + 0.1, 0.4, 350 * h, 2400 * h, 'bandpass', out, 1.2, on * 0.8);
            hiss(t + on - 0.06, 0.16, 0.5, 900 * h, 3800 * h, 'bandpass', out, 1.4, 0.04);
          } else if (kick(m)) hiss(t, 0.2, 0.55, 500 * h, 2600 * h, 'bandpass', out, 1.3, 0.07);
          else hiss(t, 0.09, 0.4, 1500 * h, 3600 * h, 'bandpass', out, 1.1, 0.025);
        },
        // a strike landing: a thud pitched by its height (a kick's lower and heavier), and a crack
        hit: (t, e, out) => {
          const h = HIGH[e.h] ?? 1, k = kick(e.move), palm = e.move === 'palm', hero = e.who === 'hero';
          const f = (k ? 82 : 112) * h * (hero ? 0.92 : 1) * (palm ? 0.6 : 1);
          thud(f, t, k || palm ? 0.2 : 0.11, k || palm ? 0.36 : 0.28, out, { punch: k ? 12 : 9, drop: k ? 0.05 : 0.03 });
          hiss(t, 0.04, k ? 0.16 : 0.12, 4200 * h, 1600, 'bandpass', out, 0.9, 0.0008);
          hiss(t, 0.12, 0.05, 1400, 250, 'lowpass', out, 0.7, 0.002); // the body
          if (e.fx) thud(f * 0.55, t + 0.02, 0.3, 0.3, out, { punch: 14, drop: 0.1, drive: 0.6 }); // a finisher's weight
          if (palm) {
            thud(48, t, 0.4, 0.3, out, { punch: 14, drop: 0.12 });
            hiss(t, 0.3, 0.06, 1600, 200, 'lowpass', hall, 0.7, 0.002);
          }
        },
        // a strike met: a dry woody clack, two knocks of wood on wood
        block: (t, e, out) => {
          const h = HIGH[e.h] ?? 1;
          fm(760 * h, t, 0.06, 0.22, { ratio: 1.48, index: 2.5, modDecay: 0.02, attack: 0.0008, decay: 0.07, sustain: 0, release: 0.03, bus: out });
          tone(540 * h, 470 * h, t, 0.035, 0.15, 'triangle', out, 0.0008);
          hiss(t, 0.025, 0.2, 2600 * h, 1700, 'bandpass', out, 3.5, 0.0006);
          fm(1080 * h, t + 0.018, 0.04, 0.09, { ratio: 1.48, index: 2, modDecay: 0.015, attack: 0.0008, decay: 0.05, sustain: 0, release: 0.03, bus: out });
        },
        // a fighter falling: the body hitting the boards, a bounce, the dust and cloth settling
        ko: (t, e, out) => {
          const big = e.who !== 'hero' ? 1 : 0.85;
          hiss(t, 0.25, 0.05, 900, 2400, 'bandpass', out, 1, 0.15); // falling
          thud(52, t + 0.3, 0.45, 0.42 * big, out, { punch: 14, drop: 0.1, drive: 0.5, tone: 900 });
          hiss(t + 0.3, 0.1, 0.12 * big, 2000, 300, 'lowpass', out, 0.7, 0.001);
          thud(70, t + 0.52, 0.15, 0.16 * big, out, { punch: 8, drop: 0.05, tone: 700 });
          hiss(t + 0.32, 0.7, 0.04, 1400, 200, 'lowpass', hall, 0.6, 0.05);
          hiss(t + 0.35, 0.5, 0.025, 600, 1600, 'bandpass', out, 1, 0.1); // the cloth settling
        },
        // knocked down (not out): the body on the boards, then the scuff of getting up
        fall: (t, e, out) => {
          hiss(t, 0.2, 0.04, 900, 2400, 'bandpass', out, 1, 0.12);
          thud(58, t + 0.32, 0.35, 0.34, out, { punch: 12, drop: 0.08, drive: 0.45, tone: 800 });
          hiss(t + 0.32, 0.4, 0.03, 1200, 250, 'lowpass', hall, 0.6, 0.04);
        },
        // a bow: two soft chimes, a fifth apart
        bow: (t, e, out) => {
          bell(81, t + 0.15, 0.04, out, 1.6);
          bell(88, t + 0.4, 0.032, out, 1.8);
          bell(88, t + 0.4, 0.012, ring, 1.2);
        },
        // a foe arrives: a deep drum and the scrape of lacquered armour
        foe: (t, e, out) => {
          thud(44, t, 0.6, 0.2, out, { punch: 12, drop: 0.08, drive: 0.4, tone: 700 });
          hiss(t, 0.5, 0.06, 1200, 150, 'lowpass', hall, 0.7, 0.003);
          hiss(t + 0.05, 0.22, 0.03, 3200, 2400, 'bandpass', out, 5, 0.06);
        },
        // health coming back: gentle bells rising, higher the fuller she is
        regen: (t, e, out) => {
          const up = [0, 2, 4, 7, 9, 12, 14, 16][clamp(Math.round(e.pips ?? 1) - 1, 0, 7)];
          bell(79 + up, t, 0.03, out, 0.9);
          bell(86 + up, t + 0.08, 0.022, out, 1.1);
          bell(86 + up, t + 0.08, 0.008, ring, 0.8);
        },
        // a gate trembling in its slot: a low rumble and the chains rattling
        gateShake: (t, e, out) => {
          hiss(t, 0.55, 0.11, 320, 110, 'lowpass', out, 0.9, 0.08);
          for (let k = 0; k < 5; k++) thud(46 + (k % 2) * 6, t + k * 0.09, 0.08, 0.1 - k * 0.012, out, { punch: 4, drop: 0.03, drive: 0.4, tone: 300 });
          for (let k = 0; k < 4; k++) hiss(t + 0.03 + k * 0.11, 0.03, 0.02, 4200, 3000, 'bandpass', out, 4, 0.002);
        },
        // a gate dropping shut: a huge boom, the iron ringing, the hall answering
        gateSlam: (t, e, out) => {
          thud(38, t, 1.3, 0.55, out, { punch: 18, drop: 0.22, drive: 0.6, tone: 900 });
          hiss(t, 0.05, 0.3, 5000, 1800, 'bandpass', out, 0.8, 0.0008);
          hiss(t, 1.6, 0.26, 2200, 50, 'lowpass', out, 0.7, 0.002);
          hiss(t, 1.4, 0.16, 1400, 60, 'lowpass', hall, 0.7, 0.002);
          fm(150, t, 1.2, 0.05, { ratio: 1.41, index: 6, modDecay: 0.2, modSustain: 0.15, attack: 0.001, decay: 1.2, sustain: 0, release: 0.3, bus: hall });
          for (let k = 0; k < 5; k++) hiss(t + 0.25 + k * 0.13, 0.04, 0.03, 3600, 2000, 'bandpass', out, 2, 0.002); // grit falling
        },
        // caught under a gate: a crunch and a dead weight
        crush: (t, e, out) => {
          for (let k = 0; k < 4; k++) hiss(t + k * 0.025, 0.04, 0.12, 2600 - k * 300, 600, 'bandpass', out, 1.5, 0.001);
          thud(60, t, 0.35, 0.36, out, { punch: 10, drop: 0.08 });
          hiss(t, 0.5, 0.06, 900, 120, 'lowpass', hall, 0.7, 0.002);
        },
        // the archer drawing: the bow's creak
        draw: (t, e, out) => {
          // stick-slip: ticks of the wood and string, coming quicker as it bends
          for (let k = 0, at = 0; k < 11; k++, at += 0.055 - k * 0.0035)
            hiss(t + at, 0.018, 0.3 + k * 0.03, 1500 + k * 90, 900, 'bandpass', out, 4, 0.002);
          tone(170, 215, t, 0.4, 0.03, 'sawtooth', out, 0.3);
        },
        // a dart in flight: the string's twang, then a falling whistle
        dart: (t, e, out) => {
          tone(320, 150, t, 0.06, 0.04, 'triangle', out, 0.001);
          tone(2600, 1700, t + 0.03, 0.38, 0.11, 'sine', out, 0.05);
          hiss(t + 0.03, 0.36, 0.1, 3400, 2200, 'bandpass', out, 6, 0.05);
        },
        dartHit: (t, e, out) => {
          thud(190, t, 0.06, 0.2, out, { punch: 6, drop: 0.015, drive: 0.6, tone: 2200 });
          hiss(t, 0.05, 0.09, 3200, 1200, 'bandpass', out, 1, 0.0008);
        },
        // a dart knocked aside: a clack and a thin ring as it spins off
        dartBlock: (t, e, out) => {
          fm(980, t, 0.05, 0.2, { ratio: 1.48, index: 2.2, modDecay: 0.02, attack: 0.0008, decay: 0.06, sustain: 0, release: 0.03, bus: out });
          hiss(t, 0.02, 0.18, 3400, 2400, 'bandpass', out, 3, 0.0006);
          fm(2300, t + 0.02, 0.25, 0.03, { ratio: 2.76, index: 1, modDecay: 0.05, attack: 0.001, decay: 0.25, sustain: 0, release: 0.1, bus: out });
        },
        // a life lost: one low toll
        life: t => fm(midi(45), t, 2.2, 0.09, { ratio: 1.41, index: 1.8, modDecay: 0.5, attack: 0.002, decay: 2.2, sustain: 0, release: 0.4, bus: ring }),

        // ---------- the jingles ----------
        // a scene cleared: the koto climbs, the flute answers on high
        clear: t => {
          jingle(t, 'clear');
          [57, 62, 64, 69, 74].forEach((n, k) => koto(n + 12, t + k * 0.09, 0.07, jspace, 1));
          flute(81, t + 0.5, 1.0, 0.075, jspace, { vib: 16 });
          don(t, 0.22, 60, 'sfx');
        },
        // KO'd: the koto falls away over a soft drum
        die: t => {
          jingle(t, 'die');
          [74, 72, 69, 65, 62].forEach((n, k) => koto(n, t + 0.2 + k * 0.17, 0.065, jspace, 1.2));
          don(t, 0.18, 54, 'sfx');
          flute(57, t + 1.1, 1.2, 0.1, jspace, { vib: 20, breath: 0.7 });
        },
        // no lives left: a slow fall on the flute, a gong under it
        over: t => {
          jingle(t, 'over');
          fm(midi(38), t, 3.6, 0.16, { ratio: 1.41, index: 2, modDecay: 0.8, modSustain: 0.2, attack: 0.002, decay: 3.6, sustain: 0, release: 0.5, bus: jspace });
          [[74, 0, 0.55], [72, 0.6, 0.55], [69, 1.2, 0.9], [67, 2.2, 0.45], [62, 2.7, 1.3]].forEach(([n, at, d]) => flute(n, t + 0.2 + at, d, 0.16, jspace, { vib: 18, breath: 0.6 }));
        },
        // the Keep won: a drum roll, bells and the koto bright, the flute's long high note
        win: t => {
          jingle(t, 'win');
          for (let k = 0; k < 6; k++) don(t + k * 0.08, 0.06 + k * 0.015, 70 - k * 2, 'sfx');
          don(t + 0.55, 0.2, 50, 'sfx');
          [65, 69, 72, 77, 81, 84].forEach((n, k) => koto(n, t + 0.55 + k * 0.07, 0.065, jspace, 1.4));
          [77, 84].forEach((n, k) => bell(n + 12, t + 0.6 + k * 0.3, 0.025, jspace, 2));
          flute(81, t + 1.2, 0.6, 0.07, jspace, { vib: 12 });
          flute(84, t + 1.85, 1.8, 0.075, jspace, { vib: 16 });
        },

        // ---------- the menus ----------
        move: t => koto(76, t, 0.05, 'sfx', 0.25),
        pick: t => {
          koto(76, t, 0.05, 'sfx', 0.3);
          koto(83, t + 0.07, 0.055, 'sfx', 0.5);
        },
        back: t => {
          koto(83, t, 0.05, 'sfx', 0.3);
          koto(76, t + 0.07, 0.05, 'sfx', 0.4);
        },
        pause: t => {
          fm(880, t, 0.05, 0.09, { ratio: 1.48, index: 2.2, modDecay: 0.02, attack: 0.0008, decay: 0.06, sustain: 0, release: 0.03, bus: 'sfx' });
          bell(76, t + 0.05, 0.03, 'sfx', 0.8);
        },
      };
      effects.select = effects.pick; // Spindle's name for it
      // every effect gets its opts (never undefined) and where to play (opts.pan placed)
      for (const [name, fn] of Object.entries(effects))
        effects[name] = (t, e) => {
          const o = e && typeof e === 'object' ? e : {};
          if (name in JINGLES) {
            // music(name) and sfx(name) in the same moment play it once
            if (lastJingle.name === name && t - lastJingle.at < 0.3) return;
            lastJingle = { name, at: t };
          }
          fn(t, o, placed(o.pan));
        };
      return { step, effects };
    },
  });
  return {
    unlock: () => synth.unlock(),
    // a jingle as music: the track stops and the jingle plays (once, if its sfx comes too)
    music(name) {
      if (name && name in JINGLES) {
        synth.music(null);
        synth.sfx(name);
      } else synth.music(name);
    },
    sfx: (name, opts) => synth.sfx(name, opts),
    setOn: b => synth.setOn(b),
    get on() {
      return synth.on;
    },
    destroy: () => synth.destroy(),
  };
}
