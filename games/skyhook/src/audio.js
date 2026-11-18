// Procedural sound effects (no music), made with Web Audio on @nostalgia/audio. Two voicings
// of the same effects: the CGA page's PC-speaker flavour (bare square blips that start at
// full level, low-passed noise, a buzzing square rotor) and HD's (filtered tones through an
// echo, a compressor, a rotor of chopped noise). The context is only created by unlock(),
// which the page calls from a user gesture; the demo never calls it.
//
//   const audio = createAudio({ on: true, hd: false });
//   audio.unlock();                       // from keydown / touchstart / mousedown
//   audio.sfx('shoot'); audio.setOn(false);
//   audio.engine(true);                   // the rotor, while the chopper flies
//   audio.throttle(p.vx, p.landed);       // every step: its pitch and chop follow the flight
import { createSynth } from '@nostalgia/audio';

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
  return {
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
    methods: rotor(v, ac => {
      const s = ac.createBufferSource(), lp = ac.createBiquadFilter(), gn = ac.createGain(), lfo = ac.createOscillator(), lgn = ac.createGain();
      s.buffer = v.noise; s.loop = true; lp.type = 'lowpass'; lp.frequency.value = 200;
      gn.gain.value = 0.05; lfo.type = 'sine'; lfo.frequency.value = 13; lgn.gain.value = 0.05;
      lfo.connect(lgn).connect(gn.gain); s.connect(lp).connect(gn).connect(v.bus.master); s.start(); lfo.start();
      return { src: s, pitch: lp.frequency, lfo };
    }, (vx, landed) => 180 + Math.abs(vx) * 1.2 + (landed ? 0 : 60)),
  };
};

export function createAudio({ on = true, hd: isHd = false } = {}) {
  // effects start on the clock, and the sfx bus is unity: voices sound as if wired to the master
  const common = { on, seed: 1985, lead: 0 };
  return isHd
    ? createSynth({
        ...common, noiseLength: 2, levels: { master: 0.6, music: 1, sfx: 1 }, compressor: true,
        echo: { time: 0.13, feedback: 0.22, wet: 1, cut: 1800, bus: 'sfx' },
        arrange: hd,
      })
    : createSynth({ ...common, levels: { master: 0.5, music: 1, sfx: 1 }, attack: 0, tail: 0.02, arrange: cga });
}
