import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { createSynth, type SynthOptions, type Voices } from './index.ts';
import { sawLevels } from './instruments.ts';
import { createRecorder, type Recorder } from './mock.ts';

let rec: Recorder, restore: () => void;
beforeEach(() => {
  rec = createRecorder({ sampleRate: 100 });
  restore = rec.install();
});
afterEach(() => restore());

/** A synth whose one effect plays `play` at t = 1; returns the log from that call on. */
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
  audio.unlock();
  rec.time = 1;
  const from = rec.log.length;
  audio.sfx('go');
  return { log: rec.log.slice(from), voices };
}
const ids = (log: string[], what: string) =>
  log.filter(l => l.endsWith(`=${what}()`) || l.includes(`=${what}(`)).map(l => l.split('=')[0]);
const calls = (log: string[], who: string) => log.filter(l => l.startsWith(who + '.'));

describe('sub', () => {
  it('starts punch semitones up, drops to the note and runs through a soft clipper', () => {
    const { log } = run((v, t) => v.sub(55, t, 0.5, 0.3, { punch: 12, drop: 0.1 }));
    const [osc] = ids(log, 'createOscillator');
    expect(calls(log, osc)).toEqual(
      expect.arrayContaining([
        `${osc}.frequency.setValueAtTime(110,1)`,
        `${osc}.frequency.exponentialRampToValueAtTime(55,1.1)`,
      ]),
    );
    const [shaper] = ids(log, 'createWaveShaper');
    expect(log).toContain(`${shaper}.curve=[2048]`);
    expect(log).toContain(`${shaper}.oversample="4x"`);
    // held for the note, then a release of 0.08 s and the tail
    expect(log).toContain(`${osc}.stop(${1 + 0.5 + 0.08 + 0.05})`);
  });
});

describe('supersaw', () => {
  it('plays seven saws spread around the note, six of them panned, waves made once', () => {
    const { log, voices } = run((v, t) => v.supersaw(220, t, 0.4, 0.1, { detune: 1, width: 1 }));
    const oscs = ids(log, 'createOscillator');
    expect(oscs).toHaveLength(7);
    expect(ids(log, 'createStereoPanner')).toHaveLength(6);
    expect(ids(log, 'createPeriodicWave')).toHaveLength(7);
    const detunes = oscs.map(o => Number(log.find(l => l.startsWith(`${o}.detune=`))!.split('=')[1]));
    expect(detunes).toContain(0);
    expect(Math.min(...detunes)).toBeCloseTo(-120);
    expect(Math.max(...detunes)).toBeCloseTo(0.97 * 120);
    // a second note reuses the waves
    const from = rec.log.length;
    voices.supersaw(330, 2, 0.4, 0.1);
    expect(ids(rec.log.slice(from), 'createPeriodicWave')).toHaveLength(0);
  });

  it('keeps the level steady whatever the mix', () => {
    for (const mix of [0, 0.5, 1]) {
      const { middle, sides } = sawLevels(mix);
      expect(middle ** 2 + 6 * sides ** 2).toBeCloseTo(1);
    }
  });

  it('opens the filter with the envelope', () => {
    const { log } = run((v, t) => v.supersaw(220, t, 0.4, 0.1, { envmod: 1200 }));
    const [filter] = ids(log, 'createBiquadFilter');
    expect(log.some(l => l.endsWith(`.connect(${filter}.detune)`))).toBe(true);
    expect(log.some(l => /^#\d+\.gain=1200$/.test(l))).toBe(true); // env mod, in cents
  });
});

describe('pulse', () => {
  it('makes each pulse from a saw less its delayed copy, the width swept by one shared LFO', () => {
    const { log, voices } = run((v, t) => v.pulse(100, t, 0.3, 0.1, { width: 0, pwm: 0.5 }));
    expect(ids(log, 'createOscillator')).toHaveLength(3); // the LFO, two saws
    const delays = ids(log, 'createDelay');
    expect(delays).toHaveLength(2);
    for (const d of delays) expect(log).toContain(`${d}.delayTime=0.005`); // a square: half a period
    const from = rec.log.length;
    voices.pulse(150, 2, 0.3, 0.1);
    expect(ids(rec.log.slice(from), 'createOscillator')).toHaveLength(2); // the LFO is shared
  });
});

describe('fm', () => {
  it('with options: the index falls from its peak, the level has an ADSR', () => {
    const { log } = run((v, t) => v.fm(200, t, 0.5, 0.1, { ratio: 3.5, index: 4, modSustain: 0.25, modDecay: 0.3 }));
    const [carrier, mod] = ids(log, 'createOscillator');
    expect(log).toContain(`${carrier}.frequency=200`);
    expect(log).toContain(`${mod}.frequency=700`);
    const [index] = ids(log, 'createGain');
    expect(calls(log, `${index}.gain`)).toEqual([
      `${index}.gain.setValueAtTime(4,1)`,
      `${index}.gain.setTargetAtTime(1,1,0.09999999999999999)`,
    ]);
  });

  it('positionally, as before', () => {
    const { log } = run((v, t) => v.fm(200, t, 0.5, 0.1, 2, 3));
    const [, mod] = ids(log, 'createOscillator');
    expect(log).toContain(`${mod}.frequency=400`);
    const [mg] = ids(log, 'createGain');
    expect(log).toContain(`${mg}.gain.setValueAtTime(600,1)`);
  });
});

describe('adsr', () => {
  it('attacks, decays towards the sustain, holds until the end and releases', () => {
    const { log } = run((v, t) => v.fm(200, t, 0.5, 0.1, { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.2 }));
    const amp = ids(log, 'createGain').at(-1)!;
    expect(calls(log, `${amp}.gain`)).toEqual([
      `${amp}.gain.setValueAtTime(0,1)`,
      `${amp}.gain.linearRampToValueAtTime(0.1,1.02)`,
      `${amp}.gain.setTargetAtTime(0.05,1.02,0.09999999999999999)`,
      `${amp}.gain.setTargetAtTime(0,1.5,0.05)`,
    ]);
  });
});

describe('the PC speaker', () => {
  it('plays the richer voices as plain squares', () => {
    const { log } = run(
      (v, t) => {
        v.sub(55, t, 0.2, 0.1);
        v.supersaw(220, t, 0.2, 0.1);
        v.pulse(330, t, 0.2, 0.1);
        v.fm(440, t, 0.2, 0.1, { ratio: 2 });
      },
      { speaker: true },
    );
    expect(ids(log, 'createOscillator')).toHaveLength(4);
    expect(ids(log, 'createWaveShaper')).toHaveLength(0);
    expect(ids(log, 'createStereoPanner')).toHaveLength(0);
  });
});
