// Procedural sound, all original tunes, made with Web Audio. Two voicings of the same score:
// the HD band (pulse lead, soft arpeggio, triangle bass, noise kit) and, for the CGA page,
// the PC speaker: one square voice, the lead alone, effects as beeps and buzzes.
// The context is only created by unlock(), which the page calls from a user gesture; the
// demo never creates one.
//
//   const audio = createAudio({ on: true, speaker: false });
//   audio.unlock();                 // from keydown / pointerdown / touchstart
//   audio.music('dig'); audio.sfx('gem', { streak: 3 }); audio.setOn(false);
const midi = n => 440 * 2 ** ((n - 69) / 12);
const CH = { M: [0, 4, 7, 12], m: [0, 3, 7, 12] };
// 16 steps a bar; lead: note numbers, '.' rest, '-' hold
const line = s => s.trim().split(/\s+/).map(t => (t === '.' ? 0 : t === '-' ? -1 : +t));
const TRACKS = {
  // "Pithead": the title march
  title: {
    bpm: 112, duty: 0.25, bass: 'x...x...x...x.x.', drums: 'k...h...s...h..h',
    bars: [[43, 'M'], [48, 'M'], [40, 'm'], [50, 'M'], [43, 'M'], [48, 'M'], [50, 'M'], [43, 'M']],
    lead: line(`67 - 71 - 74 - 79 - 78 - 74 - 71 - 74 -   72 - 76 - 79 - 76 - 74 - 72 - 71 - 69 -
                71 - 74 - 79 - 74 - 76 - 79 - 83 - 79 -   81 - 79 - 78 - 76 - 74 - - - 74 78 81 -
                83 - 81 - 79 - 74 - 76 - 74 - 71 - 67 -   72 - 74 - 76 - 79 - 81 - 79 - 76 - 72 -
                74 - 78 - 81 - 78 - 79 - 78 - 76 - 74 -   79 - - - 74 - 71 - 67 - - - - - - -`),
  },
  // "Clay and Candle": odd levels
  dig: {
    bpm: 138, duty: 0.5, bass: 'x.x.x.x.x.x.x.xx', drums: 'k.h.s.h.k.khs.h.',
    bars: [[45, 'm'], [41, 'M'], [43, 'M'], [40, 'M'], [45, 'm'], [38, 'm'], [41, 'M'], [40, 'M']],
    lead: line(`69 - 72 76 - 74 72 - 71 - 72 - 69 - - -   65 - 69 72 - 71 69 - 67 - 69 - 65 - - -
                67 - 71 74 - 76 77 - 76 - 74 - 71 - 67 -   68 - 71 - 74 - 76 - 74 - 71 - 68 - 64 -
                76 - 76 - 74 72 - 74 76 - 81 - 79 - 76 -   74 - 74 - 72 69 - 72 74 - 77 - 76 - 74 -
                72 - 74 - 76 - 77 - 79 - 77 - 76 - 74 -   71 - - - 68 - 71 - 76 - - - - - - -`),
  },
  // "Seam Shuffle": even levels
  dig2: {
    bpm: 126, duty: 0.25, bass: 'x..x..x.x..x..x.', drums: 'k..hs.h.k.hhs..h',
    bars: [[38, 'm'], [48, 'M'], [46, 'M'], [45, 'M'], [38, 'm'], [48, 'M'], [46, 'M'], [45, 'M']],
    lead: line(`74 - 77 - 81 - 79 77 - 76 74 - 72 - 74 -   72 - 76 - 79 - 77 76 - 74 72 - 71 - 72 -
                70 - 74 - 77 - 76 74 - 72 70 - 69 - 70 -   69 - 73 - 76 - 79 - 81 - - - 76 - - -
                86 - 84 - 81 - 77 - 79 - 81 - 77 - 74 -   84 - 81 - 79 - 76 - 77 - 79 - 76 - 72 -
                82 - 81 - 79 - 77 - 74 - 77 - 79 - 81 -   81 - 79 - 76 - 73 - 74 - - - - - - -`),
  },
  // "Lamplight Gallop": the grubs run
  lamp: {
    bpm: 168, duty: 0.125, bass: 'x.x.x.x.x.x.x.x.', drums: 'k.hhs.hhk.hhs.hs',
    bars: [[48, 'M'], [43, 'M'], [41, 'M'], [43, 'M']],
    lead: line(`72 74 76 79 - 76 79 84 - 79 76 79 - 76 74 72   71 72 74 79 - 74 79 83 - 79 74 79 - 74 72 71
                69 72 77 81 - 77 81 84 - 81 77 81 - 77 72 69   71 74 79 83 - 86 - 83 79 - 74 - 79 - - -`),
  },
};

