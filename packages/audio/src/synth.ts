// The engine: an AudioContext made on the first user gesture, three gain buses, a noise
// buffer, the voices (tone, hiss, fm, notes) and a 16th-step look-ahead sequencer. What a
// game plays (its tracks, the arrangement of one step, its effects) comes from arrange().
import { midi } from './notes.ts';

/** An oscillator shape, or a pulse duty cycle (0.125, 0.25, 0.5) when the synth has `pulse`. */
export type Wave = OscillatorType | number;
export type Bus = 'music' | 'sfx';

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
  /** An attack-decay envelope on g.gain: 0.0001 → peak at t + a → 0.0001 at t + dur (exponential). */
  env: (g: GainNode, t: number, a: number, peak: number, dur: number) => void;
  /** One oscillator note, sliding f0 → f1 (exponentially) over dur. */
  tone: (f0: number, f1: number, t: number, dur: number, vol: number, type?: Wave, bus?: Bus, attack?: number) => void;
  /** Filtered noise, the cutoff sliding f0 → f1; q is set on the filter only when given. */
  hiss: (
    t: number,
    dur: number,
    vol: number,
    f0?: number,
    f1?: number,
    type?: BiquadFilterType,
    bus?: Bus,
    q?: number,
  ) => void;
  /** Two-operator FM: a sine carrier at f, modulated at f × ratio with a decaying index. */
  fm: (f: number, t: number, dur: number, vol: number, ratio?: number, index?: number, bus?: Bus) => void;
  /** MIDI notes `gap` seconds apart (0 = rest), each a tone of `dur`. */
  notes: (list: readonly number[], t: number, gap: number, dur: number, vol: number, type?: Wave, bus?: Bus) => void;
  /** Keep the music quiet until context time `until` (a jingle has the floor); it then resumes. */
  hold: (until: number) => void;
}

export type Effect = (t: number, e?: any) => void;

export interface Arrangement<T, M> {
  /** Play step i (16ths from the track's start) of a track at context time t; dt is one step. */
  step: (track: T, i: number, t: number, dt: number) => void;
  /** sfx(name, e) plays effects[name](now, e). */
  effects: Record<string, Effect>;
  /** Extra methods merged into the returned object (a continuous loop, say). */
  methods?: M;
}

export interface SynthOptions<T extends { bpm: number }, M> {
  /** Start with sound on (default true). */
  on?: boolean;
  /** Bus gains; master is the "on" level setOn() ramps to. */
  levels: Levels;
  /** Seed of the noise buffer (each game keeps its own). */
  seed: number;
  tracks: Record<string, T>;
  arrange: (v: Voices) => Arrangement<T, M>;
  /** tone()'s default attack, seconds (default 0.004). */
  attack?: number;
  /** Build pulse waves so a numeric tone type is a duty cycle (default false). */
  pulse?: boolean;
  /**
   * The PC speaker (default false): every tone a square switched on and off (no envelope),
   * noise a buzz of short clicks, and the output through a small cone (highpass 180 Hz,
   * lowpass 4200 Hz).
   */
  speaker?: boolean;
  /** A slap-back echo on the music bus: delay time, feedback and wet gains. */
  echo?: { time: number; feedback: number; wet: number } | false;
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

export function createSynth<T extends { bpm: number }, M extends object = object>(opts: SynthOptions<T, M>): Synth & M {
  const { levels, seed, tracks, attack = 0.004, pulse = false, speaker = false, echo = false } = opts;
  const startDelay = opts.startDelay ?? 0.05;
  let ac: AudioContext | null = null,
    master: GainNode | null = null,
    musicBus: GainNode | null = null,
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

  function unlock() {
    if (ac) {
      if (ac.state === 'suspended') void ac.resume().catch(() => {});
      return;
    }
    try {
      ac = new AudioContext();
    } catch {
      ac = null;
      return;
    }
    master = ac.createGain();
    master.gain.value = soundOn ? levels.master : 0;
    if (speaker) {
      // a small paper cone: no deep bass, no sparkle
      const hp = ac.createBiquadFilter(),
        lp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 180;
      lp.type = 'lowpass';
      lp.frequency.value = 4200;
      master.connect(hp).connect(lp).connect(ac.destination);
    } else master.connect(ac.destination);
    musicBus = ac.createGain();
    musicBus.gain.value = levels.music;
    musicBus.connect(master);
    sfxBus = ac.createGain();
    sfxBus.gain.value = levels.sfx;
    sfxBus.connect(master);
    if (echo) {
      const d = ac.createDelay(1),
        fb = ac.createGain(),
        wet = ac.createGain();
      d.delayTime.value = echo.time;
      fb.gain.value = echo.feedback;
      wet.gain.value = echo.wet;
      musicBus.connect(d);
      d.connect(fb).connect(d);
      d.connect(wet).connect(master);
    }
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
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
    timer = setInterval(schedule, TICK);
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
  const busNode = (b: Bus) => (b === 'music' ? musicBus : sfxBus)!;
  function env(g: GainNode, t: number, a: number, peak: number, dur: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function tone(
    f0: number,
    f1: number,
    t: number,
    dur: number,
    vol: number,
    type: Wave = 'square',
    bus: Bus = 'sfx',
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
    o.stop(t + dur + 0.05);
  }
  function hiss(
    t: number,
    dur: number,
    vol: number,
    f0 = 3000,
    f1 = 300,
    type: BiquadFilterType = 'lowpass',
    bus: Bus = 'sfx',
    q?: number,
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
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    env(g, t, 0.004, vol, dur);
    s.connect(f).connect(g).connect(busNode(bus));
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }
  function fm(f: number, t: number, dur: number, vol: number, ratio = 2, index = 2, bus: Bus = 'music') {
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
    c.stop(t + dur + 0.05);
    m.stop(t + dur + 0.05);
  }
  const notes = (list: readonly number[], t: number, gap: number, dur: number, vol: number, type?: Wave, bus?: Bus) =>
    list.forEach((n, k) => n && tone(midi(n), midi(n), t + k * gap, dur, vol, type, bus));
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
    fm,
    notes,
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
  }
  function schedule() {
    if (!ac || !track) return;
    const dt = 60 / track.bpm / 4;
    while (nextT < ac.currentTime + AHEAD) {
      if (nextT >= holdUntil) step(track, i, nextT, dt);
      i++;
      nextT += dt;
    }
  }

  // ---------- effects ----------
  function sfx(name: string, e?: unknown) {
    if (!ac || !soundOn || !effects[name]) return;
    effects[name](ac.currentTime + 0.005, e);
  }

  function destroy() {
    clearInterval(timer);
    if (ac) void ac.close().catch(() => {});
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
