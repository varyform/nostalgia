// Synthesized sound effects (no music), made with Web Audio on @nostalgia/audio: gunfire and
// blasts of filtered noise, plucked tones, and three ambient loops (the plane, the rotor, the
// wind) faded in and out. The context is only created by unlock(), from a user gesture; the
// demo never calls it.
//
//   const audio = createAudio({ on: true });
//   audio.unlock();                              // from keydown / mousedown / a menu click
//   audio.sfx('shot', { vol: 0.8, pitch: 0.82 }); audio.sfx('beep', 0.5);
//   audio.loop('plane', 0.35); audio.stopLoops(); audio.setOn(false);
import { createSynth } from '@nostalgia/audio';

export function createAudio({ on = true } = {}) {
  return createSynth({
    on, seed: 1337, noiseLength: 2,
    // effects start on the clock, as plucks that decay to 0.0008; the sfx bus is unity, so
    // voices sound as if wired to the master, which feeds a compressor
    lead: 0, attack: 0, floor: 0.0008,
    levels: { master: 0.55, music: 1, sfx: 1 },
    compressor: { threshold: -14, ratio: 4 },
    arrange: v => {
      // nothing plays before the context runs, or too quietly to hear
      const ok = vol => v.ac.state === 'running' && vol > 0.01;
      const osc = (t, vol, dur, type, f0, f1) => v.tone(f0, f1 || f0, t, dur, vol, type);
      // a burst of noise from a random point in the first 1.2 s of the buffer; unlike hiss() it
      // does not loop, so a long burst that starts late ends with the buffer
      function noise(t, vol, dur, type, freq, end, q = 0.7) {
        const c = v.ac, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        s.buffer = v.noise;
        f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t); if (end) f.frequency.exponentialRampToValueAtTime(end, t + dur);
        v.env(g, t, 0, vol, dur);
        s.connect(f).connect(g).connect(v.bus.sfx); s.start(t, Math.random() * 1.2); s.stop(t + dur + 0.05);
      }
      const tone = (t, f, d, type = 'sine', vol = 0.2, f1) => { if (ok(vol)) osc(t, vol, d, type, f, f1); };

      // the loops: built on first use, faded with setTargetAtTime
      let loops = {}, loopsAc = null;
      function getLoop(name) {
        const c = v.ac;
        if (loopsAc !== c) { loops = {}; loopsAc = c; } // destroy() closed the old context
        if (loops[name]) return loops[name];
        const g = c.createGain(); g.gain.value = 0; g.connect(v.bus.master);
        const nsrc = () => { const s = c.createBufferSource(); s.buffer = v.noise; s.loop = true; s.start(); return s; };
        if (name === 'plane') {
          const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
          for (const fr of [58, 61.5]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(f); o.start(); }
          const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 520; const ng = c.createGain(); ng.gain.value = 0.6;
          nsrc().connect(nf); nf.connect(ng); ng.connect(g); f.connect(g);
        } else if (name === 'rotor') {
          const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 450; const am = c.createGain(); am.gain.value = 0.5;
          const lfo = c.createOscillator(); lfo.frequency.value = 11; const lg = c.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain); lfo.start();
          nsrc().connect(f); f.connect(am); am.connect(g);
        } else {
          const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.4; nsrc().connect(f); f.connect(g);
        }
        return (loops[name] = { gain: g });
      }
      function loop(name, vol) {
        if (!v.ac) return;
        getLoop(name).gain.gain.setTargetAtTime(vol, v.ac.currentTime, 0.2);
      }

      return {
        effects: {
          // a shot; pitch drops it for distant enemy rifles
          shot(t, { vol = 1, pitch = 1 } = {}) {
            if (!ok(vol)) return;
            noise(t, 0.75 * vol, 0.16, 'lowpass', 6000 * pitch, 500); noise(t, 0.3 * vol, 0.5, 'lowpass', 900 * pitch, 120); osc(t, 0.55 * vol, 0.12, 'sine', 170 * pitch, 45);
          },
          boom(t, { vol = 1, size = 1 } = {}) {
            if (!ok(vol)) return;
            noise(t, 1.0 * vol, 1.3 * size, 'lowpass', 1400, 60); noise(t, 0.45 * vol, 0.35, 'bandpass', 2500, 400, 0.5); osc(t, 0.9 * vol, 0.9 * size, 'sine', 90, 24);
          },
          pickup: t => { tone(t, 660, 0.09, 'triangle', 0.18); tone(t + 0.08, 990, 0.14, 'triangle', 0.18); },
          alert: t => { tone(t, 880, 0.12, 'square', 0.07); tone(t + 0.13, 620, 0.22, 'square', 0.07); },
          beep: (t, vol = 1) => tone(t, 1900, 0.05, 'square', 0.05 * vol),
          click: t => tone(t, 2400, 0.02, 'square', 0.06),
          clink: (t, vol) => tone(t, 3200, 0.05, 'triangle', 0.06 * vol),
          hurt(t) {
            if (!ok(1)) return;
            noise(t, 0.35, 0.14, 'bandpass', 800, 260, 1.2); osc(t, 0.15, 0.18, 'sawtooth', 180, 90);
          },
          reload: t => { tone(t, 1200, 0.04, 'square', 0.05); tone(t + 0.55, 900, 0.05, 'square', 0.05); tone(t + 1.25, 1500, 0.05, 'square', 0.06); },
          toss: t => tone(t, 500, 0.05, 'triangle', 0.05), // a grenade leaves the hand
          pod: t => tone(t, 300, 0.12, 'triangle', 0.12), // a supply pod leaves the plane
        },
        methods: {
          /** Fade an ambient loop ('plane', 'rotor', anything else is the wind) to vol. */
          loop,
          stopLoops() { if (loopsAc === v.ac) for (const k in loops) loop(k, 0); },
        },
      };
    },
  });
}
