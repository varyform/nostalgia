// Procedural sound: a little tracker playing original tunes (one per venue, plus the title,
// the bonus round and the street show), and effects made from oscillators and noise. Two
// voicings: 'speaker' (square waves, the PC speaker and a tiny sound card) for the CGA page,
// 'rich' (soft triangles, a touch of echo) for HD. The context is only created by unlock(),
// which the page calls from a user gesture.
//
//   const audio = createAudio({ on: true, style: 'rich' });
//   audio.unlock();  audio.music('v0');  audio.sfx('slide');  audio.setOn(false);
const midi = n => 440 * 2 ** ((n - 69) / 12);
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// "C5 . E5 - G#4": one token per 16th step; "." rests, "-" holds the previous note
function seq(s) {
  const out = [];
  for (const tok of s.trim().split(/\s+/)) {
    if (tok === '|') continue;
    if (tok === '.') { out.push(0); continue; }
    if (tok === '-') { out.push(-1); continue; }
    const m = tok.match(/^([A-G])([#b]?)(\d)$/);
    out.push(m ? 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) : 0);
  }
  return out;
}
const CH = { M: [0, 4, 7], m: [0, 3, 7], s: [0, 5, 7], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10] };

const TRACKS = {
  title: {
    bpm: 112, chords: [[48, 'M'], [45, 'm'], [41, 'M'], [43, 'M']], bass: 'x...x.x.x...x...', drums: 'k...s...k.k.s...',
    lead: seq(`C5 . E5 . G5 . E5 . C6 . - . G5 . E5 . | A4 . C5 . E5 . C5 . A5 . - . E5 . C5 . |
               F4 . A4 . C5 . F5 . A5 . G5 . F5 . E5 . | D5 . - . G4 . B4 . D5 . - . - . . .`),
  },
  v0: { // Pier Parlour: a breezy boardwalk two-step
    bpm: 116, chords: [[43, 'M'], [48, 'M'], [50, 'M'], [43, 'M'], [40, 'm'], [48, 'M'], [50, 'M'], [50, 'M']], bass: 'x...x...x...x.x.', drums: 'k..hs.h.k.hhs.h.',
    lead: seq(`D5 . . B4 . D5 G5 . - . F#5 . E5 . D5 . | E5 . . C5 . E5 G5 . - . E5 . C5 . . . |
               F#5 . . D5 . F#5 A5 . - . G5 . F#5 . E5 . | D5 . B4 . G4 . - . . . . . . . . . |
               B4 . . G4 . B4 E5 . - . D5 . B4 . . . | C5 . . E5 . G5 C6 . - . B5 . A5 . G5 . |
               A5 . - . F#5 . D5 . E5 . F#5 . A5 . . . | G5 . - . - . . . D5 . E5 . F#5 . . .`),
  },
  v1: { // Snowcap Lodge: slow and warm by the fire
    bpm: 92, chords: [[41, 'M7'], [38, 'm7'], [46, 'M'], [48, 'M']], bass: 'x.....x.x.......', drums: 'k.......s.....h.', pad: true,
    lead: seq(`C5 - - . A4 - . . F4 . A4 . C5 - . . | D5 - - . A4 - . . F4 . A4 . D5 - . . |
               Bb4 - - . D5 - . . F5 - . . D5 . Bb4 . | C5 - - . E5 - . . G5 - - - . . . .`),
  },
  v2: { // Lantern Market: a busy pentatonic stroll
    bpm: 124, chords: [[45, 'm'], [45, 'm'], [41, 'M'], [43, 'M']], bass: 'x.x...x.x.x...x.', drums: 'k.hhs.hhk.k.s.hh',
    lead: seq(`A4 . C5 . D5 . E5 G5 . E5 D5 . C5 . A4 . | G4 . A4 . C5 . - . D5 . C5 . A4 . . . |
               F4 . A4 . C5 . F5 . E5 . D5 . C5 . D5 . | E5 . - . G5 . - . E5 . D5 . E5 . . .`),
  },
  v3: { // Crater Café: spacey and floating
    bpm: 100, chords: [[38, 'm7'], [43, 'M'], [38, 'm7'], [48, 'M']], bass: 'x.......x...x...', drums: 'k...h...s...h.h.', pad: true, arp: true,
    lead: seq(`D5 . . . A5 . . . F5 . . E5 . . D5 . | B4 . . . D5 . . . G5 . . F5 . E5 . |
               D5 . . . A5 . . . C6 . . A5 . . G5 . | E5 . . . C5 . . . G4 . . . . . . .`),
  },
  bonus: {
    bpm: 136, chords: [[40, 'M'], [45, 'M'], [47, 'M'], [40, 'M']], bass: 'x.x.x.x.x.x.x.x.', drums: 'k.h.s.h.k.h.s.hh',
    lead: seq(`E5 G#5 B5 . E5 G#5 B5 . E6 . B5 . G#5 . E5 . | A5 . E5 . C#5 . E5 . A5 . - . . . . . |
               B5 . F#5 . D#5 . F#5 . B5 . A5 . G#5 . F#5 . | E5 . B4 . G#4 . B4 . E5 . - . . . . .`),
  },
  show: { // the tip's street show: an oom-pah band
    bpm: 128, oompah: true, chords: [[46, 'M'], [41, 'M'], [41, 'M'], [46, 'M']], bass: 'x...x...x...x...', drums: 'k.s.k.s.k.s.k.ss',
    lead: seq(`F5 . D5 . Bb4 . D5 . F5 . . . Bb5 . . . | A5 . G5 . F5 . Eb5 . C5 . . . . . . . |
               C5 . Eb5 . F5 . A5 . C6 . A5 . F5 . . . | Bb5 . F5 . D5 . F5 . Bb4 . . . . . . .`),
  },
};
// jingles: [midi, steps] at a fixed 16th length
const JINGLE = {
  clear: { dt: 0.075, notes: [[72, 1], [76, 1], [79, 1], [84, 2], [0, 1], [79, 1], [84, 4]] },
  gameover: { dt: 0.14, notes: [[67, 2], [66, 2], [65, 2], [64, 6]] },
  life: { dt: 0.06, notes: [[76, 1], [79, 1], [84, 1], [88, 1], [91, 3]] },
  perfect: { dt: 0.07, notes: [[72, 1], [76, 1], [79, 1], [84, 1], [79, 1], [84, 1], [88, 4]] },
  bonus: { dt: 0.08, notes: [[64, 1], [68, 1], [71, 1], [76, 3]] },
  show: { dt: 0.07, notes: [[70, 1], [74, 1], [77, 1], [82, 3]] },
};
const PADS = [72, 76, 79, 67]; // the Order Up! pads: up, right, down, left

export function createAudio({ on = true, style = 'rich' } = {}) {
  const speaker = style === 'speaker';
  let ac = null, master = null, musicBus = null, sfxBus = null, noise = null;
  let soundOn = on, track = null, trackName = null, step = 0, nextT = 0, timer = 0, lastPour = 0;

  function unlock() {
    if (ac) { if (ac.state === 'suspended') void ac.resume(); return; }
    try { ac = new AudioContext(); } catch { ac = null; return; }
    master = ac.createGain(); master.gain.value = soundOn ? 0.55 : 0; master.connect(ac.destination);
    musicBus = ac.createGain(); musicBus.gain.value = speaker ? 0.22 : 0.3; musicBus.connect(master);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.7; sfxBus.connect(master);
    if (!speaker) {
      // a short slap-back echo on the music
      const d = ac.createDelay(1), fb = ac.createGain(), wet = ac.createGain();
      d.delayTime.value = 0.19; fb.gain.value = 0.28; wet.gain.value = 0.22;
      musicBus.connect(d); d.connect(fb).connect(d); d.connect(wet).connect(master);
    }
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 11;
    for (let i = 0; i < data.length; i++) { seed = (seed * 16807) % 2147483647; data[i] = (seed / 2147483647) * 2 - 1; }
    timer = setInterval(schedule, 40);
    if (track) { step = 0; nextT = ac.currentTime + 0.05; }
  }
  function setOn(v) {
    soundOn = v;
    if (master) master.gain.setTargetAtTime(v ? 0.55 : 0, ac.currentTime, 0.02);
  }

  // ---------- voices ----------
  function env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function tone(f0, f1, t, dur, vol, type = 'square', bus = sfxBus, attack = 0.004) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    env(g, t, attack, vol, dur);
    o.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }
  function hiss(t, dur, vol, f0 = 3000, f1 = 300, type = 'lowpass', bus = sfxBus, q = 1) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise; s.loop = true; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    env(g, t, 0.004, vol, dur);
    s.connect(f).connect(g).connect(bus); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  const leadType = speaker ? 'square' : 'triangle';
  function lead(f, t, dur, vol) {
    if (speaker) { tone(f, f, t, dur, vol * 0.7, 'square', musicBus, 0.003); return; }
    tone(f, f, t, dur, vol, 'triangle', musicBus, 0.01);
    tone(f * 1.004, f * 1.004, t, dur, vol * 0.35, 'sine', musicBus, 0.02);
  }

  // ---------- music ----------
  function music(name) {
    if (name === trackName) return;
    trackName = name; track = name ? TRACKS[name] : null; step = 0;
    if (ac) nextT = ac.currentTime + 0.08;
  }
  function schedule() {
    if (!ac || !track) return;
    const dt = 60 / track.bpm / 4;
    while (nextT < ac.currentTime + 0.2) {
      playStep(track, step, nextT, dt);
      step++; nextT += dt;
    }
  }
  function playStep(tr, i, t, dt) {
    const s = i % 16, [root, kind] = tr.chords[Math.floor(i / 16) % tr.chords.length], ch = CH[kind];
    if (tr.bass[s] === 'x') {
      const n = root - 12 + (tr.oompah && s % 8 === 4 ? 7 : 0); // oom-pah: root, fifth
      tone(midi(n), midi(n), t, dt * 1.7, speaker ? 0.1 : 0.16, speaker ? 'square' : 'triangle', musicBus, 0.005);
    }
    if (tr.pad && s === 0 && !speaker) ch.forEach(c => tone(midi(root + 12 + c), midi(root + 12 + c), t, dt * 15, 0.025, 'sine', musicBus, 0.25));
    if ((tr.arp || speaker) && s % 2 === 1 && !tr.lead[i % tr.lead.length]) {
      const c = ch[((i - 1) / 2) % ch.length];
      tone(midi(root + 24 + c), midi(root + 24 + c), t, dt * 0.9, speaker ? 0.03 : 0.035, speaker ? 'square' : 'sine', musicBus);
    }
    const n = tr.lead[i % tr.lead.length];
    if (n > 0) {
      let hold = 1;
      while (tr.lead[(i + hold) % tr.lead.length] === -1) hold++;
      lead(midi(n), t, dt * (hold + 0.6), 0.09);
    }
    const d = tr.drums[s];
    if (d === 'k') tone(speaker ? 120 : 140, 40, t, 0.1, speaker ? 0.12 : 0.28, speaker ? 'square' : 'sine', musicBus);
    if (d === 's') hiss(t, 0.09, speaker ? 0.05 : 0.11, 5000, 1200, 'bandpass', musicBus, 0.8);
    if (d === 'h') hiss(t, 0.025, speaker ? 0.02 : 0.035, 9000, 7000, 'highpass', musicBus);
  }
  function jingle(name, t) {
    const J = JINGLE[name];
    let at = t;
    for (const [n, len] of J.notes) {
      if (n) { tone(midi(n), midi(n), at, J.dt * len + 0.04, 0.08, leadType, sfxBus, 0.005); if (!speaker) tone(midi(n + 12), midi(n + 12), at, J.dt * len, 0.02, 'sine', sfxBus); }
      at += J.dt * len;
    }
  }

  // ---------- effects ----------
  const SFX = {
    pour: t => { if (t - lastPour < 0.1) return; lastPour = t; hiss(t, 0.5, 0.07, 700, 1600, 'bandpass', sfxBus, 4); for (let k = 0; k < 4; k++) tone(500 + k * 140, 900 + k * 160, t + k * 0.11, 0.05, 0.02, 'sine'); },
    brim: t => tone(1320, 1320, t, 0.08, 0.05, leadType),
    slide: (t, e) => { hiss(t, 0.28, 0.12, 2200, 500, 'bandpass', sfxBus, 1.5); if (e?.perfect) [1568, 1976, 2349].forEach((f, k) => tone(f, f, t + 0.04 + k * 0.05, 0.08, 0.035, leadType)); },
    catch: t => { tone(1800, 1700, t, 0.05, 0.05, 'triangle'); tone(2400, 2300, t + 0.02, 0.05, 0.03, 'triangle'); },
    out: t => { tone(880, 880, t, 0.12, 0.05, leadType); tone(660, 660, t + 0.12, 0.2, 0.05, leadType); },
    sip: t => hiss(t, 0.12, 0.03, 600, 300, 'bandpass', sfxBus, 3),
    return: t => hiss(t, 0.35, 0.05, 900, 400, 'bandpass', sfxBus, 2),
    collect: t => { tone(1400, 1400, t, 0.04, 0.05, 'triangle'); tone(2100, 2100, t + 0.04, 0.06, 0.04, 'triangle'); },
    tipdrop: t => tone(2600, 2400, t, 0.05, 0.03, 'triangle'),
    tip: t => [1760, 2217, 2637].forEach((f, k) => tone(f, f, t + k * 0.05, 0.12, 0.045, 'triangle')),
    show: t => jingle('show', t),
    hop: t => tone(420, 640, t, 0.04, 0.025, leadType),
    putdown: t => tone(300, 200, t, 0.05, 0.03, 'triangle'),
    spill: t => { hiss(t, 0.4, 0.14, 1800, 200, 'lowpass'); tone(300, 120, t, 0.25, 0.04, leadType); },
    enter: t => tone(1200, 1000, t, 0.03, 0.012, 'triangle'),
    tipgone: t => tone(500, 300, t, 0.1, 0.02, 'triangle'),
    miss: (t, e) => {
      if (e?.cause === 'grab') { tone(220, 110, t, 0.5, 0.08, 'sawtooth'); tone(233, 116, t, 0.5, 0.05, 'square'); }
      else { hiss(t, 0.5, 0.25, 8000, 1500, 'highpass'); for (let k = 0; k < 5; k++) tone(2000 + k * 450, 1600 + k * 300, t + k * 0.03, 0.06, 0.03, 'triangle'); }
    },
    gameover: t => jingle('gameover', t + 0.3),
    clear: t => jingle('clear', t),
    life: t => jingle('life', t),
    bonus: t => jingle('bonus', t),
    pad: (t, e) => tone(midi(PADS[e.pad]), midi(PADS[e.pad]), t, 0.26, 0.08, leadType, sfxBus, 0.006),
    wrong: t => { tone(110, 100, t, 0.5, 0.08, 'sawtooth'); tone(116, 104, t, 0.5, 0.05, 'square'); },
    round: t => [76, 79, 84].forEach((n, k) => tone(midi(n), midi(n), t + 0.2 + k * 0.07, 0.1, 0.05, leadType)),
    perfect: t => jingle('perfect', t + 0.2),
    move: t => tone(600, 600, t, 0.03, 0.03, leadType),
    select: t => tone(660, 990, t, 0.08, 0.05, leadType),
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
