import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { createSynth, line, midi, seq, span, type SynthOptions } from './index.ts';
import { createRecorder, type Recorder } from './mock.ts';

type Track = { bpm: number; lead: number[] };
const TRACKS: Record<string, Track> = {
  a: { bpm: 150, lead: [60, -1, 0, 64] }, // a 16th = 0.1 s
  b: { bpm: 75, lead: [67] },
};

let rec: Recorder, restore: () => void;
beforeEach(() => {
  rec = createRecorder({ sampleRate: 100 });
  restore = rec.install();
});
afterEach(() => restore());

function setup(extra: Partial<SynthOptions<Track, object>> = {}) {
  const steps: string[] = [];
  const audio = createSynth({
    seed: 3,
    levels: { master: 0.5, music: 0.3, sfx: 0.7 },
    tracks: TRACKS,
    ...extra,
    arrange: v => ({
      step(tr, i, t) {
        steps.push(`${tr.bpm}:${i}@${t.toFixed(3)}`);
        const n = tr.lead[i % tr.lead.length];
        if (n > 0) v.tone(midi(n), midi(n), t, 0.05, 0.1, 'triangle', 'music');
      },
      effects: {
        beep: t => v.tone(440, 880, t, 0.1, 0.2),
        noise: t => v.hiss(t, 0.05, 0.1, 4000, 1000, 'bandpass'),
        jingle: t => v.hold(t + 1),
      },
    }),
  });
  return { audio, steps, log: rec.log };
}
const made = (log: string[], what: string) => log.filter(l => l.endsWith(`=${what}()`)).length;

