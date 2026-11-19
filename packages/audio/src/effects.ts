// Effects a score strings between its voices and a bus: a delay, a distortion and a
// compressor, after nightshift's (its knob maps and session plumbing left behind). Each is
// an `Fx`, a node to play into and one to take the sound from. A score uses them through
// v.insert() (a target its voices play into) or the synth's `inserts` (on a whole bus):
//
//   const crunch = v.insert(ac => distortion(ac, { amount: 0.5 }));
//   v.sub(midi(33), t, dt * 2, 0.2, { bus: crunch });
//   createSynth({ …, inserts: { music: ac => compressor(ac, { threshold: -24, ratio: 4, makeup: 'auto' }) } })

/** An effect: play into `input`, take the sound from `output`. */
export interface Fx {
  readonly input: AudioNode;
  readonly output: AudioNode;
}

/** Effects one after another, as one. */
export function chain(ac: BaseAudioContext, list: readonly Fx[]): Fx {
  if (!list.length) {
    const g = ac.createGain();
    return { input: g, output: g };
  }
  for (let k = 1; k < list.length; k++) list[k - 1].output.connect(list[k].input);
  return { input: list[0].input, output: list.at(-1)!.output };
}

// ---------- delay ----------
export interface DelayOptions {
  /** Seconds between repeats (default 0.3); `steps * dt` keeps it in time with a track. */
  time?: number;
  /** Each repeat is this times the last, 0..<1 (default 0.35). */
  feedback?: number;
  /** The echoes' level (default 0.3) and the dry sound's (default 1: an insert keeps it). */
  wet?: number;
  dry?: number;
  /** -1..1, where the echoes sit (default 0). Echoes are summed to mono first. */
  pan?: number;
  /** A lowpass in the loop, Hz: each repeat darker than the last (default none: unchanged). */
  cut?: number;
}
export interface DelayFx extends Fx {
  /** To retune it to a track: delay.time.setTargetAtTime(3 * dt, t, 0.05). */
  readonly time: AudioParam;
  readonly feedback: AudioParam;
  readonly wet: AudioParam;
}

/** A mono echo, panned into the mix, beside the dry sound. */
export function delay(ac: BaseAudioContext, o: DelayOptions = {}): DelayFx {
  const input = ac.createGain(),
    mono = ac.createGain(),
    d = ac.createDelay(4),
    fb = ac.createGain(),
    wet = ac.createGain(),
    dry = ac.createGain(),
    pan = ac.createStereoPanner(),
    output = ac.createGain();
  mono.channelCount = 1;
  mono.channelCountMode = 'explicit';
  d.delayTime.value = Math.min(4, o.time ?? 0.3);
  fb.gain.value = Math.min(0.98, o.feedback ?? 0.35);
  wet.gain.value = o.wet ?? 0.3;
  dry.gain.value = o.dry ?? 1;
  pan.pan.value = o.pan ?? 0;
  input.connect(dry).connect(output);
  input.connect(mono).connect(d);
  let tap: AudioNode = d;
  if (o.cut) {
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.cut;
    d.connect(lp);
    tap = lp;
  }
  tap.connect(fb).connect(d);
  tap.connect(wet).connect(pan).connect(output);
  return { input, output, time: d.delayTime, feedback: fb.gain, wet: wet.gain };
}

// ---------- distortion ----------
export interface DistortionOptions {
  /** 0..1, the drive into it: 0 dB at 0 up to +24 dB (square law) (default 0.5). */
  amount?: number;
  /** 0: a hard clipper; above 0, a sine wavefolder folding more the higher it goes (default 0). */
  shape?: number;
  /** The level it starts clipping at with no drive: about a voice's peak (default 0.3). */
  ceiling?: number;
  /** 0..1, how much of it against the clean sound (default 1). */
  mix?: number;
  /** A gain after it, for the level (default 1). */
  gain?: number;
}

