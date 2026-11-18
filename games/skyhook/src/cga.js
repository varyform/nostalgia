'use strict';
import { createInput, drawPrompt, glyphs, measureGlyphs, drawGlyphs, measureGlyph, parsePrompt } from '@nostalgia/input';
import meta from '../game.json';
import { createPilot } from './autopilot.js';
// SKYHOOK — a CGA-style helicopter rescue shooter. 320x200, 4 colours, shown at 4:3.

// The whole game on a canvas. `demo` is attract mode (?demo=on, the launcher's preview): an
// autopilot flies `mission`, with no input, sound or storage writes. `onExit` returns to the launcher.
export function boot(cv, { demo = false, reducedMotion = false, mission = 0, sound = true, onExit = null } = {}) {
  const W = 320, H = 200, PH = 184, DT = 1 / 60, CAP = 4, SAFE_VY = 52, SAFE_VX = 40;
  const g = cv.getContext('2d');
  // everything bound outside the game's own state, undone by stop()
  const offs = [];
  function listen(t, type, fn, opts) { t.addEventListener(type, fn, opts); offs.push(() => t.removeEventListener(type, fn, opts)); }
  function fit() {
    const s = Math.min(innerWidth / 320, innerHeight / 240);
    cv.style.width = Math.floor(320 * s) + 'px';
    cv.style.height = Math.floor(240 * s) + 'px';
  }
  listen(window, 'resize', fit); fit();

  // CGA palettes: 1 high, 0 high, 1 low
  const PALS = [
    ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
    ['#000000', '#55ff55', '#ff5555', '#ffff55'],
    ['#000000', '#00aaaa', '#aa00aa', '#aaaaaa'],
  ];
  let palIdx = 0, P = PALS[0];

  // ---------- helpers ----------
  let R = Math.random;
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const rr = (a, b) => a + (b - a) * R();
  const ri = (a, b) => Math.floor(a + (b - a + 1) * R());
  const rnd = (a, b) => a + (b - a) * Math.random();
  const approach = (v, t, d) => v < t ? Math.min(t, v + d) : Math.max(t, v - d);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const ov = (ax, ay, aw, ah, bx, by, bw, bh) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  const pad6 = n => String(Math.max(0, n | 0)).padStart(6, '0');

  // ---------- 5x7 bitmap font ----------
  const FONT_SRC = {
    A:'01110 10001 10001 11111 10001 10001 10001', B:'11110 10001 10001 11110 10001 10001 11110',
    C:'01110 10001 10000 10000 10000 10001 01110', D:'11110 10001 10001 10001 10001 10001 11110',
    E:'11111 10000 10000 11110 10000 10000 11111', F:'11111 10000 10000 11110 10000 10000 10000',
    G:'01110 10001 10000 10111 10001 10001 01111', H:'10001 10001 10001 11111 10001 10001 10001',
    I:'01110 00100 00100 00100 00100 00100 01110', J:'00111 00010 00010 00010 00010 10010 01100',
    K:'10001 10010 10100 11000 10100 10010 10001', L:'10000 10000 10000 10000 10000 10000 11111',
    M:'10001 11011 10101 10101 10001 10001 10001', N:'10001 10001 11001 10101 10011 10001 10001',
    O:'01110 10001 10001 10001 10001 10001 01110', P:'11110 10001 10001 11110 10000 10000 10000',
    Q:'01110 10001 10001 10001 10101 10010 01101', R:'11110 10001 10001 11110 10100 10010 10001',
    S:'01111 10000 10000 01110 00001 00001 11110', T:'11111 00100 00100 00100 00100 00100 00100',
    U:'10001 10001 10001 10001 10001 10001 01110', V:'10001 10001 10001 10001 10001 01010 00100',
    W:'10001 10001 10001 10101 10101 10101 01010', X:'10001 10001 01010 00100 01010 10001 10001',
    Y:'10001 10001 10001 01010 00100 00100 00100', Z:'11111 00001 00010 00100 01000 10000 11111',
    0:'01110 10001 10011 10101 11001 10001 01110', 1:'00100 01100 00100 00100 00100 00100 01110',
    2:'01110 10001 00001 00010 00100 01000 11111', 3:'11111 00010 00100 00010 00001 10001 01110',
    4:'00010 00110 01010 10010 11111 00010 00010', 5:'11111 10000 11110 00001 00001 10001 01110',
    6:'00110 01000 10000 11110 10001 10001 01110', 7:'11111 00001 00010 00100 01000 01000 01000',
    8:'01110 10001 10001 01110 10001 10001 01110', 9:'01110 10001 10001 01111 00001 00010 01100',
    '.':'00000 00000 00000 00000 00000 01100 01100', ',':'00000 00000 00000 00000 01100 00100 01000',
    ':':'00000 01100 01100 00000 01100 01100 00000', '!':'00100 00100 00100 00100 00100 00000 00100',
    '?':'01110 10001 00001 00010 00100 00000 00100', '-':'00000 00000 00000 11111 00000 00000 00000',
    '/':'00000 00001 00010 00100 01000 10000 00000', "'":'00100 00100 01000 00000 00000 00000 00000',
    '(':'00010 00100 01000 01000 01000 00100 00010', ')':'01000 00100 00010 00010 00010 00100 01000',
    '%':'11000 11001 00010 00100 01000 10011 00011', '+':'00000 00100 00100 11111 00100 00100 00000',
    '=':'00000 00000 11111 00000 11111 00000 00000', '>':'01000 00100 00010 00001 00010 00100 01000',
    '<':'00010 00100 01000 10000 01000 00100 00010', '*':'00000 00100 10101 01110 10101 00100 00000',
  };
  const FONT = {};
  for (const k in FONT_SRC) FONT[k] = FONT_SRC[k].split(' ').map(r => parseInt(r, 2));
  function text(s, x, y, c = 3, sc = 1) {
    s = String(s).toUpperCase(); g.fillStyle = typeof c === 'string' ? c : P[c];
    for (const ch of s) {
      const gl = FONT[ch];
      if (gl) for (let r = 0; r < 7; r++) { const b = gl[r]; if (b) for (let k = 0; k < 5; k++) if (b & (16 >> k)) g.fillRect(x + k * sc, y + r * sc, sc, sc); }
      x += 6 * sc;
    }
  }
  const tw = (s, sc = 1) => (String(s).length * 6 - 1) * sc;
  const ctext = (s, y, c = 3, sc = 1) => text(s, Math.round((W - tw(s, sc)) / 2), y, c, sc);
  const rtext = (s, xr, y, c = 3) => text(s, xr - tw(s), y, c);

  // ---------- sprites (0 black, 1 cyan, 2 magenta, 3 white, . clear) ----------
  const SPR_SRC = {
    heli0: ['..33333333333333333.', '..........3.........', '33.......222211.....', '3222222222222111....',
            '.2...22222222222221.', '.......333222222222.', '...2..........2.33..', '...3.........333....'],
    heli1: ['......3333333333....', '..........3.........', '.3.......222211.....', '2222222222222111....',
            '.2...22222222222221.', '.......333222222222.', '...2..........2.33..', '...3.........333....'],
    life:  ['.3333333.', '2...222..', '222222211', '...22222.'],
    gun:   ['..2222..', '.222222.', '21212121', '22222222'],
    tank:  ['....2222....', '...222222...', '.2222222222.', '222222222222', '.3.3.3.3.3..'],
    tank1: ['....2222....', '...222222...', '.2222222222.', '222222222222', '..3.3.3.3.3.'],
    rocket:['.33.', '3333', '.22.', '.22.', '.11.', '.22.', '.22.', '2222', '2..2', '2..2'],
    fuel:  ['..11111111..', '.1111111111.', '111333311111', '111311111111', '111333111111',
            '111311111111', '111311111111', '.1111111111.', '..1.1..1.1..', '..1.1..1.1..'],
    radar: ['....33....', '....33....', '....22....', '...2222...', '..222222..', '2222222222'],
    hut:   ['......33......', '....222222....', '..2222222222..', '22222222222222', '.200000000002.',
            '.203030030302.', '.203030030302.', '.200000000002.', '.222222222222.'],
    rubble:['..2..3...2..', '.222.22.222.', '222222222222'],
    jet:   ['..........33', '....1122.33.', '222222222222', '....2222..3.', '..........33'],
    mine:  ['...3...', '.2.2.2.', '..222..', '3222223', '..222..', '.2.2.2.', '...3...'],
    balloon:['..33333333..', '.3333333333.', '333333333322', '.3333333333.', '..33333333..'],
    spyA:  ['..33.3', '..33.3', '.1111.', '1.11..', '..11..', '..11..', '.1..1.', '.1..1.'],
    spyB:  ['..33..', '..33..', '.11111', '1.11..', '..11..', '..11..', '.1..1.', '.1..1.'],
    runA:  ['..33..', '..33..', '.1111.', '1.11.1', '..11..', '..11..', '.1..1.', '1....1'],
    runB:  ['..33..', '..33..', '.1111.', '.111..', '..11..', '..11..', '..11..', '..1.1.'],
    agent: ['.3.', '111', '111', '.1.', '1.1'],
    bomb:  ['2.2', '333', '333', '.3.'],
  };
  const PAT_SRC = {
    rock: ['20', '02'],
    bld:  ['1111', '1001', '1001', '1111', '1111'],
    fort: ['2222222', '2022202', '2222222', '0000000'],
    dots: ['1000', '0000', '0010', '0000'],
  };
  const MAT_PAT = ['rock', 'bld', 'fort'], MAT_SURF = [1, 3, 3];
  let SPR = {}, PAT = {};
  function mk(rows, fn, flip) {
    const h = rows.length, w = rows[0].length, c = document.createElement('canvas');
    c.width = w; c.height = h; const x = c.getContext('2d');
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const ch = rows[j][flip ? w - 1 - i : i];
      if (ch !== '.') { x.fillStyle = fn(ch); x.fillRect(i, j, 1, 1); }
    }
    return c;
  }
  function buildGfx() {
    P = PALS[palIdx];
    for (const k in SPR_SRC) {
      const r = SPR_SRC[k];
      SPR[k] = { c: mk(r, ch => P[+ch]), w: mk(r, () => P[3]), f: mk(r, ch => P[+ch], true) };
    }
    for (const k in PAT_SRC) PAT[k] = g.createPattern(mk(PAT_SRC[k], ch => P[+ch]), 'repeat');
  }
  const spr = (n, x, y, v = 'c') => g.drawImage(SPR[n][v], Math.round(x), Math.round(y));
  const sw = n => SPR_SRC[n][0].length, sh = n => SPR_SRC[n].length;
  buildGfx();

  // ---------- sound (PC-speaker flavoured) ----------
  let AC = null, master = null, soundOn = sound, engine = null, noiseBuf = null;
  function audioInit() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain(); master.gain.value = soundOn ? 0.5 : 0; master.connect(AC.destination);
    } catch (e) { AC = null; }
  }
  function tone(f0, f1, dur, vol = 0.08, type = 'square', delay = 0) {
    if (!AC) return;
    const t = AC.currentTime + delay, o = AC.createOscillator(), gn = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn).connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol = 0.2, freq = 1000) {
    if (!AC) return;
    if (!noiseBuf) {
      noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = AC.currentTime, s = AC.createBufferSource(), f = AC.createBiquadFilter(), gn = AC.createGain();
    s.buffer = noiseBuf; s.loop = true; f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(60, t + dur);
    gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(gn).connect(master); s.start(t); s.stop(t + dur + 0.02);
  }
  const seq = (notes, d, vol = 0.07) => notes.forEach((f, i) => tone(f, f, d * 0.9, vol, 'square', i * d));
  const sfx = {
    shoot: () => tone(1800, 500, 0.05, 0.04),
    bomb: () => tone(1300, 300, 0.45, 0.03),
    boom: () => { noise(0.35, 0.3, 1400); tone(160, 40, 0.25, 0.1); },
    big: () => { noise(1.1, 0.4, 900); tone(220, 30, 0.9, 0.12); },
    hit: () => tone(500, 300, 0.04, 0.05),
    tink: () => tone(2400, 2000, 0.03, 0.03),
    pick: () => seq([523, 659, 784], 0.07),
    saved: () => seq([784, 1047], 0.08),
    land: () => { tone(220, 180, 0.08, 0.07); tone(330, 330, 0.06, 0.05, 'square', 0.08); },
    lift: () => tone(200, 500, 0.25, 0.04),
    launch: () => tone(300, 1200, 0.4, 0.03),
    beep: () => tone(880, 880, 0.08, 0.05),
    fuel: () => seq([400, 600, 800, 1000], 0.05),
    jingle: () => seq([523, 659, 784, 1047], 0.1),
    fanfare: () => seq([523, 523, 659, 784, 659, 784, 1047], 0.13, 0.08),
    die: () => { noise(1.2, 0.4, 1000); tone(600, 40, 1.2, 0.08); },
    over: () => seq([392, 330, 262, 196], 0.28, 0.08),
    life: () => seq([1047, 784, 1047, 1319], 0.07),
  };
  function engineSet(on) {
    if (!AC) return;
    if (on && !engine) {
      const o = AC.createOscillator(), gn = AC.createGain(), lfo = AC.createOscillator(), lg = AC.createGain();
      o.type = 'square'; o.frequency.value = 46; gn.gain.value = 0;
      lfo.type = 'square'; lfo.frequency.value = 13; lg.gain.value = 0.012;
      lfo.connect(lg).connect(gn.gain); o.connect(gn).connect(master); o.start(); lfo.start();
      engine = { o, lfo };
    } else if (!on && engine) { engine.o.stop(); engine.lfo.stop(); engine = null; }
  }
  function setSound(on) { soundOn = on; if (master) master.gain.value = on ? 0.5 : 0; }

  // ---------- input ----------
  // bindings from game.json; the CGA version adds its palette key and has no touch prompts
  const plain = defs => Object.fromEntries(Object.entries(defs).map(([k, { touch: _touch, ...d }]) => [k, d]));
  const input = createInput({
    actions: { ...plain(meta.input.actions), palette: { keys: ['KeyC'] } },
    display: plain(meta.input.display),
    // stick counts from 0.4 deflection, as before; only arrows/space keep the page from scrolling
    threshold: 0.25, preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'],
    // the demo hears nothing and stays out of the launcher's <input-glyph> elements
    ...(demo && { target: new EventTarget(), getGamepads: () => [], register: false }),
  });
  function toggleFullscreen() {
    const d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    const pr = req.call(el, { navigationUI: 'hide' });
    if (pr && pr.then) pr.then(() => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); }).catch(() => {});
  }
  if (!demo) {
    // fullscreen must be requested from the input event itself, not from the game loop
    input.on('fullscreen', toggleFullscreen);
    listen(window, 'keydown', audioInit);
    listen(cv, 'dblclick', toggleFullscreen);
    listen(document, 'fullscreenchange', fit);
    listen(document, 'webkitfullscreenchange', fit);
    listen(window, 'blur', () => { if (state === 'play') paused = true; });
  }
  let I = {};
  function readInput(dt) {
    if (demo) { I = state === 'play' && !paused ? pilot(dt) : {}; return; }
    input.update();
    const h = a => input.held(a);
    I = { left: h('left'), right: h('right'), up: h('up'), down: h('down'), fire: h('fire'), bomb: h('bomb') };
  }
  const hit = a => input.pressed(a);

  // glyphs in CGA colours, labelled with the bitmap font
  const GS = 11;
  const GST = () => ({
    pixel: true, brand: false, measure: s => tw(s),
    text: (c, s, cx, cy, col) => text(s, Math.round(cx - tw(s) / 2), Math.round(cy - 3.5), col),
    cap: P[3], edge: P[1], capInk: P[0], pad: P[2], padInk: P[3], ink: P[3], dim: P[1],
  });
  // prompt with {action} glyphs; y is the top of the words, like text()
  const ptext = (s, x, y, c = 3, align = 'left') => drawPrompt(g, input, s, x, y + 3.5, { size: GS, gap: 4, color: P[c], align, style: GST() });
  // width of a prompt, laid out as drawPrompt does (spaces next to glyphs give way to the gap)
  const pw = s => {
    const st = GST(), q = parsePrompt(input, s);
    return q.map((it, i) => {
      if ('glyph' in it) return measureGlyph(g, it.glyph, GS, st);
      if ('sep' in it) return tw('/');
      let t = it.text; if (i > 0) t = t.trimStart(); if (i < q.length - 1) t = t.trimEnd();
      return t ? tw(t) : 0;
    }).filter(w => w > 0).reduce((w, x, i) => w + x + (i ? 4 : 0), 0);
  };
  const cptext = (s, y, c = 3) => ptext(s, W / 2, y, c, 'center');
  const onPad = () => input.device.kind === 'gamepad';

  // ---------- missions ----------
  const MISSIONS = [
    { name: 'COASTAL RUN', len: 4600, kind: 'hills', spies: 3, huts: 0, outposts: 1, dens: [100, 170],
      ground: { gun: 3, rocket: 3, tank: 1, fuel: 2, radar: 1 }, jets: 0, mines: 0, balloons: 0, walls: 0 },
    { name: 'RIDGE LINE', len: 5400, kind: 'mount', spies: 4, huts: 1, outposts: 1, dens: [80, 140],
      ground: { gun: 4, rocket: 4, tank: 2, fuel: 2, radar: 1 }, jets: 9, mines: 0, balloons: 0, walls: 0 },
    { name: 'DEEP CAVERNS', len: 5800, kind: 'cave', spies: 4, huts: 2, outposts: 2, dens: [80, 135],
      ground: { gun: 3, rocket: 4, tank: 1, fuel: 2, radar: 1 }, jets: 0, mines: 10, balloons: 0, walls: 3 },
    { name: 'OCCUPIED CITY', len: 6200, kind: 'city', spies: 5, huts: 2, outposts: 2, dens: [60, 110],
      ground: { gun: 5, rocket: 3, tank: 2, fuel: 2, radar: 2 }, jets: 7, mines: 0, balloons: 8, walls: 0 },
    { name: 'IRON FORTRESS', len: 7000, kind: 'fort', spies: 5, huts: 3, outposts: 2, dens: [55, 95],
      ground: { gun: 5, rocket: 5, tank: 2, fuel: 3, radar: 1 }, jets: 8, mines: 8, balloons: 0, walls: 5 },
  ];
  const HP = { gun: 2, tank: 3, rocket: 1, fuel: 1, radar: 2, hut: 3, jet: 1, mine: 2, balloon: 2 };
  const PTS = { gun: 100, tank: 200, rocket: 80, fuel: 150, radar: 300, hut: 100, jet: 150, mine: 80, balloon: 120 };
  const GROUNDED = { gun: 1, tank: 1, rocket: 1, fuel: 1, radar: 1, hut: 1 };

  function mkE(t, x, y) {
    return { t, x, y, w: sw(t), h: sh(t), hp: HP[t], flash: 0, dead: false, cd: rnd(0.6, 2.2), ax: 0, ay: -1, ph: rnd(0, 6.28) };
  }

  function genLevel(mi) {
    const M = MISSIONS[mi];
    R = mulberry32(1985 + mi * 7919 + loop * 31);
    const L = M.len, kind = M.kind, hasCeil = kind === 'cave' || kind === 'fort';
    const fl = new Float32Array(L), ce = new Float32Array(L).fill(-50), mat = new Uint8Array(L);
    const p0 = rr(0, 6.28), p1 = rr(0, 6.28), p2 = rr(0, 6.28), p3 = rr(0, 6.28);
    for (let x = 0; x < L; x++) {
      let f;
      if (kind === 'hills') f = 150 + 14 * Math.sin(x * 0.006 + p0) + 9 * Math.sin(x * 0.017 + p1) + 4 * Math.sin(x * 0.05 + p2);
      else if (kind === 'mount') f = 150 + 26 * Math.sin(x * 0.0045 + p0) - 26 * Math.abs(Math.sin(x * 0.012 + p1)) + 5 * Math.sin(x * 0.041 + p2);
      else if (kind === 'city') f = 174;
      else {
        f = 152 + 14 * Math.sin(x * 0.007 + p0) + 8 * Math.sin(x * 0.021 + p1) + 3 * Math.sin(x * 0.06 + p2);
        const gap = 80 + 20 * Math.sin(x * 0.005 + p3) + 10 * Math.sin(x * 0.019 + p1);
        ce[x] = Math.max(8, f - gap);
      }
      fl[x] = clamp(f, 64, 178);
      if (kind === 'fort') mat[x] = 2;
    }
    const smooth = (x, x0, w, ramp) => {
      const t = x < x0 ? (x - (x0 - ramp)) / ramp : x >= x0 + w ? (x0 + w + ramp - x) / ramp : 1;
      return t * t * (3 - 2 * t);
    };
    const flatten = (x0, w, y, ramp) => {
      for (let x = x0 - ramp; x < x0 + w + ramp; x++) if (x >= 0 && x < L) { const t = smooth(x, x0, w, ramp); fl[x] = fl[x] * (1 - t) + y * t; }
    };
    const carve = (x0, w, y, ramp) => {
      if (!hasCeil) return;
      for (let x = x0 - ramp; x < x0 + w + ramp; x++) if (x >= 0 && x < L) { const t = smooth(x, x0, w, ramp); ce[x] = Math.min(ce[x], ce[x] * (1 - t) + y * t); }
    };

    // sites: places that need flat ground
    const sites = [{ x: 30, w: 70, t: 'start' }, { x: L - 150, w: 110, t: 'hq' }];
    for (let i = 1; i <= M.outposts; i++) sites.push({ x: Math.round(L * i / (M.outposts + 1)) - 30, w: 60, t: 'out' });
    const free = (x, w, m) => sites.every(s => x + w + m < s.x || x > s.x + s.w + m);
    const kinds = []; for (let i = 0; i < M.spies; i++) kinds.push(i < M.huts ? 'hut' : 'spy');
    for (let i = kinds.length - 1; i > 0; i--) { const j = ri(0, i); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
    const seg = (L - 700) / M.spies;
    for (let i = 0; i < M.spies; i++) {
      for (let k = 0; k < 80; k++) {
        const x = Math.round(300 + seg * i + rr(0, seg - 60));
        if (free(x, 56, 40)) { sites.push({ x, w: 56, t: kinds[i] }); break; }
      }
    }
    if (kind === 'city') {
      let x = 0;
      while (x < L) {
        const gap = ri(3, 26), w = ri(20, 50), h = ri(16, 80), bx = x + gap;
        if (free(bx, w, 12)) for (let i = bx; i < bx + w && i < L; i++) { fl[i] = 174 - h; mat[i] = 1; }
        x = bx + w;
      }
    }
    for (const s of sites) {
      const y = kind === 'city' ? 174 : Math.round(clamp(fl[s.x + (s.w >> 1)], 118, 170));
      if (kind !== 'city') flatten(s.x, s.w, y, 28);
      carve(s.x, s.w, y - 62, 36);
      s.y = y;
    }
    // brick walls (caves)
    const walls = [];
    if (M.walls) {
      const segW = (L - 900) / M.walls;
      for (let i = 0; i < M.walls; i++) for (let k = 0; k < 60; k++) {
        const x = Math.round(500 + segW * i + rr(0, segW - 40));
        if (free(x, 16, 90)) { walls.push(x); sites.push({ x: x - 10, w: 36, t: 'wall' }); break; }
      }
    }
    for (const x of walls) flatten(x - 4, 24, Math.round(fl[x + 8]), 16);
    // ground enemies
    const enemies = [], types = Object.entries(M.ground), tot = types.reduce((a, b) => a + b[1], 0);
    let ex = 260;
    while (true) {
      ex += Math.round(rr(M.dens[0], M.dens[1]));
      if (ex > L - 260) break;
      let r = R() * tot, t = types[0][0];
      for (const [k, wgt] of types) { if ((r -= wgt) < 0) { t = k; break; } }
      const w = sw(t), h = sh(t), pd = t === 'tank' ? 24 : 6;
      if (!free(ex - pd, w + pd * 2, 10)) continue;
      if (kind === 'city') {
        const y0 = fl[ex - pd]; let ok = true;
        for (let i = ex - pd; i < ex + w + pd; i++) if (fl[i] !== y0) { ok = false; break; }
        if (!ok) continue;
      } else flatten(ex - pd, w + pd * 2, Math.round(fl[ex + (w >> 1)]), 12);
      if (hasCeil && fl[ex] - ce[ex] < h + 40) continue;
      enemies.push(mkE(t, ex, 0));
    }
    for (let i = 0; i < L; i++) {
      if (hasCeil && fl[i] - ce[i] < 46) ce[i] = fl[i] - 46;
      fl[i] = Math.round(fl[i]); ce[i] = Math.round(ce[i]);
    }
    // HQ tower becomes part of the skyline (and solid)
    const hq = sites.find(s => s.t === 'hq');
    for (let i = hq.x + 76; i < hq.x + 92; i++) { fl[i] = hq.y - 28; mat[i] = 1; }
    // bricks
    const bricks = [];
    for (const x of walls) {
      let top = 1e9; for (let i = x - 6; i < x + 22; i++) top = Math.min(top, ce[i]);
      for (let i = x - 6; i < x + 22; i++) ce[i] = top;
      const y = fl[x + 8];
      for (let by = y - 8; by + 8 > top; by -= 8) for (const bx of [x, x + 8]) bricks.push({ x: bx, y: by, hp: 3, flash: 0, dead: false });
    }
    for (const e of enemies) { e.y = fl[e.x + (e.w >> 1)] - e.h; e.hx = e.x; e.dir = R() < 0.5 ? -1 : 1; e.trig = rr(50, 110); }
    // mines (caves)
    for (let n = 0, k = 0; n < M.mines && k < 400; k++) {
      const x = Math.round(rr(400, L - 300));
      if (!free(x - 20, 47, 30) || fl[x] - ce[x] < 72) continue;
      const e = mkE('mine', x, 0); e.by = (fl[x] + ce[x]) / 2 - 3; e.amp = Math.min(12, (fl[x] - ce[x]) / 2 - 26);
      e.y = e.by; enemies.push(e); n++;
    }
    // barrage balloons (city)
    for (let n = 0, k = 0; n < M.balloons && k < 400; k++) {
      const x = Math.round(rr(400, L - 300));
      if (!free(x - 10, 32, 20)) continue;
      let top = 999; for (let i = x - 4; i < x + 16; i++) top = Math.min(top, fl[i]);
      const e = mkE('balloon', x, 0); e.by = Math.max(14, top - rr(28, 46)); e.y = e.by;
      enemies.push(e); n++;
    }
    // pads & agents
    const pads = [], spies = [];
    for (const s of sites) {
      if (s.t === 'start') pads.push({ x: s.x + 15, w: 40, y: s.y, t: 'start', visited: true });
      if (s.t === 'out') pads.push({ x: s.x + 8, w: 44, y: s.y, t: 'out', visited: false });
      if (s.t === 'hq') pads.push({ x: s.x + 10, w: 60, y: s.y, t: 'hq', visited: false });
      if (s.t === 'spy') spies.push({ x: s.x + 25, ox: s.x + 25, y: s.y - 8, state: 'wait', dir: -1, ph: rnd(0, 6) });
      if (s.t === 'hut') {
        const h = mkE('hut', s.x + 21, s.y - 9);
        const sp = { x: s.x + 25, ox: s.x + 25, y: s.y - 8, state: 'caged', dir: -1, ph: rnd(0, 6) };
        h.spy = sp; enemies.push(h); spies.push(sp);
      }
    }
    pads.sort((a, b) => a.x - b.x);
    return { M, L, kind, hasCeil, fl, ce, mat, enemies, bricks, pads, spies };
  }

  // ---------- game state ----------
  let state = 'title', paused = false, T = 0, stT = 0;
  let score = 0, hiscore = 0, lives = 3, mi = 0, loop = 0, nextLife = 10000, diff = 1;
  let lv = null, camX = 0, fuel = 100, checkpoint = null, p = null;
  let bullets = [], ebul = [], bombs = [], parts = [], rings = [], pops = [];
  let msgs = null, shake = 0, jetT = 0, clearT = 0, deadT = 0, unloadT = 0, lowFuelT = 0, stuckT = 0, tally = null;
  try { hiscore = +localStorage.getItem('skyhook-hi') || 0; } catch (e) {}
  function saveHi() { if (!demo && score > hiscore) { hiscore = score; try { localStorage.setItem('skyhook-hi', hiscore); } catch (e) {} } }

  const FL = x => { x = x | 0; return lv.fl[x < 0 ? 0 : x >= lv.L ? lv.L - 1 : x]; };
  const CE = x => { if (!lv.hasCeil) return -50; x = x | 0; return lv.ce[x < 0 ? 0 : x >= lv.L ? lv.L - 1 : x]; };
  function msg(lines, t = 2) {
    if (demo) lines = lines.filter(l => !l.includes('{')); // the demo never asks for keys
    if (lines.length) msgs = { lines, t };
  }
  function pop(x, y, s) { pops.push({ x, y, s: String(s), t: 0.9 }); }
  // ---------- attract mode (demo) ----------
  const pilot = demo && createPilot({
    W, FL, CE,
    get lv() { return lv; }, get p() { return p; }, get camX() { return camX; }, get fuel() { return fuel; }, get bombs() { return bombs; }, get ebul() { return ebul; },
  });
  // the next mission, with a fresh crew
  function nextMission() { mi = (mi + 1) % MISSIONS.length; lives = 3; startMission(); }
  // move on when the autopilot stalls, and now and then for variety
  const watch = { t: 0, idle: 0, best: 0 };
  function watchdog(dt) {
    watch.t += dt;
    if (p.alive && p.x > watch.best + 8) { watch.best = p.x; watch.idle = 0; } else watch.idle += dt;
    if (watch.idle < 25 && watch.t < 200) return false;
    nextMission();
    return true;
  }
  function addScore(n) {
    score += n;
    if (score >= nextLife) { nextLife += 10000; lives = Math.min(lives + 1, 6); sfx.life(); msg(['EXTRA CHOPPER!'], 1.5); }
  }

  function newGame() { score = 0; lives = 3; mi = 0; loop = 0; nextLife = 10000; startMission(); }
  function startMission() {
    diff = 1 + loop * 0.35 + mi * 0.08;
    lv = genLevel(mi);
    checkpoint = lv.pads[0];
    bullets = []; ebul = []; bombs = []; parts = []; rings = []; pops = [];
    placeAt(checkpoint); camX = 0; fuel = 100; clearT = 0;
    watch.t = watch.idle = 0; watch.best = p.x;
    jetT = lv.M.jets ? rnd(6, 10) : 0;
    state = 'play'; paused = false;
    msg(['MISSION ' + (mi + 1) + (loop ? ' - TOUR ' + (loop + 1) : ''), lv.M.name, 'RESCUE ' + lv.M.spies + ' AGENTS', '{lift} TO LIFT OFF'], 4);
  }
  function placeAt(pd) {
    p = { x: pd.x + (pd.w >> 1) - 10, y: pd.y - 8, vx: 0, vy: 0, landed: true, pad: pd, alive: true,
          fireCd: 0, bombCd: 0, landT: 0, inv: 0, aboard: [] };
  }
  function respawn() {
    placeAt(checkpoint); p.inv = 2; watch.idle = 0; watch.best = p.x;
    camX = clamp(checkpoint.x + (checkpoint.w >> 1) - 110, 0, lv.L - W);
    bullets = []; ebul = []; bombs = []; fuel = 100; clearT = 0; stuckT = 0;
    for (const e of lv.enemies) {
      if (e.t === 'rocket' && e.fly && !e.dead) { e.dead = true; e.rub = false; }
      if (e.t === 'jet') e.dead = true;
    }
    for (const s of lv.spies) if (s.state === 'run') s.state = 'wait';
    msg([lives + (lives === 1 ? ' CHOPPER LEFT' : ' CHOPPERS LEFT')], 1.6);
  }
  function crash(reason) {
    if (!p.alive) return;
    p.alive = false; deadT = 2.4; lives--;
    explode(p.x + 10, p.y + 4, 70, true); sfx.die(); shake = 0.6; engineSet(false);
    for (const s of p.aboard) { s.state = 'wait'; s.x = s.ox; }
    p.aboard = [];
    if (reason) msg([reason], 2);
  }
  function missionClear() {
    const saved = lv.spies.filter(s => s.state === 'saved' || s.state === 'walk').length;
    tally = { saved, total: lv.spies.length, fuelB: Math.round(fuel) * 10, full: saved === lv.spies.length ? 2000 : 0 };
    addScore(tally.fuelB + tally.full);
    state = 'clear'; stT = 0; engineSet(false); sfx.fanfare(); msgs = null;
  }
  function gameOver() { if (demo) return nextMission(); state = 'over'; stT = 0; saveHi(); sfx.over(); msgs = null; }

  // ---------- effects ----------
  function explode(x, y, n, big) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = Math.random() * (big ? 95 : 60) + 10;
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 25, life: rnd(0.3, big ? 1.1 : 0.8), c: [3, 2, 1][i % 3] });
    }
    rings.push({ x, y, life: big ? 0.45 : 0.25, max: big ? 0.45 : 0.25, R: big ? 24 : 12 });
    if (parts.length > 600) parts.splice(0, parts.length - 600);
  }
  function spark(x, y) { for (let i = 0; i < 3; i++) parts.push({ x, y, vx: rnd(-40, 10), vy: rnd(-40, 20), life: 0.2, c: 3 }); }

  // ---------- combat ----------
  function damage(e, d) {
    e.hp -= d; e.flash = 0.08;
    if (e.hp <= 0) killEnemy(e); else sfx.hit();
  }
  function killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    e.rub = !!GROUNDED[e.t] && !(e.t === 'rocket' && e.fly);
    const pts = e.t === 'rocket' && e.fly ? 150 : PTS[e.t];
    addScore(pts); pop(e.x + e.w / 2 - 8, e.y - 6, pts);
    explode(e.x + e.w / 2, e.y + e.h / 2, e.t === 'fuel' ? 40 : 22, e.t === 'fuel');
    sfx.boom(); shake = Math.max(shake, 0.15);
    if (e.t === 'fuel') { fuel = Math.min(100, fuel + 25); sfx.fuel(); msg(['FUEL +25'], 1); }
    if (e.t === 'hut' && e.spy) { e.spy.state = 'wait'; msg(['AGENT FREED!', 'LAND NEARBY'], 1.8); }
  }
  function hitBrick(k, d) {
    k.hp -= d; k.flash = 0.06;
    if (k.hp <= 0) { k.dead = true; addScore(10); explode(k.x + 4, k.y + 4, 8, false); sfx.hit(); } else sfx.tink();
  }
  function killSpy(s) {
    s.state = 'dead'; explode(s.x + 3, s.y + 4, 10, false);
    score = Math.max(0, score - 200); msg(['AGENT LOST!'], 1.5); sfx.hit();
  }
  function blast(x, y) {
    explode(x, y, 26, false); sfx.boom(); shake = Math.max(shake, 0.2);
    for (const e of lv.enemies) {
      if (e.dead) continue;
      const dx = Math.max(e.x - x, 0, x - (e.x + e.w)), dy = Math.max(e.y - y, 0, y - (e.y + e.h));
      if (dx * dx + dy * dy < 16 * 16) damage(e, 3);
    }
    for (const k of lv.bricks) if (!k.dead && (k.x + 4 - x) ** 2 + (k.y + 4 - y) ** 2 < 14 * 14) hitBrick(k, 3);
    for (const s of lv.spies) if ((s.state === 'wait' || s.state === 'run') && (s.x + 3 - x) ** 2 + (s.y + 4 - y) ** 2 < 100) killSpy(s);
  }

  // ---------- update ----------
  function update(dt) {
    readInput(dt);
    if (hit('sound')) setSound(!soundOn);
    if (hit('palette')) { palIdx = (palIdx + 1) % PALS.length; buildGfx(); }
    T += dt; stT += dt;
    if (state === 'title') { if (hit('start')) newGame(); else if (onExit && hit('quit')) onExit(); return; }
    if (state === 'over') { updateFx(dt); if (stT > 1 && hit('start')) state = 'title'; return; }
    if (state === 'clear') {
      updateFx(dt);
      if (demo && stT > 3.5) return nextMission();
      if (stT > 1 && hit('start')) { mi++; if (mi >= MISSIONS.length) { state = 'win'; stT = 0; saveHi(); sfx.fanfare(); } else startMission(); }
      return;
    }
    if (state === 'win') { if (stT > 1.5 && hit('start')) { loop++; mi = 0; startMission(); } return; }
    // play
    if (hit('pause')) { paused = !paused; if (paused) engineSet(false); }
    if (paused) {
      if (hit('restart')) newGame();
      if (hit('quit')) { paused = false; state = 'title'; saveHi(); }
      return;
    }
    if (msgs) { msgs.t -= dt; if (msgs.t <= 0) msgs = null; }
    if (demo && watchdog(dt)) return;
    if (shake > 0) shake -= dt;
    if (p.alive) updatePlayer(dt);
    else { deadT -= dt; if (deadT <= 0) { if (lives > 0) respawn(); else { gameOver(); return; } } }
    const tgt = Math.min(lv.L - W, p.x - 118 + Math.max(0, p.vx) * 0.35);
    if (tgt > camX) camX = Math.min(tgt, camX + 260 * dt);
    updateSpies(dt);
    updateEnemies(dt);
    updateShots(dt);
    updateFx(dt);
    if (lv.M.jets && p.alive && camX < lv.L - W - 80) {
      jetT -= dt;
      if (jetT <= 0) { jetT = rnd(0.6, 1.4) * lv.M.jets / diff; spawnJet(); }
    }
    if (engine) {
      engine.o.frequency.setTargetAtTime(44 + Math.abs(p.vx) * 0.12 + (p.landed ? 0 : 6), AC.currentTime, 0.1);
      engine.lfo.frequency.setTargetAtTime(p.landed ? 9 : 13 + Math.abs(p.vx) * 0.03, AC.currentTime, 0.1);
    }
  }

  function updatePlayer(dt) {
    if (AC && !engine && fuel > 0) engineSet(true);
    if (p.inv > 0) p.inv -= dt;
    p.fireCd -= dt; p.bombCd -= dt;
    if (I.fire && p.fireCd <= 0 && bullets.length < 5) {
      bullets.push({ x: p.x + 19, y: p.y + 5, vx: 270 + Math.max(0, p.vx) }); p.fireCd = 0.13; sfx.shoot();
    }
    if (I.bomb && p.bombCd <= 0 && bombs.length < 2 && !p.landed) {
      bombs.push({ x: p.x + 9, y: p.y + 9, vx: p.vx * 0.85, vy: 15 + Math.max(0, p.vy) * 0.5 }); p.bombCd = 0.45; sfx.bomb();
    }
    if (fuel < 20 && fuel > 0) {
      lowFuelT -= dt;
      if (lowFuelT <= 0) { lowFuelT = 1; sfx.beep(); if (!msgs) msg(['LOW FUEL!'], 0.8); }
    }
    if (p.landed) { landed(dt); return; }
    if (fuel > 0) {
      // auto-flare: descent slows to a safe rate in the last few pixels above ground
      let below = 1e9; for (let i = 6; i <= 16; i++) below = Math.min(below, FL(p.x + i));
      const flare = below - (p.y + 8) < 18;
      const tx = I.right ? 125 : I.left ? -60 : 0, ty = I.down ? (flare ? 40 : 78) : I.up ? -78 : 0;
      p.vx = approach(p.vx, tx, 150 * dt);
      p.vy = approach(p.vy, ty, 200 * dt);
      fuel = Math.max(0, fuel - dt * (1 + Math.abs(p.vx) / 250) * (1 + mi * 0.04));
      if (fuel <= 0) { engineSet(false); msg(['OUT OF FUEL!'], 2); }
    } else {
      p.vy = Math.min(110, p.vy + 95 * dt); p.vx = approach(p.vx, 0, 40 * dt);
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.x < camX + 2) { p.x = camX + 2; if (p.vx < 0) p.vx = 0; }
    if (p.x > Math.min(camX + W - 22, lv.L - 22)) { p.x = Math.min(camX + W - 22, lv.L - 22); if (p.vx > 0) p.vx = 0; }
    if (p.y < 1) { p.y = 1; if (p.vy < 0) p.vy = 0; }
    // terrain
    const x0 = Math.floor(p.x);
    for (let i = 1; i <= 18; i++) {
      const x = x0 + i;
      if (lv.hasCeil && CE(x) > p.y + 0.5) return crash();
      if ((i < 6 || i > 16) && FL(x) < p.y + 6) return crash();
    }
    let gmin = 1e9, gmax = -1e9;
    for (let i = 6; i <= 16; i++) { const f = FL(x0 + i); gmin = Math.min(gmin, f); gmax = Math.max(gmax, f); }
    if (p.y + 8 > gmin) {
      if (gmax - gmin <= 2 && p.vy <= SAFE_VY && Math.abs(p.vx) <= SAFE_VX) {
        p.y = gmin - 8; p.vx = p.vy = 0; p.landed = true; p.landT = 0; stuckT = 0; sfx.land();
        p.pad = lv.pads.find(pd => x0 + 6 >= pd.x - 3 && x0 + 16 <= pd.x + pd.w + 3 && Math.abs(pd.y - gmin) < 2) || null;
        return;
      }
      return crash(p.vy > SAFE_VY ? 'TOO FAST!' : null);
    }
    for (const k of lv.bricks) if (!k.dead && ov(p.x + 2, p.y + 1, 16, 7, k.x, k.y, 8, 8)) return crash();
  }

  function landed(dt) {
    p.landT += dt;
    const pd = p.pad;
    if (pd) {
      if (!pd.visited) {
        pd.visited = true; checkpoint = pd; sfx.jingle();
        msg(pd.t === 'hq' ? ['HQ REACHED'] : ['OUTPOST REACHED', 'CHECKPOINT + REFUEL'], 2);
      }
      if (fuel < 100) { fuel = Math.min(100, fuel + 40 * dt); }
      if (p.aboard.length) {
        unloadT -= dt;
        if (unloadT <= 0) {
          unloadT = 0.4;
          const s = p.aboard.pop();
          s.state = 'walk'; s.x = p.x + 8; s.tx = pd.t === 'hq' ? pd.x + pd.w + 2 : pd.x - 6;
          addScore(500); pop(p.x + 2, p.y - 8, 500); sfx.saved();
        }
      } else unloadT = 0.3;
      if (pd.t === 'hq' && !p.aboard.length && !lv.spies.some(s => s.state === 'walk' || s.state === 'run')) {
        clearT += dt;
        if (clearT > 1.2) return missionClear();
      }
    } else if (fuel <= 0) {
      stuckT += dt;
      if (stuckT > 2.5) return crash('STRANDED!');
    }
    // call agents in range
    const pcx = p.x + 7;
    let incoming = lv.spies.filter(s => s.state === 'run').length;
    for (const s of lv.spies) {
      if (s.state === 'wait' && Math.abs(s.x - pcx) < 90 && p.aboard.length + incoming < CAP) { s.state = 'run'; incoming++; }
    }
    if (I.up && fuel > 0 && p.landT > 0.15) {
      p.landed = false; p.pad = null; p.vy = -25; p.y -= 1; clearT = 0;
      for (const s of lv.spies) if (s.state === 'run') s.state = 'wait';
      sfx.lift();
    }
  }

  function updateSpies(dt) {
    for (const s of lv.spies) {
      if (s.state === 'run') {
        const d = p.x + 7 - s.x; s.dir = Math.sign(d) || 1;
        s.x += s.dir * Math.min(Math.abs(d), 32 * dt);
        if (Math.abs(d) < 1.5) {
          if (p.alive && p.landed && p.aboard.length < CAP) {
            s.state = 'aboard'; p.aboard.push(s); addScore(100); sfx.pick(); msg(['AGENT ABOARD'], 1.2);
          } else s.state = 'wait';
        }
      } else if (s.state === 'walk') {
        const d = s.tx - s.x; s.dir = Math.sign(d) || 1;
        s.x += s.dir * Math.min(Math.abs(d), 26 * dt);
        if (Math.abs(d) < 1) s.state = 'saved';
      }
      if (s.state === 'wait' || s.state === 'run' || s.state === 'walk') s.y = FL(s.x + 3) - 8;
    }
  }

  function spawnJet() {
    const x = camX + W + 8, xi = x | 0;
    let top = 6, bot = 999;
    for (let i = xi; i < xi + 40; i++) { top = Math.max(top, CE(i) + 4); bot = Math.min(bot, FL(i) - 14); }
    if (bot - top < 16) return;
    const e = mkE('jet', x, 0);
    e.by = rnd(top + 6, bot - 6); e.amp = Math.min(14, (bot - top) / 2 - 4); e.y = e.by; e.cd = rnd(0.4, 1.2);
    lv.enemies.push(e);
  }

  function aimFire(e, ox, oy, speed) {
    const dx = p.x + 10 - ox, dy = p.y + 4 - oy, d = Math.hypot(dx, dy) || 1;
    e.ax = dx / d; e.ay = dy / d;
    ebul.push({ x: ox, y: oy, vx: e.ax * speed, vy: e.ay * speed });
  }

  function updateEnemies(dt) {
    const pcx = p.x + 10;
    for (const e of lv.enemies) {
      if (e.dead) continue;
      if (e.flash > 0) e.flash -= dt;
      const on = e.x + e.w > camX - 20 && e.x < camX + W + 20;
      if (!on && e.t !== 'jet') continue;
      const vis = e.x + e.w > camX && e.x < camX + W;
      const canShoot = p.alive && vis && p.inv <= 0;
      switch (e.t) {
        case 'gun':
        case 'tank': {
          if (e.t === 'tank') {
            const nx = e.x + e.dir * 12 * dt, gy = FL(e.hx + (e.w >> 1));
            if (Math.abs(nx - e.hx) > 18 || FL(nx) !== gy || FL(nx + e.w - 1) !== gy) e.dir = -e.dir; else e.x = nx;
          }
          const dx = pcx - e.x, dy = p.y + 4 - e.y, d = Math.hypot(dx, dy) || 1;
          if (p.alive && dy < -6) { e.ax = approach(e.ax, dx / d, 3 * dt); e.ay = approach(e.ay, dy / d, 3 * dt); }
          e.cd -= dt;
          if (canShoot && e.cd <= 0) {
            if (dy < -6 && d < 230) aimFire(e, e.x + (e.t === 'gun' ? 4 : 6), e.y - 1, (65 + 12 * Math.min(mi, 4)) * Math.sqrt(diff));
            e.cd = (e.t === 'gun' ? rnd(1.3, 2.4) : rnd(1.8, 3.2)) / diff;
          }
          break;
        }
        case 'rocket':
          if (!e.fly) {
            const d = e.x - pcx;
            if (p.alive && vis && d < e.trig && d > -20) { e.fly = true; e.vy = -20; sfx.launch(); }
          } else {
            e.vy = Math.max(-150, e.vy - 160 * dt); e.y += e.vy * dt;
            if (lv.hasCeil && e.y < CE(e.x + 2)) { e.dead = true; e.rub = false; explode(e.x + 2, e.y, 14, false); sfx.boom(); }
            else if (e.y < -14) { e.dead = true; e.rub = false; }
            if (Math.random() < 0.6) parts.push({ x: e.x + rnd(1, 3), y: e.y + 11, vx: rnd(-8, 8), vy: rnd(10, 30), life: 0.25, c: Math.random() < 0.5 ? 3 : 2 });
          }
          break;
        case 'jet': {
          e.x -= 100 * dt; e.ph += dt * 2.4;
          e.y = e.by + Math.sin(e.ph) * e.amp;
          const xi = e.x | 0, f = Math.min(FL(xi), FL(xi + 11)) - 9;
          if (e.y > f) e.y = f;
          if (lv.hasCeil) { const c = Math.max(CE(xi), CE(xi + 11)) + 2; if (e.y < c) e.y = c; }
          e.cd -= dt;
          if (canShoot && e.cd <= 0 && e.x > p.x + 30) {
            ebul.push({ x: e.x - 2, y: e.y + 2, vx: -200, vy: clamp((p.y + 4 - e.y) * 0.6, -50, 50) });
            e.cd = rnd(1.2, 2.2) / diff;
          }
          if (e.x < camX - 30) { e.dead = true; e.rub = false; }
          break;
        }
        case 'mine': e.y = e.by + Math.sin(T * 1.8 + e.ph) * e.amp; break;
        case 'balloon': e.y = e.by + Math.sin(T * 0.8 + e.ph) * 3; break;
      }
      if (e.dead || !p.alive || p.inv > 0) continue;
      if (ov(p.x + 2, p.y + 1, 16, 7, e.x, e.y, e.w, e.h)) { killEnemy(e); crash(); continue; }
      if (e.t === 'balloon' && ov(p.x + 2, p.y + 1, 16, 7, e.x + 6, e.y + 5, 1, FL(e.x + 6) - e.y - 5)) crash();
    }
    lv.enemies = lv.enemies.filter(e => !e.dead || e.rub);
  }

  function updateShots(dt) {
    const fl = FL, ens = lv.enemies;
    for (const b of bullets) {
      b.x += b.vx * dt;
      if (b.x > camX + W + 4 || b.x >= lv.L - 1) { b.dead = 1; continue; }
      if (b.y >= fl(b.x + 3) || b.y < CE(b.x + 3)) { b.dead = 1; spark(b.x + 3, b.y); continue; }
      for (const e of ens) if (!e.dead && ov(b.x, b.y, 4, 1, e.x, e.y, e.w, e.h)) {
        b.dead = 1;
        if (e.t === 'hut') { spark(b.x + 3, b.y); sfx.tink(); } else damage(e, 1);
        break;
      }
      if (b.dead) continue;
      for (const k of lv.bricks) if (!k.dead && ov(b.x, b.y, 4, 1, k.x, k.y, 8, 8)) { b.dead = 1; hitBrick(k, 1); break; }
      if (b.dead) continue;
      for (const s of lv.spies) if ((s.state === 'wait' || s.state === 'run') && ov(b.x, b.y, 4, 1, s.x, s.y, 6, 8)) { b.dead = 1; killSpy(s); break; }
    }
    bullets = bullets.filter(b => !b.dead);
    for (const b of bombs) {
      b.vy += 170 * dt; b.x += b.vx * dt; b.y += b.vy * dt;
      let h = b.y + 2 >= fl(b.x) || b.y < CE(b.x);
      if (!h) for (const e of ens) if (!e.dead && ov(b.x - 1, b.y - 2, 3, 4, e.x, e.y, e.w, e.h)) { h = true; break; }
      if (!h) for (const k of lv.bricks) if (!k.dead && ov(b.x - 1, b.y - 2, 3, 4, k.x, k.y, 8, 8)) { h = true; break; }
      if (!h) for (const s of lv.spies) if ((s.state === 'wait' || s.state === 'run') && ov(b.x - 1, b.y - 2, 3, 4, s.x, s.y, 6, 8)) { h = true; break; }
      if (h) { b.dead = 1; blast(b.x, Math.min(b.y, fl(b.x) - 1)); }
      else if (b.y > PH + 10 || b.x > camX + W + 30 || b.x < camX - 30) b.dead = 1;
    }
    bombs = bombs.filter(b => !b.dead);
    for (const b of ebul) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < camX - 8 || b.x > camX + W + 8 || b.y < -8 || b.y > PH) { b.dead = 1; continue; }
      if (b.y >= fl(b.x) || b.y < CE(b.x)) { b.dead = 1; continue; }
      if (p.alive && p.inv <= 0 && ov(b.x - 1, b.y - 1, 2, 2, p.x + 2, p.y + 1, 16, 7)) { b.dead = 1; crash(); }
    }
    ebul = ebul.filter(b => !b.dead);
    for (const k of lv.bricks) if (k.flash > 0) k.flash -= dt;
  }

  function updateFx(dt) {
    for (const q of parts) {
      q.vy += 90 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt;
      if (lv && q.y >= FL(q.x)) { q.y = FL(q.x) - 1; q.vy *= -0.3; q.vx *= 0.5; }
    }
    parts = parts.filter(q => q.life > 0);
    for (const r of rings) r.life -= dt;
    rings = rings.filter(r => r.life > 0);
    for (const q of pops) { q.y -= 14 * dt; q.t -= dt; }
    pops = pops.filter(q => q.t > 0);
  }

  // ---------- render ----------
  let stars = [];
  { const r = mulberry32(42); for (let i = 0; i < 70; i++) stars.push({ x: r() * 640, y: r() * 120, c: r() < 0.3 ? 3 : 1, z: r() < 0.5 ? 0.15 : 0.25 }); }

  function drawBackdrop(cx, kind) {
    if (kind === 'cave' || kind === 'fort') return;
    for (const s of stars) {
      const x = Math.floor(((s.x - cx * s.z) % 640 + 640) % 640);
      if (x < W) { g.fillStyle = P[s.c]; g.fillRect(x, s.y | 0, 1, 1); }
    }
    if (kind === 'cave' || kind === 'fort') return;
    const bx = Math.round(cx * 0.4);
    const hgt = kind === 'city'
      ? x => { const b = Math.floor(x / 14); return 128 - ((Math.sin(b * 12.9898) * 43758.5453 % 1 + 1) % 1) * 44; }
      : x => 116 + 16 * Math.sin(x * 0.013) + 9 * Math.sin(x * 0.031 + 2) + (kind === 'mount' ? -18 * Math.abs(Math.sin(x * 0.007)) : 0);
    g.save(); g.translate(-bx, 0);
    g.fillStyle = PAT.dots;
    for (let x = bx; x < bx + W; x++) { const h = Math.round(hgt(x)); g.fillRect(x, h, 1, PH - h); }
    g.fillStyle = P[1];
    for (let x = bx; x < bx + W; x++) if (x % 2 === 0) g.fillRect(x, Math.round(hgt(x)), 1, 1);
    g.restore();
  }

  function drawTerrain(cx) {
    const { fl, ce, mat, hasCeil, L } = lv;
    const x1 = Math.min(L, cx + W + 1);
    let cur = -1;
    for (let x = Math.max(0, cx - 1); x < x1; x++) {
      if (mat[x] !== cur) { cur = mat[x]; g.fillStyle = PAT[MAT_PAT[cur]]; }
      g.fillRect(x, fl[x], 1, PH - fl[x]);
    }
    if (hasCeil) { g.fillStyle = PAT[lv.kind === 'fort' ? 'fort' : 'rock']; for (let x = Math.max(0, cx - 1); x < x1; x++) g.fillRect(x, 0, 1, ce[x]); }
    cur = -1;
    for (let x = Math.max(1, cx - 1); x < x1; x++) {
      const c = MAT_SURF[Math.max(mat[x], mat[x - 1])];
      if (c !== cur) { cur = c; g.fillStyle = P[c]; }
      const a = Math.min(fl[x], fl[x - 1]), b = Math.max(fl[x], fl[x - 1]);
      g.fillRect(x, a, 1, b - a + 1);
    }
    if (hasCeil) {
      g.fillStyle = P[lv.kind === 'fort' ? 3 : 1];
      for (let x = Math.max(1, cx - 1); x < x1; x++) {
        const a = Math.min(ce[x], ce[x - 1]) - 1, b = Math.max(ce[x], ce[x - 1]) - 1;
        g.fillRect(x, a, 1, b - a + 1);
      }
    }
  }

  function drawPad(pd) {
    const { x, y, w } = pd;
    g.fillStyle = P[3]; g.fillRect(x, y, w, 1);
    g.fillStyle = P[1]; for (let i = 0; i < w; i += 4) g.fillRect(x + i, y + 1, 2, 1);
    if ((T * 2 | 0) % 2) { g.fillStyle = P[pd.visited ? 1 : 2]; g.fillRect(x, y - 1, 1, 1); g.fillRect(x + w - 1, y - 1, 1, 1); }
    if (pd.t === 'hq') {
      const tx = x + w + 6, ty = y - 28;
      text('HQ', tx + 2, ty + 4, 0);
      g.fillStyle = P[0]; g.fillRect(tx + 1, y - 7, 4, 7);
      g.fillStyle = P[3]; g.fillRect(tx + 7, ty - 8, 1, 8);
      g.fillStyle = P[2]; if ((T * 3 | 0) % 2) g.fillRect(tx + 6, ty - 9, 3, 1);
      // "H" on the pad
      g.fillStyle = P[2]; g.fillRect(x + 26, y - 1, 1, 1); g.fillRect(x + 33, y - 1, 1, 1);
    } else {
      const fx = x - 6;
      g.fillStyle = P[3]; g.fillRect(fx, y - 16, 1, 16);
      g.fillStyle = P[pd.visited ? 1 : 2];
      const wv = (T * 4 | 0) % 2;
      for (let r = 0; r < 4; r++) g.fillRect(fx + 1, y - 16 + r, 6 - ((r + wv) % 2), 1);
    }
  }

  function drawEnemy(e) {
    const x = Math.round(e.x), y = Math.round(e.y);
    if (e.dead) { if (e.rub) spr('rubble', x + (e.w >> 1) - 6, FL(e.x + (e.w >> 1)) - 3); return; }
    const v = e.flash > 0 ? 'w' : 'c';
    const barrel = (bx, by, n) => { g.fillStyle = P[3]; for (let i = 1; i <= n; i++) g.fillRect(Math.round(bx + e.ax * i), Math.round(by + e.ay * i), 1, 1); };
    switch (e.t) {
      case 'tank': spr(((x >> 1) & 1) ? 'tank1' : 'tank', x, y, v); barrel(x + 6, y - 1, 5); break;
      case 'gun': spr('gun', x, y, v); barrel(x + 4, y - 1, 4); break;
      case 'radar': {
        spr('radar', x, y, v);
        const w = Math.round(Math.abs(Math.cos(T * 3 + e.ph)) * 4) + 1;
        g.fillStyle = P[3]; g.fillRect(x + 5 - w, y - 2, w * 2, 1);
        g.fillStyle = P[1]; g.fillRect(x + 6 - w, y - 1, w * 2 - 2, 1);
        break;
      }
      case 'rocket':
        spr('rocket', x, y, v);
        if (e.fly) { g.fillStyle = P[(T * 20 | 0) % 2 ? 3 : 2]; g.fillRect(x + 1, y + 10, 2, 2 + ((T * 30 | 0) % 2)); }
        break;
      case 'balloon': {
        g.fillStyle = P[3];
        const gy = FL(e.x + 6);
        for (let cy = y + 5; cy < gy; cy += 2) g.fillRect(x + 6, cy, 1, 1);
        spr('balloon', x, y, v);
        break;
      }
      default: spr(e.t, x, y, v);
    }
  }

  function drawSpy(s) {
    if (s.state === 'wait') {
      spr(((T * 3 + s.ph) | 0) % 2 ? 'spyA' : 'spyB', s.x, s.y, s.dir < 0 ? 'f' : 'c');
    } else if (s.state === 'run' || s.state === 'walk') {
      spr(((T * 8) | 0) % 2 ? 'runA' : 'runB', s.x, s.y, s.dir < 0 ? 'f' : 'c');
    }
  }

  function drawPlayer() {
    if (!p.alive) return;
    if (p.inv > 0 && ((T * 12) | 0) % 2) return;
    const x = Math.round(p.x), y = Math.round(p.y);
    const spin = fuel > 0 || !p.landed;
    spr(spin && ((T * 20) | 0) % 2 ? 'heli1' : 'heli0', x, y);
    if (!p.landed) {
      let gmin = 1e9, gmax = -1e9;
      for (let i = 6; i <= 16; i++) { const f = FL(x + i); gmin = Math.min(gmin, f); gmax = Math.max(gmax, f); }
      const d = gmin - (p.y + 8);
      if (d < 34 && d > 0) {
        const safe = p.vy <= SAFE_VY && Math.abs(p.vx) <= SAFE_VX && gmax - gmin <= 2;
        g.fillStyle = P[safe ? 1 : 2];
        for (let i = 6; i <= 16; i += safe ? 1 : 2) g.fillRect(x + i, gmin - 1, 1, 1);
      }
    }
  }

  function drawWorld() {
    const cx = Math.round(camX);
    const sx = shake > 0 ? Math.round(rnd(-2, 2)) : 0, sy = shake > 0 ? Math.round(rnd(-1, 1)) : 0;
    g.fillStyle = P[0]; g.fillRect(0, 0, W, H);
    g.save();
    g.beginPath(); g.rect(0, 0, W, PH); g.clip();
    g.translate(sx, sy);
    drawBackdrop(cx, lv.kind);
    g.translate(-cx, 0);
    drawTerrain(cx);
    for (const pd of lv.pads) if (pd.x + pd.w + 30 > cx && pd.x - 10 < cx + W) drawPad(pd);
    for (const e of lv.enemies) if (e.x + e.w > cx - 4 && e.x < cx + W + 4) drawEnemy(e);
    for (const k of lv.bricks) {
      if (k.dead || k.x + 8 < cx || k.x > cx + W) continue;
      g.fillStyle = P[k.flash > 0 ? 3 : k.hp < 3 ? 1 : 2];
      g.fillRect(k.x, k.y, 7, 3); g.fillRect(k.x, k.y + 4, 3, 3); g.fillRect(k.x + 4, k.y + 4, 4, 3);
    }
    for (const s of lv.spies) drawSpy(s);
    for (const b of bombs) spr('bomb', b.x - 1, b.y - 2);
    g.fillStyle = P[3]; for (const b of bullets) g.fillRect(Math.round(b.x), Math.round(b.y), 4, 1);
    for (const b of ebul) { g.fillStyle = P[(T * 16 | 0) % 2 ? 3 : 2]; g.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 1, 2, 2); }
    drawPlayer();
    for (const q of parts) { g.fillStyle = P[q.c]; g.fillRect(Math.round(q.x), Math.round(q.y), 1, 1); }
    g.fillStyle = P[3];
    for (const r of rings) {
      const rad = r.R * (1 - r.life / r.max), n = Math.max(8, rad * 4 | 0);
      for (let i = 0; i < n; i++) { const a = i / n * 6.283; g.fillRect(Math.round(r.x + Math.cos(a) * rad), Math.round(r.y + Math.sin(a) * rad), 1, 1); }
    }
    for (const q of pops) text(q.s, Math.round(q.x), Math.round(q.y), 3);
    g.restore();
  }

  function drawHud() {
    g.fillStyle = P[0]; g.fillRect(0, PH, W, H - PH);
    g.fillStyle = P[1]; g.fillRect(0, PH, W, 1);
    text('SC' + pad6(score), 2, 187, 3);
    const low = fuel < 20 && (T * 4 | 0) % 2;
    text('FUEL', 56, 187, low ? 2 : 1);
    g.fillStyle = P[3];
    g.fillRect(81, 187, 42, 1); g.fillRect(81, 193, 42, 1); g.fillRect(81, 187, 1, 7); g.fillRect(122, 187, 1, 7);
    g.fillStyle = P[fuel < 20 ? 2 : 1]; g.fillRect(83, 189, Math.round(38 * fuel / 100), 3);
    for (let i = 0; i < CAP; i++) {
      const x = 129 + i * 5;
      if (p && i < p.aboard.length) spr('agent', x, 188);
      else { g.fillStyle = P[2]; g.fillRect(x + 1, 192, 1, 1); }
    }
    const saved = lv.spies.filter(s => s.state === 'saved' || s.state === 'walk').length;
    text(saved + '/' + lv.spies.length, 152, 187, 1);
    text('M' + (mi + 1), 178, 187, 2);
    for (let i = 0; i < Math.min(lives, 6); i++) spr('life', W - 11 - i * 11, 188);
    // route map
    const mx = x => 2 + Math.round(x / lv.L * 315);
    g.fillStyle = P[2]; for (let x = 2; x < 318; x += 2) g.fillRect(x, 197, 1, 1);
    for (const pd of lv.pads) { g.fillStyle = P[pd.visited ? 1 : 3]; g.fillRect(mx(pd.x), 195, 2, 3); }
    g.fillStyle = P[1];
    for (const s of lv.spies) if (s.state === 'wait' || s.state === 'caged' || s.state === 'run') g.fillRect(mx(s.x), 196, 1, 2);
    if (p && (T * 4 | 0) % 2) { g.fillStyle = P[3]; g.fillRect(mx(p.x) - 1, 195, 3, 3); }
  }

  function box(x, y, w, h) {
    g.fillStyle = P[0]; g.fillRect(x, y, w, h);
    g.fillStyle = P[1]; g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1); g.fillRect(x, y, 1, h); g.fillRect(x + w - 1, y, 1, h);
    g.fillStyle = P[2]; g.fillRect(x + 2, y + 2, w - 4, 1); g.fillRect(x + 2, y + h - 3, w - 4, 1);
  }

  function drawMsgs() {
    if (!msgs) return;
    const n = msgs.lines.length, gl = l => l.includes('{'), wd = Math.max(...msgs.lines.map(pw)) + 16;
    const ht = n * 10 + 8 + msgs.lines.filter(gl).length * 4;
    const y0 = 46 - (ht >> 1);
    box(((W - wd) >> 1), y0, wd, ht);
    let y = y0 + 5;
    msgs.lines.forEach((l, i) => { if (gl(l)) y += 2; cptext(l, y, i === 0 ? 3 : i === n - 1 && n > 2 ? 2 : 1); y += gl(l) ? 12 : 10; });
  }

  // key/button legend: one column per item, glyphs right-aligned to their labels, centred on screen
  function legend(rows, y, pitch, c) {
    const st = GST(), gw = [], lw = [], gsOf = a => glyphs(input, a);
    for (const r of rows) r.forEach(([a, l], k) => { gw[k] = Math.max(gw[k] || 0, measureGlyphs(g, gsOf(a), GS, st, 2)); lw[k] = Math.max(lw[k] || 0, tw(l)); });
    const total = gw.reduce((w, x, k) => w + (k ? 14 : 0) + x + 4 + lw[k], 0);
    rows.forEach((r, i) => {
      let x = Math.round((W - total) / 2);
      const yc = y + i * pitch;
      r.forEach(([a, l], k) => {
        const gs = gsOf(a);
        drawGlyphs(g, gs, x + gw[k] - measureGlyphs(g, gs, GS, st, 2), yc, GS, st, 2);
        text(l, x + gw[k] + 4, yc - 3, c);
        x += gw[k] + 4 + lw[k] + 14;
      });
    });
  }

  let titleScroll = 0;
  function drawTitle() {
    g.fillStyle = P[0]; g.fillRect(0, 0, W, H);
    titleScroll += 0.5;
    for (const s of stars) {
      const x = Math.floor(((s.x - titleScroll * s.z * 4) % 640 + 640) % 640);
      if (x < W) { g.fillStyle = P[s.c]; g.fillRect(x, s.y | 0, 1, 1); }
    }
    const t = 'SKYHOOK', x0 = Math.round((W - tw(t, 4)) / 2);
    for (let i = 0; i < t.length; i++) {
      text(t[i], x0 + i * 24 + 2, 14 + 2, 2, 4);
      text(t[i], x0 + i * 24, 14 + Math.round(Math.sin(T * 3 + i * 0.7) * 1.5), 3, 4);
    }
    const hx = ((T * 70) % 420) - 50;
    spr(((T * 20) | 0) % 2 ? 'heli1' : 'heli0', hx, 48);
    g.fillStyle = P[3]; for (let i = 0; i < 4; i++) g.fillRect(Math.round(hx) + 22 + i * 9 + ((T * 40 | 0) % 9), 53, 3, 1);
    ctext('AIRBORNE AGENT EXTRACTION', 62, 2);
    ctext('LAND NEAR AGENTS TO PICK THEM UP', 74, 3);
    ctext('DELIVER THEM TO OUTPOSTS AND HQ', 84, 3);
    ctext('BOMB PRISON HUTS TO FREE AGENTS', 94, 3);
    ctext('SHOOT FUEL DEPOTS TO REFUEL', 104, 3);
    // keyboard-only extras (sound, palette, fullscreen) stay off the pad legend
    const rows = [[['fly', 'FLY'], ['fire', 'FIRE']], [['bomb', 'BOMB'], ['pause', 'PAUSE']]];
    if (!onPad()) rows.push([['sound', 'SOUND'], ['palette', 'PALETTE']], [['fullscreen', 'FULLSCREEN']]);
    if (onExit) (rows[rows.length - 1].length < 2 ? rows[rows.length - 1] : rows[rows.push([]) - 1]).push(['quit', 'EXIT']);
    legend(rows, 121 + Math.round((4 - rows.length) * 6.5), 13, 3);
    if ((T * 2 | 0) % 2) cptext('PRESS {start} TO START', 172, 3);
    const hs = 'HI ' + pad6(hiscore), so = 'SOUND ' + (soundOn ? 'ON' : 'OFF'), sx = Math.round((W - tw(hs) - 18 - tw(so)) / 2);
    text(hs, sx, 188, 2); text(so, sx + tw(hs) + 18, 188, 1);
  }

  function drawClear() {
    box(54, 40, 212, 112);
    ctext('MISSION ' + (mi + 1) + ' COMPLETE', 48, 3);
    const rows = [
      ['AGENTS SAVED', tally.saved + '/' + tally.total, 1],
      ['FUEL BONUS', String(tally.fuelB), 1],
      ['FULL RESCUE', String(tally.full), tally.full ? 3 : 2],
    ];
    rows.forEach((r, i) => { if (stT > 0.3 + i * 0.3) { text(r[0], 70, 66 + i * 12, 1); rtext(r[1], 250, 66 + i * 12, r[2]); } });
    if (stT > 1.2) { text('SCORE', 70, 110, 3); rtext(pad6(score), 250, 110, 3); }
    if (!demo && stT > 1 && (T * 2 | 0) % 2) cptext(mi + 1 >= MISSIONS.length ? 'PRESS {start}' : 'PRESS {start} FOR MISSION ' + (mi + 2), 134, 2);
  }

  function drawWin() {
    drawTitleBg();
    ctext('ALL AGENTS HOME', 40, 3, 2);
    ctext('THE NETWORK SURVIVES', 70, 1);
    ctext('...FOR NOW', 82, 1);
    ctext('SCORE ' + pad6(score), 104, 3);
    ctext('HI ' + pad6(hiscore), 116, 2);
    if (stT > 1.5 && (T * 2 | 0) % 2) cptext('PRESS {start} FOR TOUR ' + (loop + 2), 150, 3);
    spr(((T * 20) | 0) % 2 ? 'heli1' : 'heli0', ((T * 70) % 420) - 50, 130);
  }
  function drawTitleBg() {
    g.fillStyle = P[0]; g.fillRect(0, 0, W, H);
    for (const s of stars) { g.fillStyle = P[s.c]; g.fillRect(s.x % W | 0, s.y + 40 | 0, 1, 1); }
  }

  function render() {
    if (state === 'title') return drawTitle();
    if (state === 'win') return drawWin();
    drawWorld(); drawHud(); drawMsgs();
    if (state === 'clear') drawClear();
    if (state === 'over') {
      box(80, 56, 160, 64);
      ctext('GAME OVER', 64, 2, 2);
      ctext('SCORE ' + pad6(score), 88, 3);
      if (stT > 1 && (T * 2 | 0) % 2) cptext('PRESS {start}', 104, 1);
    }
    if (paused) {
      box(90, 50, 140, 86);
      ctext('PAUSED', 58, 3, 2);
      const rows = [[['pause', 'RESUME']], [['restart', 'RESTART']], [['quit', 'QUIT']]];
      if (!onPad()) rows.push([['fullscreen', 'FULLSCREEN']]);
      legend(rows, 84 + Math.round((4 - rows.length) * 6.5), 13, 1);
    }
  }

  // ---------- main loop ----------
  let last = performance.now(), acc = 0, raf = 0, stopped = false;
  function frame(now) {
    acc += Math.min(0.1, (now - last) / 1000); last = now;
    while (acc >= DT) { update(DT); acc -= DT; }
    render();
    if (!stopped) raf = requestAnimationFrame(frame);
  }
  if (demo) {
    mi = mission % MISSIONS.length; startMission();
    // airborne by the first frame; a still demo shows the mission a few seconds in
    for (let i = 0, n = reducedMotion ? 420 : 75; i < n; i++) update(DT);
  }
  if (demo && reducedMotion) { render(); listen(window, 'resize', render); }
  else raf = requestAnimationFrame(frame);

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    offs.forEach(off => off());
    input.destroy();
    if (AC) { AC.close().catch(() => {}); AC = null; engine = null; }
  }
  return { stop };
}
