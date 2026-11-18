'use strict';
import { createInput, drawGlyph, measureGlyph, parsePrompt } from '@nostalgia/input';
import meta from '../game.json';
import { createPilot } from './autopilot.js';
// SKYHOOK HD — widescreen remaster. World runs in 384x216 units (16:9), drawn as vectors at native resolution.

// The whole game on a canvas. `preview` is the launcher's attract mode: an autopilot flies
// `mission`, with no input, sound, storage writes, window/document listeners or fit-to-window.
export function boot(cv, { preview = false, reducedMotion = false, mission = 0 } = {}) {
  const W = 384, H = 216, PH = 216, DT = 1 / 60, CAP = 4, SAFE_VY = 52, SAFE_VX = 40;
  const g = cv.getContext('2d');
  // everything bound outside the game's own state, undone by stop()
  const offs = [];
  function listen(t, type, fn, opts) { t.addEventListener(type, fn, opts); offs.push(() => t.removeEventListener(type, fn, opts)); }
  const F = "'Rajdhani','Segoe UI',system-ui,sans-serif";
  let cw = 0, ch = 0, S = 1, u = 1, vign = null;
  const lc = document.createElement('canvas'), lg = lc.getContext('2d');
  // standalone: the largest 16:9 box in the window; preview: in the canvas's CSS box, which the host
  // letterboxes (object-fit), so only the drawing buffer is sized
  let boxW = -1, boxH = -1, boxDpr = 0;
  function fit() {
    boxW = cv.clientWidth; boxH = cv.clientHeight; boxDpr = devicePixelRatio;
    let w = preview ? boxW || 640 : innerWidth, h = preview ? boxH || 360 : innerHeight;
    if (w / h > 16 / 9) w = h * 16 / 9; else h = w * 9 / 16;
    const dpr = Math.min(devicePixelRatio || 1, 2, 2560 / w);
    if (!preview) { cv.style.width = Math.round(w) + 'px'; cv.style.height = Math.round(h) + 'px'; }
    cw = cv.width = Math.round(w * dpr); ch = cv.height = Math.round(h * dpr);
    lc.width = Math.ceil(cw / 2); lc.height = Math.ceil(ch / 2);
    S = ch / H; u = ch / 1080;
    vign = document.createElement('canvas'); vign.width = cw; vign.height = ch;
    const v = vign.getContext('2d'), gr = v.createRadialGradient(cw / 2, ch / 2, ch * 0.3, cw / 2, ch / 2, cw * 0.62);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.55)');
    v.fillStyle = gr; v.fillRect(0, 0, cw, ch);
  }
  // the host may resize the preview box at any time
  const refit = () => { if (cv.clientWidth !== boxW || cv.clientHeight !== boxH || devicePixelRatio !== boxDpr) fit(); };
  if (!preview) listen(window, 'resize', fit);
  fit();

  // soft sprites
  function radial(stops, size = 64) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'), gr = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([o, col]) => gr.addColorStop(o, col)); x.fillStyle = gr; x.fillRect(0, 0, size, size);
    return c;
  }
  const glowOf = (r, gg, b) => radial([[0, `rgba(${r},${gg},${b},1)`], [0.22, `rgba(${r},${gg},${b},0.6)`], [1, `rgba(${r},${gg},${b},0)`]]);
  const GL = {
    white: glowOf(255, 255, 255), yel: glowOf(255, 214, 130), org: glowOf(255, 120, 40), red: glowOf(255, 55, 45),
    cyan: glowOf(90, 235, 255), grn: glowOf(80, 255, 150), pink: glowOf(255, 90, 220), amber: glowOf(255, 170, 40),
  };
  const SMOKE = radial([[0, 'rgba(110,110,120,0.9)'], [0.5, 'rgba(95,95,105,0.45)'], [1, 'rgba(90,90,100,0)']]);
  const DUST = radial([[0, 'rgba(200,180,150,0.8)'], [1, 'rgba(200,180,150,0)']]);
  const LIGHT = radial([[0, 'rgba(0,0,0,1)'], [0.45, 'rgba(0,0,0,0.65)'], [1, 'rgba(0,0,0,0)']], 128);
  function glow(spr, x, y, r, a = 1) {
    if (a <= 0.01) return;
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = Math.min(1, a);
    g.drawImage(spr, x - r, y - r, r * 2, r * 2);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  function hash(a, b = 0) {
    let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
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

  // ---------- sound ----------
  let AC = null, master = null, bus = null, soundOn = true, engine = null, noiseBuf = null;
  function audioInit() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      const comp = AC.createDynamicsCompressor(); comp.connect(AC.destination);
      master = AC.createGain(); master.gain.value = soundOn ? 0.6 : 0; master.connect(comp);
      const dl = AC.createDelay(), fb = AC.createGain(), lp = AC.createBiquadFilter();
      dl.delayTime.value = 0.13; fb.gain.value = 0.22; lp.type = 'lowpass'; lp.frequency.value = 1800;
      bus = AC.createGain(); bus.connect(master); bus.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(master);
      noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { AC = null; }
  }
  function tone(f0, f1, dur, vol = 0.08, type = 'triangle', delay = 0, cut = 5000) {
    if (!AC) return;
    const t = AC.currentTime + delay, o = AC.createOscillator(), f = AC.createBiquadFilter(), gn = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    f.type = 'lowpass'; f.frequency.value = cut;
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol, t + 0.008); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(gn).connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol = 0.2, freq = 1000, delay = 0, type = 'lowpass', end = 50) {
    if (!AC) return;
    const t = AC.currentTime + delay, s = AC.createBufferSource(), f = AC.createBiquadFilter(), gn = AC.createGain();
    s.buffer = noiseBuf; s.loop = true; f.type = type;
    f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(end, t + dur);
    gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(gn).connect(bus); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  const seq = (notes, d, vol = 0.06, type = 'triangle') => notes.forEach((f, i) => tone(f, f, d * 1.6, vol, type, i * d));
  const sfx = {
    shoot: () => { tone(1100, 180, 0.07, 0.03, 'sawtooth', 0, 2400); noise(0.04, 0.05, 4000, 0, 'highpass', 2000); },
    bomb: () => tone(1500, 280, 0.6, 0.03, 'sine'),
    boom: () => { noise(0.9, 0.45, 1200, 0, 'lowpass', 40); tone(120, 32, 0.6, 0.22, 'sine'); },
    big: () => { noise(1.8, 0.6, 900, 0, 'lowpass', 30); tone(95, 22, 1.4, 0.3, 'sine'); },
    hit: () => tone(700, 250, 0.06, 0.05, 'square', 0, 1800),
    tink: () => tone(3000, 2600, 0.05, 0.03, 'sine'),
    pick: () => seq([660, 880, 1320], 0.07, 0.07, 'sine'),
    saved: () => seq([880, 1175, 1760], 0.07, 0.06, 'sine'),
    land: () => { noise(0.15, 0.12, 600); tone(180, 120, 0.12, 0.08, 'sine'); },
    lift: () => tone(160, 420, 0.4, 0.05, 'sine'),
    launch: () => { noise(0.6, 0.12, 3000, 0, 'bandpass', 800); tone(250, 900, 0.5, 0.03, 'sawtooth', 0, 1500); },
    beep: () => tone(990, 990, 0.1, 0.05, 'sine'),
    fuel: () => seq([520, 660, 780, 1040], 0.05, 0.06, 'sine'),
    jingle: () => seq([523, 659, 784, 1047], 0.09, 0.06),
    fanfare: () => seq([523, 523, 659, 784, 659, 784, 1047], 0.12, 0.07),
    die: () => { noise(2, 0.6, 800, 0, 'lowpass', 30); tone(500, 30, 1.4, 0.08, 'sawtooth', 0, 1200); },
    over: () => seq([392, 330, 262, 196], 0.3, 0.07),
    life: () => seq([1047, 784, 1047, 1319], 0.07, 0.06, 'sine'),
  };
  // rotor: low-passed noise chopped by an LFO
  function engineSet(on) {
    if (!AC) return;
    if (on && !engine) {
      const s = AC.createBufferSource(), lp = AC.createBiquadFilter(), gn = AC.createGain(), lfo = AC.createOscillator(), lgn = AC.createGain();
      s.buffer = noiseBuf; s.loop = true; lp.type = 'lowpass'; lp.frequency.value = 200;
      gn.gain.value = 0.05; lfo.type = 'sine'; lfo.frequency.value = 13; lgn.gain.value = 0.05;
      lfo.connect(lgn).connect(gn.gain); s.connect(lp).connect(gn).connect(master); s.start(); lfo.start();
      engine = { o: lp, lfo, s };
    } else if (!on && engine) { engine.s.stop(); engine.lfo.stop(); engine = null; }
  }
  function setSound(on) { soundOn = on; if (master) master.gain.value = on ? 0.6 : 0; }

  // ---------- input ----------
  // bindings (actions + prompt-only display entries) from game.json
  const input = createInput({
    ...meta.input,
    // stick counts from 0.4 deflection, as before; only arrows/space keep the page from scrolling
    threshold: 0.25, preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'],
    // the preview hears nothing and stays out of the launcher's <input-glyph> elements
    ...(preview && { target: new EventTarget(), getGamepads: () => [], register: false }),
  });
  function toggleFullscreen() {
    const d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    const pr = req.call(el, { navigationUI: 'hide' });
    if (pr && pr.then) pr.then(() => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); }).catch(() => {});
  }
  if (!preview) {
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
    if (preview) { I = state === 'play' && !paused ? pilot(dt) : {}; return; }
    input.update();
    const h = a => input.held(a);
    I = { left: h('left'), right: h('right'), up: h('up'), down: h('down'), fire: h('fire'), bomb: h('bomb') };
  }
  // screen taps and clicks (start / pause) arrive outside the input module; cleared after each fixed step
  const taps = new Set();
  const hit = a => input.pressed(a) || taps.has(a);
  const tapUI = () => input.device.kind === 'touch';
  const onPad = () => input.device.kind === 'gamepad';

  // ---------- touch ----------
  const TCH = { used: false, stick: null, sx: 0, sy: 0, dx: 0, dy: 0, fire: false, bomb: false };
  function tpos(t) { const r = cv.getBoundingClientRect(); return { x: (t.clientX - r.left) / r.width * cw, y: (t.clientY - r.top) / r.height * ch }; }
  const BTN = () => ({
    fire: { x: cw - 150 * u, y: ch - 170 * u, r: 90 * u },
    bomb: { x: cw - 340 * u, y: ch - 110 * u, r: 70 * u },
    pause: { x: cw - 60 * u, y: 170 * u, r: 36 * u },
  });
  function onTouch(e) {
    e.preventDefault(); audioInit(); TCH.used = true;
    const b = BTN(); let stickSeen = false;
    TCH.fire = TCH.bomb = false;
    for (const t of e.touches) {
      const q = tpos(t);
      if (TCH.stick === t.identifier) { stickSeen = true; TCH.dx = q.x - TCH.sx; TCH.dy = q.y - TCH.sy; continue; }
      if (Math.hypot(q.x - b.fire.x, q.y - b.fire.y) < b.fire.r * 1.3) { TCH.fire = true; continue; }
      if (Math.hypot(q.x - b.bomb.x, q.y - b.bomb.y) < b.bomb.r * 1.3) { TCH.bomb = true; continue; }
      if (q.x < cw * 0.5 && TCH.stick === null && e.type === 'touchstart') {
        TCH.stick = t.identifier; TCH.sx = q.x; TCH.sy = q.y; TCH.dx = TCH.dy = 0; stickSeen = true;
      }
    }
    if (!stickSeen) TCH.stick = null;
    if (e.type === 'touchstart') for (const t of e.changedTouches) {
      const q = tpos(t);
      if (state === 'play' && Math.hypot(q.x - b.pause.x, q.y - b.pause.y) < b.pause.r * 1.5) taps.add('pause');
      else if (state !== 'play') { taps.add('start'); if (state === 'title' && !document.fullscreenElement && !document.webkitFullscreenElement) toggleFullscreen(); }
      else if (paused) taps.add('pause');
    }
  }
  if (!preview) {
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(n => listen(cv, n, onTouch, { passive: false }));
    listen(cv, 'mousedown', () => { audioInit(); if (state !== 'play') taps.add('start'); });
  }
  function applyTouch() {
    if (!TCH.used) return;
    const d = 20 * u;
    if (TCH.stick !== null) {
      if (TCH.dx < -d) I.left = true; if (TCH.dx > d) I.right = true;
      if (TCH.dy < -d) I.up = true; if (TCH.dy > d) I.down = true;
    }
    if (TCH.fire) I.fire = true;
    if (TCH.bomb) I.bomb = true;
  }


  const SIZE = { gun: [8, 4], tank: [12, 5], rocket: [4, 10], fuel: [12, 10], radar: [10, 6], hut: [14, 9], jet: [12, 5], mine: [7, 7], balloon: [12, 5] };
  const sw = n => SIZE[n][0], sh = n => SIZE[n][1];

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
  try { hiscore = +localStorage.getItem('skyhook-hd-hi') || 0; } catch (e) {}
  function saveHi() { if (!preview && score > hiscore) { hiscore = score; try { localStorage.setItem('skyhook-hd-hi', hiscore); } catch (e) {} } }

  const FL = x => { x = x | 0; return lv.fl[x < 0 ? 0 : x >= lv.L ? lv.L - 1 : x]; };
  const CE = x => { if (!lv.hasCeil) return -50; x = x | 0; return lv.ce[x < 0 ? 0 : x >= lv.L ? lv.L - 1 : x]; };
  function msg(lines, t = 2) {
    if (preview) lines = lines.filter(l => !l.includes('{')); // the preview never asks for keys
    if (lines.length) msgs = { lines, t };
  }
  function pop(x, y, s) { pops.push({ x, y, s: String(s), t: 0.9 }); }
  // ---------- attract mode (preview) ----------
  const pilot = preview && createPilot({
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
    lv = genLevel(mi); decorate(lv);
    checkpoint = lv.pads[0];
    bullets = []; ebul = []; bombs = []; parts = []; rings = []; pops = []; flashes = []; blooms = [];
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
  function gameOver() { if (preview) return nextMission(); state = 'over'; stT = 0; saveHi(); sfx.over(); msgs = null; }

  // ---------- effects ----------
  let flashes = [], blooms = [];
  function P_(q) { q.max = q.life; parts.push(q); }
  function puff(x, y, r, life, dust) {
    P_({ k: dust ? 'dust' : 'smoke', x, y, vx: rnd(-6, 6), vy: dust ? rnd(-6, -1) : rnd(-12, -4), r, gr: r * 2.2, life });
  }
  function explode(x, y, n, big) {
    const k = big ? 1.7 : 1;
    flashes.push({ x, y, r: 30 * k, life: 0.16 * k, max: 0.16 * k });
    blooms.push({ x, y, r: 70 * k, life: 0.7 * k, max: 0.7 * k });
    rings.push({ x, y, R: 24 * k, life: 0.4, max: 0.4 });
    for (let i = 0; i < 8 * k; i++) P_({ k: 'fire', x: x + rnd(-2, 2) * k, y: y + rnd(-2, 2) * k, vx: rnd(-35, 35) * k, vy: rnd(-45, 10) * k, r: rnd(2.5, 5) * k, life: rnd(0.3, 0.6) * k });
    for (let i = 0; i < 6 * k; i++) P_({ k: 'smoke', x: x + rnd(-3, 3) * k, y: y + rnd(-3, 3) * k, vx: rnd(-15, 15), vy: rnd(-22, -4), r: rnd(3, 6) * k, gr: rnd(7, 13) * k, life: rnd(1.2, 2.4) });
    for (let i = 0; i < n; i++) { const a = rnd(0, 6.283), s = rnd(40, 170) * (big ? 1.2 : 1); P_({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30, life: rnd(0.2, 0.6) }); }
    for (let i = 0; i < 5 * k; i++) P_({ k: 'debris', x, y, vx: rnd(-70, 70), vy: rnd(-110, -30), s: rnd(0.8, 1.8), life: rnd(0.8, 1.6) });
    if (parts.length > 1400) parts.splice(0, parts.length - 1400);
  }
  function spark(x, y) {
    for (let i = 0; i < 4; i++) P_({ k: 'spark', x, y, vx: rnd(-80, 10), vy: rnd(-60, 30), life: rnd(0.1, 0.25) });
    flashes.push({ x, y, r: 5, life: 0.06, max: 0.06 });
  }
  // rotor wash, exhaust
  function rotorFx(dt) {
    if (p.landed && fuel <= 0) return;
    let gmin = 1e9; for (let i = 6; i <= 16; i++) gmin = Math.min(gmin, FL(p.x + i));
    const d = gmin - (p.y + 8);
    if (d < 26 && Math.random() < (1 - d / 26) * 0.9) {
      const side = Math.random() < 0.5 ? -1 : 1;
      P_({ k: 'dust', x: p.x + 11 + side * rnd(2, 8), y: gmin - 1, vx: side * rnd(30, 70), vy: rnd(-10, -2), r: rnd(1, 2), gr: rnd(4, 7), life: rnd(0.4, 0.9) });
    }
    if (Math.random() < 0.15) puff(p.x + 4, p.y + 2, 0.8, 0.6);
  }
  function updateFx(dt) {
    const f1 = Math.pow(0.1, dt), f2 = Math.pow(0.4, dt);
    for (const q of parts) {
      switch (q.k) {
        case 'fire': q.vx *= f1; q.vy = q.vy * f1 - 20 * dt; break;
        case 'smoke': case 'dust': q.vx *= f2; q.vy *= f2; q.r += (q.gr - q.r) * Math.min(1, dt * 1.5); break;
        case 'spark': q.vy += 160 * dt; break;
        case 'debris':
          q.vy += 220 * dt;
          if (lv && q.y >= FL(q.x)) { q.y = FL(q.x) - 0.5; q.vy *= -0.3; q.vx *= 0.5; }
          break;
      }
      q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt;
    }
    parts = parts.filter(q => q.life > 0);
    for (const r of rings) r.life -= dt;
    rings = rings.filter(r => r.life > 0);
    for (const r of flashes) r.life -= dt;
    flashes = flashes.filter(r => r.life > 0);
    for (const r of blooms) r.life -= dt;
    blooms = blooms.filter(r => r.life > 0);
    for (const q of pops) { q.y -= 14 * dt; q.t -= dt; }
    pops = pops.filter(q => q.t > 0);
  }

  // ---------- level dressing (render-only data) ----------
  function decorate(lv) {
    const { L, fl, mat, kind } = lv;
    const hq = lv.pads.find(pd => pd.t === 'hq');
    lv.th = THEMES[MISSIONS.indexOf(lv.M)];
    const gfl = new Float32Array(fl);
    for (let i = 0; i < L; i++) if (mat[i] === 1) gfl[i] = kind === 'city' ? 174 : hq.y;
    lv.gfl = gfl;
    // Heights are whole units for the game logic; at HD scale that reads as stair-steps that
    // crawl while scrolling. Draw a box-blurred copy (flat pads/plateaus stay exact).
    const smooth = (a, r = 4) => {
      const n = a.length, o = new Float32Array(n), ps = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) ps[i + 1] = ps[i] + a[i];
      for (let i = 0; i < n; i++) { const lo = Math.max(0, i - r), hi = Math.min(n, i + r + 1); o[i] = (ps[hi] - ps[lo]) / (hi - lo); }
      return o;
    };
    lv.rfl = smooth(gfl);
    if (lv.hasCeil) lv.rce = smooth(lv.ce);
    lv.buildings = [];
    for (let i = 0; i < L;) {
      if (mat[i] !== 1) { i++; continue; }
      let j = i; while (j < L && mat[j] === 1 && fl[j] === fl[i]) j++;
      const b = { x: i, w: j - i, top: fl[i], base: gfl[i], hq: i === hq.x + hq.w + 6, wins: [], ant: hash(i, 3) < 0.45, tone: hash(i, 8) };
      for (let wy = b.top + 3, r = 0; wy < b.base - 3; wy += 4.5, r++)
        for (let wx = b.x + 2, c = 0; wx < b.x + b.w - 2.5; wx += 3.5, c++) {
          const h = hash(i * 131 + r, c);
          if (h < 0.42 || b.hq) b.wins.push(wx, wy, h < 0.22 ? 0 : h < 0.36 ? 1 : 2);
        }
      lv.buildings.push(b); i = j;
    }
    lv.decor = [];
    if (kind === 'cave') for (let x = 40; x < L - 2;) {
      const top = hash(x, 4) < 0.5, xi = x | 0;
      lv.decor.push({ t: 'crystal', x: xi, y: top ? lv.ce[xi] : fl[xi], top, s: 1.5 + hash(x, 5) * 2.5, c: hash(x, 6) < 0.7 ? 'cyan' : 'pink' });
      x += 18 + hash(x, 9) * 40;
    }
    if (kind === 'fort') for (let x = 60; x < L; x += 70) lv.decor.push({ t: 'lamp', x, y: lv.ce[x] });
    const m = document.createElement('canvas'); m.width = 600; m.height = 40;
    const mx = m.getContext('2d'); mx.fillStyle = 'rgba(255,255,255,0.22)';
    for (let i = 0; i < 600; i++) {
      const x = Math.floor(i / 600 * L), f = fl[x] / H * 40;
      mx.fillRect(i, f, 1, 40 - f);
      if (lv.hasCeil) mx.fillRect(i, 0, 1, lv.ce[x] / H * 40);
    }
    lv.mini = m;
  }
  function toTitle() {
    state = 'title'; paused = false; stT = 0; engineSet(false);
    mi = 0; loop = 0; lv = genLevel(0); decorate(lv); p = null; camX = 0;
    bullets = []; ebul = []; bombs = []; parts = []; rings = []; pops = []; flashes = []; blooms = []; msgs = null;
  }

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
    readInput(dt); applyTouch();
    if (hit('sound')) setSound(!soundOn);
    T += dt; stT += dt;
    if (state === 'title') { camX += 26 * dt; if (camX > lv.L - W - 10) camX = 0; updateFx(dt); if (hit('start')) newGame(); return; }
    if (state === 'over') { updateFx(dt); if (stT > 1 && hit('start')) toTitle(); return; }
    if (state === 'clear') {
      updateFx(dt);
      if (preview && stT > 3.5) return nextMission();
      if (stT > 1 && hit('start')) { mi++; if (mi >= MISSIONS.length) { state = 'win'; stT = 0; saveHi(); sfx.fanfare(); } else startMission(); }
      return;
    }
    if (state === 'win') { if (stT > 1.5 && hit('start')) { loop++; mi = 0; startMission(); } return; }
    // play
    if (hit('pause')) { paused = !paused; if (paused) engineSet(false); }
    if (paused) {
      if (hit('restart')) newGame();
      if (hit('quit')) { saveHi(); toTitle(); }
      return;
    }
    if (msgs) { msgs.t -= dt; if (msgs.t <= 0) msgs = null; }
    if (preview && watchdog(dt)) return;
    if (shake > 0) shake -= dt;
    if (p.alive) updatePlayer(dt);
    else { deadT -= dt; if (deadT <= 0) { if (lives > 0) respawn(); else { gameOver(); return; } } }
    const tgt = Math.min(lv.L - W, p.x - 120 + Math.max(0, p.vx) * 0.5);
    if (tgt > camX) camX = Math.min(tgt, camX + 260 * dt);
    if (p.alive) rotorFx(dt);
    updateSpies(dt);
    updateEnemies(dt);
    updateShots(dt);
    updateFx(dt);
    if (lv.M.jets && p.alive && camX < lv.L - W - 80) {
      jetT -= dt;
      if (jetT <= 0) { jetT = rnd(0.6, 1.4) * lv.M.jets / diff; spawnJet(); }
    }
    if (engine) {
      engine.o.frequency.setTargetAtTime(180 + Math.abs(p.vx) * 1.2 + (p.landed ? 0 : 60), AC.currentTime, 0.1);
      engine.lfo.frequency.setTargetAtTime(p.landed ? 9 : 13 + Math.abs(p.vx) * 0.03, AC.currentTime, 0.1);
    }
  }

  function updatePlayer(dt) {
    if (AC && !engine && fuel > 0) engineSet(true);
    if (p.inv > 0) p.inv -= dt;
    if (p.mf > 0) p.mf -= dt;
    p.fireCd -= dt; p.bombCd -= dt;
    if (I.fire && p.fireCd <= 0 && bullets.length < 5) {
      bullets.push({ x: p.x + 19, y: p.y + 5, vx: 270 + Math.max(0, p.vx) }); p.fireCd = 0.13; p.mf = 0.06; sfx.shoot();
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
    e.mf = 0.08;
  }

  function updateEnemies(dt) {
    const pcx = p.x + 10;
    for (const e of lv.enemies) {
      if (e.dead) { if (e.rub && Math.random() < 0.04 && e.x > camX - 10 && e.x < camX + W + 10) puff(e.x + e.w / 2 + rnd(-2, 2), FL(e.x + e.w / 2) - 2, 2.5, 2.2); continue; }
      if (e.flash > 0) e.flash -= dt;
      if (e.mf > 0) e.mf -= dt;
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
            if (Math.random() < 0.8) puff(e.x + 2, e.y + 12, 1.4, 1.1);
          }
          break;
        case 'jet': {
          e.x -= 100 * dt; e.ph += dt * 2.4;
          if (Math.random() < 0.5) puff(e.x + 14, e.y + 2.7, 0.9, 0.5);
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

  // ---------- render ----------
  const THEMES = [
    { // coastal dusk
      sky: [[0, '#16204a'], [0.5, '#a54d7c'], [0.78, '#f08a6a'], [1, '#ffc27a']],
      sun: { x: 0.74, y: 0.5, r: 24, core: '#fff3d6' }, sea: ['#3a3f78', '#1a1d40'],
      far: [{ par: 0.16, base: 128, amp: [12, 6], col: '#5a4380' }, { par: 0.33, base: 146, amp: [16, 8], col: '#3b2f62' }],
      ground: ['#6cc46f', '#2e6e50', '#112626'], rim: '#d6ffb8', clouds: '#ffd2dc', cloudA: 0.55, stars: 0.35, dark: 0,
    },
    { // ridge at dawn, snow
      sky: [[0, '#0c1c44'], [0.55, '#4a7cc0'], [1, '#d4e9ff']],
      sun: { x: 0.2, y: 0.26, r: 16, core: '#ffffff' },
      far: [{ par: 0.14, base: 112, amp: [26, 12], col: '#8aa2c8', snow: true, peaks: true }, { par: 0.3, base: 134, amp: [22, 10], col: '#4f6796', snow: true, peaks: true }],
      ground: ['#f2f7ff', '#7d8ea8', '#1c2336'], rim: '#ffffff', snow: true, clouds: '#ffffff', cloudA: 0.6, stars: 0.12, dark: 0,
    },
    { // crystal caverns
      sky: [[0, '#03050b'], [0.5, '#0a1322'], [1, '#05080f']],
      far: [{ par: 0.28, cave: true, col: '#0c1526' }, { par: 0.5, cave: true, col: '#122036' }],
      ground: ['#7a5aa0', '#3a2a55', '#110c1c'], rim: '#cfa8ff', dark: 0.66,
    },
    { // occupied city at night
      sky: [[0, '#04020c'], [0.6, '#1d0c3b'], [1, '#5a1b62']],
      moon: { x: 0.82, y: 0.17, r: 9 },
      far: [{ par: 0.18, city: true, col: '#1a1232' }, { par: 0.38, city: true, col: '#271846' }],
      ground: ['#45405c', '#24203a', '#0b0a12'], rim: '#ff5bd8', clouds: '#8a4aa0', cloudA: 0.3, stars: 1, dark: 0.32,
    },
    { // iron fortress
      sky: [[0, '#0a0404'], [0.5, '#2a0c08'], [1, '#100303']],
      far: [{ par: 0.32, pillars: true, col: '#1b0e0d' }, { par: 0.55, pillars: true, col: '#2a1512' }],
      ground: ['#a7b0c2', '#4c5262', '#121318'], rim: '#ff8a3d', metal: true, dark: 0.58,
    },
  ];
  const STARS = [];
  { const r = mulberry32(7); for (let i = 0; i < 120; i++) STARS.push({ x: r() * W, y: r() * 110, s: r() < 0.15 ? 0.9 : 0.5, tw: 1 + r() * 3 }); }
  const CLOUDS = [];
  { const r = mulberry32(11); for (let i = 0; i < 14; i++) CLOUDS.push({ x: r() * 1600, y: 10 + r() * 70, s: 0.5 + r() * 0.9, par: 0.05 + r() * 0.16 }); }
  function makeCloud(col) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 96;
    const x = c.getContext('2d'), r = mulberry32(3);
    const blob = radial([[0, col], [0.6, col + '88'], [1, col + '00']], 64);
    for (let i = 0; i < 14; i++) { const bx = 40 + r() * 176, by = 30 + r() * 30, s = 30 + r() * 40; x.globalAlpha = 0.5; x.drawImage(blob, bx - s / 2, by - s / 2, s, s); }
    return c;
  }

  let lights = [], shX = 0, shY = 0;
  const addLight = (x, y, r) => lights.push(x, y, r);
  function wt(par = 1) { g.setTransform(S, 0, 0, S, (-camX * par + shX) * S, shY * S); }
  function font(px, wgt = 700) { g.font = `${wgt} ${Math.round(px * u)}px ${F}`; }

  function drawSky(th) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (th._skyH !== ch) {
      const gr = g.createLinearGradient(0, 0, 0, ch); th.sky.forEach(([o, c]) => gr.addColorStop(o, c));
      th._sky = gr; th._skyH = ch;
    }
    g.fillStyle = th._sky; g.fillRect(0, 0, cw, ch);
    wt(0);
    if (th.stars) {
      g.fillStyle = '#fff';
      for (const s of STARS) {
        g.globalAlpha = th.stars * (0.45 + 0.55 * Math.sin(T * s.tw + s.x));
        g.fillRect(((s.x - camX * 0.02) % W + W) % W, s.y, s.s, s.s);
      }
      g.globalAlpha = 1;
    }
    if (th.sun) {
      const s = th.sun, sx = s.x * W, sy = s.y * H;
      glow(GL.org, sx, sy, s.r * 4, 0.35); glow(GL.yel, sx, sy, s.r * 2, 0.6);
      g.fillStyle = s.core; g.beginPath(); g.arc(sx, sy, s.r * 0.42, 0, 6.283); g.fill();
    }
    if (th.moon) {
      const m = th.moon, mx = m.x * W, my = m.y * H;
      glow(GL.white, mx, my, m.r * 3, 0.22);
      g.fillStyle = '#f3eedd'; g.beginPath(); g.arc(mx, my, m.r * 0.6, 0, 6.283); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.beginPath(); g.arc(mx - 1.5, my - 1, 1.2, 0, 6.283); g.arc(mx + 2, my + 1.5, 0.8, 0, 6.283); g.fill();
    }
    if (th.sea) {
      const hz = 126;
      if (!th._sea) { const gr = g.createLinearGradient(0, hz, 0, H); gr.addColorStop(0, th.sea[0]); gr.addColorStop(1, th.sea[1]); th._sea = gr; }
      g.fillStyle = th._sea; g.fillRect(0, hz, W, H - hz);
      const sx = th.sun.x * W;
      for (let k = 0; k < 22; k++) {
        const y = hz + 0.8 + k * 2.6, w = 3 + k * 1.6 + Math.sin(T * 2 + k) * 2;
        g.fillStyle = `rgba(255,200,150,${0.55 - k * 0.022})`;
        g.fillRect(sx - w / 2 + Math.sin(T * 1.3 + k * 1.7) * 2, y, w, 0.6);
      }
    }
  }

  function farH(Ly, x) {
    const a = Ly.amp, s = Ly.par * 37;
    return Ly.peaks
      ? Ly.base - a[0] * Math.abs(Math.sin(x * 0.008 + s)) - a[1] * Math.abs(Math.sin(x * 0.023 + s * 2))
      : Ly.base - a[0] * (0.5 + 0.5 * Math.sin(x * 0.011 + s)) - a[1] * (0.5 + 0.5 * Math.sin(x * 0.033 + s * 2));
  }
  function drawFar(th) {
    for (const Ly of th.far) {
      wt(Ly.par);
      const x0 = Math.floor(camX * Ly.par) - 4, x1 = x0 + W + 8;
      g.fillStyle = Ly.col;
      if (Ly.city) {
        for (let bx = Math.floor(x0 / 12) * 12; bx < x1; bx += 12) {
          const k = bx / 12, h = 30 + hash(k, Ly.par * 100) * 75, top = 178 - h, w = 9 + hash(k, 7) * 3;
          g.fillStyle = Ly.col; g.fillRect(bx, top, w, H - top);
          g.fillStyle = 'rgba(255,210,150,0.45)';
          for (let j = 0; j < 7; j++) if (hash(k, j + 20) < 0.5) g.fillRect(bx + 1 + hash(k, j + 40) * (w - 2), top + 3 + hash(k, j + 60) * h * 0.8, 0.7, 0.9);
          if (hash(k, 99) < 0.2) glow(GL.red, bx + w / 2, top - 1, 2.5, 0.5 + 0.5 * Math.sin(T * 3 + k));
        }
      } else if (Ly.cave) {
        g.beginPath(); g.moveTo(x0, H);
        for (let x = x0; x <= x1; x += 3) g.lineTo(x, 196 - 22 * Ly.par - 14 * (0.5 + 0.5 * Math.sin(x * 0.02 + Ly.par * 9)) - 10 * Math.abs(Math.sin(x * 0.051)));
        g.lineTo(x1, H); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(x0, 0);
        for (let x = x0; x <= x1; x += 3) g.lineTo(x, 14 + 20 * Ly.par + 14 * (0.5 + 0.5 * Math.sin(x * 0.017 + Ly.par * 5)) + 9 * Math.abs(Math.sin(x * 0.047)));
        g.lineTo(x1, 0); g.closePath(); g.fill();
      } else if (Ly.pillars) {
        for (let bx = Math.floor(x0 / 54) * 54; bx < x1; bx += 54) {
          g.fillStyle = Ly.col; g.fillRect(bx, 0, 14, H);
          g.fillStyle = 'rgba(0,0,0,0.35)'; for (let y = 8; y < H; y += 22) g.fillRect(bx, y, 14, 1.2);
          glow(GL.org, bx + 7, 60 + (bx % 3) * 20, 6, 0.35 + 0.15 * Math.sin(T * 2 + bx));
        }
      } else {
        g.beginPath(); g.moveTo(x0, H);
        for (let x = x0; x <= x1; x += 2) g.lineTo(x, farH(Ly, x));
        g.lineTo(x1, H); g.closePath(); g.fill();
        if (Ly.snow) {
          g.save(); g.clip();
          g.beginPath(); for (let x = x0; x <= x1; x += 2) x === x0 ? g.moveTo(x, farH(Ly, x)) : g.lineTo(x, farH(Ly, x));
          g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 5; g.stroke();
          g.restore();
        }
      }
    }
  }

  function drawClouds(th) {
    if (!th.clouds) return;
    if (!th._cloud) th._cloud = makeCloud(th.clouds);
    g.setTransform(S, 0, 0, S, shX * S, shY * S);
    g.globalAlpha = th.cloudA;
    for (const c of CLOUDS) {
      const x = ((c.x - camX * c.par - T * 2 * c.par * 10) % 1600 + 1600) % 1600 - 200;
      if (x < W + 10) g.drawImage(th._cloud, x, c.y, 100 * c.s, 38 * c.s);
    }
    g.globalAlpha = 1;
  }

  function surf(a, x0, x1, dy, step) { for (let x = x0; x <= x1; x += step) g.lineTo(x, a[x] + dy); g.lineTo(x1, a[x1] + dy); }
  function band(a, x0, x1, dy, w, col, alpha = 1) {
    g.beginPath(); g.moveTo(x0, a[x0] + dy); surf(a, x0, x1, dy, 3);
    g.strokeStyle = col; g.lineWidth = w; g.globalAlpha = alpha; g.stroke(); g.globalAlpha = 1;
  }
  let shadeGrad = null;
  function drawSolid(a, x0, x1, up) {
    const th = lv.th, edge = up ? -3 : H + 3, s = up ? -1 : 1;
    g.beginPath(); g.moveTo(x0, edge); g.lineTo(x0, a[x0]); surf(a, x0, x1, 0, 2); g.lineTo(x1, edge); g.closePath();
    g.fillStyle = th.ground[2]; g.fill();
    g.save(); g.clip();
    band(a, x0, x1, 18 * s, 36, th.ground[1]);
    band(a, x0, x1, 3 * s, 6, th.ground[0]);
    if (th.snow && !up) band(a, x0, x1, 1.5, 3, '#ffffff', 0.9);
    for (const d of [10, 21, 35, 54]) band(a, x0, x1, d * s, 0.6, 'rgba(0,0,0,0.4)');
    if (th.metal) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (let x = Math.floor(x0 / 24) * 24; x < x1; x += 24) g.fillRect(x, 0, 0.6, H);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      for (let x = Math.floor(x0 / 24) * 24 + 2; x < x1; x += 24) for (let y = 6; y < H; y += 12) g.fillRect(x, y, 0.8, 0.8);
    }
    if (!up) {
      if (!shadeGrad) { shadeGrad = g.createLinearGradient(0, 110, 0, H); shadeGrad.addColorStop(0, 'rgba(0,0,0,0)'); shadeGrad.addColorStop(1, 'rgba(0,0,0,0.55)'); }
      g.fillStyle = shadeGrad; g.fillRect(x0, 60, x1 - x0, H);
    }
    g.restore();
    g.beginPath(); g.moveTo(x0, a[x0]); surf(a, x0, x1, 0, 2);
    g.lineJoin = 'round'; g.strokeStyle = th.rim; g.lineWidth = 0.7; g.stroke();
    g.globalAlpha = 0.22; g.lineWidth = 2.6; g.stroke(); g.globalAlpha = 1;
  }

  function drawBuildings(x0, x1) {
    const city = lv.kind === 'city';
    for (const b of lv.buildings) {
      if (b.x + b.w < x0 || b.x > x1) continue;
      const h = b.base - b.top + 1;
      g.fillStyle = b.hq ? '#39465a' : city ? `hsl(${255 + b.tone * 30},30%,${13 + b.tone * 7}%)` : '#39465a';
      g.fillRect(b.x, b.top, b.w, h);
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(b.x + b.w * 0.68, b.top, b.w * 0.32, h);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(b.x, b.top, 0.8, h);
      g.fillStyle = b.hq ? '#8fd3ff' : lv.th.rim; g.globalAlpha = 0.85; g.fillRect(b.x, b.top, b.w, 0.6); g.globalAlpha = 1;
      const cols = ['#ffd98a', '#7fe7ff', '#ff9ad8'];
      for (let i = 0; i < b.wins.length; i += 3) {
        g.fillStyle = cols[b.wins[i + 2]];
        g.globalAlpha = 0.8 + 0.2 * Math.sin(T * 0.7 + i);
        g.fillRect(b.wins[i], b.wins[i + 1], 1.5, 2.1);
      }
      g.globalAlpha = 1;
      if (b.ant && !b.hq) {
        g.strokeStyle = '#596173'; g.lineWidth = 0.4;
        g.beginPath(); g.moveTo(b.x + b.w * 0.3, b.top); g.lineTo(b.x + b.w * 0.3, b.top - 7); g.stroke();
        const bl = 0.5 + 0.5 * Math.sin(T * 4 + b.x);
        glow(GL.red, b.x + b.w * 0.3, b.top - 7, 3, bl);
      }
      if (city && b.x % 5 === 0 && b.w > 26) {
        const sx = b.x + 3, sy = b.top + 4, glowc = b.x % 2 ? GL.pink : GL.cyan;
        g.fillStyle = b.x % 2 ? '#ff6ad5' : '#62f0ff'; g.fillRect(sx, sy, 8, 1.2);
        glow(glowc, sx + 4, sy + 0.6, 7, 0.35);
      }
    }
  }

  function drawDecor(x0, x1) {
    for (const d of lv.decor) {
      if (d.x < x0 - 10 || d.x > x1 + 10) continue;
      if (d.t === 'crystal') {
        const dir = d.top ? 1 : -1, s = d.s;
        g.fillStyle = d.c === 'cyan' ? '#7ff6ff' : '#ff8ae6';
        g.beginPath(); g.moveTo(d.x - s * 0.6, d.y - dir); g.lineTo(d.x, d.y + dir * s * 1.4); g.lineTo(d.x + s * 0.6, d.y - dir); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(d.x + s * 0.4, d.y - dir); g.lineTo(d.x + s * 1.1, d.y + dir * s * 0.8); g.lineTo(d.x + s * 1.3, d.y - dir); g.closePath(); g.fill();
        const a = 0.35 + 0.2 * Math.sin(T * 2 + d.x);
        glow(d.c === 'cyan' ? GL.cyan : GL.pink, d.x, d.y + dir * s * 0.6, s * 4, a);
        addLight(d.x, d.y + dir * 4, 26 + s * 4);
      } else {
        g.strokeStyle = '#333'; g.lineWidth = 0.4;
        g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x, d.y + 4); g.stroke();
        g.fillStyle = '#4a4e58'; g.fillRect(d.x - 1.5, d.y + 4, 3, 1.2);
        glow(GL.amber, d.x, d.y + 5.5, 8, 0.6 + 0.1 * Math.sin(T * 9 + d.x));
        addLight(d.x, d.y + 14, 50);
      }
    }
  }

  function drawPad(pd) {
    const { x, y, w } = pd;
    g.fillStyle = '#262a33'; g.fillRect(x, y - 0.6, w, 2.6);
    g.fillStyle = '#ffcf3a';
    for (let i = 0; i < w; i += 3) { g.beginPath(); g.moveTo(x + i, y + 2); g.lineTo(x + i + 1.2, y + 0.5); g.lineTo(x + i + 2.2, y + 0.5); g.lineTo(x + i + 1, y + 2); g.fill(); }
    g.fillStyle = '#c9d2df'; g.fillRect(x, y - 0.8, w, 0.45);
    const on = (T * 2 + x) % 2 < 1.4, gc = pd.visited ? GL.grn : GL.amber;
    if (on) { glow(gc, x + 0.5, y - 1, 4, 0.9); glow(gc, x + w - 0.5, y - 1, 4, 0.9); }
    addLight(x + w / 2, y - 6, 46);
    if (pd.t === 'hq') {
      const tx = x + w + 6, ty = y - 28;
      g.fillStyle = '#e8f4ff'; g.font = `700 6px ${F}`; g.textAlign = 'center'; g.fillText('HQ', tx + 8, ty + 7); g.textAlign = 'left';
      g.strokeStyle = '#7d8696'; g.lineWidth = 0.5; g.beginPath(); g.moveTo(tx + 8, ty); g.lineTo(tx + 8, ty - 9); g.stroke();
      const a = Math.sin(T * 4);
      glow(GL.cyan, tx + 8 + a * 3, ty - 9, 7, 0.9); glow(GL.white, tx + 8, ty - 9, 2.5, 1);
      addLight(tx + 8, ty - 4, 70);
      g.fillStyle = '#ffcf3a'; g.font = `700 4px ${F}`; g.textAlign = 'center'; g.fillText('H', x + w / 2, y - 1.2); g.textAlign = 'left';
    } else {
      const fx = x - 6;
      g.strokeStyle = '#cfd6e2'; g.lineWidth = 0.45; g.beginPath(); g.moveTo(fx, y); g.lineTo(fx, y - 17); g.stroke();
      g.fillStyle = pd.visited ? '#3ff0a0' : '#ff5a5a';
      g.beginPath(); g.moveTo(fx, y - 16.5);
      for (let i = 0; i <= 8; i++) g.lineTo(fx + i, y - 16.5 + Math.sin(T * 6 - i * 0.8) * 0.6 * (i / 8));
      for (let i = 8; i >= 0; i--) g.lineTo(fx + i, y - 12.5 + Math.sin(T * 6 - i * 0.8) * 0.6 * (i / 8));
      g.fill();
    }
  }

  function barrelLine(x, y, ax, ay, len, wdt) {
    g.strokeStyle = '#1b1f27'; g.lineWidth = wdt; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + ax * len, y + ay * len); g.stroke(); g.lineCap = 'butt';
  }
  function drawEnemy(e) {
    const x = e.x, y = e.y, fl = e.flash > 0;
    if (e.dead) {
      if (!e.rub) return;
      const gx = e.x + e.w / 2, gy = FL(gx);
      g.fillStyle = '#1d1a1a';
      g.beginPath(); g.moveTo(gx - 6, gy); g.lineTo(gx - 3.5, gy - 2.2); g.lineTo(gx - 1, gy - 1.2); g.lineTo(gx + 1.5, gy - 3); g.lineTo(gx + 4, gy - 1.4); g.lineTo(gx + 6, gy); g.fill();
      glow(GL.org, gx + Math.sin(T * 7 + gx) * 1.5, gy - 1, 3, 0.35 + 0.25 * Math.sin(T * 11 + gx));
      return;
    }
    switch (e.t) {
      case 'gun': {
        g.fillStyle = '#2a2f3a'; g.fillRect(x - 0.5, y + 2.8, 9, 1.3);
        g.fillStyle = fl ? '#fff' : '#5d6878'; g.beginPath(); g.ellipse(x + 4, y + 2.9, 3.6, 2.7, 0, Math.PI, 0); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.ellipse(x + 3, y + 1.6, 1.3, 0.6, 0, 0, 6.283); g.fill();
        barrelLine(x + 4, y + 0.6, e.ax, e.ay, 5.5, 1.1);
        glow(GL.red, x + 4, y + 2.2, 1.6, 0.5 + 0.5 * Math.sin(T * 5 + e.ph));
        if (e.mf > 0) glow(GL.yel, x + 4 + e.ax * 6.5, y + 0.6 + e.ay * 6.5, 4, e.mf / 0.08);
        break;
      }
      case 'tank': {
        g.fillStyle = '#1f2318'; g.beginPath(); g.roundRect(x, y + 2.9, 12, 2.1, 1); g.fill();
        g.fillStyle = '#3d4530'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(x + 1.8 + i * 2.1, y + 3.95, 0.65, 0, 6.283); g.fill(); }
        g.fillStyle = fl ? '#fff' : '#6c7a45';
        g.beginPath(); g.moveTo(x + 0.4, y + 3); g.lineTo(x + 1.6, y + 1.6); g.lineTo(x + 10.4, y + 1.6); g.lineTo(x + 11.6, y + 3); g.fill();
        g.fillStyle = fl ? '#fff' : '#58653a'; g.beginPath(); g.ellipse(x + 6, y + 1.7, 2.6, 1.7, 0, Math.PI, 0); g.fill();
        barrelLine(x + 6, y + 0.9, e.ax, e.ay, 6, 0.8);
        if (e.mf > 0) glow(GL.yel, x + 6 + e.ax * 7, y + 0.9 + e.ay * 7, 4, e.mf / 0.08);
        break;
      }
      case 'rocket': {
        if (!e.fly) { g.fillStyle = '#323844'; g.fillRect(x - 1.5, y + 9, 7, 1); g.fillRect(x - 0.5, y + 4, 0.6, 5); }
        g.fillStyle = fl ? '#fff' : '#dfe3ea'; g.beginPath(); g.roundRect(x + 0.8, y + 2, 2.4, 6.6, 0.5); g.fill();
        g.fillStyle = '#e0473c';
        g.beginPath(); g.moveTo(x + 0.8, y + 2.1); g.quadraticCurveTo(x + 2, y - 1.2, x + 3.2, y + 2.1); g.fill();
        g.fillRect(x + 0.8, y + 4.6, 2.4, 0.7);
        g.beginPath(); g.moveTo(x + 0.8, y + 6.4); g.lineTo(x - 0.3, y + 9.4); g.lineTo(x + 0.8, y + 8.6); g.fill();
        g.beginPath(); g.moveTo(x + 3.2, y + 6.4); g.lineTo(x + 4.3, y + 9.4); g.lineTo(x + 3.2, y + 8.6); g.fill();
        if (e.fly) {
          const fl2 = 0.8 + Math.random() * 0.4;
          g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.9;
          g.drawImage(GL.yel, x + 0.2, y + 8, 3.6, 7 * fl2); g.drawImage(GL.org, x - 0.8, y + 8, 5.6, 11 * fl2);
          g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
          addLight(x + 2, y + 11, 40);
        }
        break;
      }
      case 'fuel': {
        g.fillStyle = '#2a2f3a'; g.fillRect(x + 2, y + 8, 0.8, 2); g.fillRect(x + 9.2, y + 8, 0.8, 2);
        const gr = g.createLinearGradient(0, y + 1, 0, y + 8.6);
        gr.addColorStop(0, fl ? '#fff' : '#ffe9a6'); gr.addColorStop(0.5, fl ? '#fff' : '#e8a22a'); gr.addColorStop(1, '#7a4a0a');
        g.fillStyle = gr; g.beginPath(); g.roundRect(x, y + 1, 12, 7.6, 3.6); g.fill();
        g.fillStyle = '#1c1c1c'; g.fillRect(x + 0.3, y + 4.3, 11.4, 1.2);
        g.fillStyle = '#ffcf3a'; for (let i = 0; i < 11; i += 2) g.fillRect(x + 0.6 + i, y + 4.3, 0.8, 1.2);
        g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(x + 2, y + 1.8, 8, 0.5);
        g.fillStyle = '#5a3606'; g.font = `700 3.6px ${F}`; g.textAlign = 'center'; g.fillText('FUEL', x + 6, y + 8); g.textAlign = 'left';
        break;
      }
      case 'radar': {
        g.strokeStyle = '#7a8494'; g.lineWidth = 0.5;
        g.beginPath(); g.moveTo(x + 1, y + 6); g.lineTo(x + 5, y + 1); g.lineTo(x + 9, y + 6); g.moveTo(x + 2.6, y + 4); g.lineTo(x + 7.4, y + 4); g.stroke();
        g.fillStyle = '#323844'; g.fillRect(x, y + 5.4, 10, 0.8);
        const rx = Math.abs(Math.cos(T * 2 + e.ph)) * 4 + 0.4;
        g.fillStyle = fl ? '#fff' : '#cfd8e6'; g.beginPath(); g.ellipse(x + 5, y - 0.2, rx, 2.2, 0, 0, 6.283); g.fill();
        g.fillStyle = '#8a96a8'; g.beginPath(); g.ellipse(x + 5, y - 0.2, rx * 0.55, 1.2, 0, 0, 6.283); g.fill();
        glow(GL.red, x + 5, y - 2.8, 2.2, 0.5 + 0.5 * Math.sin(T * 6 + e.ph));
        break;
      }
      case 'hut': {
        g.fillStyle = fl ? '#fff' : '#6f737c'; g.fillRect(x + 0.5, y + 3, 13, 6);
        g.fillStyle = '#4a4e56'; g.fillRect(x - 0.5, y + 2, 15, 1.4);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 9, y + 3.4, 4.5, 5.6);
        g.fillStyle = '#0c0d10'; g.fillRect(x + 3.5, y + 4.4, 7, 3.2);
        glow(GL.cyan, x + 7, y + 6, 3.5, 0.35 + 0.2 * Math.sin(T * 3 + e.ph));
        g.fillStyle = '#a9b0bd'; for (let i = 0; i < 4; i++) g.fillRect(x + 4.2 + i * 1.8, y + 4.4, 0.4, 3.2);
        g.strokeStyle = '#596173'; g.lineWidth = 0.35; g.beginPath(); g.moveTo(x + 12, y + 2); g.lineTo(x + 12, y - 3); g.stroke();
        glow(GL.red, x + 12, y - 3, 2.4, 0.5 + 0.5 * Math.sin(T * 4 + e.ph));
        break;
      }
      case 'jet': {
        g.fillStyle = fl ? '#fff' : '#5f6a7c';
        g.beginPath(); g.moveTo(x + 5, y + 2.8); g.lineTo(x + 9.5, y + 5); g.lineTo(x + 11, y + 5); g.lineTo(x + 9.5, y + 2.8); g.fill();
        g.beginPath(); g.moveTo(x + 9.4, y + 1.7); g.lineTo(x + 11.4, y - 0.6); g.lineTo(x + 12.3, y - 0.6); g.lineTo(x + 12, y + 1.7); g.fill();
        g.fillStyle = fl ? '#fff' : '#9aa5b8';
        g.beginPath(); g.moveTo(x - 0.5, y + 2.6); g.quadraticCurveTo(x + 2, y + 1.4, x + 4, y + 1.5); g.lineTo(x + 11.5, y + 1.6); g.lineTo(x + 12.2, y + 2.4); g.lineTo(x + 12, y + 3.4); g.lineTo(x + 3, y + 3.5); g.closePath(); g.fill();
        g.fillStyle = 'rgba(120,240,255,0.85)'; g.beginPath(); g.ellipse(x + 3.6, y + 1.7, 1.6, 0.65, 0, 0, 6.283); g.fill();
        g.globalCompositeOperation = 'lighter'; g.drawImage(GL.org, x + 11.5, y + 1.2, 5 + Math.random() * 2, 3); g.globalCompositeOperation = 'source-over';
        addLight(x + 13, y + 2.7, 30);
        break;
      }
      case 'mine': {
        const cx = x + 3.5, cy = y + 3.5;
        g.strokeStyle = '#3a3f4a'; g.lineWidth = 0.55;
        g.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283 + T * 0.4; g.moveTo(cx + Math.cos(a) * 2.4, cy + Math.sin(a) * 2.4); g.lineTo(cx + Math.cos(a) * 3.8, cy + Math.sin(a) * 3.8); } g.stroke();
        const gr = g.createRadialGradient(cx - 1, cy - 1, 0.2, cx, cy, 3);
        gr.addColorStop(0, fl ? '#fff' : '#8a93a3'); gr.addColorStop(1, '#2a2e36');
        g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, 2.7, 0, 6.283); g.fill();
        const pl = 0.5 + 0.5 * Math.sin(T * 6 + e.ph);
        glow(GL.red, cx, cy, 3 + pl * 2, 0.4 + pl * 0.5);
        addLight(cx, cy, 16);
        break;
      }
      case 'balloon': {
        g.strokeStyle = 'rgba(170,180,200,0.55)'; g.lineWidth = 0.3;
        g.beginPath(); g.moveTo(x + 6, y + 4.6); g.lineTo(x + 6, FL(x + 6)); g.stroke();
        const gr = g.createLinearGradient(0, y, 0, y + 5);
        gr.addColorStop(0, fl ? '#fff' : '#e9edf3'); gr.addColorStop(1, '#7c8698');
        g.fillStyle = gr; g.beginPath(); g.ellipse(x + 5.5, y + 2.5, 5.5, 2.6, 0, 0, 6.283); g.fill();
        g.fillStyle = '#7c8698';
        g.beginPath(); g.moveTo(x + 9.5, y + 2.5); g.lineTo(x + 12.5, y + 0.2); g.lineTo(x + 12.5, y + 4.8); g.fill();
        g.fillStyle = '#c0392b'; g.fillRect(x + 3, y + 2.1, 3, 0.8);
        break;
      }
    }
  }

  function drawBrick(k) {
    const base = k.flash > 0 ? '#ffffff' : k.hp >= 3 ? '#8c6e57' : k.hp === 2 ? '#74594a' : '#5a443a';
    g.fillStyle = base; g.beginPath(); g.roundRect(k.x + 0.25, k.y + 0.25, 7.5, 7.5, 0.8); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(k.x + 0.6, k.y + 0.5, 6.8, 0.6);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(k.x + 0.6, k.y + 6.9, 6.8, 0.6); g.fillRect(k.x + 0.3, k.y + 3.8, 7.4, 0.4);
    if (k.hp < 3) {
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.35;
      g.beginPath(); g.moveTo(k.x + 2, k.y + 1); g.lineTo(k.x + 3.5, k.y + 3.5); g.lineTo(k.x + 2.8, k.y + 6);
      if (k.hp < 2) { g.moveTo(k.x + 6, k.y + 1.5); g.lineTo(k.x + 4.8, k.y + 4); g.lineTo(k.x + 6.4, k.y + 6.5); }
      g.stroke();
    }
  }

  function drawSpy(s) {
    if (s.state !== 'wait' && s.state !== 'run' && s.state !== 'walk') return;
    const x = s.x + 3, y = s.y, moving = s.state !== 'wait', t = T * 12 + s.ph;
    g.strokeStyle = '#1e2026'; g.lineWidth = 0.75; g.lineCap = 'round';
    g.beginPath();
    if (moving) { g.moveTo(x, y + 5.2); g.lineTo(x + Math.sin(t) * 1.5, y + 8); g.moveTo(x, y + 5.2); g.lineTo(x - Math.sin(t) * 1.5, y + 8); }
    else { g.moveTo(x - 0.6, y + 5.2); g.lineTo(x - 0.9, y + 8); g.moveTo(x + 0.6, y + 5.2); g.lineTo(x + 0.9, y + 8); }
    g.stroke();
    g.fillStyle = '#d9b46a'; g.beginPath(); g.roundRect(x - 1.4, y + 2.2, 2.8, 3.8, 0.6); g.fill();
    g.strokeStyle = '#d9b46a'; g.lineWidth = 0.7; g.beginPath();
    if (moving) { g.moveTo(x, y + 3); g.lineTo(x + s.dir * 1.6 + Math.cos(t) * 0.8, y + 4.6); }
    else { g.moveTo(x + 1, y + 2.8); g.lineTo(x + 2.4, y + 0.6 + Math.sin(T * 9 + s.ph) * 0.7); }
    g.stroke(); g.lineCap = 'butt';
    g.fillStyle = '#f2c9a0'; g.beginPath(); g.arc(x, y + 1.3, 1.05, 0, 6.283); g.fill();
    g.fillStyle = '#262626'; g.fillRect(x - 1.7, y + 0.35, 3.4, 0.45); g.fillRect(x - 1, y - 0.45, 2, 0.9);
    if (s.state === 'wait') {
      const b = 0.5 + 0.5 * Math.sin(T * 4 + s.ph);
      glow(GL.cyan, x, y - 5, 5 + b * 2, 0.35 + b * 0.35);
      g.fillStyle = '#bff8ff'; g.beginPath(); g.moveTo(x - 1.4, y - 6.5 - b); g.lineTo(x + 1.4, y - 6.5 - b); g.lineTo(x, y - 4.6 - b); g.fill();
      addLight(x, y, 26);
    }
  }

  // AH-64-style gunship, side view facing right; local origin = centre of the 20x8 hitbox
  function drawHeli(x, y, tilt, t, spin) {
    g.save(); g.translate(x + 10, y + 5); g.rotate(tilt);
    const OD = '#4d5a38', ODD = '#323b25', ODK = '#1d2316';
    const poly = (pts, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); };
    // far-side main wheel
    g.strokeStyle = ODK; g.lineWidth = 0.35; g.beginPath(); g.moveTo(3.4, 1.4); g.lineTo(3.7, 2.7); g.stroke();
    g.fillStyle = '#0d0f0b'; g.beginPath(); g.arc(3.7, 2.8, 0.5, 0, 6.283); g.fill();
    // tail boom, swept fin, stabilator, tail wheel
    poly([-3, -1.9, -9.4, -1.6, -9.6, -0.6, -3, 0.9], ODD);
    poly([-7.9, -1.6, -9.5, -4.8, -10.5, -4.8, -10.2, -0.6, -9.2, -0.6], OD);
    poly([-10.9, -0.5, -7.9, -0.5, -8.2, 0.1, -10.9, 0.1], ODK);
    g.strokeStyle = ODK; g.lineWidth = 0.3; g.beginPath(); g.moveTo(-8.6, -0.4); g.lineTo(-8.6, 0.9); g.stroke();
    g.fillStyle = '#0d0f0b'; g.beginPath(); g.arc(-8.6, 1.0, 0.35, 0, 6.283); g.fill();
    // four-blade tail rotor
    g.fillStyle = 'rgba(190,200,180,0.16)'; g.beginPath(); g.arc(-10.1, -3.7, 1.9, 0, 6.283); g.fill();
    g.strokeStyle = spin ? 'rgba(30,34,26,0.75)' : ODK; g.lineWidth = 0.3; g.beginPath();
    for (let k = 0; k < 4; k++) { const a = (spin ? t * 70 : 0.4) + k * 1.5708; g.moveTo(-10.1, -3.7); g.lineTo(-10.1 + Math.cos(a) * 1.9, -3.7 + Math.sin(a) * 1.9); }
    g.stroke();
    // fuselage
    const bg = g.createLinearGradient(0, -3.2, 0, 2);
    bg.addColorStop(0, '#6b7a4c'); bg.addColorStop(0.55, OD); bg.addColorStop(1, ODK);
    g.fillStyle = bg;
    g.beginPath(); g.moveTo(-3.8, -1.6); g.lineTo(-1.2, -2.7); g.lineTo(2.4, -2.8); g.lineTo(7.4, -1.6);
    g.quadraticCurveTo(8.9, -0.9, 9.1, 0.2); g.lineTo(8.8, 1.1); g.lineTo(7.2, 1.7); g.lineTo(-1.2, 1.9); g.lineTo(-3.8, 0.9); g.closePath(); g.fill();
    // engine nacelle + exhaust
    g.fillStyle = ODD; g.beginPath(); g.roundRect(-2.8, -3.6, 4.6, 1.3, 0.6); g.fill();
    g.fillStyle = '#5e6b45'; g.fillRect(-2.4, -3.5, 3.8, 0.3);
    g.fillStyle = '#2a2a26'; g.beginPath(); g.ellipse(-2.9, -2.95, 0.45, 0.6, 0, 0, 6.283); g.fill();
    glow(GL.org, -3.3, -2.9, 1.4, spin ? 0.18 : 0);
    // panel lines
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.15; g.beginPath();
    g.moveTo(-0.6, -2.6); g.lineTo(-0.9, 1.8); g.moveTo(2.2, -2.7); g.lineTo(2.0, 1.8); g.moveTo(-3.6, -0.2); g.lineTo(8.6, -0.2); g.stroke();
    // stepped tandem canopy: rear (pilot) higher, front (gunner) lower
    const cg = g.createLinearGradient(3, -3.8, 8, -1);
    cg.addColorStop(0, '#7f9aa0'); cg.addColorStop(0.5, '#2c444c'); cg.addColorStop(1, '#0f1b20');
    poly([2.2, -2.7, 2.8, -3.9, 4.9, -3.7, 5.3, -2.3], cg);
    poly([5.3, -2.3, 5.7, -3.0, 7.0, -2.4, 7.9, -1.4, 5.5, -1.4], cg);
    g.strokeStyle = ODK; g.lineWidth = 0.22; g.beginPath(); g.moveTo(3.9, -3.8); g.lineTo(4.1, -2.5); g.moveTo(6.4, -2.7); g.lineTo(6.6, -1.4); g.stroke();
    g.strokeStyle = 'rgba(220,240,245,0.55)'; g.lineWidth = 0.18; g.beginPath(); g.moveTo(3, -3.6); g.lineTo(4.6, -3.45); g.moveTo(5.9, -2.85); g.lineTo(6.9, -2.3); g.stroke();
    // nose sensor ball
    g.fillStyle = '#262c1e'; g.beginPath(); g.arc(9.0, 0.5, 0.95, 0, 6.283); g.fill();
    g.fillStyle = '#11140e'; g.fillRect(9.2, 0.1, 0.75, 0.8);
    glow(GL.red, 9.7, 0.5, 0.9, 0.5 + 0.3 * Math.sin(t * 5));
    // chin gun
    g.fillStyle = '#1a1e15'; g.beginPath(); g.arc(6.4, 1.9, 0.6, 0, 6.283); g.fill();
    g.strokeStyle = '#14170f'; g.lineWidth = 0.32; g.beginPath(); g.moveTo(6.4, 1.9); g.lineTo(9.4, 2.2); g.stroke();
    // stub wing with rocket pod and missiles
    poly([-1.4, -0.5, 3.4, -0.5, 3.1, 0.25, -1.1, 0.25], ODD);
    g.fillStyle = '#5f6b4a'; g.fillRect(-0.4, 0.55, 2.6, 0.38); g.fillRect(-0.4, 1.0, 2.6, 0.38);
    g.fillStyle = '#c9b45a'; g.fillRect(2.2, 0.55, 0.35, 0.38); g.fillRect(2.2, 1.0, 0.35, 0.38);
    g.fillStyle = '#262d1c'; g.beginPath(); g.roundRect(-1.2, 0.25, 3.0, 1.35, 0.6); g.fill();
    g.fillStyle = '#11140e'; g.beginPath(); g.ellipse(1.8, 0.92, 0.25, 0.6, 0, 0, 6.283); g.fill();
    // front main wheel
    g.strokeStyle = ODK; g.lineWidth = 0.4; g.beginPath(); g.moveTo(4.4, 1.6); g.lineTo(4.7, 2.7); g.stroke();
    g.fillStyle = '#121410'; g.beginPath(); g.arc(4.7, 2.8, 0.55, 0, 6.283); g.fill();
    g.fillStyle = '#3a3f33'; g.beginPath(); g.arc(4.7, 2.8, 0.2, 0, 6.283); g.fill();
    // low-vis insignia
    g.fillStyle = 'rgba(20,24,16,0.65)'; g.font = `700 1.5px ${F}`; g.fillText('★', -6.2, -0.1);
    // mast, rotor, Longbow radome on top
    g.fillStyle = ODK; g.fillRect(0.0, -4.6, 0.8, 1.2);
    if (spin) {
      g.fillStyle = 'rgba(200,210,190,0.14)'; g.beginPath(); g.ellipse(0.4, -4.7, 10.8, 0.85, 0, 0, 6.283); g.fill();
      g.strokeStyle = 'rgba(25,28,22,0.85)'; g.lineWidth = 0.5; g.beginPath();
      for (let k = 0; k < 4; k++) { const a = t * 45 + k * 1.5708; g.moveTo(0.4, -4.7); g.lineTo(0.4 + Math.cos(a) * 10.8, -4.7 + Math.sin(a) * 0.55); }
      g.stroke();
    } else {
      g.strokeStyle = ODK; g.lineWidth = 0.5; g.beginPath(); g.moveTo(-7.8, -4.7); g.lineTo(8.6, -4.7); g.stroke();
    }
    g.fillStyle = ODD; g.beginPath(); g.ellipse(0.4, -5.45, 1.15, 0.6, 0, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.ellipse(0.2, -5.65, 0.6, 0.2, 0, 0, 6.283); g.fill();
    // anti-collision beacon and formation lights
    glow(GL.red, -1.2, 1.9, 2.2, (t * 1.5) % 1 < 0.12 ? 1 : 0.15);
    glow(GL.grn, 3.4, -0.1, 1.2, 0.45);
    glow(GL.red, -10.4, -4.8, 1.1, 0.5);
    g.restore();
  }

  function drawBeam() {
    if (!p || !p.alive || lv.th.dark <= 0.3) return;
    const x = p.x, y = p.y;
    g.globalCompositeOperation = 'lighter';
    const gr = g.createLinearGradient(x + 18, y + 5, x + 60, y + 50);
    gr.addColorStop(0, 'rgba(255,240,200,0.22)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(x + 18, y + 5); g.lineTo(x + 75, y + 46); g.lineTo(x + 44, y + 60); g.closePath(); g.fill();
    g.globalCompositeOperation = 'source-over';
    addLight(x + 50, y + 42, 48);
  }
  function drawPlayer() {
    if (!p || !p.alive) return;
    const x = p.x, y = p.y;
    let gmin = 1e9, gmax = -1e9;
    for (let i = 6; i <= 16; i++) { const f = FL(x + i); gmin = Math.min(gmin, f); gmax = Math.max(gmax, f); }
    const d = gmin - (y + 8);
    if (d < 60) {
      const k = 1 - d / 60;
      g.fillStyle = `rgba(0,0,0,${0.35 * k})`; g.beginPath(); g.ellipse(x + 11, gmin, 9 * (0.5 + 0.5 * k), 1.1, 0, 0, 6.283); g.fill();
    }
    if (!p.landed && d < 34 && d > 0) {
      const safe = p.vy <= SAFE_VY && Math.abs(p.vx) <= SAFE_VX && gmax - gmin <= 2;
      g.strokeStyle = safe ? '#5dffa0' : '#ff5a5a'; g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(x + 5, gmin - 2.5); g.lineTo(x + 5, gmin - 0.5); g.lineTo(x + 7, gmin - 0.5);
      g.moveTo(x + 17, gmin - 2.5); g.lineTo(x + 17, gmin - 0.5); g.lineTo(x + 15, gmin - 0.5);
      g.stroke();
      glow(safe ? GL.grn : GL.red, x + 11, gmin - 1, 7, 0.35);
    }
    if (p.inv > 0 && ((T * 12) | 0) % 2) g.globalAlpha = 0.35;
    const tilt = clamp(p.vx / 125, -1, 1) * 0.16 + (p.landed ? 0 : clamp(p.vy / 78, -1, 1) * 0.03);
    drawHeli(x, y, tilt, T, fuel > 0 || !p.landed);
    g.globalAlpha = 1;
    if (p.mf > 0) glow(GL.yel, x + 20, y + 5.5, 4.5, p.mf / 0.06);
    addLight(x + 10, y + 4, 75);
  }

  function drawShots() {
    g.globalCompositeOperation = 'lighter';
    for (const b of bullets) {
      g.drawImage(GL.yel, b.x - 2, b.y - 1.5, 8, 3);
      g.fillStyle = '#fff6d8'; g.fillRect(b.x, b.y - 0.3, 4, 0.6);
    }
    for (const b of ebul) { g.drawImage(GL.red, b.x - 3, b.y - 3, 6, 6); g.drawImage(GL.white, b.x - 0.9, b.y - 0.9, 1.8, 1.8); addLight(b.x, b.y, 12); }
    g.globalCompositeOperation = 'source-over';
    for (const b of bombs) {
      const a = Math.atan2(b.vy, b.vx);
      g.save(); g.translate(b.x, b.y); g.rotate(a);
      g.fillStyle = '#2a2f3a'; g.beginPath(); g.ellipse(0, 0, 2, 0.9, 0, 0, 6.283); g.fill();
      g.fillStyle = '#ffcf3a'; g.fillRect(-0.5, -0.9, 0.5, 1.8);
      g.fillStyle = '#2a2f3a'; g.beginPath(); g.moveTo(-1.5, 0); g.lineTo(-2.8, -1.2); g.lineTo(-2.8, 1.2); g.fill();
      g.restore();
    }
  }

  function drawParticles() {
    for (const q of parts) {
      const a = q.life / q.max;
      if (q.k === 'smoke') { g.globalAlpha = a * 0.6; g.drawImage(SMOKE, q.x - q.r, q.y - q.r, q.r * 2, q.r * 2); }
      else if (q.k === 'dust') { g.globalAlpha = a * 0.45; g.drawImage(DUST, q.x - q.r, q.y - q.r, q.r * 2, q.r * 2); }
      else if (q.k === 'debris') { g.globalAlpha = 1; g.fillStyle = '#231f1d'; g.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s, q.s * 0.7); }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'lighter';
    for (const q of parts) {
      const a = q.life / q.max;
      if (q.k === 'fire') {
        const t = 1 - a, spr = t < 0.3 ? GL.yel : t < 0.6 ? GL.org : GL.red, r = q.r * (1 + t * 1.6);
        g.globalAlpha = a; g.drawImage(spr, q.x - r, q.y - r, r * 2, r * 2);
      } else if (q.k === 'spark') {
        g.globalAlpha = a; g.strokeStyle = '#ffd890'; g.lineWidth = 0.45;
        g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(q.x - q.vx * 0.025, q.y - q.vy * 0.025); g.stroke();
      } else if (q.k === 'debris') {
        g.globalAlpha = a * 0.6; g.drawImage(GL.org, q.x - 1.2, q.y - 1.2, 2.4, 2.4);
      }
    }
    for (const f of flashes) { const a = f.life / f.max; g.globalAlpha = a; g.drawImage(GL.white, f.x - f.r, f.y - f.r, f.r * 2, f.r * 2); }
    for (const r of rings) {
      const t = 1 - r.life / r.max;
      g.globalAlpha = (1 - t) * 0.6; g.strokeStyle = '#ffe0b0'; g.lineWidth = 0.8 * (1 - t) + 0.2;
      g.beginPath(); g.arc(r.x, r.y, r.R * t, 0, 6.283); g.stroke();
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    for (const b of blooms) addLight(b.x, b.y, b.r * (b.life / b.max) + 10);
  }

  function applyLighting(dark) {
    if (dark <= 0) return;
    const k = lc.width / cw, sc = S * k;
    lg.setTransform(1, 0, 0, 1, 0, 0); lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, lc.width, lc.height);
    lg.fillStyle = `rgba(2,3,12,${dark})`; lg.fillRect(0, 0, lc.width, lc.height);
    lg.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < lights.length; i += 3) {
      const x = (lights[i] - camX + shX) * sc, y = (lights[i + 1] + shY) * sc, r = lights[i + 2] * sc;
      if (x + r < 0 || x - r > lc.width) continue;
      lg.drawImage(LIGHT, x - r, y - r, r * 2, r * 2);
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(lc, 0, 0, cw, ch);
  }

  function drawWorld() {
    lights = [];
    shX = shake > 0 ? rnd(-1.5, 1.5) : 0; shY = shake > 0 ? rnd(-1, 1) : 0;
    const th = lv.th;
    drawSky(th);
    drawFar(th);
    drawClouds(th);
    wt(1);
    const x0 = clamp(Math.floor(camX) - 2, 0, lv.L - 1), x1 = clamp(Math.ceil(camX + W) + 2, 0, lv.L - 1);
    drawBeam();
    drawSolid(lv.rfl, x0, x1, false);
    if (lv.hasCeil) drawSolid(lv.rce, x0, x1, true);
    drawBuildings(x0, x1);
    drawDecor(x0, x1);
    for (const pd of lv.pads) if (pd.x + pd.w + 30 > x0 && pd.x - 12 < x1) drawPad(pd);
    for (const e of lv.enemies) if (e.x + e.w > x0 - 6 && e.x < x1 + 6) drawEnemy(e);
    for (const k of lv.bricks) if (!k.dead && k.x + 8 > x0 && k.x < x1) drawBrick(k);
    for (const s of lv.spies) if (s.x > x0 - 10 && s.x < x1 + 10) drawSpy(s);
    drawPlayer();
    drawShots();
    drawParticles();
    g.font = `700 6px ${F}`; g.textAlign = 'center';
    for (const q of pops) { g.globalAlpha = Math.min(1, q.t * 2); g.fillStyle = '#fff3c4'; g.fillText('+' + q.s, q.x + 8, q.y); }
    g.globalAlpha = 1; g.textAlign = 'left';
    applyLighting(th.dark);
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(vign, 0, 0);
  }

  // ---------- HUD & screens ----------
  function label(s, x, y, size, col, wgt = 700, align = 'left', spacing = 0) {
    font(size, wgt); g.fillStyle = col; g.textAlign = align;
    if ('letterSpacing' in g) g.letterSpacing = spacing * u + 'px';
    g.fillText(s, x, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.textAlign = 'left';
  }
  function labelW(s, size, wgt, spacing) {
    font(size, wgt);
    if ('letterSpacing' in g) g.letterSpacing = spacing * u + 'px';
    const w = g.measureText(s).width;
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    return w;
  }
  // label() with {action} glyphs of the active device; text glyphs ("Tap") read as words in the line's style
  const GST = { font: F };
  function prompt(s, x, y, size, col, wgt = 700, align = 'left', spacing = 0) {
    const gs = size * 1.3 * u, gap = size * 0.3 * u, cy = y - size * 0.34 * u;
    const q = [];
    for (let it of parsePrompt(input, s)) {
      if ('glyph' in it && it.glyph.kind === 'text') it = { text: it.glyph.label.toUpperCase() };
      if ('text' in it && q.length && 'text' in q[q.length - 1]) q[q.length - 1] = { text: q[q.length - 1].text + it.text }; else q.push(it);
    }
    const parts = q.map((it, i) => {
      if ('glyph' in it) return { gl: it.glyph, w: measureGlyph(g, it.glyph, gs, GST) };
      let t = 'sep' in it ? '/' : it.text;
      if (i > 0 && 'glyph' in q[i - 1]) t = t.trimStart();
      if (i < q.length - 1 && 'glyph' in q[i + 1]) t = t.trimEnd();
      return { t, w: t ? labelW(t, size, wgt, spacing) : 0 };
    }).filter(it => it.w > 0);
    const total = parts.reduce((w, it, i) => w + it.w + (i ? gap : 0), 0);
    let px = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    for (const it of parts) {
      if (it.gl) { g.save(); drawGlyph(g, it.gl, px, cy, gs, GST); g.restore(); } else label(it.t, px, y, size, col, wgt, 'left', spacing);
      px += it.w + gap;
    }
    return total;
  }
  function agentIcon(x, y, s, on) {
    g.fillStyle = on ? '#ffd98a' : 'rgba(255,255,255,0.18)';
    g.beginPath(); g.arc(x, y - s * 0.55, s * 0.28, 0, 6.283); g.fill();
    g.beginPath(); g.roundRect(x - s * 0.32, y - s * 0.22, s * 0.64, s * 0.7, s * 0.15); g.fill();
  }
  function drawHud() {
    g.setTransform(1, 0, 0, 1, 0, 0);
    const gr = g.createLinearGradient(0, 0, 0, 130 * u);
    gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, cw, 130 * u);
    const pd = 36 * u;
    label('SCORE', pd, 40 * u, 16, 'rgba(255,255,255,0.55)', 600, 'left', 3);
    label(pad6(score), pd, 82 * u, 46, '#ffffff', 700, 'left', 2);
    label('HI ' + pad6(Math.max(hiscore, score)), pd, 108 * u, 16, 'rgba(255,255,255,0.4)', 600, 'left', 2);
    // mission + route
    const mw = 620 * u, mh = 36 * u, mx = (cw - mw) / 2, my = 52 * u;
    label('MISSION ' + (mi + 1) + (loop ? '  ·  TOUR ' + (loop + 1) : '') + '  ·  ' + lv.M.name, cw / 2, 40 * u, 17, 'rgba(255,255,255,0.75)', 700, 'center', 4);
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.beginPath(); g.roundRect(mx - 6 * u, my - 4 * u, mw + 12 * u, mh + 8 * u, 8 * u); g.fill();
    g.drawImage(lv.mini, mx, my, mw, mh);
    const mX = x => mx + x / lv.L * mw;
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.5 * u; g.strokeRect(mX(camX), my, W / lv.L * mw, mh);
    for (const p2 of lv.pads) { g.fillStyle = p2.visited ? '#5dffa0' : '#ffcf3a'; g.fillRect(mX(p2.x + p2.w / 2) - 3 * u, my + mh - 8 * u, 6 * u, 8 * u); }
    for (const s of lv.spies) if (s.state === 'wait' || s.state === 'caged' || s.state === 'run') {
      g.fillStyle = s.state === 'caged' ? '#ff9ad8' : '#7ff6ff';
      g.beginPath(); g.arc(mX(s.x), my + mh * (s.y / H), 3.5 * u, 0, 6.283); g.fill();
    }
    if (p) {
      g.fillStyle = '#fff'; const px = mX(p.x), py = my + mh * (p.y / H);
      g.beginPath(); g.moveTo(px + 7 * u, py); g.lineTo(px - 4 * u, py - 5 * u); g.lineTo(px - 4 * u, py + 5 * u); g.fill();
    }
    // right column
    const rx = cw - pd, bw = 300 * u;
    label('FUEL', rx - bw, 40 * u, 16, fuel < 20 && (T * 4 | 0) % 2 ? '#ff6a6a' : 'rgba(255,255,255,0.55)', 600, 'left', 3);
    label(Math.round(fuel) + '%', rx, 40 * u, 16, 'rgba(255,255,255,0.8)', 700, 'right');
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.roundRect(rx - bw, 50 * u, bw, 12 * u, 6 * u); g.fill();
    const fg = g.createLinearGradient(rx - bw, 0, rx, 0);
    if (fuel < 20) { fg.addColorStop(0, '#ff3d3d'); fg.addColorStop(1, '#ff8a5a'); } else { fg.addColorStop(0, '#2fd0ff'); fg.addColorStop(1, '#5dffa0'); }
    g.fillStyle = fg; g.beginPath(); g.roundRect(rx - bw, 50 * u, Math.max(12 * u, bw * fuel / 100), 12 * u, 6 * u); g.fill();
    label('ABOARD', rx - bw, 92 * u, 16, 'rgba(255,255,255,0.55)', 600, 'left', 3);
    for (let i = 0; i < CAP; i++) agentIcon(rx - bw + 96 * u + i * 22 * u, 90 * u, 20 * u, p && i < p.aboard.length);
    const saved = lv.spies.filter(s => s.state === 'saved' || s.state === 'walk').length;
    label('SAVED ' + saved + '/' + lv.spies.length, rx, 92 * u, 16, '#ffd98a', 700, 'right', 2);
    for (let i = 0; i < Math.min(lives, 6); i++) {
      g.setTransform(2.2 * u, 0, 0, 2.2 * u, rx - 26 * u - i * 52 * u - 22 * u, 112 * u);
      drawHeli(0, 0, 0, 0, false);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (TCH.used && state === 'play') drawTouch();
  }
  function drawTouch() {
    const b = BTN();
    const ring = (c, txt, on) => {
      g.fillStyle = on ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.1)'; g.beginPath(); g.arc(c.x, c.y, c.r, 0, 6.283); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2 * u; g.stroke();
      label(txt, c.x, c.y + 8 * u, 22, 'rgba(255,255,255,0.85)', 700, 'center', 2);
    };
    ring(b.fire, 'FIRE', TCH.fire); ring(b.bomb, 'BOMB', TCH.bomb); ring(b.pause, 'II', false);
    if (TCH.stick !== null) {
      g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 2 * u;
      g.beginPath(); g.arc(TCH.sx, TCH.sy, 80 * u, 0, 6.283); g.stroke();
      const d = Math.min(80 * u, Math.hypot(TCH.dx, TCH.dy)), a = Math.atan2(TCH.dy, TCH.dx);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(TCH.sx + Math.cos(a) * d, TCH.sy + Math.sin(a) * d, 34 * u, 0, 6.283); g.fill();
    }
  }
  function panel(w, h, y) {
    const x = (cw - w) / 2;
    g.fillStyle = 'rgba(8,10,22,0.78)'; g.beginPath(); g.roundRect(x, y, w, h, 18 * u); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 2 * u; g.stroke();
    return x;
  }
  function bigTitle(s, y, size, c1 = '#ffd98a', c2 = '#ff5bd8') {
    font(size, 700); g.textAlign = 'center';
    if ('letterSpacing' in g) g.letterSpacing = size * 0.06 * u + 'px';
    const w = g.measureText(s).width, gr = g.createLinearGradient(cw / 2 - w / 2, 0, cw / 2 + w / 2, 0);
    gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.shadowColor = c2; g.shadowBlur = 30 * u; g.fillStyle = gr; g.fillText(s, cw / 2, y);
    g.shadowBlur = 0; g.fillText(s, cw / 2, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.textAlign = 'left';
  }
  function drawMsgs() {
    if (!msgs) return;
    const a = Math.min(1, msgs.t * 3), lines = msgs.lines;
    g.globalAlpha = a;
    const y0 = ch * 0.3;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, y0 - 64 * u, cw, (lines.length > 1 ? 74 + (lines.length - 1) * 34 : 84) * u);
    prompt(lines[0], cw / 2, y0, 48, '#ffffff', 700, 'center', 6);
    lines.slice(1).forEach((l, i) => prompt(l, cw / 2, y0 + 40 * u + i * 32 * u, 24, i === lines.length - 2 && lines.length > 2 ? '#7ff6ff' : '#ffd98a', 600, 'center', 4));
    g.globalAlpha = 1;
  }
  function drawTitle() {
    drawWorld();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = 'rgba(4,6,16,0.35)'; g.fillRect(0, 0, cw, ch);
    bigTitle('SKYHOOK', 250 * u, 190);
    label('AIRBORNE  AGENT  EXTRACTION', cw / 2, 310 * u, 30, 'rgba(255,255,255,0.85)', 600, 'center', 10);
    const x = panel(980 * u, 290 * u, 380 * u);
    const L1 = ['Land near agents to pick them up', 'Deliver them to outposts and HQ', 'Bomb prison huts to free captives', 'Shoot fuel depots to refuel'];
    L1.forEach((s, i) => label(s.toUpperCase(), x + 50 * u, 440 * u + i * 44 * u, 24, i % 2 ? '#ffffff' : '#ffd98a', 600, 'left', 2));
    // keyboard-only extras (sound, fullscreen) stay off the pad legend
    const C = [['fly', 'FLY'], ['fire', 'FIRE'], ['bomb', 'BOMB'], ['pause', 'PAUSE']];
    if (!onPad()) C.push(['sound', 'SOUND'], ['fullscreen', 'FULLSCREEN']);
    C.forEach(([k, v], i) => {
      prompt('{' + k + '}', x + 640 * u, 440 * u + i * 38 * u, 22, '#7ff6ff', 700, 'right', 2);
      label(v, x + 670 * u, 440 * u + i * 38 * u, 22, 'rgba(255,255,255,0.8)', 600, 'left', 2);
    });
    const a = 0.55 + 0.45 * Math.sin(T * 4);
    g.globalAlpha = a; prompt(tapUI() ? 'TAP TO START' : 'PRESS {start} TO START', cw / 2, 720 * u, 36, '#ffffff', 700, 'center', 8); g.globalAlpha = 1;
    label('HI ' + pad6(hiscore) + '   ·   SOUND ' + (soundOn ? 'ON' : 'OFF'), cw / 2, 780 * u, 20, 'rgba(255,255,255,0.55)', 600, 'center', 4);
  }
  function drawClear() {
    const x = panel(760 * u, 420 * u, 300 * u), cx = cw / 2;
    bigTitle('MISSION ' + (mi + 1) + ' COMPLETE', 380 * u, 60, '#7ff6ff', '#5dffa0');
    const rows = [['AGENTS SAVED', tally.saved + ' / ' + tally.total], ['FUEL BONUS', '+' + tally.fuelB], ['FULL RESCUE', tally.full ? '+' + tally.full : '—']];
    rows.forEach((r, i) => { if (stT > 0.3 + i * 0.3) { label(r[0], x + 80 * u, 460 * u + i * 50 * u, 28, 'rgba(255,255,255,0.7)', 600, 'left', 3); label(r[1], x + 680 * u, 460 * u + i * 50 * u, 28, '#ffd98a', 700, 'right', 2); } });
    if (stT > 1.2) { label('SCORE', x + 80 * u, 640 * u, 32, '#fff', 700, 'left', 3); label(pad6(score), x + 680 * u, 640 * u, 32, '#fff', 700, 'right', 2); }
    if (!preview && stT > 1 && (T * 2 | 0) % 2) prompt((tapUI() ? 'TAP' : 'PRESS {start}') + (mi + 1 >= MISSIONS.length ? '' : ' FOR MISSION ' + (mi + 2)), cx, 690 * u, 22, '#7ff6ff', 700, 'center', 4);
  }
  function render() {
    if (state === 'title') return drawTitle();
    drawWorld(); drawHud(); drawMsgs();
    if (state === 'clear') drawClear();
    if (state === 'over') {
      panel(640 * u, 280 * u, 360 * u);
      bigTitle('GAME OVER', 470 * u, 90, '#ff8a5a', '#ff3d6a');
      label('SCORE ' + pad6(score), cw / 2, 540 * u, 32, '#fff', 700, 'center', 4);
      if (stT > 1 && (T * 2 | 0) % 2) prompt(tapUI() ? 'TAP TO CONTINUE' : 'PRESS {start}', cw / 2, 600 * u, 22, '#7ff6ff', 700, 'center', 4);
    }
    if (state === 'win') {
      panel(900 * u, 420 * u, 300 * u);
      bigTitle('ALL AGENTS HOME', 410 * u, 80);
      label('THE NETWORK SURVIVES… FOR NOW', cw / 2, 480 * u, 28, 'rgba(255,255,255,0.8)', 600, 'center', 4);
      label('SCORE ' + pad6(score), cw / 2, 560 * u, 34, '#ffd98a', 700, 'center', 4);
      if (stT > 1.5 && (T * 2 | 0) % 2) prompt((tapUI() ? 'TAP' : 'PRESS {start}') + ' FOR TOUR ' + (loop + 2), cw / 2, 650 * u, 22, '#7ff6ff', 700, 'center', 4);
    }
    if (paused) {
      panel(520 * u, 370 * u, 330 * u);
      bigTitle('PAUSED', 430 * u, 80, '#ffffff', '#7ff6ff');
      // touch can only resume (tap anywhere); fullscreen is a keyboard extra
      const rows = ['{pause}  ·  RESUME'];
      if (!tapUI()) rows.push('{restart}  ·  RESTART', '{quit}  ·  QUIT');
      if (!tapUI() && !onPad()) rows.push('{fullscreen}  ·  FULLSCREEN');
      rows.forEach((s, i) => prompt(s, cw / 2, 500 * u + i * 40 * u, 26, 'rgba(255,255,255,0.8)', 600, 'center', 4));
    }
  }

  // ---------- main loop ----------
  let last = performance.now(), acc = 0, raf = 0, stopped = false, ro = null;
  function frame(now) {
    if (preview) refit();
    acc += Math.min(0.1, (now - last) / 1000); last = now;
    while (acc >= DT) { update(DT); acc -= DT; taps.clear(); }
    render();
    if (!stopped) raf = requestAnimationFrame(frame);
  }
  if (preview) {
    mi = mission % MISSIONS.length; startMission();
    // airborne by the first frame; a still preview shows the mission a few seconds in
    for (let i = 0, n = reducedMotion ? 420 : 75; i < n; i++) update(DT);
  } else toTitle();
  if (preview && reducedMotion) {
    render();
    // still frame: redraw it when the box changes size
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => { const w0 = cw, h0 = ch; refit(); if (cw !== w0 || ch !== h0) render(); });
      ro.observe(cv);
    }
  } else raf = requestAnimationFrame(frame);

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    offs.forEach(off => off());
    input.destroy();
    ro?.disconnect();
    if (AC) { AC.close().catch(() => {}); AC = null; engine = null; }
  }
  return { stop };
}
