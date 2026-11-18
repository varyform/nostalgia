// Procedural sound, made with Web Audio on @nostalgia/audio. Two voicings of the same
// effects: the CGA page's PC-speaker flavour (bare square blips that start at full level,
// low-passed noise, a buzzing square rotor) and HD's (filtered tones through an echo, a
// compressor, a rotor of chopped noise). HD also has music (SKY): slow, dark ambient pieces,
// one per kind of mission and one for the title, that tighten when the fuel runs low. The
// context is only created by unlock(), which the page calls from a user gesture; the demo
// never calls it.
//
//   const audio = createAudio({ on: true, hd: false });
//   audio.unlock();                       // from keydown / touchstart / mousedown
//   audio.sfx('shoot'); audio.setOn(false);
//   audio.engine(true);                   // the rotor, while the chopper flies
//   audio.throttle(p.vx, p.landed);       // every step: its pitch and chop follow the flight
//   audio.music('cave'); audio.mood(fuel, aboard);   // HD only: the score, and how tense it is
import { compressor, createSynth, delay, distortion, line, midi, span } from '@nostalgia/audio';

// ---------- the HD score ----------
// Each piece: a chord every two bars (pad and a sub drone under it), and some of: an ostinato
// (pulse, or a gritty supersaw), a sparse motif (bells, soft keys or a low saw), cave drips,
// a wind swell every four bars and a beat (k thump, h shaker). 16 steps a bar; all original.
const CH = { m: [0, 3, 7], M: [0, 4, 7] };
const SKY = {
  // D minor: Dm Bb Gm A
  title: {
    bpm: 66, pad: 0.02, cutoff: 700, wind: true, motif: 'keys',
    bars: [[38, 'm'], [38, 'm'], [46, 'M'], [46, 'M'], [43, 'm'], [43, 'm'], [45, 'M'], [45, 'M']],
    lead: line(`74 - - - - - - - 77 - - - 76 - - -   69 - - - - - - - - - - - . . . .
                70 - - - - - - - 74 - - - 72 - - -   70 - - - 69 - - - - - - - . . . .
                67 - - - - - - - 70 - - - 74 - - -   72 - - - - - - - 70 - - - . . . .
                69 - - - 73 - - - 76 - - - 73 - - -   69 - - - - - - - - - - - . . . .`),
  },
  // the coast, E minor: Em C Am B
  hills: {
    bpm: 72, pad: 0.018, cutoff: 900, wind: true, ost: 'x.....x.x.......', beat: 'k...............',
    bars: [[40, 'm'], [40, 'm'], [36, 'M'], [36, 'M'], [45, 'm'], [45, 'm'], [47, 'M'], [47, 'M']],
  },
  // the ridge, B minor: Bm G Em F#
  mount: {
    bpm: 70, pad: 0.018, cutoff: 800, wind: true, ost: 'x...x...x...x...', alt: true, beat: 'k.......h.......',
    bars: [[47, 'm'], [47, 'm'], [43, 'M'], [43, 'M'], [40, 'm'], [40, 'm'], [42, 'M'], [42, 'M']],
  },
  // the caverns, C# minor with a Phrygian D: drips, and bells far off
  cave: {
    bpm: 60, pad: 0.022, cutoff: 600, drips: true, motif: 'bell',
    bars: [[37, 'm'], [37, 'm'], [38, 'M'], [38, 'M'], [37, 'm'], [37, 'm'], [35, 'M'], [35, 'M']],
    lead: line(`80 - - - - - - - - - - - - - - -   . . . . 76 - - - - - - - 73 - - -
                74 - - - - - - - - - - - - - - -   . . . . 78 - - - 74 - - - - - - -
                80 - - - - - - - 76 - - - - - - -   . . . . 73 - - - - - - - 68 - - -
                71 - - - - - - - 75 - - - 78 - - -   75 - - - - - - - - - - - . . . .`),
  },
  // the city, F minor: a clock ticking under it
  city: {
    bpm: 76, pad: 0.017, cutoff: 750, ost: 'x.x.x.x.x.x.x.x.', ostVol: 0.018, beat: 'h...h...h...h...',
    bars: [[41, 'm'], [41, 'm'], [37, 'M'], [37, 'M'], [46, 'm'], [46, 'm'], [36, 'M'], [36, 'M']],
  },
  // the fortress, G minor: a gritty ostinato, a heavy beat and a low saw motif
  fort: {
    bpm: 84, pad: 0.016, cutoff: 900, drive: 0.4, ost: 'x..x..x.x..x..x.', ostSaw: true, beat: 'k.......k.k.....', motif: 'saw',
    bars: [[43, 'm'], [43, 'm'], [39, 'M'], [39, 'M'], [36, 'm'], [36, 'm'], [38, 'M'], [38, 'M']],
    lead: line(`55 - - - 58 - 62 - - - - - 60 - 58 -   55 - - - - - - - - - - - . . . .
                58 - - - 63 - 67 - - - - - 65 - 63 -   62 - - - - - - - - - - - . . . .
                60 - - - 63 - 67 - - - - - 65 - 63 -   60 - - - - - - - - - - - . . . .
                62 - - - 66 - 69 - - - 66 - 62 - 57 -   62 - - - - - - - - - - - . . . .`),
  },
};
const MUSIC_MAKEUP = -10; // dB, after the music's compressor: under the rotor and the effects

