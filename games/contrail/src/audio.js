// Contrail's sound, made in code on @nostalgia/audio: the score (score.js), the jet engine, the
// cockpit's warning and lock tones, and the effects of the weapons, the hits and the UI. The
// context is only made by unlock(), from a user gesture; the demo never calls it.
//
//   const audio = createAudio({ on: true });
//   audio.unlock();                          // keydown / pointerdown / touchstart
//   audio.music('flight1');                  // a track (score.js), or null
//   audio.engine(true);                      // the jet, while flying
//   audio.throttle(0.8, false, 0.6);         // every sim step: throttle, afterburner, speed (0..1)
//   audio.warn(true);                        // an enemy missile tracks us: the warble
//   audio.lock('seek');                      // 'off' | 'seek' (slow beeps) | 'lock' (a steady tone)
//   audio.sfx('boom', { big: true, dist: 0.4 });
//
// The engine and the two cockpit tones are continuous graphs (v.loop), built when first wanted
// and again on a new context after destroy() + unlock(); throttle() and the others only glide
// their parameters (setTargetAtTime), so nothing zips or clicks.
import { compressor, createSynth, delay, limiter, midi } from '@nostalgia/audio';
import { TRACKS, score } from './score.js';

const LEVELS = { master: 0.95, music: 0.42, sfx: 0.9 };
const clamp01 = x => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));

