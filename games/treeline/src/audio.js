// Treeline's sound, made in code on @nostalgia/audio: the score (score.js), the helicopter's rotor
// and turbine, the cockpit's warning and lock tones, and the effects of the weapons, the hits, the
// landings and the UI. The context is only made by unlock(), from a user gesture; the demo never
// calls it.
//
//   const audio = createAudio({ on: true });
//   audio.unlock();                          // keydown / pointerdown / touchstart
//   audio.music('flight1');                  // a track (score.js), or null
//   audio.rotor(true);                       // the rotor and turbine, flying or idling on the ground
//   audio.flight(0.6, 1, 0.4, 0.2);          // every sim step: collective, rpm (1 nominal), speed, load
//   audio.warn('missile');                   // 'radar' | 'missile' | 'rpm' | null
//   audio.lock('seek');                      // 'off' | 'seek' | 'lock'
//   audio.sfx('boom', { big: true, dist: 0.4 });
//
// Effects: cannon (one round), rocket {count = 2}, missile, aam, flare, hit {kind 'air' | 'ground'
// | 'armor'}, damage {amount}, boom {big, dist}, crash {wet}, splash, settle, treestrike, land,
// liftoff, pickup {n, total}, efire {kind, dist}, launch {dist}, objective, fail, weapon, target,
// lowfuel; the UI's start, move, select, back. Unknown names are ignored.
//
// The rotor and the cockpit tones are continuous graphs (v.loop), built when first wanted and again
// on a new context after destroy() + unlock(); flight() and the others only glide their parameters
// (setTargetAtTime), so nothing zips or clicks.
//
// The rotor: one clock at the main rotor's blade-pass rate (four blades, ~19 Hz at nominal rpm)
// drives both the chop (band-passed noise, its level swung once a blade) and the thump (a narrow
// pulse at that rate, low-passed), so the two stay locked together. Two shapes of the clock, a
// rounded swell and a sharp slap, are mixed by how hard the blades work: heavier with collective
// and load, sharpest in a hard turn (load) or a fast descent (low collective at speed). Over it the
// turbine's whine rises with rpm, the tail rotor buzzes five times faster, the gearbox whines, and
// the rotor wash and the wind grow with speed. Heavy collective droops the rpm a little.
import { compressor, createSynth, delay, limiter, midi, softclip } from '@nostalgia/audio';
import { TRACKS, score } from './score.js';

const LEVELS = { master: 0.95, music: 0.42, sfx: 0.9 };
const clamp01 = x => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
const BLADE_PASS = 19.5; // Hz at nominal rpm: four blades at ~290 rpm
const TAIL = 5.4; // the tail rotor's blade-pass against the main's
const ROTOR = 0.94; // the whole rotor's level

