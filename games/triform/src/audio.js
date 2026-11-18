// Procedural sound: two-operator FM voices and square/noise channels, in the spirit of an
// AdLib card with the PC speaker beeping along. The context is only created by unlock(),
// which the page calls from a user gesture.
//
//   const audio = createAudio({ on: true });
//   audio.unlock();            // from keydown / pointerdown
//   audio.sfx('jump');  audio.music('zone0');  audio.setOn(false);
import { createSynth, midi } from '@nostalgia/audio';

// chords: root note + intervals, one per bar of 16 steps
const CH = { m: [0, 3, 7, 12], M: [0, 4, 7, 12], s: [0, 5, 7, 12], d: [0, 3, 6, 9] };
const TRACKS = {
  title: { bpm: 96, bars: [[57, 'm'], [53, 'M'], [55, 'M'], [52, 'M']], bass: 'x...x.x.x...x.x.', arp: [0, 1, 2, 3, 2, 1, 0, 2], ratio: 2, index: 1.6, drums: 'k...s...k.k.s...',
    lead: [69, 0, 0, 72, 0, 0, 76, 0, 74, 0, 72, 0, 71, 0, 0, 0, 69, 0, 0, 65, 0, 0, 69, 0, 72, 0, 0, 0, 0, 0, 0, 0, 67, 0, 0, 71, 0, 0, 74, 0, 72, 0, 71, 0, 67, 0, 0, 0, 68, 0, 0, 71, 0, 0, 76, 0, 0, 0, 74, 0, 71, 0, 68, 0] },
  zone0: { bpm: 104, bars: [[45, 'm'], [45, 'm'], [41, 'M'], [43, 'M'], [45, 'm'], [45, 'm'], [40, 'M'], [40, 'M']], bass: 'x.x.x..xx.x.x..x', arp: [0, 2, 1, 3], ratio: 1, index: 2.4, drums: 'k..hs.h.k.khs.hh' },
  zone1: { bpm: 90, bars: [[50, 'm'], [46, 'M'], [48, 'M'], [45, 's'], [50, 'm'], [53, 'M'], [48, 'M'], [45, 'M']], bass: 'x.......x...x...', arp: [0, 1, 2, 3, 2, 1], ratio: 3.5, index: 1.2, drums: 'k.h.h.h.s.h.h.h.' },
  zone2: { bpm: 116, bars: [[52, 'm'], [48, 'M'], [50, 'M'], [47, 'm'], [52, 'm'], [55, 'M'], [50, 'M'], [47, 'M']], bass: 'x.xxx.xxx.xxx.xx', arp: [0, 2, 3, 2], ratio: 2, index: 3, drums: 'k.hhs.hhk.hks.hh' },
  boss: { bpm: 136, bars: [[48, 'm'], [48, 'd'], [44, 'M'], [43, 'M']], bass: 'xxx.xxx.xx.xxx.x', arp: [0, 3, 1, 3, 2, 3], ratio: 1.5, index: 4, drums: 'k.kks.k.k.kks.ss' },
  final: { bpm: 128, bars: [[45, 'm'], [46, 'M'], [45, 'm'], [44, 'd'], [41, 'M'], [43, 'M'], [45, 'm'], [40, 'M']], bass: 'x.xxx.x.x.xxx.xx', arp: [0, 1, 2, 3, 1, 2], ratio: 1.5, index: 3.5, drums: 'k.hks.hhk.kks.hs' },
  victory: { bpm: 100, bars: [[48, 'M'], [53, 'M'], [55, 'M'], [48, 'M']], bass: 'x...x...x...x...', arp: [0, 1, 2, 3], ratio: 2, index: 1, drums: 'k...s...k...s...',
    lead: [72, 0, 76, 0, 79, 0, 84, 0, 0, 0, 79, 0, 76, 0, 0, 0, 77, 0, 81, 0, 84, 0, 0, 0, 81, 0, 77, 0, 0, 0, 0, 0, 79, 0, 83, 0, 86, 0, 0, 0, 83, 0, 79, 0, 0, 0, 0, 0, 84, 0, 0, 0, 79, 0, 0, 0, 76, 0, 0, 0, 72, 0, 0, 0] },
};