// ---------- the continuous loops ----------
function loops(v) {
  const want = { engine: false, warn: false, lock: 'off' };
  const sim = { t: 0, burner: false, speed: 0, at: -1 };
  // the engine, and the warn and lock tones: each kept on the current context by v.loop
  const engine = v.loop(buildEngine),
    cue = v.loop(buildCue);

  const filter = (ac, type, f, q) => {
    const b = ac.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  };
  const gain = (ac, g) => {
    const n = ac.createGain();
    n.gain.value = g;
    return n;
  };
  // a sine LFO through a curve: a clean square (for the warble's pitch) or a soft gate (the beeps)
  const shaped = (ac, rate, curve) => {
    const lfo = ac.createOscillator(),
      ws = ac.createWaveShaper();
    lfo.frequency.value = rate;
    ws.curve = curve;
    lfo.connect(ws);
    lfo.start();
    return { lfo, out: ws };
  };
  const curve = fn => Float32Array.from({ length: 1024 }, (_, k) => fn((2 * k) / 1023 - 1));
  const SQUARE = curve(x => Math.tanh(9 * x) / Math.tanh(9));
  const GATE = curve(x => {
    const u = Math.min(1, Math.max(0, (x - 0.6) / 0.25));
    return u * u * (3 - 2 * u);
  });

  function buildEngine(ac) {
    const t = ac.currentTime,
      out = gain(ac, 0);
    out.gain.setTargetAtTime(1, t, 0.3);
    out.connect(v.bus.sfx);
    // two noise sources a little apart in the stereo field: the turbine's air
    const air = gain(ac, 1),
      srcs = [];
    for (const [offset, side] of [
      [0.13, -0.45],
      [0.71, 0.45],
    ]) {
      const s = v.noiseSource(offset), // looped from different points so the layers don't move together
        p = ac.createStereoPanner();
      p.pan.value = side;
      s.connect(p).connect(air);
      srcs.push(s);
    }
    const roarF = filter(ac, 'lowpass', 700, 0.6),
      roar = gain(ac, 0.1),
      bodyF = filter(ac, 'bandpass', 160, 1.1),
      body = gain(ac, 0.3),
      rushF = filter(ac, 'highpass', 2600, 0.7),
      rush = gain(ac, 0),
      rumbleF = filter(ac, 'lowpass', 85, 0.9),
      rumble = gain(ac, 0);
    air.connect(roarF).connect(roar).connect(out);
    air.connect(bodyF).connect(body).connect(out);
    air.connect(rushF).connect(rush).connect(out);
    air.connect(rumbleF).connect(rumble).connect(out);
    // the whine: the spool's tone and a fifth over it, and a low hum under the roar
    const whine = gain(ac, 0.006),
      hum = gain(ac, 0.02),
      w1 = ac.createOscillator(),
      w2 = ac.createOscillator(),
      h = ac.createOscillator(),
      humF = filter(ac, 'lowpass', 400, 0.7);
    w1.type = 'sine';
    w2.type = 'sine';
    h.type = 'triangle';
    w1.connect(whine);
    w2.connect(whine);
    whine.connect(out);
    h.connect(humF).connect(hum).connect(out);
    for (const o of [w1, w2, h]) o.start(t);
    srcs.push(w1, w2, h);
    const e = { roarF, roar, bodyF, body, rushF, rush, rumble, whine, hum, w1, w2, h };
    // off: a quick fade, then the sources stop
    e.stop = () => {
      const now = ac.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setTargetAtTime(0, now, 0.12);
      for (const s of srcs) s.stop(now + 0.8);
    };
    tune(e, t, 0.01);
    return e;
  }

  // where the engine's parameters go for the throttle, the burner and the speed; `tc` the glide
  function tune(e, now, tc) {
    const { t, burner, speed } = sim,
      b = burner ? 1 : 0,
      spool = tc * 2.2, // the turbine takes longer to spool than the air to change
      f = 900 + 1700 * t + 300 * b;
    e.roarF.frequency.setTargetAtTime(450 + 1500 * t + 600 * speed + 700 * b, now, tc);
    e.roar.gain.setTargetAtTime(0.1 + 0.2 * t + 0.14 * b, now, tc);
    e.bodyF.frequency.setTargetAtTime(130 + 190 * t, now, spool);
    e.body.gain.setTargetAtTime(0.28 + 0.3 * t + 0.2 * b, now, tc);
    e.rushF.frequency.setTargetAtTime(2400 + 2200 * speed, now, tc);
    e.rush.gain.setTargetAtTime(0.22 * speed ** 1.5, now, tc);
    e.rumble.gain.setTargetAtTime(b * 2.6, now, burner ? 0.12 : 0.3);
    e.w1.frequency.setTargetAtTime(f, now, spool);
    e.w2.frequency.setTargetAtTime(f * 1.5 + 6, now, spool);
    e.whine.gain.setTargetAtTime(0.005 + 0.009 * t, now, tc);
    e.h.frequency.setTargetAtTime(f / 12, now, spool);
    e.hum.gain.setTargetAtTime(0.018 + 0.022 * t + 0.01 * b, now, tc);
  }

  function buildCue(ac) {
    const t = ac.currentTime;
    // warn: a square jumping between two pitches six times a second, filtered soft
    const wo = ac.createOscillator(),
      wsq = shaped(ac, 6.5, SQUARE),
      wdepth = gain(ac, 250),
      wf = filter(ac, 'lowpass', 2800, 0.7),
      warnG = gain(ac, 0);
    wo.type = 'square';
    wo.frequency.value = 1150;
    wsq.out.connect(wdepth).connect(wo.frequency);
    wo.connect(wf).connect(warnG).connect(v.bus.sfx);
    // seek: a sine gated into short beeps a little over twice a second
    const so = ac.createOscillator(),
      gate = gain(ac, 0),
      sg = shaped(ac, 2.2, GATE),
      seekG = gain(ac, 0);
    so.frequency.value = 1000;
    sg.out.connect(gate.gain);
    so.connect(gate).connect(seekG).connect(v.bus.sfx);
    // lock: a steady, brighter tone
    const lo = ac.createOscillator(),
      lo2 = ac.createOscillator(),
      l2g = gain(ac, 0.25),
      lockG = gain(ac, 0);
    lo.type = 'triangle';
    lo.frequency.value = 1600;
    lo2.frequency.value = 3200;
    lo.connect(lockG);
    lo2.connect(l2g).connect(lockG);
    lockG.connect(v.bus.sfx);
    for (const o of [wo, so, lo, lo2]) o.start(t);
    const c = { warnG, seekG, lockG, stop: () => [wo, so, lo, lo2, wsq.lfo, sg.lfo].forEach(o => o.stop()) };
    cues(c, t);
    return c;
  }

  // the graphs follow what's wanted, on the context there is now
  function sync() {
    if (!v.ac) return false;
    if (want.engine) engine.on();
    else engine.off();
    // the tones, once wanted, stay built (silent when not sounding)
    if (want.warn || want.lock !== 'off') cue.on();
    return true;
  }
  function cues(c = cue.live, t = v.ac?.currentTime) {
    if (!c) return;
    c.warnG.gain.setTargetAtTime(want.warn ? 0.06 : 0, t, 0.012);
    c.seekG.gain.setTargetAtTime(want.lock === 'seek' ? 0.065 : 0, t, 0.01);
    c.lockG.gain.setTargetAtTime(want.lock === 'lock' ? 0.05 : 0, t, 0.01);
  }
  // a cue changed: only then touch the graph (lock() may come every step)
  function setCue(key, value) {
    if (want[key] === value) return;
    want[key] = value;
    if (sync()) cues();
  }

  return {
    engine(on) {
      want.engine = !!on;
      sync();
    },
    throttle(t, burner, speed) {
      sim.t = clamp01(t);
      sim.burner = !!burner;
      sim.speed = clamp01(speed);
      const eng = sync() && engine.live;
      if (!eng) return;
      // every step, but the params only move every 40 ms (or when the burner lights)
      const now = v.ac.currentTime;
      if (now - sim.at < 0.04 && sim.burner === sim.lit) return;
      sim.at = now;
      sim.lit = sim.burner;
      tune(eng, now, 0.15);
    },
    warn(on) {
      setCue('warn', !!on);
    },
    lock(state) {
      setCue('lock', state === 'seek' || state === 'lock' ? state : 'off');
    },
  };
}