// nightshift's fit of ReBirth's distortion, in units of `ref` (the clip level over DIST.clip)
const DIST = {
  driveDb: 24.25,
  clip: 1.97,
  foldClip: 3.446,
  foldGain: 6.267,
  foldPow: 1.661,
  foldAmp: 2.505,
  foldDry: 0.691,
  foldDryPow: 0.82,
  foldLowpass: 4881,
};
const distDrive = (amount: number) => 10 ** ((DIST.driveDb * amount * amount) / 20);
const folds = new Map<number, Float32Array<ArrayBuffer>>();
/** The folder's curve, made once per shape (to 1/127). Its input ±1 is ±foldClip refs. */
export function foldCurve(shape: number) {
  const key = Math.round(shape * 127);
  let c = folds.get(key);
  if (!c) {
    const s = key / 127,
      g = DIST.foldGain * s ** DIST.foldPow,
      dry = DIST.foldDry * (1 - s) ** DIST.foldDryPow;
    c = new Float32Array(4096);
    for (let k = 0; k < c.length; k++) {
      const v = ((2 * k) / (c.length - 1) - 1) * DIST.foldClip;
      c[k] = DIST.foldAmp * Math.sin(g * v) + dry * v;
    }
    folds.set(key, c);
  }
  return c;
}
const LINEAR = Float32Array.from([-1, 1]); // a shaper's input clamps at ±1: a hard clipper

/** A hard clipper or a wavefolder, driven by `amount`, mixed with the clean sound. */
export function distortion(ac: BaseAudioContext, o: DistortionOptions = {}): Fx {
  const shape = Math.min(1, Math.max(0, o.shape ?? 0)),
    mix = Math.min(1, Math.max(0, o.mix ?? 1)),
    ceiling = o.ceiling ?? 0.3,
    ref = ceiling / DIST.clip,
    drive = distDrive(Math.min(1, Math.max(0, o.amount ?? 0.5)));
  const input = ac.createGain(),
    pre = ac.createGain(),
    shaper = ac.createWaveShaper(),
    post = ac.createGain(),
    dry = ac.createGain(),
    output = ac.createGain();
  output.gain.value = o.gain ?? 1;
  dry.gain.value = 1 - mix;
  input.connect(dry).connect(output);
  input.connect(pre).connect(shaper);
  if (shape === 0) {
    pre.gain.value = drive / ceiling;
    shaper.curve = LINEAR;
    shaper.oversample = '2x';
    post.gain.value = ceiling * mix;
    shaper.connect(post);
  } else {
    pre.gain.value = drive / (DIST.foldClip * ref);
    shaper.curve = foldCurve(shape);
    shaper.oversample = '4x';
    post.gain.value = ref * mix;
    // folding makes a lot of top end: a gentle (one-pole) lowpass after it
    const p = Math.exp((-2 * Math.PI * DIST.foldLowpass) / ac.sampleRate);
    shaper.connect(ac.createIIRFilter([1 - p], [1, -p])).connect(post);
  }
  post.connect(output);
  return { input, output };
}

// ---------- compressor ----------
export interface CompressorOptions {
  /** dB (of full scale) where it starts turning down (default -24). */
  threshold?: number;
  /** Above the threshold, this many dB in for one out (default 4). */
  ratio?: number;
  /** dB of soft knee around the threshold (default 6). */
  knee?: number;
  /** Seconds for the gain to fall and to recover (defaults 0.01, 0.15). */
  attack?: number;
  release?: number;
  /** dB added after it, or 'auto': what it takes off a full-scale sound, halved (default 0). */
  makeup?: number | 'auto';
}
export interface CompressorFx extends Fx {
  /** Resolves once its own processor runs (the browser's compressor stands in if it can't). */
  readonly ready: Promise<void>;
}

/** The makeup 'auto' gives: half the reduction of a 0 dB sound. */
export const autoMakeup = (threshold: number, ratio: number) => (-threshold * (1 - 1 / ratio)) / 2;