function score(v) {
  const { sub, supersaw, pulse, fm, hiss } = v;
  const space = v.insert(ac => delay(ac, { time: 0.6, feedback: 0.45, wet: 0.32, cut: 1800, pan: -0.25 }));
  const grit = v.insert(ac => distortion(ac, { amount: 0.5, ceiling: 0.03, mix: 0.6 }), space);
  const mood = { alarm: false, bright: 0 };
  return {
    // low fuel: a heartbeat and a high tick; agents aboard: the pad and ostinato open up
    mood: (fuel, aboard) => {
      mood.alarm = fuel > 0 && fuel < 25;
      mood.bright = Math.min(3, aboard) * 250;
    },
    step: (tr, i, t, dt) => {
      const bars = tr.bars.length, bar = (i >> 4) % bars, s = i % 16, [root, kind] = tr.bars[bar], ch = CH[kind];
      if (s === 0) space.fx?.time.setTargetAtTime(dt * 3, t, 0.1); // a dotted eighth at this tempo
      if (s === 0 && bar % 2 === 0) {
        const len = dt * 32;
        for (const iv of ch)
          supersaw(midi(root + 12 + iv), t, len * 0.9, tr.pad, {
            attack: dt * 10, decay: dt * 16, sustain: 0.85, release: dt * 12, cutoff: tr.cutoff + mood.bright,
            envmod: 500, reso: 0.1, detune: 0.45, mix: 0.7, width: 1, bus: space,
          });
        sub(midi(root), t, len * 0.95, 0.12, { punch: 0, drive: tr.drive ?? 0.1, tone: 500, attack: dt * 6, decay: 1, sustain: 0.8, release: dt * 8 });
      }
      if (tr.ost?.[s] === 'x') {
        const n = root + 12 + (tr.alt && (s >> 2) % 2 ? 7 : 0);
        if (tr.ostSaw)
          supersaw(midi(n), t, dt * 1.2, 0.025, { detune: 0.25, mix: 0.5, cutoff: 400 + mood.bright, envmod: 1800, reso: 0.3, attack: 0.005, decay: dt, sustain: 0.2, release: 0.08, bus: grit });
        else
          pulse(midi(n), t, dt * 1.2, tr.ostVol ?? 0.03, { width: 0.3, cutoff: 450 + mood.bright, envmod: 2000, reso: 0.35, decay: dt, sustain: 0.15, release: 0.06, bus: space });
      }
      const n = tr.lead?.[i % tr.lead.length];
      if (n > 0) {
        const d = dt * span(tr.lead, i, 16) * 0.95;
        if (tr.motif === 'saw')
          supersaw(midi(n), t, d, 0.03, { detune: 0.15, mix: 0.3, width: 0.4, cutoff: 1200, envmod: 1500, reso: 0.2, attack: 0.04, decay: 0.5, sustain: 0.6, release: 0.4, bus: space });
        else if (tr.motif === 'bell')
          fm(midi(n), t, d, 0.03, { ratio: 3.5, index: 2, modDecay: 0.4, modSustain: 0.1, decay: 1.2, sustain: 0.1, release: 0.8, bus: space });
        else fm(midi(n), t, d, 0.045, { ratio: 1, index: 1.2, modDecay: 0.6, modSustain: 0.3, attack: 0.05, decay: 1, sustain: 0.5, release: 0.8, bus: space });
      }
      if (tr.drips && s % 2 === 0) {
        const h = ((i * 2654435761) >>> 0) / 4294967296; // the same drips every time round
        if (h < 0.1) fm(midi(84 + [0, 3, 7, 10, 12][Math.floor(h * 1000) % 5]), t, 0.2, 0.012, { ratio: 3.5, index: 1.5, decay: 0.3, sustain: 0, release: 0.3, bus: space });
      }
      if (tr.wind && s === 0 && bar % 4 === 0) hiss(t, dt * 48, 0.02, 400, 1600, 'bandpass', space, 2, dt * 24);
      const b = tr.beat?.[s];
      if (b === 'k') sub(48, t, 0.3, 0.16, { punch: 10, drop: 0.08, drive: 0.3, tone: 800, decay: 0.3, sustain: 0, release: 0.1 });
      if (b === 'h') hiss(t, 0.03, 0.012, 9000, 6000, 'highpass', 'music');
      if (mood.alarm) {
        if (s === 0 || s === 3) sub(44, t, 0.2, s ? 0.1 : 0.14, { punch: 8, drop: 0.05, drive: 0.2, tone: 600, decay: 0.2, sustain: 0, release: 0.08 });
        if (s % 4 === 2) fm(midi(root + 42), t, 0.1, 0.01, { ratio: 2, index: 1, decay: 0.1, sustain: 0, release: 0.1, bus: space });
      }
    },
  };
}

