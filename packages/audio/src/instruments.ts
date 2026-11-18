// The richer voices: a punchy sub bass, a supersaw, a PWM pulse synth and an enveloped
// two-operator FM, after the instruments of nightshift (its piano roll, knobs and session
// plumbing left behind). Each plays one note of `dur` seconds: an ADSR envelope opens at t,
// holds its sustain until t + dur, then releases.
//
//   v.sub(midi(36), t, 0.5, 0.3, { punch: 12, drive: 0.4 })
//   v.supersaw(midi(60), t, dt * 4, 0.08, { cutoff: 2400, envmod: 2400 })
//   v.pulse(midi(67), t, dt * 2, 0.07, { width: 0.3, pwm: 0.6 })
//   v.fm(midi(72), t, 0.8, 0.1, { ratio: 3.5, index: 4, modDecay: 0.3 })   // a bell
import type { Target } from './synth.ts';

/** The level envelope, seconds and a 0..1 sustain. */
export interface Adsr {
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
}
export interface VoiceOptions extends Adsr {
  /** Where it plays (default 'music'): a bus, an insert (v.insert()) or a node of the score's own. */
  bus?: Target;
}
export interface SubOptions extends VoiceOptions {
  /** Semitones above the note it starts at, dropping to it (default 12). */
  punch?: number;
  /** How long the drop takes, seconds (default 0.06). */
  drop?: number;
  /** 0..1 into a soft clipper: grit, harder while the note is loud (default 0.25). */
  drive?: number;
  /** A lowpass after it, Hz (default 2400). */
  tone?: number;
}
export interface FilterOptions extends VoiceOptions {
  /** The lowpass, Hz (supersaw default 1800, pulse 1400). */
  cutoff?: number;
  /** 0..1 resonance (default 0.15). */
  reso?: number;
  /** Cents the envelope opens the filter at its peak (default 2400). */
  envmod?: number;
}
export interface SupersawOptions extends FilterOptions {
  /** 0..1, how far the outer saws drift, up to 120 cents (default 0.35). */
  detune?: number;
  /** 0..1, the six outer saws against the middle one (default 0.6). */
  mix?: number;
  /** 0..1, how far apart they pan (default 0.8). */
  width?: number;
}
export interface PulseOptions extends FilterOptions {
  /** 0..1, from square (50 %) to thin (5 %) (default 0). */
  width?: number;
  /** 0..1, how far the LFO sweeps the width (default 0.5). */
  pwm?: number;
  /** The LFO, Hz (default 0.8); every pulse note shares it, as one synth's would. */
  rate?: number;
  /** 0..1, the two pulses apart, up to 30 cents (default 0.3). */
  detune?: number;
}
export interface FmOptions extends VoiceOptions {
  /** The modulator against the note (default 2): whole numbers ring harmonic, 3.5 a bell. */
  ratio?: number;
  /** Cents the modulator is off that ratio (default 0). */
  fine?: number;
  /** How far the modulator bends the carrier at the start, the FM index (default 3). */
  index?: number;
  /** The index falls to modSustain of itself over about modDecay seconds (defaults 0.25, 0.2):
   * bright at the start, mellowing as an electric piano does. */
  modDecay?: number;
  modSustain?: number;
}

/** What the voices need of the synth they play in. */
export interface Kit {
  ac: AudioContext;
  out: (bus: Target) => AudioNode;
  /** How long a voice runs on after its release, before stop(). */
  tail: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Attack to `peak`, decay towards `sustain` of it, held until `end`, then released: on a
 * param starting from 0. Returns when the release is over.
 */
export function adsr(p: AudioParam, t: number, end: number, peak: number, a: Required<Adsr>): number {
  const top = t + Math.max(0.001, a.attack);
  p.value = 0; // silent before t too: a source can start a fraction of a sample early
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, top);
  p.setTargetAtTime(peak * clamp01(a.sustain), top, Math.max(0.001, a.decay) / 3);
  const off = Math.max(end, top);
  p.setTargetAtTime(0, off, Math.max(0.001, a.release) / 4);
  return off + Math.max(0.001, a.release);
}
const shape = (o: Adsr, d: Required<Adsr>): Required<Adsr> => ({
  attack: o.attack ?? d.attack,
  decay: o.decay ?? d.decay,
  sustain: o.sustain ?? d.sustain,
  release: o.release ?? d.release,
});

// ---------- sub ----------
const RANGE = 16; // the clipper's curve spans ±RANGE: drive at full gains the signal that much
let clipCurve: Float32Array<ArrayBuffer> | null = null;
function softClip() {
  if (!clipCurve) {
    clipCurve = new Float32Array(2048);
    for (let k = 0; k < clipCurve.length; k++) clipCurve[k] = Math.tanh(RANGE * ((2 * k) / (clipCurve.length - 1) - 1));
  }
  return clipCurve;
}

