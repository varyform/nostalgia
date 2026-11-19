import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import {
  autoMakeup,
  compressor,
  createSynth,
  delay,
  distortion,
  limiter,
  softclip,
  softCurve,
  type SynthOptions,
  type Voices,
} from './index.ts';
import { foldCurve } from './effects.ts';
import { createRecorder, type Recorder } from './mock.ts';

let rec: Recorder, restore: () => void;
beforeEach(() => {
  rec = createRecorder({ sampleRate: 100 });
  restore = rec.install();
});
afterEach(() => restore());

const id = (node: unknown) => '#' + (node as { id: number }).id;
const made = (log: string[], what: string) => log.filter(l => l.includes(`=${what}(`)).map(l => l.split('=')[0]);
/** A synth whose `go` effect runs `play`; the log from unlock() on. */
function run(play: (v: Voices, t: number) => void, extra: Partial<SynthOptions<{ bpm: number }, object>> = {}) {
  let voices!: Voices;
  const audio = createSynth({
    seed: 1,
    levels: { master: 0.5, music: 0.3, sfx: 0.7 },
    lead: 0,
    ...extra,
    arrange: v => {
      voices = v;
      return { effects: { go: t => play(v, t) } };
    },
  });
  const from = rec.log.length;
  audio.unlock();
  audio.sfx('go');
  return { log: rec.log.slice(from), voices, audio };
}

describe('delay', () => {
  it('keeps the dry sound beside a mono, panned echo with feedback (and a darkening loop)', () => {
    const ac = new AudioContext();
    const fx = delay(ac, { time: 0.25, feedback: 0.5, wet: 0.4, pan: -0.5, cut: 2000 });
    expect(fx.time.value).toBe(0.25);
    expect(fx.feedback.value).toBe(0.5);
    expect(fx.wet.value).toBe(0.4);
    const [d] = made(rec.log, 'createDelay');
    const [lp] = made(rec.log, 'createBiquadFilter');
    expect(rec.log).toContain(`${d}.connect(${lp})`);
    expect(rec.log).toContain(`${lp}.frequency=2000`);
    expect(rec.log).toContain(`${made(rec.log, 'createStereoPanner')[0]}.pan=-0.5`);
    expect(rec.log).toContain(`${id(fx.input)}.connect(${made(rec.log, 'createGain')[4]})`); // dry
  });
});

describe('distortion', () => {
  it('clips at the ceiling with no drive, harder with it', () => {
    const ac = new AudioContext();
    distortion(ac, { amount: 0, ceiling: 0.25 });
    const gains = made(rec.log, 'createGain');
    expect(rec.log).toContain(`${gains[1]}.gain=4`); // into the clipper: ±0.25 → ±1
    expect(rec.log).toContain(`${gains[2]}.gain=0.25`); // and back
    const from = rec.log.length;
    distortion(ac, { amount: 1, ceiling: 0.25 });
    const pre = made(rec.log.slice(from), 'createGain')[1];
    const into = Number(rec.log.find(l => l.startsWith(`${pre}.gain=`))!.split('=')[1]);
    expect(20 * Math.log10(into / 4)).toBeCloseTo(24.25);
  });

  it('folds with a shape, through a one-pole lowpass; curves are made once per shape', () => {
    const ac = new AudioContext();
    distortion(ac, { shape: 0.5, mix: 0.5 });
    expect(made(rec.log, 'createIIRFilter')).toHaveLength(1);
    expect(rec.log.some(l => l.endsWith('.curve=[4096]'))).toBe(true);
    expect(foldCurve(0.5)).toBe(foldCurve(0.501));
    expect(Math.max(...foldCurve(1).map(Math.abs))).toBeGreaterThan(2);
  });
});

describe('compressor', () => {
  it('passes the sound through, then the browser compressor stands in where worklets cannot run', async () => {
    const ac = new AudioContext();
    const fx = compressor(ac, { threshold: -30, ratio: 3, makeup: 'auto' });
    expect(rec.log).toContain(`${id(fx.input)}.connect(${id(fx.output)})`);
    await fx.ready;
    const [c] = made(rec.log, 'createDynamicsCompressor');
    expect(rec.log).toContain(`${c}.threshold=-30`);
    expect(rec.log).toContain(`${c}.ratio=3`);
    expect(rec.log).toContain(`${id(fx.input)}.connect(${c})`);
    const up = made(rec.log, 'createGain').at(-1)!;
    expect(rec.log).toContain(`${up}.gain=${10 ** (autoMakeup(-30, 3) / 20)}`);
    expect(autoMakeup(-30, 3)).toBeCloseTo(10);
  });
});