// the rotor: a continuous source whose pitch (an oscillator's, or a filter's) and chop (an
// LFO on its gain) follow the chopper; tune(vx, landed) gives the pitch
function rotor(v, build, tune) {
  let r = null;
  return {
    engine(on) {
      const ac = v.ac;
      if (!ac) return;
      if (r?.ac !== ac) r = null; // destroy() closed the old context
      if (on && !r) r = { ...build(ac), ac };
      else if (!on && r) { r.src.stop(); r.lfo.stop(); r = null; }
    },
    throttle(vx, landed) {
      if (!r || r.ac !== v.ac) return;
      r.pitch.setTargetAtTime(tune(vx, landed), v.ac.currentTime, 0.1);
      r.lfo.frequency.setTargetAtTime(landed ? 9 : 13 + Math.abs(vx) * 0.03, v.ac.currentTime, 0.1);
    },
  };
}

// PC-speaker flavoured: every voice starts at its peak, straight into the master
const cga = v => {
  const tone = (f0, f1, t, dur, vol = 0.08, type = 'square') => v.tone(f0, f1, t, dur, vol, type);
  const noise = (t, dur, vol = 0.2, freq = 1000) => v.hiss(t, dur, vol, freq, 60, 'lowpass', 'sfx', undefined, 0);
  const seq = (t, notes, d, vol = 0.07) => notes.forEach((f, i) => tone(f, f, t + i * d, d * 0.9, vol));
  return {
    effects: {
      shoot: t => tone(1800, 500, t, 0.05, 0.04),
      bomb: t => tone(1300, 300, t, 0.45, 0.03),
      boom: t => { noise(t, 0.35, 0.3, 1400); tone(160, 40, t, 0.25, 0.1); },
      big: t => { noise(t, 1.1, 0.4, 900); tone(220, 30, t, 0.9, 0.12); },
      hit: t => tone(500, 300, t, 0.04, 0.05),
      tink: t => tone(2400, 2000, t, 0.03, 0.03),
      pick: t => seq(t, [523, 659, 784], 0.07),
      saved: t => seq(t, [784, 1047], 0.08),
      land: t => { tone(220, 180, t, 0.08, 0.07); tone(330, 330, t + 0.08, 0.06, 0.05); },
      lift: t => tone(200, 500, t, 0.25, 0.04),
      launch: t => tone(300, 1200, t, 0.4, 0.03),
      beep: t => tone(880, 880, t, 0.08, 0.05),
      fuel: t => seq(t, [400, 600, 800, 1000], 0.05),
      jingle: t => seq(t, [523, 659, 784, 1047], 0.1),
      fanfare: t => seq(t, [523, 523, 659, 784, 659, 784, 1047], 0.13, 0.08),
      die: t => { noise(t, 1.2, 0.4, 1000); tone(600, 40, t, 1.2, 0.08); },
      over: t => seq(t, [392, 330, 262, 196], 0.28, 0.08),
      life: t => seq(t, [1047, 784, 1047, 1319], 0.07),
    },
    // a square buzz, chopped by a square LFO
    methods: rotor(v, ac => {
      const o = ac.createOscillator(), gn = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
      o.type = 'square'; o.frequency.value = 46; gn.gain.value = 0;
      lfo.type = 'square'; lfo.frequency.value = 13; lg.gain.value = 0.012;
      lfo.connect(lg).connect(gn.gain); o.connect(gn).connect(v.bus.master); o.start(); lfo.start();
      return { src: o, pitch: o.frequency, lfo };
    }, (vx, landed) => 44 + Math.abs(vx) * 0.12 + (landed ? 0 : 6)),
  };
};