/** A sine punched up at the start and dropping to the note, through a soft clipper. */
export function sub(k: Kit, f: number, t: number, dur: number, vol: number, o: SubOptions = {}) {
  const { ac } = k;
  const env = shape(o, { attack: 0.003, decay: 0.6, sustain: 0, release: 0.08 });
  const osc = ac.createOscillator();
  osc.frequency.setValueAtTime(f * 2 ** ((o.punch ?? 12) / 12), t);
  osc.frequency.exponentialRampToValueAtTime(f, t + Math.max(0.005, o.drop ?? 0.06));
  // the envelope before the clipper: a loud start crunches, the tail cleans up
  const amp = ac.createGain();
  const end = adsr(amp.gain, t, t + dur, 1, env);
  const drive = 1 + (RANGE - 1) * clamp01(o.drive ?? 0.25) ** 2;
  const pre = ac.createGain(),
    clip = ac.createWaveShaper(),
    post = ac.createGain(),
    lp = ac.createBiquadFilter(),
    out = ac.createGain();
  pre.gain.value = drive / RANGE;
  clip.curve = softClip();
  clip.oversample = '4x';
  post.gain.value = vol / Math.tanh(drive); // a full-scale sine comes out about as loud as it went in
  lp.type = 'lowpass';
  lp.frequency.value = o.tone ?? 2400;
  lp.Q.value = 0.7;
  osc
    .connect(amp)
    .connect(pre)
    .connect(clip)
    .connect(post)
    .connect(lp)
    .connect(out)
    .connect(k.out(o.bus ?? 'music'));
  osc.start(t);
  osc.stop(end + k.tail);
  osc.onended = () => [amp, pre, clip, post, lp, out].forEach(n => n.disconnect());
}

// ---------- the filtered synths: supersaw and pulse ----------
const cents = (reso: number) => 0.5 + 15 * clamp01(reso) ** 2;

/** A lowpass whose detune the envelope moves, into an amp the envelope moves too. */
function filtered(k: Kit, t: number, dur: number, vol: number, o: FilterOptions, cutoff: number, d: Required<Adsr>) {
  const { ac } = k;
  const lp = ac.createBiquadFilter(),
    one = ac.createConstantSource(),
    env = ac.createGain(),
    amp = ac.createGain(),
    mod = ac.createGain(),
    out = ac.createGain();
  lp.type = 'lowpass';
  lp.frequency.value = o.cutoff ?? cutoff;
  lp.Q.value = cents(o.reso ?? 0.15);
  // one envelope for the level and the filter: a steady 1 through a gain the stages move
  env.gain.value = 0;
  const end = adsr(env.gain, t, t + dur, 1, shape(o, d));
  amp.gain.value = 0;
  mod.gain.value = o.envmod ?? 2400;
  out.gain.value = vol;
  one.connect(env);
  env.connect(amp.gain);
  env.connect(mod).connect(lp.detune);
  lp.connect(amp)
    .connect(out)
    .connect(k.out(o.bus ?? 'music'));
  one.start(t);
  one.stop(end + k.tail);
  return { lp, end, one, parts: [lp, one, env, amp, mod, out] as AudioNode[] };
}

// Each saw's share of the detune (uneven, so they don't beat in step), its place in the width
// and where in its cycle it starts (so a note isn't seven edges at once); the middle is the 4th.
const SAWS = [
  { detune: -1, pan: -1, phase: 0 },
  { detune: -0.58, pan: 0.67, phase: 0.71 },
  { detune: -0.19, pan: -0.33, phase: 0.29 },
  { detune: 0, pan: 0, phase: 0.53 },
  { detune: 0.21, pan: 0.33, phase: 0.87 },
  { detune: 0.56, pan: -0.67, phase: 0.13 },
  { detune: 0.97, pan: 1, phase: 0.44 },
];
const MIDDLE = 3;
const HARMONICS = 512;
const sawCache = new WeakMap<BaseAudioContext, PeriodicWave[]>();
/** Band-limited saws starting `phase` into their cycle, made once per context. */
function saws(ac: AudioContext) {
  let made = sawCache.get(ac);
  if (!made) {
    made = SAWS.map(({ phase }) => {
      const re = new Float32Array(HARMONICS + 1),
        im = new Float32Array(HARMONICS + 1),
        shift = 2 * Math.PI * phase;
      for (let n = 1; n <= HARMONICS; n++) {
        const b = ((n % 2 ? 1 : -1) * 2) / (n * Math.PI);
        re[n] = b * Math.sin(n * shift);
        im[n] = b * Math.cos(n * shift);
      }
      return ac.createPeriodicWave(re, im);
    });
    sawCache.set(ac, made);
  }
  return made;
}
/** The middle saw's level and the others', together about as loud at any mix. */
export function sawLevels(mix: number) {
  const middle = 1 - 0.5 * mix,
    sides = mix,
    scale = 1 / Math.sqrt(middle ** 2 + (SAWS.length - 1) * sides ** 2);
  return { middle: middle * scale, sides: sides * scale };
}