// ---------- the continuous loops ----------
function loops(v) {
  const want = { rotor: false, warn: null, lock: 'off' };
  const sim = { collective: 0.4, rpm: 1, speed: 0, load: 0, at: -1 };
  const rotor = v.loop(buildRotor),
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
  const osc = (ac, type, f) => {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = f;
    return o;
  };
  const shaper = (ac, c) => {
    const ws = ac.createWaveShaper();
    ws.curve = c;
    return ws;
  };
  // a sine LFO through a curve: a clean square, a soft gate, a blade's swell or slap
  const shaped = (ac, rate, c) => {
    const lfo = osc(ac, 'sine', rate),
      ws = shaper(ac, c);
    lfo.connect(ws);
    lfo.start();
    return { lfo, out: ws };
  };
  const curve = fn => Float32Array.from({ length: 2048 }, (_, k) => fn((2 * k) / 2047 - 1));
  const smooth = u => {
    u = Math.min(1, Math.max(0, u));
    return u * u * (3 - 2 * u);
  };
  const SQUARE = curve(x => Math.tanh(9 * x) / Math.tanh(9));
  const gate = (lo, hi) => curve(x => smooth((x - lo) / (hi - lo)));
  const SWELL = curve(x => ((x + 1) / 2) ** 2.5); // a blade going over: a rounded swell
  const SLAP = curve(x => ((x + 1) / 2) ** 14); // and the slap: a few milliseconds' crack
  const BODY = curve(x => ((x + 1) / 2) ** 6); // the airframe's thud between them

  function buildRotor(ac) {
    const t = ac.currentTime,
      out = gain(ac, 0),
      level = gain(ac, 0);
    out.gain.setTargetAtTime(1, t, 0.35);
    level.connect(out).connect(v.bus.sfx);
    const srcs = [];
    // oscillators and constants start now (the noises are started as they're made)
    const start = (...list) => {
      for (const s of list) {
        s.start(t);
        srcs.push(s);
      }
    };

    // the clock: a sine at the blade-pass rate, its frequency held by one constant, and its two shapes
    const rate = ac.createConstantSource();
    rate.offset.value = BLADE_PASS;
    const clock = osc(ac, 'sine', 0);
    rate.connect(clock.frequency);
    const swell = shaper(ac, SWELL),
      slap = shaper(ac, SLAP);
    clock.connect(swell);
    clock.connect(slap);
    start(rate, clock);

    // the chop: noise through a band, swung by the blades (a floor between them, then each pass)
    // each noise layer looped from its own point, so the layers don't move together
    const chopN = v.noiseSource(0.21),
      chopF = filter(ac, 'bandpass', 520, 0.8),
      chopVca = gain(ac, 0.2),
      chopDrive = gain(ac, 1.8),
      chopClip = softclip(ac, { drive: 1.6 }),
      chop = gain(ac, 0.5),
      swellD = gain(ac, 0.5),
      slapD = gain(ac, 0.3);
    chopN.connect(chopF).connect(chopVca).connect(chopDrive).connect(chopClip.input); // gritty, its peaks rounded
    chopClip.output.connect(chop).connect(level);
    swell.connect(swellD).connect(chopVca.gain);
    slap.connect(slapD).connect(chopVca.gain);
    // a brighter crack on the slap alone: the tips' blade-vortex smack
    const crackN = v.noiseSource(1.37),
      crackF = filter(ac, 'bandpass', 1500, 1.1),
      crackVca = gain(ac, 0),
      crack = gain(ac, 0.2),
      crackD = gain(ac, 0.4);
    crackN.connect(crackF).connect(crackVca).connect(crack).connect(level);
    slap.connect(crackD).connect(crackVca.gain);
    // the thump: a low body swung by the blades (the airframe's ring), with the slap's own pulse
    // train for its edge, the sub-audible blade-pass itself taken off; and a low noise whump
    const body = gain(ac, 0),
      b1 = osc(ac, 'sine', 66),
      b2 = osc(ac, 'triangle', 99),
      b2g = gain(ac, 0.35),
      bodyLp = filter(ac, 'lowpass', 240, 0.7),
      thump = gain(ac, 0.5),
      mid = shaper(ac, BODY);
    clock.connect(mid).connect(body.gain);
    b1.connect(body);
    b2.connect(b2g).connect(body);
    body.connect(bodyLp).connect(thump).connect(level);
    const edgeHp = filter(ac, 'highpass', 60, 0.7),
      edgeHp2 = filter(ac, 'highpass', 60, 0.7),
      edgeLp = filter(ac, 'lowpass', 260, 0.9),
      edge = gain(ac, 0.3);
    slap.connect(edgeHp).connect(edgeHp2).connect(edgeLp).connect(edge).connect(level);
    const whumpN = v.noiseSource(0.83),
      whumpHp = filter(ac, 'highpass', 55, 0.7),
      whumpF = filter(ac, 'lowpass', 170, 0.9),
      whumpVca = gain(ac, 0.05),
      whump = gain(ac, 1.4);
    whumpN.connect(whumpHp).connect(whumpF).connect(whumpVca).connect(whump).connect(level);
    swell.connect(whumpVca.gain);
    start(b1, b2);

    // the wash and the wind: two noises a little apart in the stereo field
    const wash = gain(ac, 0.1),
      washF = filter(ac, 'lowpass', 420, 0.6),
      wind = gain(ac, 0),
      windF = filter(ac, 'highpass', 2400, 0.7);
    for (const [offset, side] of [
      [0.47, -0.5],
      [1.61, 0.5],
    ]) {
      const s = v.noiseSource(offset),
        p = ac.createStereoPanner();
      p.pan.value = side;
      s.connect(p);
      p.connect(washF);
      p.connect(windF);
      srcs.push(s);
    }
    washF.connect(wash).connect(level);
    windF.connect(wind).connect(level);

    // the turbine: its whine and a beating partial a fifth over, and the compressor's air
    const turb = gain(ac, 0.004),
      t1 = osc(ac, 'sine', 2600),
      t2 = osc(ac, 'sine', 3900),
      t2g = gain(ac, 0.5),
      airN = v.noiseSource(0.05),
      airF = filter(ac, 'bandpass', 2900, 3),
      air = gain(ac, 0.05);
    t1.connect(turb);
    t2.connect(t2g).connect(turb);
    turb.connect(level);
    airN.connect(airF).connect(air).connect(level);
    // the tail rotor: a buzzing saw and noise swung at its own blade-pass rate
    const tailO = osc(ac, 'sawtooth', BLADE_PASS * TAIL),
      tailF = filter(ac, 'bandpass', 620, 1.4),
      tail = gain(ac, 0.02),
      tailN = v.noiseSource(1.05),
      tailNF = filter(ac, 'bandpass', 1900, 1.2),
      tailVca = gain(ac, 0.5),
      tailLfo = osc(ac, 'sine', BLADE_PASS * TAIL),
      tailD = gain(ac, 0.45),
      tailNG = gain(ac, 0.05);
    tailO.connect(tailF).connect(tail).connect(level);
    tailN.connect(tailNF).connect(tailVca).connect(tailNG).connect(level);
    tailLfo.connect(tailD).connect(tailVca.gain);
    // the gearbox: a thin whine and its second gear
    const gear = gain(ac, 0.002),
      g1 = osc(ac, 'sine', 1150),
      g2 = osc(ac, 'triangle', 1730),
      g2g = gain(ac, 0.4);
    g1.connect(gear);
    g2.connect(g2g).connect(gear);
    gear.connect(level);
    start(t1, t2, tailO, tailLfo, g1, g2);
    srcs.push(chopN, crackN, whumpN, airN, tailN);

    const r = { rate, level, chopF, chop, swellD, slapD, crackF, crack, crackD, thump, edge, whump, wash, washF, wind, windF, turb, t1, t2, airF, air, tailO, tailLfo, tail, tailNG, gear, g1, g2 };
    // off: a fade, then the sources stop
    r.stop = () => {
      const now = ac.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setTargetAtTime(0, now, 0.25);
      for (const s of srcs) s.stop(now + 1.6);
    };
    tune(r, t, 0.01);
    return r;
  }

  // where the rotor's parameters go for the collective, the rpm, the speed and the load; `tc` the glide
  function tune(r, now, tc) {
    const { collective: c, speed: s, load: l } = sim,
      rpm = sim.rpm * (1 - 0.03 * c * c), // heavy collective drags the rotor down a little
      spin = Math.min(1.1, rpm),
      on = Math.min(1, spin) ** 1.6, // spinning up from rest: quiet, then full
      work = clamp01(0.25 + 0.55 * c + 0.45 * l), // how hard the blades bite
      sharp = clamp01(0.08 + 1.1 * l + 0.9 * s * (1 - c) ** 2), // the slap: hard turns, fast descents
      slow = tc * 1.8; // the turbine spools slower than the air changes
    r.level.gain.setTargetAtTime(ROTOR * on, now, tc);
    r.rate.offset.setTargetAtTime(BLADE_PASS * spin, now, slow);
    r.chopF.frequency.setTargetAtTime(380 + 260 * work + 500 * sharp, now, tc);
    r.chop.gain.setTargetAtTime(0.22 + 0.2 * work, now, tc);
    r.swellD.gain.setTargetAtTime(0.35 + 0.35 * work, now, tc);
    r.slapD.gain.setTargetAtTime(0.1 + 0.35 * sharp, now, tc);
    r.crackF.frequency.setTargetAtTime(1200 + 900 * sharp, now, tc);
    r.crackD.gain.setTargetAtTime(0.1 + 0.7 * sharp * sharp, now, tc);
    r.crack.gain.setTargetAtTime(0.08 + 0.4 * sharp, now, tc);
    r.thump.gain.setTargetAtTime(0.07 + 0.12 * work, now, tc);
    r.edge.gain.setTargetAtTime(0.1 + 0.3 * sharp, now, tc);
    r.whump.gain.setTargetAtTime(0.5 + 0.8 * work, now, tc);
    r.washF.frequency.setTargetAtTime(380 + 600 * s, now, tc);
    r.wash.gain.setTargetAtTime(0.08 + 0.1 * c + 0.12 * s, now, tc);
    r.windF.frequency.setTargetAtTime(2200 + 1800 * s, now, tc);
    r.wind.gain.setTargetAtTime(0.09 * s ** 1.5, now, tc);
    // the turbine: its pitch with the rpm (and a little with the power drawn)
    const f = 2350 * spin + 260 * c;
    r.t1.frequency.setTargetAtTime(f, now, slow);
    r.t2.frequency.setTargetAtTime(f * 1.5 + 7, now, slow);
    r.turb.gain.setTargetAtTime(0.006 + 0.008 * c, now, tc);
    r.airF.frequency.setTargetAtTime(2300 + 1300 * spin, now, slow);
    r.air.gain.setTargetAtTime(0.03 + 0.05 * c, now, tc);
    r.tailO.frequency.setTargetAtTime(BLADE_PASS * TAIL * spin, now, slow);
    r.tailLfo.frequency.setTargetAtTime(BLADE_PASS * TAIL * spin, now, slow);
    r.tail.gain.setTargetAtTime(0.012 + 0.012 * c, now, tc);
    r.tailNG.gain.setTargetAtTime(0.035 + 0.03 * c, now, tc);
    r.g1.frequency.setTargetAtTime(1150 * spin, now, slow);
    r.g2.frequency.setTargetAtTime(1730 * spin, now, slow);
    r.gear.gain.setTargetAtTime(0.003 + 0.005 * (c + l) * 0.5, now, tc);
  }

  function buildCue(ac) {
    const t = ac.currentTime,
      lfos = [],
      oscs = [];
    const lfo = (rate, c) => {
      const s = shaped(ac, rate, c);
      lfos.push(s.lfo);
      return s.out;
    };
    // radar: a search radar paints us: a long, soft tone once a sweep
    const ro = osc(ac, 'sine', 1240),
      ro2 = osc(ac, 'sine', 2480),
      ro2g = gain(ac, 0.12),
      rgate = gain(ac, 0),
      radarG = gain(ac, 0);
    lfo(0.75, gate(0.05, 0.35)).connect(rgate.gain);
    ro.connect(rgate);
    ro2.connect(ro2g).connect(rgate);
    rgate.connect(radarG).connect(v.bus.sfx);
    // missile: one tracks us: a fast two-tone trill in urgent bursts
    const mo = osc(ac, 'square', 1250),
      mdepth = gain(ac, 280),
      mf = filter(ac, 'lowpass', 3000, 0.7),
      mgate = gain(ac, 0),
      missileG = gain(ac, 0);
    lfo(11, SQUARE).connect(mdepth).connect(mo.frequency);
    lfo(2.6, gate(-0.55, -0.3)).connect(mgate.gain);
    mo.connect(mf).connect(mgate).connect(missileG).connect(v.bus.sfx);
    // rpm: low rotor: a reedy horn, beating, mostly on
    const h1 = osc(ac, 'sawtooth', 311),
      h2 = osc(ac, 'sawtooth', 314.5),
      h3 = osc(ac, 'square', 155.5),
      h3g = gain(ac, 0.5),
      hf = filter(ac, 'lowpass', 1500, 1),
      hgate = gain(ac, 0),
      hornG = gain(ac, 0);
    lfo(1.4, gate(-0.75, -0.45)).connect(hgate.gain);
    h1.connect(hf);
    h2.connect(hf);
    h3.connect(h3g).connect(hf);
    hf.connect(hgate).connect(hornG).connect(v.bus.sfx);
    // seek: the seeker hunting: soft beeps three times a second
    const so = osc(ac, 'sine', 760),
      sgate = gain(ac, 0),
      seekG = gain(ac, 0);
    lfo(3, gate(0.5, 0.8)).connect(sgate.gain);
    so.connect(sgate).connect(seekG).connect(v.bus.sfx);
    // lock: a steady, brighter tone
    const lo = osc(ac, 'triangle', 1520),
      lo2 = osc(ac, 'sine', 3040),
      l2g = gain(ac, 0.22),
      lockG = gain(ac, 0);
    lo.connect(lockG);
    lo2.connect(l2g).connect(lockG);
    lockG.connect(v.bus.sfx);
    oscs.push(ro, ro2, mo, h1, h2, h3, so, lo, lo2);
    for (const o of oscs) o.start(t);
    const c = { radarG, missileG, hornG, seekG, lockG, stop: () => [...oscs, ...lfos].forEach(o => o.stop()) };
    cues(c, t);
    return c;
  }

  // the graphs follow what's wanted, on the context there is now
  function sync() {
    if (!v.ac) return false;
    if (want.rotor) rotor.on();
    else rotor.off();
    // the tones, once wanted, stay built (silent when not sounding)
    if (want.warn || want.lock !== 'off') cue.on();
    return true;
  }
  function cues(c = cue.live, t = v.ac?.currentTime) {
    if (!c) return;
    c.radarG.gain.setTargetAtTime(want.warn === 'radar' ? 0.05 : 0, t, 0.015);
    c.missileG.gain.setTargetAtTime(want.warn === 'missile' ? 0.055 : 0, t, 0.01);
    c.hornG.gain.setTargetAtTime(want.warn === 'rpm' ? 0.05 : 0, t, 0.015);
    c.seekG.gain.setTargetAtTime(want.lock === 'seek' ? 0.06 : 0, t, 0.01);
    c.lockG.gain.setTargetAtTime(want.lock === 'lock' ? 0.045 : 0, t, 0.01);
  }
  // a cue changed: only then touch the graph (warn() and lock() may come every step)
  function setCue(key, value) {
    if (want[key] === value) {
      void cue.live; // still wanted: kept on (and after destroy() + unlock() rebuilt on) this context
      return;
    }
    want[key] = value;
    if (sync()) cues();
  }

  return {
    rotor(on) {
      want.rotor = !!on;
      sync();
    },
    flight(collective, rpm, speed, load) {
      const c = clamp01(collective),
        r = Math.min(1.1, Math.max(0, Number.isFinite(rpm) ? rpm : 0)),
        s = clamp01(speed),
        l = clamp01(load);
      const moved = Math.abs(r - sim.rpm) > 0.08 || Math.abs(l - sim.load) > 0.25;
      sim.collective = c;
      sim.rpm = r;
      sim.speed = s;
      sim.load = l;
      if (!want.rotor || !v.ac) return;
      const live = rotor.live;
      if (!live) return;
      // every step, but the params only move every 40 ms (or at once on a sharp change)
      const now = v.ac.currentTime;
      if (now - sim.at < 0.04 && !moved) return;
      sim.at = now;
      tune(live, now, 0.12);
    },
    warn(kind) {
      setCue('warn', kind === 'radar' || kind === 'missile' || kind === 'rpm' ? kind : null);
    },
    lock(state) {
      setCue('lock', state === 'seek' || state === 'lock' ? state : 'off');
    },
  };
}