describe('inserts', () => {
  it('a voice plays into an insert, built once per context, feeding its bus', () => {
    let crunch!: ReturnType<Voices['insert']>;
    const { log, voices, audio } = run((v, t) => {
      crunch ??= v.insert(ac => [distortion(ac), delay(ac)], 'sfx');
      v.tone(440, 440, t, 0.1, 0.1, 'square', crunch);
      v.sub(55, t, 0.1, 0.1, { bus: crunch });
    });
    expect(made(log, 'createWaveShaper')).toHaveLength(2); // the distortion's, the sub's
    expect(log).toContain(`${id(crunch.fx!.output)}.connect(${id(voices.bus.sfx)})`);
    audio.sfx('go');
    expect(made(rec.log, 'createDelay')).toHaveLength(1);
    // a new context (after destroy) builds it again
    audio.destroy();
    expect(crunch.fx).toBeNull();
    audio.unlock();
    audio.sfx('go');
    expect(made(rec.log, 'createDelay')).toHaveLength(2);
  });

  it('on a whole bus: after its level, before master', () => {
    let fx!: ReturnType<typeof delay>;
    const { log, voices } = run(() => {}, { inserts: { music: ac => (fx = delay(ac)) } });
    expect(log).toContain(`${id(voices.bus.music)}.connect(${id(fx.input)})`);
    expect(log).toContain(`${id(fx.output)}.connect(${id(voices.bus.master)})`);
    expect(log).not.toContain(`${id(voices.bus.music)}.connect(${id(voices.bus.master)})`);
  });
});

describe('limiter', () => {
  it('passes the sound through, then a hard browser compressor stands in where worklets cannot run', async () => {
    const ac = new AudioContext();
    const fx = limiter(ac, { ceiling: -3 });
    expect(rec.log).toContain(`${id(fx.input)}.connect(${id(fx.output)})`);
    await fx.ready;
    const [c] = made(rec.log, 'createDynamicsCompressor');
    expect(rec.log).toContain(`${c}.threshold=-3`);
    expect(rec.log).toContain(`${c}.ratio=20`);
    expect(rec.log).toContain(`${c}.connect(${id(fx.output)})`);
  });
});

describe('track gains', () => {
  type T = { bpm: number; gain?: number };
  const synth = (tracks: Record<string, T>, extra = {}) =>
    createSynth<T>({
      seed: 1,
      levels: { master: 0.5, music: 0.3, sfx: 0.7 },
      tracks,
      ...extra,
      arrange: () => ({ step() {}, effects: {} }),
    });

  it('a level after the music inserts, which the music glides to as a track starts', () => {
    let fx!: ReturnType<typeof delay>;
    const audio = synth(
      { a: { bpm: 120, gain: 2 }, b: { bpm: 120 } },
      { inserts: { music: (ac: AudioContext) => (fx = delay(ac)) } },
    );
    audio.music('a');
    audio.unlock();
    const post = rec.log
      .find(l => l.startsWith(`${id(fx.output)}.connect(`))!
      .slice(`${id(fx.output)}.connect(`.length, -1);
    expect(rec.log).toContain(`${post}.gain=2`);
    rec.time = 1;
    audio.music('b');
    expect(rec.log.at(-1)).toMatch(new RegExp(`^${post}\\.gain\\.setTargetAtTime\\(1,`));
  });

  it('no extra node when no track has a gain', () => {
    const audio = synth({ a: { bpm: 120 } });
    const from = rec.log.length;
    audio.unlock();
    expect(made(rec.log.slice(from), 'createGain')).toHaveLength(3); // master, music, sfx
  });
});

