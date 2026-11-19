// The engine: an AudioContext made on the first user gesture, three gain buses, a noise
// buffer, the voices (tone, hiss, fm, notes) and a 16th-step look-ahead sequencer. What a
// game plays (its tracks, the arrangement of one step, its effects) comes from arrange().
import { chain, type Fx } from './effects.ts';
import * as inst from './instruments.ts';
import type { FmOptions, PulseOptions, SubOptions, SupersawOptions } from './instruments.ts';
import { midi } from './notes.ts';

/** An oscillator shape, or a pulse duty cycle (0.125, 0.25, 0.5) when the synth has `pulse`. */
export type Wave = OscillatorType | number;
/**
 * A track: its tempo, and optionally its level, applied after the music bus's inserts (so a
 * compressor there evens the tracks out and the level then sets each exactly); the music
 * glides to it as the track starts. Tracks without one play at 1.
 */
export interface Track {
  bpm: number;
  gain?: number;
}
export type Bus = 'music' | 'sfx';
/** Effects a score's voices can play into (v.insert()), feeding a bus or another insert. */
export interface Insert<F extends Fx = Fx> {
  /** The effect on the current context: null before unlock(), built on first use. */
  readonly fx: F | null;
}
/**
 * A continuous sound (an engine, a rotor, an alarm) on whatever context there is: built when
 * first wanted, and again on the new context after destroy() + unlock() while still wanted.
 */
export interface Loop<L> {
  /** Want it: its graph (built now if need be), or null before unlock(). */
  on(): L | null;
  /** Don't: its stop() runs (if it's on the current context) and it's forgotten. */
  off(): void;
  /** Its graph while wanted, on the current context (rebuilt there if that changed); else null. */
  readonly live: L | null;
}
/** Where a voice plays: a bus, an insert, or a node of the score's own. */
export type Target = Bus | Insert | AudioNode;
/** Makes an insert's effects on a context: one, or several in a row. */
export type FxBuilder<F extends Fx = Fx> = (ac: AudioContext) => F | readonly Fx[];

export interface Levels {
  master: number;
  music: number;
  sfx: number;
}

/** What arrange() gets: the voices, and the live graph for anything a game builds itself. */
export interface Voices {
  /** The context, null until unlock() (and again after destroy()). */
  readonly ac: AudioContext | null;
  /** One second of seeded white noise, looped by hiss(). */
  readonly noise: AudioBuffer | null;
  /** The bus nodes: music and sfx feed master. */
  readonly bus: { readonly master: GainNode; readonly music: GainNode; readonly sfx: GainNode };
  /**
   * An attack-decay envelope on g.gain: floor → peak at t + a → floor at t + dur (exponential;
   * floor is 0.0001 unless the synth sets it). With a = 0 it starts at the peak, a pluck.
   */
  env: (g: GainNode, t: number, a: number, peak: number, dur: number) => void;
  /** One oscillator note, sliding f0 → f1 (exponentially) over dur. */
  tone: (
    f0: number,
    f1: number,
    t: number,
    dur: number,
    vol: number,
    type?: Wave,
    bus?: Target,
    attack?: number,
  ) => void;
  /** Filtered noise, the cutoff sliding f0 → f1; q is set on the filter only when given. */
  hiss: (
    t: number,
    dur: number,
    vol: number,
    f0?: number,
    f1?: number,
    type?: BiquadFilterType,
    bus?: Target,
    q?: number,
    attack?: number,
  ) => void;
  /**
   * Two-operator FM: a sine carrier at f, modulated at f × ratio with a decaying index. With an
   * options object instead of the ratio: fine detune, the index's own envelope and an ADSR
   * (instruments.ts).
   */
  fm: {
    (f: number, t: number, dur: number, vol: number, ratio?: number, index?: number, bus?: Target): void;
    (f: number, t: number, dur: number, vol: number, options: FmOptions): void;
  };
  /** A sub bass: a sine punched up at the start, dropping to f, through a soft clipper. */
  sub: (f: number, t: number, dur: number, vol: number, options?: SubOptions) => void;
  /** Seven detuned saws spread in stereo, through a lowpass the envelope opens. */
  supersaw: (f: number, t: number, dur: number, vol: number, options?: SupersawOptions) => void;
  /** Two pulse waves with their width swept by an LFO (PWM), through an enveloped lowpass. */
  pulse: (f: number, t: number, dur: number, vol: number, options?: PulseOptions) => void;
  /** MIDI notes `gap` seconds apart (0 = rest), each a tone of `dur`. */
  notes: (list: readonly number[], t: number, gap: number, dur: number, vol: number, type?: Wave, bus?: Target) => void;
  /**
   * Effects (effects.ts) for voices to play into: pass the insert as their bus. It's built on
   * the context when first played into, and feeds `to` (default 'music').
   */
  insert: <F extends Fx>(build: FxBuilder<F>, to?: Target) => Insert<F>;
  /**
   * The noise buffer looping on the current context, started now from `offset` seconds in
   * (layers taken from different points don't move together); null before unlock().
   */
  noiseSource: (offset?: number) => AudioBufferSourceNode | null;
  /** A continuous sound kept on the current context (see Loop); build() makes its graph. */
  loop: <L extends { stop(): void }>(build: (ac: AudioContext) => L) => Loop<L>;
  /** Keep the music quiet until context time `until` (a jingle has the floor); it then resumes. */
  hold: (until: number) => void;
}

