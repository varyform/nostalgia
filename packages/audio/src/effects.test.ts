import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { autoMakeup, compressor, createSynth, delay, distortion, type SynthOptions, type Voices } from './index.ts';
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