export function createAudio({ on = true } = {}) {
  return createSynth({
    on, seed: 7, levels: { master: 0.6, music: 0.32, sfx: 0.7 }, tracks: TRACKS,
    arrange: v => {
      const { tone, hiss, fm } = v;
      let flameSrc = null;
      return {
        step(tr, i, t, dt) {
          const bar = tr.bars[Math.floor(i / 16) % tr.bars.length], s = i % 16, [root, kind] = bar, ch = CH[kind];
          if (tr.bass[s] === 'x') tone(midi(root - 12), midi(root - 12), t, dt * 1.6, 0.11, 'square', 'music');
          if (s % 2 === 0) fm(midi(root + 12 + ch[tr.arp[(s / 2) % tr.arp.length]]), t, dt * 1.8, 0.07, tr.ratio, tr.index);
          if (tr.lead) { const n = tr.lead[i % tr.lead.length]; if (n) fm(midi(n), t, dt * 3.5, 0.09, 1, 0.8); }
          const d = tr.drums[s];
          if (d === 'k') tone(150, 40, t, 0.12, 0.25, 'sine', 'music');
          if (d === 's') hiss(t, 0.1, 0.12, 5000, 900, 'lowpass', 'music');
          if (d === 'h') hiss(t, 0.03, 0.04, 9000, 6000, 'highpass', 'music');
        },
        effects: {
          jump: t => tone(300, 620, t, 0.09, 0.06),
          leap: t => { tone(180, 520, t, 0.18, 0.07); hiss(t, 0.15, 0.06, 2000, 400); },
          land: (t, e) => hiss(t, e?.hard ? 0.14 : 0.07, e?.hard ? 0.18 : 0.08, 900, 100),
          strike: t => hiss(t, 0.05, 0.12, 6000, 1500),
          swipe: t => hiss(t, 0.12, 0.1, 1500, 4000, 'bandpass'),
          bite: t => { tone(140, 70, t, 0.08, 0.14); hiss(t, 0.06, 0.12, 3000, 500); },
          crunch: t => { hiss(t, 0.45, 0.3, 2500, 80); tone(110, 40, t, 0.3, 0.12); },
          bolt: t => tone(1400, 380, t, 0.09, 0.05),
          cannon: t => { tone(120, 40, t, 0.22, 0.2, 'sawtooth'); hiss(t, 0.2, 0.2, 1800, 100); },
          flame: t => hiss(t, 0.2, 0.08, 1200, 600),
          hit: t => tone(520, 260, t, 0.06, 0.07),
          boom: (t, e) => { hiss(t, e?.big ? 0.8 : 0.35, e?.big ? 0.4 : 0.25, 1600, 60); tone(e?.big ? 90 : 150, 30, t, e?.big ? 0.6 : 0.25, 0.14, 'sawtooth'); },
          tink: t => tone(2600, 2200, t, 0.04, 0.05, 'triangle'),
          spark: t => hiss(t, 0.04, 0.05, 7000, 3000),
          switch: t => { tone(660, 660, t, 0.06, 0.06); tone(990, 990, t + 0.07, 0.08, 0.06); },
          door: t => { tone(70, 110, t, 0.5, 0.08, 'sawtooth'); hiss(t, 0.5, 0.05, 600, 300); },
          doorshut: t => tone(110, 60, t, 0.25, 0.08, 'sawtooth'),
          plate: t => tone(220, 330, t, 0.08, 0.06),
          unplate: t => tone(330, 220, t, 0.08, 0.05),
          morph: t => { fm(220, t, 0.32, 0.12, 3, 6, 'sfx'); tone(200, 1200, t, 0.3, 0.04, 'triangle'); },
          deny: t => tone(110, 100, t, 0.15, 0.07),
          hurt: t => { tone(300, 90, t, 0.18, 0.1, 'sawtooth'); hiss(t, 0.1, 0.1, 3000, 800); },
          zap: t => { for (let k = 0; k < 4; k++) tone(1800 - k * 300, 300, t + k * 0.04, 0.04, 0.05, 'sawtooth'); hiss(t, 0.25, 0.12, 8000, 2000, 'highpass'); },
          pit: t => tone(600, 60, t, 0.5, 0.08, 'triangle'),
          warp: t => tone(200, 900, t, 0.15, 0.04, 'triangle'),
          die: t => { hiss(t, 1.2, 0.4, 1500, 50); tone(400, 30, t, 1.2, 0.12, 'sawtooth'); },
          pickup: t => { tone(880, 880, t, 0.05, 0.05); tone(1320, 1320, t + 0.05, 0.07, 0.05); },
          upgrade: t => [523, 659, 784, 1047, 1319].forEach((f, k) => fm(f, t + k * 0.08, 0.3, 0.1, 2, 1, 'sfx')),
          check: (t, e) => (e?.fresh ? [392, 523, 659] : [523, 659]).forEach((f, k) => fm(f, t + k * 0.09, 0.25, 0.08, 1, 1, 'sfx')),
          probe: t => tone(800, 1600, t, 0.12, 0.04, 'triangle'),
          recall: t => tone(1600, 600, t, 0.12, 0.04, 'triangle'),
          eshot: t => tone(900, 500, t, 0.08, 0.035, 'sawtooth'),
          pour: t => hiss(t, 0.5, 0.15, 800, 200),
          icicle: t => tone(3000, 1500, t, 0.1, 0.03, 'triangle'),
          splash: (t, e) => e?.kind === 'icicle' ? tone(2400, 1800, t, 0.05, 0.03, 'triangle') : hiss(t, 0.08, 0.05, 1500, 400),
          spawn: t => tone(300, 700, t, 0.2, 0.03, 'triangle'),
          field: (t, e) => e?.up ? tone(100, 400, t, 0.4, 0.07, 'sawtooth') : tone(400, 60, t, 0.5, 0.08, 'sawtooth'),
          freeze: t => hiss(t, 0.5, 0.12, 9000, 2000, 'highpass'),
          shatter: t => { hiss(t, 0.4, 0.2, 9000, 1500, 'highpass'); tone(2000, 800, t, 0.2, 0.04, 'triangle'); },
          melt: t => hiss(t, 0.6, 0.15, 4000, 300),
          hop: t => tone(200, 400, t, 0.08, 0.04),
          thud: t => { tone(90, 40, t, 0.2, 0.18, 'sine'); hiss(t, 0.15, 0.1, 600, 80); },
          phase: t => [440, 415, 392, 370].forEach((f, k) => tone(f, f, t + k * 0.12, 0.12, 0.07, 'sawtooth')),
          bossdown: t => tone(300, 40, t, 1.8, 0.1, 'sawtooth'),
          bossdead: t => [523, 659, 784, 1047].forEach((f, k) => fm(f, t + 0.3 + k * 0.1, 0.4, 0.1, 2, 1, 'sfx')),
          gameover: t => [392, 330, 262, 196].forEach((f, k) => fm(f, t + k * 0.3, 0.5, 0.1, 1, 2, 'sfx')),
          victory: () => {},
          select: t => tone(660, 990, t, 0.08, 0.05),
        },
        methods: {
          // continuous flame roar while the raptor breathes fire
          flame(on) {
            const ac = v.ac;
            if (!ac) return;
            if (flameSrc?.ac !== ac) flameSrc = null; // destroy() closed the old context
            if (on && !flameSrc) {
              const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
              s.buffer = v.noise; s.loop = true; f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.7;
              g.gain.value = 0.12; lfo.frequency.value = 9; lg.gain.value = 250;
              lfo.connect(lg).connect(f.frequency);
              s.connect(f).connect(g).connect(v.bus.sfx); s.start(); lfo.start();
              flameSrc = { s, lfo, ac };
            } else if (!on && flameSrc) {
              flameSrc.s.stop(); flameSrc.lfo.stop(); flameSrc = null;
            }
          },
        },
      };
    },
  });
}