/** Seven saws a little out of tune, the outer six spread across the stereo field. */
export function supersaw(k: Kit, f: number, t: number, dur: number, vol: number, o: SupersawOptions = {}) {
  const { ac } = k;
  const { lp, end, one, parts } = filtered(k, t, dur, vol, o, 1800, {
    attack: 0.01,
    decay: 0.3,
    sustain: 0.7,
    release: 0.25,
  });
  const spread = 120 * clamp01(o.detune ?? 0.35) ** 1.5,
    width = clamp01(o.width ?? 0.8),
    levels = sawLevels(clamp01(o.mix ?? 0.6)),
    waves = saws(ac);
  const middle = ac.createGain(),
    sides = ac.createGain();
  middle.gain.value = levels.middle;
  sides.gain.value = levels.sides;
  middle.connect(lp);
  sides.connect(lp);
  parts.push(middle, sides);
  const oscs = SAWS.map((saw, i) => {
    const osc = ac.createOscillator();
    osc.setPeriodicWave(waves[i]);
    osc.frequency.value = f;
    osc.detune.value = saw.detune * spread;
    if (i === MIDDLE) osc.connect(middle);
    else {
      const pan = ac.createStereoPanner();
      pan.pan.value = saw.pan * width;
      osc.connect(pan).connect(sides);
      parts.push(pan);
    }
    parts.push(osc);
    return osc;
  });
  for (const osc of oscs) {
    osc.start(t);
    osc.stop(end + k.tail);
  }
  one.onended = () => parts.forEach(n => n.disconnect());
}

// A pulse is a saw less a copy of itself a fraction of a period later: that fraction is the
// width, so the width is a delay's time, which the LFO moves, and the wave stays band-limited.
const lfos = new WeakMap<BaseAudioContext, OscillatorNode>();
function lfoOf(ac: AudioContext, rate: number, t: number) {
  let lfo = lfos.get(ac);
  if (!lfo) {
    lfo = ac.createOscillator();
    lfo.frequency.value = rate;
    lfo.start();
    lfos.set(ac, lfo);
  }
  lfo.frequency.setTargetAtTime(rate, t, 0.05);
  return lfo;
}

/** Two pulse waves a little out of tune, their width swept by a slow LFO (PWM). */
export function pulse(k: Kit, f: number, t: number, dur: number, vol: number, o: PulseOptions = {}) {
  const { ac } = k;
  const { lp, end, one, parts } = filtered(k, t, dur, vol, o, 1400, {
    attack: 0.01,
    decay: 0.25,
    sustain: 0.6,
    release: 0.2,
  });
  const duty = 0.5 - 0.45 * clamp01(o.width ?? 0),
    swing = clamp01(o.pwm ?? 0.5) * (duty - 0.02), // the width's reach either way
    spread = 30 * clamp01(o.detune ?? 0.3),
    lfo = lfoOf(ac, o.rate ?? 0.8, t);
  const depths: GainNode[] = [];
  const sum = ac.createGain();
  sum.gain.value = 0.25; // two pulses of up to ±2 each
  sum.connect(lp);
  parts.push(sum);
  const oscs = [-0.5, 0.5].map(side => {
    const osc = ac.createOscillator(),
      delay = ac.createDelay(0.2), // a period at 5 Hz
      invert = ac.createGain(),
      depth = ac.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    osc.detune.value = side * spread;
    delay.delayTime.value = duty / f;
    invert.gain.value = -1;
    depth.gain.value = swing / f;
    osc.connect(sum);
    osc.connect(delay).connect(invert).connect(sum);
    lfo.connect(depth).connect(delay.delayTime);
    parts.push(osc, delay, invert, depth);
    depths.push(depth);
    return osc;
  });
  for (const osc of oscs) {
    osc.start(t);
    osc.stop(end + k.tail);
  }
  one.onended = () => {
    parts.forEach(n => n.disconnect());
    // the shared LFO would otherwise hold on to every note's depth for good
    for (const d of depths) lfo.disconnect(d);
  };
}

/** Two sines, the modulator bending the carrier at audio rate, its index enveloped. */
export function fm(k: Kit, f: number, t: number, dur: number, vol: number, o: FmOptions = {}) {
  const { ac } = k;
  const ratio = (o.ratio ?? 2) * 2 ** ((o.fine ?? 0) / 1200),
    peak = o.index ?? 3;
  const carrier = ac.createOscillator(),
    m = ac.createOscillator(),
    index = ac.createGain(),
    swing = ac.createGain(),
    amp = ac.createGain();
  carrier.frequency.value = f;
  m.frequency.value = f * ratio;
  // the index, enveloped, times the modulator's Hz: how far the carrier swings
  index.gain.setValueAtTime(peak, t);
  index.gain.setTargetAtTime(peak * clamp01(o.modSustain ?? 0.2), t, Math.max(0.001, o.modDecay ?? 0.25) / 3);
  swing.gain.value = f * ratio;
  m.connect(index).connect(swing).connect(carrier.frequency);
  const end = adsr(amp.gain, t, t + dur, vol, shape(o, { attack: 0.005, decay: 0.4, sustain: 0.35, release: 0.2 }));
  carrier.connect(amp).connect(k.out(o.bus ?? 'music'));
  carrier.start(t);
  m.start(t);
  carrier.stop(end + k.tail);
  m.stop(end + k.tail);
  carrier.onended = () => [m, index, swing, amp].forEach(n => n.disconnect());
}