describe('createSynth', () => {
  it('makes no context before unlock(), and stays silent until then', () => {
    const { audio, log } = setup();
    audio.music('a');
    audio.sfx('beep');
    rec.tick(10);
    expect(log).toEqual([]);
  });

  it('unlocks once; later gestures only resume a suspended context', () => {
    const { audio, log } = setup();
    audio.unlock();
    const n = log.length;
    expect(log.filter(l => l.endsWith('=new AudioContext()'))).toHaveLength(1);
    expect(log).toContain('setInterval(1,40)');
    audio.unlock();
    expect(log).toHaveLength(n);
    rec.suspend();
    audio.unlock();
    expect(log.slice(n)).toEqual([`${log[0].split('=')[0]}.resume()`]);
  });

  it('survives a browser without audio, and tries again on the next gesture', () => {
    const { audio, log } = setup();
    rec.failNext = true;
    audio.unlock();
    audio.sfx('beep');
    expect(log).toEqual(['new AudioContext() threw']);
    audio.unlock();
    expect(made(log, 'createGain')).toBe(3);
  });

  it('builds master, music and sfx buses at their levels, and ramps master on setOn()', () => {
    const { audio, log } = setup({ on: false });
    audio.unlock();
    expect(log.filter(l => /\.gain=/.test(l))).toEqual(['#3.gain=0', '#4.gain=0.3', '#5.gain=0.7']);
    expect(audio.on).toBe(false);
    audio.sfx('beep');
    expect(made(log, 'createOscillator')).toBe(0);
    rec.time = 2;
    audio.setOn(true);
    expect(audio.on).toBe(true);
    expect(log.at(-1)).toBe('#3.gain.setTargetAtTime(0.5,2,0.02)');
    audio.sfx('beep');
    expect(log).toContain('#7.frequency.setValueAtTime(440,2.005)');
  });

  it('plays 16ths ahead of the clock, from the start of each new track', () => {
    const { audio, steps } = setup();
    audio.music('a');
    audio.unlock(); // asked for before the context existed: starts 0.05 s in
    expect(steps).toEqual([]);
    rec.tick(); // t = 0.04: everything before 0.24 is scheduled
    expect(steps).toEqual(['150:0@0.050', '150:1@0.150']);
    rec.tick(4); // t = 0.2
    expect(steps.slice(2)).toEqual(['150:2@0.250', '150:3@0.350']);
    audio.music('a'); // the same track keeps going
    rec.tick(2);
    expect(steps.slice(4)).toEqual(['150:4@0.450']);
    audio.music('b'); // a new one starts over 0.08 s from now
    rec.tick();
    expect(steps.slice(5)).toEqual(['75:0@0.360']);
    audio.music(null);
    rec.tick(10);
    expect(steps).toHaveLength(6);
  });

  it('holds the music while a jingle plays', () => {
    const { audio, steps } = setup({ startDelay: 0 });
    audio.unlock();
    audio.music('a');
    rec.tick();
    audio.sfx('jingle'); // music waits until 0.04 + 0.005 + 1
    rec.tick(30);
    const times = steps.map(s => +s.split('@')[1]);
    expect(times.filter(t => t > 0.25 && t < 1.045)).toEqual([]);
    expect(times.at(-1)).toBeGreaterThan(1.045);
    audio.music('b'); // a new track during a hold starts after it
    expect(steps.at(-1)).toMatch(/^150:/);
  });

  it('as a PC speaker: square tones gated on and off, clicks for noise, a small cone', () => {
    const { audio, log } = setup({ speaker: true, pulse: true });
    audio.unlock();
    expect(log.slice(1, 9)).toEqual([
      '#3=createGain()',
      '#3.gain=0.5',
      '#4=createBiquadFilter()',
      '#5=createBiquadFilter()',
      '#4.type="highpass"',
      '#4.frequency=180',
      '#5.type="lowpass"',
      '#5.frequency=4200',
    ]);
    const n = log.length;
    audio.sfx('beep');
    expect(log.slice(n).filter(l => /type|gain\./.test(l))).toEqual([
      expect.stringMatching(/\.type="square"$/),
      expect.stringMatching(/\.gain\.setValueAtTime\(0\.2,0\.005\)$/),
      expect.stringMatching(/\.gain\.setValueAtTime\(0,0\.10500000000000001\)$/),
    ]);
    const m = log.length;
    audio.sfx('noise');
    expect(made(log.slice(m), 'createBufferSource')).toBe(0);
    expect(made(log.slice(m), 'createOscillator')).toBe(4); // 0.05 s of 12 ms clicks
  });

  it('pulse waves for numeric types, an echo on the music bus when asked', () => {
    const { audio, log } = setup({ pulse: true, echo: { time: 0.2, feedback: 0.3, wet: 0.25 } });
    audio.unlock();
    expect(log.filter(l => l.includes('=createPeriodicWave('))).toHaveLength(3);
    expect(log).toContain('#6.delayTime=0.2');
    expect(log).toContain('#4.connect(#6)');
  });

  it('merges extra methods and stops on destroy()', () => {
    const audio = createSynth({
      seed: 1,
      levels: { master: 1, music: 1, sfx: 1 },
      tracks: TRACKS,
      arrange: v => ({ step() {}, effects: {}, methods: { live: () => v.ac !== null } }),
    });
    expect(audio.live()).toBe(false);
    audio.unlock();
    expect(audio.live()).toBe(true);
    audio.destroy();
    expect(audio.live()).toBe(false);
    expect(rec.timers.size).toBe(0);
    expect(rec.log.slice(-2)).toEqual(['clearInterval(1)', '#1.close()']);
  });
});

describe('notes', () => {
  it('midi, line, seq and span', () => {
    expect(midi(69)).toBe(440);
    expect(midi(81)).toBe(880);
    expect(line(' 72 - .  76 ')).toEqual([72, -1, 0, 76]);
    expect(seq('C4 . - | G#4 Bb3 X9')).toEqual([60, 0, -1, 68, 58, 0]);
    const lead = [60, -1, -1, 0, 62, -1];
    expect(span(lead, 0)).toBe(3);
    expect(span(lead, 4)).toBe(2);
    expect(span([60, -1, -1, -1], 0, 2)).toBe(2);
  });
});