// HD: soft-attack tones, each through its own lowpass, and noise, all into the echo
const hd = v => {
  function tone(f0, f1, t, dur, vol = 0.08, type = 'triangle', cut = 5000) {
    const ac = v.ac, o = ac.createOscillator(), f = ac.createBiquadFilter(), gn = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    f.type = 'lowpass'; f.frequency.value = cut;
    v.env(gn, t, 0.008, vol, dur);
    o.connect(f).connect(gn).connect(v.bus.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  const noise = (t, dur, vol = 0.2, freq = 1000, type = 'lowpass', end = 50) => v.hiss(t, dur, vol, freq, end, type, 'sfx', undefined, 0);
  const seq = (t, notes, d, vol = 0.06, type = 'triangle') => notes.forEach((f, i) => tone(f, f, t + i * d, d * 1.6, vol, type));
  const music = score(v);
  return {
    step: music.step,
    effects: {
      shoot: t => { tone(1100, 180, t, 0.07, 0.03, 'sawtooth', 2400); noise(t, 0.04, 0.05, 4000, 'highpass', 2000); },
      bomb: t => tone(1500, 280, t, 0.6, 0.03, 'sine'),
      boom: t => { noise(t, 0.9, 0.45, 1200, 'lowpass', 40); tone(120, 32, t, 0.6, 0.22, 'sine'); },
      big: t => { noise(t, 1.8, 0.6, 900, 'lowpass', 30); tone(95, 22, t, 1.4, 0.3, 'sine'); },
      hit: t => tone(700, 250, t, 0.06, 0.05, 'square', 1800),
      tink: t => tone(3000, 2600, t, 0.05, 0.03, 'sine'),
      pick: t => seq(t, [660, 880, 1320], 0.07, 0.07, 'sine'),
      saved: t => seq(t, [880, 1175, 1760], 0.07, 0.06, 'sine'),
      land: t => { noise(t, 0.15, 0.12, 600); tone(180, 120, t, 0.12, 0.08, 'sine'); },
      lift: t => tone(160, 420, t, 0.4, 0.05, 'sine'),
      launch: t => { noise(t, 0.6, 0.12, 3000, 'bandpass', 800); tone(250, 900, t, 0.5, 0.03, 'sawtooth', 1500); },
      beep: t => tone(990, 990, t, 0.1, 0.05, 'sine'),
      fuel: t => seq(t, [520, 660, 780, 1040], 0.05, 0.06, 'sine'),
      jingle: t => seq(t, [523, 659, 784, 1047], 0.09, 0.06),
      fanfare: t => seq(t, [523, 523, 659, 784, 659, 784, 1047], 0.12, 0.07),
      die: t => { noise(t, 2, 0.6, 800, 'lowpass', 30); tone(500, 30, t, 1.4, 0.08, 'sawtooth', 1200); },
      over: t => seq(t, [392, 330, 262, 196], 0.3, 0.07),
      life: t => seq(t, [1047, 784, 1047, 1319], 0.07, 0.06, 'sine'),
    },
    // low-passed noise chopped by a sine LFO, dry into the master
    methods: { mood: music.mood, ...rotor(v, ac => {
      const s = ac.createBufferSource(), lp = ac.createBiquadFilter(), gn = ac.createGain(), lfo = ac.createOscillator(), lgn = ac.createGain();
      s.buffer = v.noise; s.loop = true; lp.type = 'lowpass'; lp.frequency.value = 200;
      gn.gain.value = 0.05; lfo.type = 'sine'; lfo.frequency.value = 13; lgn.gain.value = 0.05;
      lfo.connect(lgn).connect(gn.gain); s.connect(lp).connect(gn).connect(v.bus.master); s.start(); lfo.start();
      return { src: s, pitch: lp.frequency, lfo };
    }, (vx, landed) => 180 + Math.abs(vx) * 1.2 + (landed ? 0 : 60)) },
  };
};

export function createAudio({ on = true, hd: isHd = false } = {}) {
  // effects start on the clock, and the sfx bus is unity: voices sound as if wired to the master
  const common = { on, seed: 1985, lead: 0 };
  return isHd
    ? createSynth({
        ...common, noiseLength: 2, levels: { master: 0.6, music: 0.4, sfx: 1 }, compressor: true, tracks: SKY,
        inserts: { music: ac => compressor(ac, { threshold: -36, ratio: 3, knee: 10, attack: 0.03, release: 0.4, makeup: MUSIC_MAKEUP }) },
        echo: { time: 0.13, feedback: 0.22, wet: 1, cut: 1800, bus: 'sfx' },
        arrange: hd,
      })
    : createSynth({ ...common, levels: { master: 0.5, music: 1, sfx: 1 }, attack: 0, tail: 0.02, arrange: cga });
}