export type Effect = (t: number, e?: any) => void;

export interface Arrangement<T, M> {
  /** Play step i (16ths from the track's start) of a track at context time t; dt is one step. */
  step?: (track: T, i: number, t: number, dt: number) => void;
  /** sfx(name, e) plays effects[name](now, e). */
  effects: Record<string, Effect>;
  /** Extra methods merged into the returned object (a continuous loop, say). */
  methods?: M;
}

export interface SynthOptions<T extends Track, M> {
  /** Start with sound on (default true). */
  on?: boolean;
  /** Bus gains; master is the "on" level setOn() ramps to. */
  levels: Levels;
  /** Seed of the noise buffer (each game keeps its own). */
  seed: number;
  /** Length of the noise buffer hiss() loops, seconds (default 1). */
  noiseLength?: number;
  /** The music; a synth without tracks plays effects only and runs no sequencer. A track's
   * `gain`, if any has one, is its level after the music bus's inserts. */
  tracks?: Record<string, T>;
  arrange: (v: Voices) => Arrangement<T, M>;
  /** tone()'s default attack, seconds (default 0.004); 0 starts every tone at its peak. */
  attack?: number;
  /** The level envelopes start from and decay to (default 0.0001). */
  floor?: number;
  /** How long a voice keeps running after its envelope ends, before stop() (default 0.05 s). */
  tail?: number;
  /** sfx() plays an effect this long after the context clock (default 0.005 s). */
  lead?: number;
  /** Build pulse waves so a numeric tone type is a duty cycle (default false). */
  pulse?: boolean;
  /**
   * The PC speaker (default false): every tone a square switched on and off (no envelope),
   * noise a buzz of short clicks, and the output through a small cone (highpass 180 Hz,
   * lowpass 4200 Hz).
   */
  speaker?: boolean;
  /**
   * A slap-back echo, on the music bus unless `bus` says otherwise: delay time, feedback and
   * wet gains, and `cut`, a lowpass inside the loop that darkens each repeat (the wet signal
   * is taken after it).
   */
  echo?: { time: number; feedback: number; wet: number; cut?: number; bus?: Bus } | false;
  /**
   * Effects on a whole bus (effects.ts), after its level: a compressor on the music evens out
   * the tracks, one on master the whole mix.
   */
  inserts?: Partial<Record<'master' | Bus, FxBuilder>>;
  /** A compressor between master and the speakers: true for the browser's defaults, or its settings. */
  compressor?: boolean | Partial<Record<'threshold' | 'knee' | 'ratio' | 'attack' | 'release', number>>;
  /** When music() was asked for before unlock(), its first step plays this long after (default 0.05 s). */
  startDelay?: number;
}

export interface Synth {
  /** Make (or resume) the context; call from a user gesture. Safe to call on every one. */
  unlock(): void;
  /** Mute or unmute, with a short ramp. */
  setOn(on: boolean): void;
  /** Play an effect now; nothing before unlock(), while muted, or for an unknown name. */
  sfx(name: string, e?: unknown): void;
  /** Switch tracks (null stops); the same name again keeps playing. */
  music(name: string | null): void;
  /** Stop the sequencer and close the context. */
  destroy(): void;
  readonly on: boolean;
}

const TICK = 40; // ms between scheduler runs
const AHEAD = 0.2; // seconds scheduled ahead of the clock
const NEXT = 0.08; // a new track's first step, from now