// ---------- the effects ----------
function effects(v) {
  const { tone, hiss, sub, fm, pulse } = v;
  // booms ring off the hills: a short dark echo on the sfx bus, and a longer one for far booms
  const echo = v.insert(ac => delay(ac, { time: 0.21, feedback: 0.32, wet: 0.3, cut: 1200, pan: -0.25 }), 'sfx');
  const valley = v.insert(ac => delay(ac, { time: 0.46, feedback: 0.35, wet: 0.35, cut: 900, pan: 0.3 }), 'sfx');
  const thump = (f, t, dur, vol, o = {}) =>
    sub(f, t, dur, vol, { punch: 14, drop: 0.1, drive: 0.5, tone: 600, decay: dur, sustain: 0, release: 0.1, bus: 'sfx', ...o });
  const bell = (n, t, vol, o = {}) =>
    fm(midi(n), t, 0.12, vol, { ratio: 2, index: 1.5, modDecay: 0.2, decay: 0.5, sustain: 0, release: 0.4, bus: 'sfx', ...o });
  const clank = (f, t, vol) =>
    fm(f, t, 0.03, vol, { ratio: 2.71, index: 4, modDecay: 0.02, attack: 0, decay: 0.06, sustain: 0, release: 0.04, bus: 'sfx' });
  let round = 0;

  function boom(t, e = {}) {
    const d = clamp01(e.dist),
      big = !!e.big,
      at = t + d * 0.4, // far: later
      vol = (1 - 0.82 * d) ** 1.4, // quieter
      cut = 280 + (big ? 2000 : 2600) * (1 - d) ** 2, // and darker
      ring = d > 0.5 ? valley : echo;
    if (d < 0.45) hiss(at, 0.06, 0.4 * vol, 6500, 2200, 'bandpass', 'sfx', 0.8, 0.001); // the crack, near
    hiss(at, big ? 2.4 : 1.1, (big ? 0.5 : 0.45) * vol, cut, 40, 'lowpass', ring, 0.7, 0.003);
    thump(big ? 46 : 64, at, big ? 1.3 : 0.55, (big ? 0.45 : 0.4) * vol, { punch: big ? 16 : 12, drop: big ? 0.25 : 0.12 });
    if (big) {
      hiss(at + 0.08, 3, 0.3 * vol, 480 + 400 * (1 - d), 30, 'lowpass', ring, 0.7, 0.2); // the rumble after
      if (d < 0.5)
        for (let k = 0; k < 6; k++) // debris pattering down
          hiss(at + 0.3 + k * 0.14 + Math.random() * 0.1, 0.04, 0.07 * vol, 4200, 1800, 'bandpass', 'sfx', 1.5, 0.002);
    }
  }

  const all = {
    // the chin gun, one round a call (up to ~12 a second): the report, the bolt and the feed's
    // links, alternating two ways so a burst has a mechanical lope
    cannon: t => {
      const r = 0.96 + Math.random() * 0.08,
        odd = round++ & 1;
      hiss(t, 0.03, 0.36, 2300 * r, 700, 'bandpass', 'sfx', 1.4, 0.0008);
      thump(118 * r, t, 0.05, 0.2, { punch: 9, drop: 0.025, drive: 0.7, tone: 1400, release: 0.03 });
      clank(odd ? 920 : 760, t + 0.012, 0.03);
      if (odd) hiss(t + 0.018, 0.02, 0.1, 5200, 3600, 'bandpass', 'sfx', 3, 0.001); // the link out
    },
    // a pair of rockets off the pods (e.count for more), each a pop and a whoosh away
    rocket: (t, e = {}) => {
      const n = Math.max(1, Math.min(8, Math.round(e.count ?? 2)));
      for (let k = 0; k < n; k++) {
        const at = t + k * 0.075,
          r = 0.92 + 0.16 * ((k * 0.618) % 1);
        thump(95 * r, at, 0.12, 0.2, { punch: 12 });
        hiss(at, 0.04, 0.15, 5500, 2200, 'bandpass', 'sfx', 0.8, 0.001);
        hiss(at + 0.01, 0.75, 0.15 / Math.sqrt(n / 2), 3200 * r, 650, 'bandpass', echo, 1.3, 0.015); // falling away
      }
    },
    // the guided missile: a pop off the rail, then a long burn leaving us
    missile: t => {
      thump(70, t, 0.3, 0.32, { punch: 16 });
      hiss(t, 0.1, 0.22, 4500, 1400, 'bandpass', 'sfx', 0.8, 0.002);
      hiss(t + 0.05, 2.6, 0.2, 2400, 500, 'bandpass', echo, 1.1, 0.06);
      hiss(t + 0.05, 2.2, 0.05, 7000, 4000, 'highpass', 'sfx', undefined, 0.12);
      for (let k = 0; k < 6; k++) // the motor's crackle
        hiss(t + 0.2 + k * 0.17 + Math.random() * 0.06, 0.02, 0.04, 3000, 2500, 'bandpass', 'sfx', 2, 0.001);
    },
    // the air-to-air missile: a kick out, then a brighter motor rising quickly away
    aam: t => {
      thump(130, t, 0.08, 0.2, { punch: 6, drop: 0.03, tone: 1000 });
      tone(600, 300, t, 0.06, 0.03, 'triangle', 'sfx', 0.001);
      hiss(t + 0.12, 1.4, 0.2, 1200, 5000, 'bandpass', echo, 1.4, 0.04);
      hiss(t + 0.14, 1.1, 0.05, 8000, 9500, 'highpass', 'sfx', undefined, 0.08);
    },
    flare: t => {
      hiss(t, 0.04, 0.22, 2800, 1000, 'bandpass', 'sfx', 1, 0.001);
      tone(700, 260, t, 0.05, 0.06, 'sine', 'sfx', 0.001);
      hiss(t + 0.02, 1, 0.06, 6500, 4000, 'highpass', 'sfx', undefined, 0.03); // the sizzle
    },
    hit: (t, e = {}) => {
      if (e.kind === 'armor') {
        // on a tank: a heavy clang, the plate ringing low
        thump(90, t, 0.12, 0.22, { punch: 10, drive: 0.7, tone: 1600 });
        hiss(t, 0.04, 0.2, 3500, 1800, 'bandpass', 'sfx', 1.2, 0.001);
        fm(420, t, 0.1, 0.07, { ratio: 2.31, index: 4, modDecay: 0.08, attack: 0, decay: 0.35, sustain: 0, release: 0.25, bus: echo });
      } else if (e.kind === 'air') {
        // on metal: a crack and a ring
        hiss(t, 0.05, 0.2, 4500, 2000, 'bandpass', 'sfx', 1, 0.001);
        fm(850, t, 0.08, 0.06, { ratio: 2.76, index: 3, modDecay: 0.05, decay: 0.15, sustain: 0, release: 0.1, bus: 'sfx' });
      } else {
        thump(76, t, 0.2, 0.26, { punch: 8 });
        hiss(t, 0.18, 0.2, 1600, 260, 'lowpass', echo, 0.8, 0.002);
      }
    },
    damage: (t, e = {}) => {
      const a = 0.35 + 0.65 * clamp01(e.amount ?? 0.5);
      fm(150, t, 0.2, 0.12 * a, { ratio: 1.41, index: 7, modDecay: 0.08, modSustain: 0.1, decay: 0.3, sustain: 0, release: 0.2, bus: 'sfx' });
      hiss(t, 0.25, 0.28 * a, 3200, 400, 'lowpass', 'sfx', 1.2, 0.001);
      thump(58, t, 0.2, 0.22 * a, { punch: 10 });
      if (a > 0.5) for (let k = 0; k < 3; k++) tone(660, 660, t + 0.2 + k * 0.13, 0.08, 0.028, 'square', 'sfx', 0.005); // the master caution
    },
    boom,
    // the Gadfly going in (e.wet: into the water)
    crash: (t, e = {}) => {
      if (e.wet) all.splash(t + 0.05);
      boom(t, { big: true, dist: e.wet ? 0.35 : 0.1 });
      hiss(t, 1.8, 0.18, 1300, 220, 'bandpass', 'sfx', 3, 0.01); // tearing metal
      fm(110, t, 0.6, 0.07, { ratio: 1.41, index: 8, modDecay: 0.25, decay: 0.7, sustain: 0, release: 0.3, bus: 'sfx' });
      thump(34, t + 0.05, 1.6, 0.22, { punch: 20, drop: 0.4 });
      for (let k = 0; k < 4; k++) // the blades striking the ground
        thump(90 - k * 8, t + 0.12 + k * 0.11, 0.08, 0.1, { punch: 8, drive: 0.6, tone: 1500 });
    },
    splash: t => {
      thump(58, t, 0.3, 0.25, { punch: 6, drive: 0.2 });
      hiss(t, 1.1, 0.35, 4200, 280, 'lowpass', echo, 0.7, 0.01);
      hiss(t + 0.05, 0.8, 0.1, 8000, 5000, 'highpass', 'sfx', undefined, 0.05); // the spray
    },
    // settling with power (vortex ring): the disc shudders, a deep buffet beating against itself
    settle: t => {
      for (let k = 0; k < 7; k++) {
        const at = t + k * 0.11 + (k & 1) * 0.02;
        thump(44 + (k % 3) * 5, at, 0.12, 0.22 - k * 0.02, { punch: 6, drop: 0.05, drive: 0.6, tone: 380 });
      }
      hiss(t, 1, 0.16, 700, 250, 'lowpass', 'sfx', 1.4, 0.08);
      tone(180, 140, t + 0.1, 0.7, 0.01, 'sawtooth', 'sfx', 0.1); // the airframe groaning
    },
    // the rotor clipping branches: a splintering rattle, twigs and leaves
    treestrike: t => {
      for (let k = 0; k < 8; k++) {
        const at = t + k * 0.045 + Math.random() * 0.02;
        hiss(at, 0.03, 0.22 - k * 0.018, 3000 + 900 * ((k * 0.618) % 1), 1200, 'bandpass', 'sfx', 1.6, 0.001);
        if (k % 3 === 0) thump(150 - k * 6, at, 0.04, 0.12, { punch: 5, drop: 0.015, drive: 0.8, tone: 2200 });
      }
      hiss(t + 0.05, 0.6, 0.08, 6000, 2500, 'bandpass', 'sfx', 0.6, 0.02); // the leaves
    },
    // the skids settle: a scrape, a thud, the airframe's creak
    land: t => {
      hiss(t, 0.16, 0.14, 1800, 900, 'bandpass', 'sfx', 2.5, 0.004);
      thump(72, t, 0.22, 0.24, { punch: 5, tone: 450 });
      hiss(t + 0.07, 0.1, 0.07, 2200, 1500, 'bandpass', 'sfx', 3, 0.004); // the other skid
      tone(260, 230, t + 0.12, 0.25, 0.008, 'sawtooth', 'sfx', 0.05);
    },
    // the skids lift: the weight comes off with a creak and a soft knock
    liftoff: t => {
      tone(220, 270, t, 0.3, 0.008, 'sawtooth', 'sfx', 0.08);
      thump(95, t + 0.05, 0.1, 0.1, { punch: 4, tone: 600 });
      hiss(t, 0.35, 0.06, 500, 1500, 'bandpass', 'sfx', 1.5, 0.15);
    },
    // a survivor boarding (e: { n, total }): boots on the deck and a chime that climbs with each;
    // the last one in, the door slides shut
    pickup: (t, e = {}) => {
      const n = Math.max(1, e.n ?? 1),
        last = !e.total || n >= e.total;
      for (let k = 0; k < 3; k++) {
        const at = t + k * 0.14 + (k & 1) * 0.03;
        thump(110 + (k % 3) * 12, at, 0.05, 0.13, { punch: 4, drop: 0.02, tone: 900 });
        hiss(at, 0.025, 0.05, 2000, 1200, 'bandpass', 'sfx', 2, 0.001);
      }
      bell(72 + Math.min(12, [0, 2, 4, 7, 9, 12][(n - 1) % 6]), t + 0.45, 0.035, { ratio: 1, index: 1.2 });
      if (!last) return;
      hiss(t + 0.6, 0.32, 0.1, 900, 2600, 'bandpass', 'sfx', 2, 0.05); // the door
      thump(80, t + 0.92, 0.1, 0.18, { punch: 6, drive: 0.6, tone: 1200 });
      [72, 79, 84].forEach((m, k) => bell(m, t + 1.05 + k * 0.09, 0.04, { ratio: 1, index: 1.2 }));
    },
    // enemy fire near us (e: { kind 'mg' | 'flak' | 'shell' | 'gun' | 'rocket', dist 0..1 })
    efire: (t, e = {}) => {
      const d = clamp01(e.dist ?? 0.5),
        vol = (1 - 0.85 * d) ** 1.5,
        cut = 600 + 2400 * (1 - d) ** 2;
      if (e.kind === 'mg' || e.kind === 'gun')
        for (let k = 0; k < 3; k++) hiss(t + k * 0.07, 0.03, 0.12 * vol, cut * 1.4, cut * 0.5, 'bandpass', 'sfx', 1.2, 0.001);
      else if (e.kind === 'rocket') hiss(t, 0.6, 0.12 * vol, cut, 400, 'bandpass', echo, 1.2, 0.02);
      else thump(e.kind === 'shell' ? 60 : 75, t, 0.25, 0.22 * vol, { punch: 10, tone: cut, bus: d > 0.5 ? valley : echo });
    },
    // a missile launched at us: a far whoosh (the warning tone says the rest)
    launch: (t, e = {}) => {
      const vol = (1 - 0.8 * clamp01(e.dist ?? 0.6)) ** 1.5;
      thump(55, t, 0.4, 0.12 * vol, { punch: 10, tone: 300, bus: valley });
      hiss(t + 0.05, 1.2, 0.08 * vol, 700, 1800, 'bandpass', valley, 1.2, 0.1);
    },
    weapon: t => {
      hiss(t, 0.012, 0.12, 4000, 3000, 'bandpass', 'sfx', 2, 0.001);
      clank(600, t + 0.03, 0.025);
      tone(520, 780, t + 0.01, 0.06, 0.035, 'triangle');
    },
    target: t => {
      tone(1320, 1320, t, 0.04, 0.035, 'sine');
      tone(1760, 1760, t + 0.06, 0.05, 0.03, 'sine');
    },
    lowfuel: t => {
      for (let k = 0; k < 2; k++) {
        bell(79, t + k * 0.55, 0.05, { ratio: 1, index: 1 });
        bell(74, t + k * 0.55 + 0.2, 0.05, { ratio: 1, index: 1 });
      }
    },
    objective: t => [74, 81, 86].forEach((n, k) => bell(n, t + k * 0.09, 0.045, { ratio: 3.5, index: 1.2 })),
    fail: t =>
      [65, 61, 56].forEach((n, k) =>
        pulse(midi(n), t + k * 0.2, 0.18, 0.05, { width: 0.2, cutoff: 900, envmod: 600, decay: 0.2, sustain: 0.5, release: 0.15, bus: 'sfx' }),
      ),
    // start a mission: the starter's whir and three rising chimes
    start: t => {
      tone(180, 900, t, 0.6, 0.012, 'sawtooth', 'sfx', 0.3);
      hiss(t, 0.7, 0.07, 300, 2400, 'bandpass', 'sfx', 1.2, 0.5);
      [62, 69, 74].forEach((n, k) => bell(n, t + 0.12 + k * 0.08, 0.04, { ratio: 1, index: 1.5 }));
    },
    move: t => tone(940, 940, t, 0.03, 0.035, 'triangle'),
    select: t => {
      tone(784, 784, t, 0.05, 0.04, 'triangle');
      tone(1175, 1175, t + 0.06, 0.07, 0.04, 'triangle');
    },
    back: t => {
      tone(1046, 1046, t, 0.05, 0.04, 'triangle');
      tone(698, 698, t + 0.06, 0.07, 0.04, 'triangle');
    },
  };
  return all;
}

export function createAudio({ on = true } = {}) {
  return createSynth({
    on,
    seed: 1990,
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