describe('loops', () => {
  it('built when wanted, stopped when not, and rebuilt on a new context while wanted', () => {
    let builds = 0,
      stops = 0;
    const { voices, audio } = run(() => {});
    const engine = voices.loop(() => {
      builds++;
      return { stop: () => stops++ };
    });
    expect(engine.on()).not.toBeNull();
    expect(engine.live).toBe(engine.live);
    expect(builds).toBe(1);
    audio.destroy();
    expect(engine.live).toBeNull();
    audio.unlock();
    expect(engine.live).not.toBeNull(); // still wanted: on the new context
    expect(builds).toBe(2);
    engine.off();
    expect(stops).toBe(1);
    expect(engine.live).toBeNull();
  });

  it('nothing before unlock()', () => {
    const audio = createSynth({
      seed: 1,
      levels: { master: 1, music: 1, sfx: 1 },
      arrange: v => ({ effects: {}, methods: { v } }),
    });
    const l = audio.v.loop(() => ({ stop() {} }));
    expect(l.on()).toBeNull();
    audio.unlock();
    expect(l.live).not.toBeNull();
  });
});

describe('softclip', () => {
  it('a tanh curve, full scale in → full scale out, made once per drive', () => {
    const ac = new AudioContext();
    const fx = softclip(ac, { drive: 1.6 });
    expect(fx.input).toBe(fx.output);
    const c = softCurve(1.6);
    expect(c[0]).toBeCloseTo(-1);
    expect(c[2047]).toBeCloseTo(1);
    expect(c[1536]).toBeCloseTo(Math.tanh(1.6 * (3072 / 2047 - 1)) / Math.tanh(1.6), 6);
    expect(softCurve(1.601)).toBe(c);
  });
});

describe('noise sources', () => {
  it('the noise buffer looping on the current context, from an offset; none before unlock()', () => {
    const audio = createSynth({
      seed: 1,
      levels: { master: 1, music: 1, sfx: 1 },
      noiseLength: 2,
      arrange: v => ({ effects: {}, methods: { v } }),
    });
    expect(audio.v.noiseSource(0.3)).toBeNull();
    audio.unlock();
    rec.time = 1;
    const s = audio.v.noiseSource(0.3)!;
    expect(s.loop).toBe(true);
    expect(rec.log).toContain(`${id(s)}.start(1,0.3)`);
  });
});

describe('silent voices', () => {
  it('a voice at volume 0 plays at the floor instead of throwing', () => {
    expect(() =>
      run((v, t) => {
        v.tone(440, 440, t, 0.1, 0, 'square');
        v.hiss(t, 0.1, 0);
      }),
    ).not.toThrow();
  });
});

describe('destroy', () => {
  it('copes with a context that has no close() (an OfflineAudioContext in a render harness)', () => {
    const audio = createSynth({ seed: 1, levels: { master: 1, music: 1, sfx: 1 }, arrange: () => ({ effects: {} }) });
    audio.unlock();
    const ctx = rec.log.find(l => l.includes('=AudioContext('))?.split('=')[0];
    const proto = Object.getPrototypeOf(new AudioContext()) as { close?: unknown };
    const close = proto.close;
    delete proto.close;
    try {
      expect(() => audio.destroy()).not.toThrow();
    } finally {
      proto.close = close;
    }
    expect(rec.log).not.toContain(`${ctx}.close()`);
  });
});

describe('hidden tab', () => {
  it('suspends the context while hidden and resumes it when shown; not after destroy', () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const prev = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = doc;
    try {
      const audio = createSynth({ seed: 1, levels: { master: 1, music: 1, sfx: 1 }, arrange: () => ({ effects: {} }) });
      audio.unlock();
      const ctx = rec.log.find(l => l.includes('=new AudioContext()'))!.split('=')[0];
      const flip = (v: string) => {
        doc.visibilityState = v;
        doc.dispatchEvent(new Event('visibilitychange'));
      };
      flip('hidden');
      expect(rec.log.at(-1)).toBe(`${ctx}.suspend()`);
      flip('visible');
      expect(rec.log.at(-1)).toBe(`${ctx}.resume()`);
      audio.destroy();
      const from = rec.log.length;
      flip('hidden');
      expect(rec.log.length).toBe(from);
    } finally {
      (globalThis as { document?: unknown }).document = prev;
    }
  });
});