export function createSynth<T extends Track, M extends object = object>(opts: SynthOptions<T, M>): Synth & M {
  const { levels, seed, tracks = {}, attack = 0.004, pulse = false, speaker = false, echo = false } = opts;
  const { noiseLength = 1, floor = 0.0001, tail = 0.05, lead = 0.005, compressor = false } = opts;
  const startDelay = opts.startDelay ?? 0.05;
  const sequenced = Object.keys(tracks).length > 0;
  const trackGains = Object.values(tracks).some(t => t.gain !== undefined);
  let ac: AudioContext | null = null,
    master: GainNode | null = null,
    musicBus: GainNode | null = null,
    musicOut: GainNode | null = null,
    sfxBus: GainNode | null = null,
    noise: AudioBuffer | null = null;
  const waves: Record<number, PeriodicWave> = {};
  let soundOn = opts.on ?? true,
    trackName: string | null = null,
    track: T | null = null,
    i = 0,
    nextT = 0,
    timer: ReturnType<typeof setInterval> | 0 = 0,
    holdUntil = 0;

  // a hidden tab (another tab, minimised, the iOS app in the background) hears nothing: the
  // context is suspended, which also stops its clock, so the score goes on from where it was
  let awaySuspended = false;
  function visibility() {
    if (!ac || ac.state === 'closed') return;
    if (document.visibilityState === 'hidden') {
      if (ac.state !== 'running') return;
      awaySuspended = true;
      void ac.suspend().catch(() => {});
    } else if (awaySuspended) {
      awaySuspended = false;
      void ac.resume().catch(() => {});
    }
  }
  const watch = (on: boolean) => {
    if (typeof document === 'undefined') return;
    if (on) document.addEventListener('visibilitychange', visibility);
    else document.removeEventListener('visibilitychange', visibility);
  };

  function unlock() {
    if (ac) {
      // not only 'suspended': iOS leaves it 'interrupted' (a call, Siri, another app) until told
      if (ac.state !== 'running' && ac.state !== 'closed') void ac.resume().catch(() => {});
      return;
    }
    try {
      ac = new AudioContext();
    } catch {
      ac = null;
      return;
    }
    watch(true);
    master = ac.createGain();
    master.gain.value = soundOn ? levels.master : 0;
    const into = (bus: 'master' | Bus, node: GainNode, to: AudioNode) => {
      const build = opts.inserts?.[bus];
      if (!build) return node.connect(to);
      const fx = built(build);
      node.connect(fx.input);
      fx.output.connect(to);
    };
    let out: AudioNode = ac.destination;
    if (compressor) {
      const c = ac.createDynamicsCompressor();
      if (compressor !== true)
        for (const [k, v] of Object.entries(compressor)) c[k as keyof typeof compressor].value = v;
      c.connect(ac.destination);
      out = c;
    }
    if (speaker) {
      // a small paper cone: no deep bass, no sparkle
      const hp = ac.createBiquadFilter(),
        lp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 180;
      lp.type = 'lowpass';
      lp.frequency.value = 4200;
      into('master', master, hp);
      hp.connect(lp).connect(out);
    }
    if (!speaker) into('master', master, out);
    musicBus = ac.createGain();
    musicBus.gain.value = levels.music;
    if (trackGains) {
      // each track's own level, after the inserts (a compressor there evens them out first)
      musicOut = ac.createGain();
      musicOut.gain.value = track?.gain ?? 1;
      musicOut.connect(master);
    }
    into('music', musicBus, musicOut ?? master);
    sfxBus = ac.createGain();
    sfxBus.gain.value = levels.sfx;
    into('sfx', sfxBus, master);
    if (echo) {
      const d = ac.createDelay(1),
        fb = ac.createGain(),
        wet = ac.createGain();
      d.delayTime.value = echo.time;
      fb.gain.value = echo.feedback;
      wet.gain.value = echo.wet;
      busNode(echo.bus ?? 'music').connect(d);
      let tap: AudioNode = d;
      if (echo.cut) {
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = echo.cut;
        d.connect(lp);
        tap = lp;
      }
      tap.connect(fb).connect(d);
      tap.connect(wet).connect(master);
    }
    noise = ac.createBuffer(1, ac.sampleRate * noiseLength, ac.sampleRate);
    const data = noise.getChannelData(0);
    let s = seed;
    for (let k = 0; k < data.length; k++) {
      s = (s * 16807) % 2147483647;
      data[k] = (s / 2147483647) * 2 - 1;
    }
    if (pulse) {
      // pulse waves at a few duty cycles, the chip's signature colour
      for (const duty of [0.125, 0.25, 0.5]) {
        const n = 32,
          re = new Float32Array(n),
          im = new Float32Array(n);
        for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
        waves[duty] = ac.createPeriodicWave(re, im);
      }
    }
    if (sequenced) timer = setInterval(schedule, TICK);
    if (track) {
      i = 0;
      nextT = ac.currentTime + startDelay;
    }
  }

  function setOn(on: boolean) {
    soundOn = on;
    if (ac && master) master.gain.setTargetAtTime(on ? levels.master : 0, ac.currentTime, 0.02);
  }

  // ---------- voices ----------
  const built = (build: FxBuilder): Fx => {
    const fx = build(ac!);
    return 'input' in fx ? fx : chain(ac!, fx);
  };
  // each insert's effects on each context, made when first played into
  const inserts = new WeakMap<Insert, { ac: AudioContext; fx: Fx }>();
  function insert<F extends Fx>(build: FxBuilder<F>, to: Target = 'music'): Insert<F> {
    const ins: Insert<F> = {
      get fx() {
        if (!ac) return null;
        let made = inserts.get(ins);
        if (made?.ac !== ac) {
          made = { ac, fx: built(build) };
          made.fx.output.connect(busNode(to));
          inserts.set(ins, made);
        }
        return made.fx as F;
      },
    };
    return ins;
  }
  function noiseSource(offset = 0) {
    if (!ac || !noise) return null;
    const s = ac.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.start(ac.currentTime, offset);
    return s;
  }
  function loop<L extends { stop(): void }>(build: (ac: AudioContext) => L): Loop<L> {
    let want = false,
      made: { ac: AudioContext; it: L } | null = null;
    const live = () => {
      if (!want || !ac) return null;
      if (made?.ac !== ac) made = { ac, it: build(ac) };
      return made.it;
    };
    return {
      on() {
        want = true;
        return live();
      },
      off() {
        want = false;
        if (made && made.ac === ac && ac.state !== 'closed') made.it.stop();
        made = null;
      },
      get live() {
        return live();
      },
    };
  }
  const busNode = (b: Target): AudioNode =>
    b === 'music' ? musicBus! : b === 'sfx' ? sfxBus! : 'fx' in b ? b.fx!.input : b;
  function env(g: GainNode, t: number, a: number, peak: number, dur: number) {
    peak = Math.max(floor, peak); // a silent voice (a level faded to 0) mustn't throw
    // silent until t: a source can start a fraction of a sample early, and a gain still at its
    // default 1 then lets one sample through at full level, a click
    g.gain.value = 0;
    if (a > 0) {
      g.gain.setValueAtTime(floor, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
    } else g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(floor, t + dur);
  }
  function tone(
    f0: number,
    f1: number,
    t: number,
    dur: number,
    vol: number,
    type: Wave = 'square',
    bus: Target = 'sfx',
    a = attack,
  ) {
    const o = ac!.createOscillator(),
      g = ac!.createGain();
    if (speaker) o.type = 'square';
    else if (typeof type === 'number') o.setPeriodicWave(waves[type]);
    else o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    if (speaker) {
      // the speaker is on or off
      g.gain.setValueAtTime(vol, t);
      g.gain.setValueAtTime(0, t + dur);
    } else env(g, t, a, vol, dur);
    o.connect(g).connect(busNode(bus));
    o.start(t);
    o.stop(t + dur + tail);
  }
  function hiss(
    t: number,
    dur: number,
    vol: number,
    f0 = 3000,
    f1 = 300,
    type: BiquadFilterType = 'lowpass',
    bus: Target = 'sfx',
    q?: number,
    a = 0.004,
  ) {
    if (speaker) {
      // a buzz of random clicks instead of noise
      for (let k = 0, n = Math.max(1, Math.round(dur / 0.012)); k < n; k++)
        tone(f1 + (((k * 7919) % 13) * (f0 - f1)) / 13, f1, t + k * 0.012, 0.008, vol * 0.5, 0.5, bus);
      return;
    }
    const s = ac!.createBufferSource(),
      f = ac!.createBiquadFilter(),
      g = ac!.createGain();
    s.buffer = noise;
    s.loop = true;
    f.type = type;
    if (q !== undefined) f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    env(g, t, a, vol, dur);
    s.connect(f).connect(g).connect(busNode(bus));
    s.start(t, Math.random());
    s.stop(t + dur + tail);
  }
  // the richer voices (instruments.ts); the PC speaker plays them as plain squares
  const kit = (): inst.Kit => ({ ac: ac!, out: busNode, tail });
  const square = (f: number, t: number, dur: number, vol: number, o?: { bus?: Target; release?: number }) =>
    tone(f, f, t, dur + (o?.release ?? 0), vol, 0.5, o?.bus ?? 'music');
  const sub = (f: number, t: number, dur: number, vol: number, o?: SubOptions) =>
    speaker ? square(f, t, dur, vol, o) : inst.sub(kit(), f, t, dur, vol, o);
  const supersaw = (f: number, t: number, dur: number, vol: number, o?: SupersawOptions) =>
    speaker ? square(f, t, dur, vol, o) : inst.supersaw(kit(), f, t, dur, vol, o);
  const pulseVoice = (f: number, t: number, dur: number, vol: number, o?: PulseOptions) =>
    speaker ? square(f, t, dur, vol, o) : inst.pulse(kit(), f, t, dur, vol, o);
  function fm(
    f: number,
    t: number,
    dur: number,
    vol: number,
    ratio: number | FmOptions = 2,
    index = 2,
    bus: Target = 'music',
  ) {
    if (typeof ratio === 'object') {
      if (speaker) square(f, t, dur, vol, ratio);
      else inst.fm(kit(), f, t, dur, vol, ratio);
      return;
    }
    const c = ac!.createOscillator(),
      m = ac!.createOscillator(),
      mg = ac!.createGain(),
      g = ac!.createGain();
    c.frequency.value = f;
    m.frequency.value = f * ratio;
    mg.gain.setValueAtTime(f * index, t);
    mg.gain.exponentialRampToValueAtTime(f * index * 0.15 + 1, t + dur);
    m.connect(mg).connect(c.frequency);
    env(g, t, 0.008, vol, dur);
    c.connect(g).connect(busNode(bus));
    c.start(t);
    m.start(t);
    c.stop(t + dur + tail);
    m.stop(t + dur + tail);
  }
  const notes = (
    list: readonly number[],
    t: number,
    gap: number,
    dur: number,
    vol: number,
    type?: Wave,
    bus?: Target,
  ) => list.forEach((n, k) => n && tone(midi(n), midi(n), t + k * gap, dur, vol, type, bus));
  const hold = (until: number) => {
    holdUntil = Math.max(holdUntil, until);
  };

  const voices: Voices = {
    get ac() {
      return ac;
    },
    get noise() {
      return noise;
    },
    bus: {
      get master() {
        return master!;
      },
      get music() {
        return musicBus!;
      },
      get sfx() {
        return sfxBus!;
      },
    },
    env,
    tone,
    hiss,
    fm: fm as Voices['fm'],
    sub,
    supersaw,
    pulse: pulseVoice,
    notes,
    insert,
    noiseSource,
    loop,
    hold,
  };
  const { step, effects, methods } = opts.arrange(voices);

  // ---------- music ----------
  function music(name: string | null) {
    if (name === trackName) return;
    trackName = name;
    track = name ? tracks[name] : null;
    i = 0;
    if (ac) nextT = Math.max(ac.currentTime + NEXT, holdUntil);
    if (ac && musicOut && track) musicOut.gain.setTargetAtTime(track.gain ?? 1, nextT, 0.15);
  }
  function schedule() {
    if (!ac || !track) return;
    const dt = 60 / track.bpm / 4;
    while (nextT < ac.currentTime + AHEAD) {
      if (nextT >= holdUntil) step?.(track, i, nextT, dt);
      i++;
      nextT += dt;
    }
  }

  // ---------- effects ----------
  function sfx(name: string, e?: unknown) {
    if (!ac || !soundOn || !effects[name]) return;
    effects[name](ac.currentTime + lead, e);
  }

  function destroy() {
    clearInterval(timer);
    watch(false);
    awaySuspended = false;
    // an OfflineAudioContext (render harnesses) has no close()
    if (ac && typeof ac.close === 'function') void ac.close().catch(() => {});
    ac = null;
  }

  const api: Synth = {
    unlock,
    setOn,
    sfx,
    music,
    destroy,
    get on() {
      return soundOn;
    },
  };
  return Object.assign(api, methods) as Synth & M;
}