export function createAudio({ on = true, speaker = false } = {}) {
  let ac = null, master = null, musicBus = null, sfxBus = null, noise = null;
  const waves = {};
  let soundOn = on, track = null, trackName = null, step = 0, nextT = 0, timer = 0, hold = 0;
  const VOL = speaker ? 0.32 : 0.55;

  function unlock() {
    if (ac) { if (ac.state === 'suspended') void ac.resume().catch(() => {}); return; }
    try { ac = new AudioContext(); } catch { ac = null; return; }
    master = ac.createGain(); master.gain.value = soundOn ? VOL : 0;
    if (speaker) {
      // a small paper cone: no deep bass, no sparkle
      const hp = ac.createBiquadFilter(), lp = ac.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 180; lp.type = 'lowpass'; lp.frequency.value = 4200;
      master.connect(hp).connect(lp).connect(ac.destination);
    } else master.connect(ac.destination);
    musicBus = ac.createGain(); musicBus.gain.value = speaker ? 0.22 : 0.34; musicBus.connect(master);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.75; sfxBus.connect(master);
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noise.getChannelData(0);
    let seed = 23;
    for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
    for (const duty of [0.125, 0.25, 0.5]) {
      const n = 32, re = new Float32Array(n), im = new Float32Array(n);
      for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      waves[duty] = ac.createPeriodicWave(re, im);
    }
    timer = setInterval(schedule, 40);
    nextT = ac.currentTime + 0.06; step = 0;
  }
  function setOn(v) {
    soundOn = v;
    if (master) master.gain.setTargetAtTime(v ? VOL : 0, ac.currentTime, 0.02);
  }

  // ---------- voices ----------
  function env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function tone(f0, f1, t, dur, vol, type = 0.25, bus = sfxBus) {
    const o = ac.createOscillator(), g = ac.createGain();
    if (speaker) o.type = 'square';
    else if (typeof type === 'number') o.setPeriodicWave(waves[type]);
    else o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    if (speaker) { g.gain.setValueAtTime(vol, t); g.gain.setValueAtTime(0, t + dur); } // the speaker is on or off
    else env(g, t, 0.005, vol, dur);
    o.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }
  function hiss(t, dur, vol, f0 = 3000, f1 = 300, type = 'lowpass', bus = sfxBus) {
    if (speaker) { // a buzz of random clicks instead of noise
      for (let k = 0, n = Math.max(1, Math.round(dur / 0.012)); k < n; k++) tone(f1 + ((k * 7919) % 13) * (f0 - f1) / 13, f1, t + k * 0.012, 0.008, vol * 0.5, 0.5, bus);
      return;
    }
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise; s.loop = true; f.type = type;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    env(g, t, 0.004, vol, dur);
    s.connect(f).connect(g).connect(bus); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  const notes = (list, t, gap, dur, vol, type = 0.25) => list.forEach((n, k) => n && tone(midi(n), midi(n), t + k * gap, dur, vol, type));

  // ---------- music ----------
  function music(name) {
    if (name === trackName) return;
    trackName = name; track = name ? TRACKS[name] : null; step = 0;
    if (ac) nextT = Math.max(ac.currentTime + 0.08, hold);
  }
  function schedule() {
    if (!ac || !track) return;
    const dt = 60 / track.bpm / 4;
    while (nextT < ac.currentTime + 0.2) { playStep(track, step, nextT, dt); step++; nextT += dt; }
  }
  function playStep(tr, i, t, dt) {
    if (t < hold) return; // a jingle has the floor
    const bar = tr.bars[Math.floor(i / 16) % tr.bars.length], s = i % 16, [root, kind] = bar, ch = CH[kind];
    const L = tr.lead, n = L[i % L.length];
    if (n > 0) {
      let len = 1;
      while (L[(i + len) % L.length] === -1 && len < 8) len++;
      tone(midi(n), midi(n), t, dt * len * (speaker ? 0.8 : 0.95), speaker ? 0.08 : 0.075, tr.duty, musicBus);
    }
    if (speaker) return;
    if (tr.bass[s] === 'x') tone(midi(root - 12), midi(root - 12), t, dt * 1.7, 0.16, 'triangle', musicBus);
    if (s % 2 === 1) { const f = midi(root + 12 + ch[((s - 1) / 2) % 4]); tone(f, f, t, dt * 0.9, 0.03, 0.5, musicBus); }
    const d = tr.drums[s];
    if (d === 'k') tone(140, 45, t, 0.1, 0.22, 'sine', musicBus);
    if (d === 's') hiss(t, 0.08, 0.08, 6000, 1500, 'bandpass', musicBus);
    if (d === 'h') hiss(t, 0.025, 0.035, 9000, 7000, 'highpass', musicBus);
  }
  // a jingle silences the music for its length
  const jingle = (t, secs) => { hold = Math.max(hold, t + secs); };

  // ---------- effects ----------
  const SFX = {
    dig: t => hiss(t, 0.035, 0.025, 1400, 500),
    gem: (t, e) => { const b = 79 + Math.min(12, (e?.streak ?? 1) * 1.5); tone(midi(b), midi(b + 7), t, 0.07, 0.06, 0.25); },
    streak: t => notes([84, 88, 91, 96, 91, 96], t + 0.08, 0.05, 0.08, 0.06, 0.125),
    push: t => hiss(t, 0.08, 0.04, 800, 300),
    wobble: t => { for (let k = 0; k < 4; k++) tone(170 + (k % 2) * 30, 170 + (k % 2) * 30, t + k * 0.09, 0.05, 0.035, 0.5); },
    drop: t => tone(600, 200, t, 0.25, 0.04, 0.25),
    thud: t => { tone(110, 50, t, 0.12, 0.12, 'sine'); hiss(t, 0.1, 0.06, 900, 150); },
    burst: t => { tone(160, 60, t, 0.18, 0.12, 'sine'); hiss(t, 0.25, 0.1, 2500, 300); notes([88, 91, 95], t + 0.1, 0.05, 0.08, 0.04, 0.125); },
    gold: t => notes([84, 91, 96, 91, 96, 100], t, 0.045, 0.09, 0.06, 0.125),
    fire: t => { tone(1400, 300, t, 0.16, 0.06, 0.125); hiss(t, 0.06, 0.04, 6000, 2000, 'highpass'); },
    fizzle: t => hiss(t, 0.12, 0.05, 2500, 400),
    kill: (t, e) => {
      if (e?.how === 'eat') { const b = 72 + Math.min(4, (e.pts ?? 200) / 400) * 3; notes([b, b + 4, b + 7, b + 12], t, 0.05, 0.08, 0.07, 0.25); return; }
      tone(900, 120, t, 0.25, 0.07, 0.5); hiss(t + 0.04, 0.2, 0.06, 3000, 300);
    },
    spawn: t => { tone(120, 240, t, 0.25, 0.04, 0.5); hiss(t, 0.2, 0.03, 700, 200); },
    morph: (t, e) => e?.to === 'burrower' ? tone(300, 90, t, 0.3, 0.05, 0.5) : tone(90, 260, t, 0.25, 0.04, 0.5),
    gemlost: t => tone(500, 380, t, 0.08, 0.03, 0.5),
    goldlost: t => tone(400, 200, t, 0.12, 0.03, 0.5),
    bonusshow: t => notes([79, 0, 79, 84], t, 0.07, 0.08, 0.05, 0.125),
    bonus: t => notes([72, 76, 79, 84, 88], t, 0.05, 0.1, 0.07, 0.25),
    frenzyend: t => notes([84, 79, 74], t, 0.08, 0.1, 0.05, 0.5),
    die: t => {
      jingle(t, 1.9);
      // "Cave-in": a sagging chromatic slide and two low knocks
      notes([79, 78, 77, 76, 0, 72, 71, 0, 64, 0, 60], t + 0.15, 0.12, 0.13, 0.08, 0.25);
      hiss(t, 0.35, 0.1, 1800, 200);
    },
    respawn: t => notes([67, 71, 74, 79], t, 0.06, 0.1, 0.05, 0.125),
    clear: t => { jingle(t, 2.4); notes([72, 76, 79, 84, 0, 79, 84, 0, 88, 91, 96], t + 0.1, 0.1, 0.16, 0.08, 0.25); },
    over: t => { jingle(t, 3); notes([67, 0, 66, 0, 65, 0, 64, 0, 0, 55], t + 0.2, 0.18, 0.3, 0.08, 0.25); },
    life: t => notes([79, 83, 86, 91, 86, 91], t, 0.07, 0.12, 0.07, 0.25),
    level: () => {},
    tick: t => tone(1100, 1100, t, 0.025, 0.03, 0.125),
    select: t => tone(660, 990, t, 0.08, 0.05, 0.25),
  };
  function sfx(type, e) {
    if (!ac || !soundOn || !SFX[type]) return;
    SFX[type](ac.currentTime + 0.005, e);
  }
  function destroy() {
    clearInterval(timer);
    if (ac) void ac.close().catch(() => {});
    ac = null;
  }
  return { unlock, setOn, sfx, music, destroy, get on() { return soundOn; } };
}