// The DSP, in the AudioWorkletGlobalScope: no imports, nothing from this module's scope. It
// reads the mean square (an RMS level, so drums' peaks don't set it off as the browser's
// peak-reading compressor does), puts it through a soft-knee curve and smooths the gain in dB.
function registerWorklets() {
  const PARAMS: [string, number][] = [
    ['thresholdDb', -24],
    ['kneeDb', 6],
    ['slope', 0.75], // 1 - 1/ratio
    ['makeupDb', 0],
    ['detector', 0.015], // seconds of mean-square averaging
    ['attack', 0.01],
    ['release', 0.15],
  ];
  class Compressor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return PARAMS.map(([name, defaultValue]) => ({ name, defaultValue, automationRate: 'k-rate' }));
    }
    declare ms: number;
    declare g: number;
    constructor() {
      super();
      this.ms = 0;
      this.g = 0;
    }
    process(inputs: Float32Array[][], outputs: Float32Array[][], p: Record<string, Float32Array>) {
      const input = inputs[0],
        output = outputs[0],
        nch = input.length;
      if (!nch) return true;
      const n = input[0].length,
        coef = (t: number) => 1 - Math.exp(-1 / (Math.max(t, 1e-4) * sampleRate)),
        kd = coef(p.detector[0]),
        ka = coef(p.attack[0]),
        kr = coef(p.release[0]),
        T = p.thresholdDb[0],
        knee = Math.max(p.kneeDb[0], 1e-6),
        slope = p.slope[0],
        makeup = p.makeupDb[0];
      let { ms, g } = this;
      for (let i = 0; i < n; i++) {
        let pw = 0;
        for (let c = 0; c < nch; c++) pw += input[c][i] * input[c][i];
        ms += (pw / nch - ms) * kd;
        const over = 10 * Math.log10(ms + 1e-20) + 3 - T; // +3: a sine's RMS read as its peak
        const red = over > knee / 2 ? over : over < -knee / 2 ? 0 : (over + knee / 2) ** 2 / (2 * knee);
        const target = makeup - slope * red;
        g += (target - g) * (target < g ? ka : kr);
        const gain = 10 ** (g / 20);
        for (let c = 0; c < output.length; c++) output[c][i] = input[Math.min(c, nch - 1)][i] * gain;
      }
      this.ms = ms;
      this.g = g;
      return true;
    }
  }
  registerProcessor('nostalgia-compressor', Compressor);

  // The limiter: a peak follower that turns down at once (no overshoot, no look-ahead) and
  // recovers over `release`; no makeup gain, so below the ceiling the sound is untouched.
  class Limiter extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [
        { name: 'ceiling', defaultValue: 0.89, automationRate: 'k-rate' },
        { name: 'release', defaultValue: 0.1, automationRate: 'k-rate' },
      ];
    }
    declare g: number;
    constructor() {
      super();
      this.g = 1;
    }
    process(inputs: Float32Array[][], outputs: Float32Array[][], p: Record<string, Float32Array>) {
      const input = inputs[0],
        output = outputs[0],
        nch = input.length;
      if (!nch) return true;
      const n = input[0].length,
        ceiling = p.ceiling[0],
        kr = 1 - Math.exp(-1 / (Math.max(p.release[0], 1e-4) * sampleRate));
      let g = this.g;
      for (let i = 0; i < n; i++) {
        let peak = 0;
        for (let c = 0; c < nch; c++) peak = Math.max(peak, Math.abs(input[c][i]));
        const target = peak > ceiling ? ceiling / peak : 1;
        g = target < g ? target : g + (target - g) * kr;
        for (let c = 0; c < output.length; c++) output[c][i] = input[Math.min(c, nch - 1)][i] * g;
      }
      this.g = g;
      return true;
    }
  }
  registerProcessor('nostalgia-limiter', Limiter);
}
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {}

const modules = new WeakMap<BaseAudioContext, Promise<void>>();
function loadWorklets(ac: BaseAudioContext) {
  let m = modules.get(ac);
  if (!m) {
    if (!ac.audioWorklet || typeof AudioWorkletNode === 'undefined') m = Promise.reject(new Error('no AudioWorklet'));
    else {
      // a data: URL, not a Blob one: a page opened from a file has an opaque origin, and a
      // worklet from a blob:null URL fails to load there
      const code = `(${registerWorklets.toString()})();`;
      m = ac.audioWorklet.addModule('data:text/javascript,' + encodeURIComponent(code));
    }
    modules.set(ac, m);
  }
  return m;
}

/**
 * An RMS compressor with a soft knee, for evening out a voice or a bus. It is an AudioWorklet,
 * loaded on first use: until then the sound passes through, and where worklets can't run the
 * browser's DynamicsCompressor takes its place.
 */