// ---------- the effects ----------
function effects(v) {
  const { tone, hiss, sub, fm, pulse } = v;
  // booms and the like ring off the ground: a short dark echo on the sfx bus
  const echo = v.insert(ac => delay(ac, { time: 0.17, feedback: 0.3, wet: 0.32, cut: 1300, pan: 0.2 }), 'sfx');
  const thump = (f, t, dur, vol, o = {}) =>
    sub(f, t, dur, vol, { punch: 14, drop: 0.1, drive: 0.5, tone: 600, decay: dur, sustain: 0, release: 0.1, bus: 'sfx', ...o });
  const bell = (n, t, vol, o = {}) =>
    fm(midi(n), t, 0.12, vol, { ratio: 2, index: 1.5, modDecay: 0.2, decay: 0.5, sustain: 0, release: 0.4, bus: 'sfx', ...o });

  function boom(t, e = {}) {
    const d = clamp01(e.dist),
      big = !!e.big,
      at = t + d * 0.35, // far: later
      vol = (1 - 0.82 * d) ** 1.4, // quieter
      cut = 300 + (big ? 2200 : 2800) * (1 - d) ** 2; // and darker
    if (d < 0.45) hiss(at, 0.06, 0.4 * vol, 7000, 2500, 'bandpass', 'sfx', 0.8, 0.001); // the crack, near
    hiss(at, big ? 2.4 : 1.1, (big ? 0.6 : 0.45) * vol, cut, 40, 'lowpass', echo, 0.7, 0.003);
    thump(big ? 48 : 68, at, big ? 1.3 : 0.55, (big ? 0.55 : 0.4) * vol, { punch: big ? 16 : 12, drop: big ? 0.25 : 0.12 });
    if (big) {
      hiss(at + 0.08, 3, 0.3 * vol, 500 + 400 * (1 - d), 30, 'lowpass', echo, 0.7, 0.2); // the rumble after
      if (d < 0.5)
        for (let k = 0; k < 5; k++) // debris
          hiss(at + 0.15 + k * 0.13 + Math.random() * 0.08, 0.05, 0.08 * vol, 5000, 2000, 'bandpass', 'sfx', 1.5, 0.002);
    }
  }

  return {
    // one hiss and one tone a round: up to fifteen a second
    cannon: t => {
      const r = 0.94 + Math.random() * 0.12;
      hiss(t, 0.045, 0.6, 3000 * r, 500, 'bandpass', 'sfx', 0.9, 0.001);
      tone(160 * r, 60, t, 0.05, 0.3, 'triangle', 'sfx', 0.001);
    },
    missile: t => {
      thump(70, t, 0.25, 0.32, { punch: 18 });
      hiss(t, 0.08, 0.2, 5000, 1500, 'bandpass', 'sfx', 0.8, 0.002);
      hiss(t + 0.03, 1.5, 0.22, 500, 3600, 'bandpass', echo, 1.2, 0.08); // the motor, rising away
      hiss(t + 0.05, 1.1, 0.06, 6000, 9000, 'highpass', 'sfx', undefined, 0.1);
    },
    rocket: t => {
      thump(90, t, 0.15, 0.2, { punch: 14 });
      hiss(t, 0.05, 0.16, 6000, 2000, 'bandpass', 'sfx', 0.8, 0.001);
      hiss(t + 0.02, 0.6, 0.16, 1400, 4200, 'bandpass', 'sfx', 1.5, 0.02);
    },
    bomb: t => {
      // the rack lets go: a clunk and a latch, then a thin falling whistle
      thump(110, t, 0.1, 0.25, { punch: 5, drop: 0.03, drive: 0.3, tone: 900 });
      hiss(t, 0.04, 0.12, 1200, 900, 'bandpass', 'sfx', 4, 0.001);
      tone(1700, 600, t + 0.2, 1.8, 0.012, 'sine', 'sfx', 0.3);
    },
    flare: t => {
      hiss(t, 0.05, 0.22, 3200, 1000, 'bandpass', 'sfx', 1, 0.001);
      tone(900, 300, t, 0.05, 0.06, 'sine', 'sfx', 0.001);
      hiss(t + 0.02, 0.8, 0.06, 7000, 4500, 'highpass', 'sfx', undefined, 0.03); // the sizzle
    },
    chaff: t => {
      hiss(t, 0.18, 0.2, 2400, 800, 'bandpass', 'sfx', 0.7, 0.002);
      hiss(t + 0.03, 0.45, 0.045, 5000, 3000, 'highpass', 'sfx', undefined, 0.05); // the cloud
    },
    hit: (t, e = {}) => {
      if (e.kind === 'ground' || e.kind === 'site' || e.kind === 'building') {
        thump(80, t, 0.2, 0.25, { punch: 8 });
        hiss(t, 0.15, 0.18, 1800, 300, 'lowpass', 'sfx', 0.8, 0.002);
      } else {
        // on metal: a crack and a ring
        hiss(t, 0.05, 0.2, 4500, 2000, 'bandpass', 'sfx', 1, 0.001);
        fm(e.kind === 'cannon' ? 1400 : 700, t, 0.08, 0.06, { ratio: 2.76, index: 3, modDecay: 0.05, decay: 0.15, sustain: 0, release: 0.1, bus: 'sfx' });
      }
    },
    damage: (t, e = {}) => {
      const a = 0.35 + 0.65 * clamp01(e.amount ?? 0.5);
      fm(170, t, 0.2, 0.12 * a, { ratio: 1.41, index: 7, modDecay: 0.08, modSustain: 0.1, decay: 0.3, sustain: 0, release: 0.2, bus: 'sfx' });
      hiss(t, 0.25, 0.28 * a, 3500, 400, 'lowpass', 'sfx', 1.2, 0.001);
      thump(60, t, 0.2, 0.22 * a, { punch: 10 });
      if (a > 0.5) for (let k = 0; k < 2; k++) tone(740, 740, t + 0.18 + k * 0.16, 0.1, 0.03, 'square', 'sfx', 0.005); // the master caution
    },
    boom,
    crash: t => {
      boom(t, { big: true, dist: 0 });
      hiss(t, 1.6, 0.18, 1400, 250, 'bandpass', 'sfx', 3, 0.01); // tearing metal
      fm(120, t, 0.5, 0.1, { ratio: 1.41, index: 8, modDecay: 0.2, decay: 0.6, sustain: 0, release: 0.3, bus: 'sfx' });
      thump(36, t, 1.6, 0.5, { punch: 20, drop: 0.4 });
    },
    splash: t => {
      thump(60, t, 0.3, 0.25, { punch: 6, drive: 0.2 });
      hiss(t, 1, 0.35, 4500, 300, 'lowpass', echo, 0.7, 0.01);
      hiss(t + 0.05, 0.7, 0.1, 8000, 5000, 'highpass', 'sfx', undefined, 0.05); // the spray
    },
    launch: t => {
      // an enemy missile off the rail: three rising chirps, and a far thump
      for (let k = 0; k < 3; k++) tone(800, 1600, t + k * 0.09, 0.07, 0.04, 'sine', 'sfx', 0.004);
      thump(55, t, 0.4, 0.12, { punch: 10, tone: 300 });
    },
    weapon: t => {
      hiss(t, 0.012, 0.12, 4000, 3000, 'bandpass', 'sfx', 2, 0.001);
      tone(660, 990, t + 0.01, 0.07, 0.04, 'triangle');
    },
    target: t => {
      tone(1568, 1568, t, 0.05, 0.04, 'sine');
      tone(2093, 2093, t + 0.07, 0.05, 0.035, 'sine');
    },
    stall: t => {
      for (let k = 0; k < 3; k++)
        pulse(midi(52), t + k * 0.26, 0.16, 0.06, { width: 0.4, cutoff: 1200, envmod: 600, attack: 0.008, decay: 0.1, sustain: 0.9, release: 0.04, bus: 'sfx' });
    },
    lowfuel: t => {
      for (let k = 0; k < 2; k++) {
        bell(81, t + k * 0.6, 0.05, { ratio: 1, index: 1 });
        bell(76, t + k * 0.6 + 0.22, 0.05, { ratio: 1, index: 1 });
      }
    },
    objective: t => [76, 83, 88].forEach((n, k) => bell(n, t + k * 0.08, 0.045, { ratio: 3.5, index: 1.2 })),
    fail: t =>
      [67, 63, 58].forEach((n, k) =>
        pulse(midi(n), t + k * 0.2, 0.18, 0.05, { width: 0.2, cutoff: 900, envmod: 600, decay: 0.2, sustain: 0.5, release: 0.15, bus: 'sfx' }),
      ),
    start: t => {
      hiss(t, 0.7, 0.08, 300, 2800, 'bandpass', 'sfx', 1.2, 0.5);
      [64, 71, 76].forEach((n, k) => bell(n, t + 0.1 + k * 0.07, 0.04, { ratio: 1, index: 1.5 }));
    },
    land: t => {
      hiss(t, 0.12, 0.14, 2600, 1800, 'bandpass', 'sfx', 3, 0.003); // the mains
      thump(80, t, 0.2, 0.2, { punch: 6, tone: 500 });
      hiss(t + 0.35, 0.1, 0.08, 2600, 1800, 'bandpass', 'sfx', 3, 0.003); // the nose wheel
    },
    move: t => tone(1000, 1000, t, 0.03, 0.035, 'triangle'),
    select: t => {
      tone(880, 880, t, 0.05, 0.04, 'triangle');
      tone(1320, 1320, t + 0.06, 0.07, 0.04, 'triangle');
    },
    back: t => {
      tone(990, 990, t, 0.05, 0.04, 'triangle');
      tone(660, 660, t + 0.06, 0.07, 0.04, 'triangle');
    },
  };
}

export function createAudio({ on = true } = {}) {
  return createSynth({
    on,
    seed: 1989,
    noiseLength: 2,
    levels: LEVELS,
    tracks: TRACKS,
    lead: 0,
    // the music evened out against itself (each track's `gain` then sets its level), and a
    // limiter on the whole mix that only catches what would go over
    inserts: {
      music: ac => compressor(ac, { threshold: -30, ratio: 3, knee: 8, attack: 0.015, release: 0.3, makeup: 8 }),
      master: ac => limiter(ac, { ceiling: -1, release: 0.15 }),
    },
    arrange: v => ({ step: score(v), effects: effects(v), methods: loops(v) }),
  });
}