export function compressor(ac: BaseAudioContext, o: CompressorOptions = {}): CompressorFx {
  const threshold = o.threshold ?? -24,
    ratio = Math.max(1, o.ratio ?? 4),
    knee = o.knee ?? 6,
    attack = o.attack ?? 0.01,
    release = o.release ?? 0.15,
    makeup = o.makeup === 'auto' ? autoMakeup(threshold, ratio) : (o.makeup ?? 0);
  const input = ac.createGain(),
    output = ac.createGain();
  input.connect(output);
  const swap = (node: AudioNode, after: AudioNode = node) => {
    input.disconnect();
    input.connect(node);
    after.connect(output);
  };
  const ready = loadWorklets(ac).then(
    () => {
      const node = new AudioWorkletNode(ac, 'nostalgia-compressor', { outputChannelCount: [2] });
      const set = (name: string, v: number) => (node.parameters.get(name)!.value = v);
      set('thresholdDb', threshold);
      set('kneeDb', knee);
      set('slope', 1 - 1 / ratio);
      set('makeupDb', makeup);
      set('attack', attack);
      set('release', release);
      swap(node);
    },
    () => {
      const c = ac.createDynamicsCompressor(),
        up = ac.createGain();
      c.threshold.value = threshold;
      c.ratio.value = Math.min(20, ratio);
      c.knee.value = knee;
      c.attack.value = attack;
      c.release.value = release;
      up.gain.value = 10 ** (makeup / 20);
      c.connect(up);
      swap(c, up);
    },
  );
  return { input, output, ready };
}

// ---------- limiter ----------
export interface LimiterOptions {
  /** dB of full scale nothing goes over (default -1). */
  ceiling?: number;
  /** Seconds to come back up after a peak (default 0.1). */
  release?: number;
}

/**
 * A peak limiter for the end of a mix (`inserts: { master: ac => limiter(ac) }`): it only ever
 * turns down, and only what would go over the ceiling, so it adds no makeup gain and the mix's
 * level stays what its gains say. An AudioWorklet like the compressor (passing the sound
 * through until it loads); where worklets can't run, the browser's compressor at its hardest
 * stands in, which does add some gain of its own.
 */
export function limiter(ac: BaseAudioContext, o: LimiterOptions = {}): CompressorFx {
  const ceiling = o.ceiling ?? -1,
    release = o.release ?? 0.1;
  const input = ac.createGain(),
    output = ac.createGain();
  input.connect(output);
  const swap = (node: AudioNode) => {
    input.disconnect();
    input.connect(node).connect(output);
  };
  const ready = loadWorklets(ac).then(
    () => {
      const node = new AudioWorkletNode(ac, 'nostalgia-limiter', { outputChannelCount: [2] });
      node.parameters.get('ceiling')!.value = 10 ** (ceiling / 20);
      node.parameters.get('release')!.value = release;
      swap(node);
    },
    () => {
      const c = ac.createDynamicsCompressor();
      c.threshold.value = ceiling;
      c.knee.value = 0;
      c.ratio.value = 20;
      c.attack.value = 0.001;
      c.release.value = release;
      swap(c);
    },
  );
  return { input, output, ready };
}

// ---------- soft clip ----------
const softCurves = new Map<number, Float32Array<ArrayBuffer>>();
/** tanh(drive·x) normalised to ±1 at the ends; cached per drive (to 1/100). */
export function softCurve(drive: number): Float32Array<ArrayBuffer> {
  const key = Math.round(drive * 100) / 100;
  let c = softCurves.get(key);
  if (!c) {
    const d = Math.max(key, 0.01),
      norm = Math.tanh(d);
    c = Float32Array.from({ length: 2048 }, (_, k) => Math.tanh(d * ((2 * k) / 2047 - 1)) / norm);
    softCurves.set(key, c);
  }
  return c;
}

/**
 * A soft clipper: tanh, rounding peaks instead of cutting them (grit on a noise layer, warmth
 * on a bass). `drive` sets how early it bends (1.6: gently; 5: nearly a square); full scale in
 * stays full scale out.
 */
export function softclip(ac: BaseAudioContext, { drive = 1.6 }: { drive?: number } = {}): Fx {
  const ws = ac.createWaveShaper();
  ws.curve = softCurve(drive);
  return { input: ws, output: ws };
}
