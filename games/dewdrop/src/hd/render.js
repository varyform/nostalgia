// The HD renderer: draws the stage and every screen as vectors at the window's own
// resolution, 16:9. The 32 × 18 stage fills the frame (row 0 sits under the HUD). Static art
// is painted once per stage into a layer; the night is a darkness buffer with holes punched
// around every light, then soft glows on top. It only reads `app`, `sim.s` and `sim.L`.
//
//   const view = createRenderer(canvas, app);
//   view.stage(sim);            // a new stage was loaded
//   view.events(sim.events, sim);
//   view.draw(app);
import { drawGlyphs, drawPrompt, glyphs, measureGlyphs } from '@nostalgia/input';
import { fitWide } from '@nostalgia/game/runtime';
import { BRUSHES, BRUSH_NAMES, BUTTONS } from '../editor.js';
import { COLS, ROWS, parseStage } from '../level.js';
import { MOVER_H } from '../sim.js';
import { STAGES, WORLDS } from '../stages.js';
import { layout as touchLayout } from '../touch.js';
import { PAL, TAU, canvas, glow, makeBackdrop, mix, paintStage, rgba, thumbnail } from './art.js';
import {
  FOE_COL, drawBerry, drawBloom, drawBurr, drawDew, drawFirefly, drawKnot, drawLeafPlatform, drawPad, drawToadstool, fireflyPos,
} from './sprites.js';

const F = "'Fredoka','Baloo 2','Trebuchet MS',system-ui,sans-serif";
const INK = '#f4f0ff', DIM = 'rgba(236,232,255,0.62)', GOLD = '#ffd76a';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pad6 = n => String(Math.max(0, n | 0)).padStart(6, '0');
const ease = t => 1 - (1 - clamp(t, 0, 1)) ** 3;

export function createRenderer(cv) {
  const g = cv.getContext('2d');
  let cw = 1, ch = 1, ts = 1, u = 1, vign = null, destroyed = false, lastApp = null;
  const lc = document.createElement('canvas'), lg = lc.getContext('2d');
  let backdrops = {}, layers = new Map(), thumbs = new Map();
  // the largest 16:9 box in the window, at device resolution (capped)
  function fit(w, h) {
    cw = w; ch = h;
    ts = ch / ROWS; u = ch / 1080;
    lc.width = Math.ceil(cw / 2); lc.height = Math.ceil(ch / 2);
    vign = canvas(cw, ch);
    const v = vign.getContext('2d'), gr = v.createRadialGradient(cw / 2, ch / 2, ch * 0.4, cw / 2, ch / 2, cw * 0.62);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.5)');
    v.fillStyle = gr; v.fillRect(0, 0, cw, ch);
    backdrops = {}; layers = new Map(); thumbs = new Map();
  }
  const unfit = fitWide(cv, { onFit: fit });
  // the still demo frame is drawn once; draw it again when the web font arrives
  void document.fonts?.ready.then(() => { if (!destroyed && lastApp) draw(lastApp); });

  const LIGHT = canvas(128, 128);
  {
    const x = LIGHT.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  }
  const backdrop = w => backdrops[w] ?? (backdrops[w] = makeBackdrop(w, cw, ch));
  function layerFor(L, world) {
    const key = world + ':' + L.t.map(r => r.join('')).join('');
    let e = layers.get(key);
    if (!e) {
      e = paintStage(L, world, ts);
      layers.set(key, e);
      if (layers.size > 6) layers.delete(layers.keys().next().value);
    }
    return e;
  }
  function thumbOf(i, w, h) {
    let c = thumbs.get(i);
    if (!c) { const d = STAGES[i]; c = thumbnail(parseStage(d, d.world), d.world, w, h); thumbs.set(i, c); }
    return c;
  }

  // ---------- text ----------
  const font = (size, wgt = 600) => { g.font = `${wgt} ${Math.round(size * u)}px ${F}`; };
  function label(s, x, y, size, col, wgt = 600, align = 'left', spacing = 0) {
    font(size, wgt); g.fillStyle = col; g.textAlign = align; g.textBaseline = 'alphabetic';
    if ('letterSpacing' in g) g.letterSpacing = spacing * u + 'px';
    g.fillText(s, x, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.textAlign = 'left';
  }
  function labelW(s, size, wgt = 600, spacing = 0) {
    font(size, wgt);
    if ('letterSpacing' in g) g.letterSpacing = spacing * u + 'px';
    const w = g.measureText(s).width;
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    return w;
  }
  const GST = { font: F };
  const prompt = (input, s, x, y, size, col, align = 'left', wgt = 600) =>
    drawPrompt(g, input, s, x, y, { font: `${wgt} ${Math.round(size * u)}px ${F}`, size: size * 1.35 * u, color: col, align, letterSpacing: 1.5 * u, style: GST });
  // rows of [action, label, all?] in aligned columns, centred on cx
  function legend(input, rows, cx, y, pitch = 46, size = 22) {
    const gs = size * 1.3 * u, gap = 6 * u, gw = [], lw = [];
    const gl = (a, all) => glyphs(input, a, all);
    for (const r of rows) r.forEach(([a, l, all], k) => { gw[k] = Math.max(gw[k] || 0, measureGlyphs(g, gl(a, all), gs, GST, gap)); lw[k] = Math.max(lw[k] || 0, labelW(l, size, 600, 1.5)); });
    const colGap = 44 * u, inner = 14 * u;
    const total = gw.reduce((w, x, k) => w + (k ? colGap : 0) + x + inner + lw[k], 0);
    rows.forEach((r, i) => {
      let x = cx - total / 2;
      const yc = y + i * pitch * u;
      r.forEach(([a, l, all], k) => {
        const list = gl(a, all);
        drawGlyphs(g, list, x + gw[k] - measureGlyphs(g, list, gs, GST, gap), yc, gs, GST, gap);
        label(l, x + gw[k] + inner, yc + size * 0.36 * u, size, DIM, 600, 'left', 1.5);
        x += gw[k] + inner + lw[k] + colGap;
      });
    });
  }
  function glass(x, y, w, h, r = 28, a = 0.6) {
    g.fillStyle = `rgba(10,12,34,${a})`; g.beginPath(); g.roundRect(x, y, w, h, r * u); g.fill();
    g.strokeStyle = 'rgba(220,220,255,0.16)'; g.lineWidth = 2 * u; g.stroke();
  }
  const shade = (a, col = '5,6,18') => { g.fillStyle = `rgba(${col},${a})`; g.fillRect(0, 0, cw, ch); };
  const pulse = (t, k = 4) => 0.55 + Math.sin(t * k) * 0.45;

  // ---------- particles and effects (tile units) ----------
  let parts = [], shake = 0, flash = 0, flashCol = '255,255,255', squash = new Map(), drift = [];
  const rand = Math.random;
  const P = (x, y, vx, vy, life, col, size = 0.1, grav = 0, gl = null, kind = 'dot', text = '') => parts.push({ x, y, vx, vy, life, max: life, col, size, grav, gl, kind, text });
  function burst(x, y, n, cols, speed = 6, life = 0.6, grav = 10, size = 0.1, gl = null) {
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU, s = speed * (0.3 + rand() * 0.7);
      P(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.5 + rand() * 0.5), cols[Math.floor(rand() * cols.length)], size * (0.6 + rand() * 0.8), grav, gl);
    }
  }
  let curWorld = 0;
  function events(list, sim) {
    if (!sim?.L) return;
    const Z = PAL[sim.L.world ?? 0];
    for (const e of list) {
      const { x, y } = e;
      switch (e.type) {
        case 'berry':
          burst(x, y, 16, [Z.berry[1], Z.berry[2], '#ffffff'], 5, 0.6, -2, 0.1, Z.glow);
          P(x, y - 0.4, 0, -1.4, 0.9, Z.berry[2], 0.5, 0, null, 'text', '100');
          break;
        case 'fly':
          burst(x, y, 22, ['#e6ffa0', '#ffffff'], 6, 0.8, -1, 0.09, 'green');
          P(x, y - 0.4, 0, -1.2, 1.1, '#e6ffa0', 0.55, 0, null, 'text', '500');
          break;
        case 'jump': burst(x, y, 5, ['#bfeaff', '#ffffff'], 2.5, 0.35, 6, 0.07); break;
        case 'land': if (e.hard) burst(x, y, 8, ['#bfeaff', '#ffffff'], 3, 0.4, 10, 0.08); break;
        case 'boing': squash.set(e.c + ',' + e.r, 0.3); burst(x, y, 10, ['#ff8a7a', '#fff2e0'], 4, 0.5, 8, 0.08); break;
        case 'die':
          burst(x, y, 40, ['#9fe4ff', '#e8fbff', '#5cc8f0'], 7, 1, 14, 0.12, 'dew');
          shake = 0.35; flash = 0.12; flashCol = e.why === 'prickle' ? '255,90,120' : '120,200,255';
          break;
        case 'bloom':
          for (let i = 0; i < 40; i++) { const a = (i / 40) * TAU; P(x, y, Math.cos(a) * 5, Math.sin(a) * 4, 1.1, i % 2 ? '#ffffff' : '#e8d8ff', 0.1, 0, 'moon'); }
          flash = 0.15; flashCol = '240,230,255';
          break;
        case 'home': burst(x, y, 50, ['#ffffff', '#e8d8ff', Z.berry[2]], 6, 1.4, -3, 0.11, 'moon'); break;
        case 'crumble': burst(x, y, 10, [Z.leaf[0], Z.leaf[1], '#c08a3a'], 2.5, 1, 12, 0.13); break;
        case 'warn': break;
        case 'spawn': burst(x, y, 14, [Z.thorn[1], '#ff7a7a'], 4, 0.5, 4, 0.1, 'red'); break;
        case 'sink': burst(x, y, 12, [Z.water[2], '#ffffff'], 4, 0.6, 14, 0.09); break;
        case 'thump': burst(x, y, 4, [Z.earth[2]], 2, 0.3, 8, 0.07); break;
        case 'respawn': burst(x, y, 20, ['#9fe4ff', '#ffffff'], 3, 0.7, -2, 0.09, 'dew'); break;
        case 'life': P(x || 16, (y || 3) - 0.5, 0, -1, 1.4, '#9fffb4', 0.7, 0, null, 'text', '1UP'); break;
      }
    }
  }
  function stepParts(dt) {
    for (const p of parts) { p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 1.5; }
    parts = parts.filter(p => p.life > 0);
    if (parts.length > 700) parts.splice(0, parts.length - 700);
    for (const [k, v] of squash) { if (v - dt <= 0) squash.delete(k); else squash.set(k, v - dt); }
    shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt);
  }
  function drawParts() {
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.kind === 'text') {
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
        label(p.text, p.x * ts, p.y * ts, 26 + p.size * 10, rgba(p.col.startsWith('#') ? p.col : '#ffffff', a), 700, 'center', 1);
        g.restore();
        continue;
      }
      g.globalAlpha = a; g.fillStyle = p.col;
      g.beginPath(); g.arc(p.x, p.y, p.size, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
    for (const p of parts) if (p.gl && p.kind !== 'text') glow(g, p.gl, p.x, p.y, p.size * 5, (p.life / p.max) * 0.6);
  }

  // ---------- the stage ----------
  let camX = 16;
  function drawBackdrop(world, dt, t, focusX = 16) {
    const B = backdrop(world);
    camX += (focusX - camX) * (1 - Math.exp(-dt * 2));
    const k = (camX / COLS - 0.5) * 2; // -1..1
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(B.sky, 0, 0);
    for (const s of B.stars) {
      const a = 0.35 + Math.sin(t * s.s + s.p) * 0.35;
      if (a <= 0.05) continue;
      g.fillStyle = rgba(PAL[world].star, a); g.fillRect(s.x - k * 6 * u, s.y, s.r, s.r);
    }
    const slack = B.W - cw;
    g.drawImage(B.far, -slack / 2 - k * slack * 0.18, 0);
    g.drawImage(B.mid, -slack / 2 - k * slack * 0.32, 0);
    g.drawImage(B.near, -slack / 2 - k * slack * 0.5, 0);
  }
  // ponds and brooks, animated under the static layer
  function drawWater(L, Z, t) {
    for (let r = 0; r < ROWS; r++) {
      let c = 0;
      while (c < COLS) {
        const ch0 = L.t[r][c];
        if (ch0 !== '~') { c++; continue; }
        const c0 = c;
        while (c < COLS && L.t[r][c] === '~') c++;
        const top = r === 0 || L.t[r - 1][c0] !== '~';
        const y0 = top ? r + 0.28 : r;
        const gr = g.createLinearGradient(0, y0, 0, r + 1);
        gr.addColorStop(0, top ? Z.water[1] : mix(Z.water[1], Z.water[0], 0.5)); gr.addColorStop(1, Z.water[0]);
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(c0, r + 1.02);
        if (top) for (let x = c0; x <= c + 0.001; x += 0.25) g.lineTo(x, y0 + Math.sin(x * 2.1 + t * 2.2) * 0.05 + Math.sin(x * 0.7 - t * 1.3) * 0.04);
        else { g.lineTo(c0, r - 0.02); g.lineTo(c, r - 0.02); }
        g.lineTo(c, r + 1.02); g.closePath(); g.fill();
        if (top) {
          g.strokeStyle = rgba(Z.water[2], 0.55); g.lineWidth = 0.05;
          g.beginPath();
          for (let x = c0; x <= c + 0.001; x += 0.25) { const y = y0 + Math.sin(x * 2.1 + t * 2.2) * 0.05 + Math.sin(x * 0.7 - t * 1.3) * 0.04; if (x === c0) g.moveTo(x, y); else g.lineTo(x, y); }
          g.stroke();
          // moon glints
          g.fillStyle = rgba(Z.water[2], 0.35);
          for (let x = c0 + 0.3; x < c; x += 1.3) g.fillRect(x + Math.sin(t + x) * 0.2, y0 + 0.25 + (x % 0.5), 0.35, 0.03);
        }
      }
    }
    // brook banks: solid ground with a running stream on top
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const ch0 = L.t[r][c];
        if (ch0 !== '<' && ch0 !== '>') continue;
        g.fillStyle = Z.earth[1]; g.fillRect(c - 0.01, r + 0.18, 1.02, 0.84);
        g.fillStyle = Z.water[1]; g.fillRect(c - 0.01, r - 0.02, 1.02, 0.26);
        const dir = ch0 === '>' ? 1 : -1;
        g.fillStyle = rgba(Z.water[2], 0.7);
        for (let k = 0; k < 3; k++) {
          const ph = (((t * 1.6 * dir + k / 3 + c * 0.37) % 1) + 1) % 1;
          g.fillRect(c + ph * 0.8, r + 0.04 + (k % 2) * 0.08, 0.22, 0.035);
        }
      }
  }
  // seeds riding updrafts, streaks in the breeze
  function drawWind(L, Z, dt, t) {
    if (!L.wind.length) return;
    while (drift.length < L.wind.length * 14) {
      const w = L.wind[Math.floor(rand() * L.wind.length)];
      drift.push({ w, x: w.x + rand() * w.w, y: w.y + rand() * w.h, life: 1 + rand() * 2, p: rand() * TAU });
    }
    g.lineCap = 'round';
    for (const d of drift) {
      const w = d.w;
      d.life -= dt;
      if (w.kind === 'U') { d.y -= dt * 4.5; d.x += Math.sin(t * 2 + d.p) * dt * 0.5; }
      else d.x += (w.kind === 'L' ? -1 : 1) * dt * (w.k * 2.2);
      if (d.life <= 0 || d.y < w.y || d.x < w.x || d.x > w.x + w.w) { d.dead = true; continue; }
      const a = Math.min(1, d.life) * 0.55;
      if (w.kind === 'U') {
        g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = 0.02;
        g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x, d.y + 0.18); g.stroke();
        for (let i = 0; i < 5; i++) { const an = -Math.PI / 2 + (i - 2) * 0.35; g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x + Math.cos(an) * 0.12, d.y + Math.sin(an) * 0.12); g.stroke(); }
      } else {
        g.strokeStyle = rgba(Z.fog, a * 0.7); g.lineWidth = 0.03;
        g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x - (w.kind === 'L' ? -0.6 : 0.6), d.y + Math.sin(t * 3 + d.p) * 0.05); g.stroke();
      }
    }
    drift = drift.filter(d => !d.dead);
  }

  // the whole stage: L is the level; s the live state (null in the editor: everything at rest)
  function drawScene(L, s, dt, t, { dim = 0, focus = null } = {}) {
    const world = L.world ?? 0, Z = PAL[world];
    curWorld = world;
    const p = s?.p;
    drawBackdrop(world, dt, t, focus ?? (p ? p.x + p.w / 2 : 16));
    const sx = shake > 0 ? (rand() - 0.5) * shake * 0.4 * ts : 0, sy = shake > 0 ? (rand() - 0.5) * shake * 0.4 * ts : 0;
    g.setTransform(ts, 0, 0, ts, sx, sy);
    drawWater(L, Z, t);
    g.setTransform(1, 0, 0, 1, sx, sy);
    g.drawImage(layerFor(L, world), 0, 0);
    g.setTransform(ts, 0, 0, ts, sx, sy);
    drawWind(L, Z, dt, t);
    // toadstools
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (L.t[r][c] === 'T') drawToadstool(g, c, r, squash.get(c + ',' + r) ?? 0, t);
    // dry leaves
    L.crumbles.forEach((k, i) => { const st = s ? s.cr[i] : { st: 0, t: 0 }; drawLeafPlatform(g, Z, k.c, k.r, st.st, t, st.st === 1 ? clamp(st.t / 0.5, 0.3, 1) : 0); });
    // lily pads
    L.movers.forEach((m, i) => { const q = s ? s.mv[i] : m; drawPad(g, Z, q.x, q.y - MOVER_H * 0.2, m.w, t); });
    // bramble knots, glowing when about to spawn
    for (const [k, kn] of Object.entries(L.knots)) {
      let warn = 0;
      if (s) L.waves.forEach((w, i) => { if (w.knot === k && s.slots[i].st === 'warn') warn = Math.max(warn, clamp(1 - s.slots[i].t / 1.5, 0.35, 1)); });
      drawKnot(g, Z, kn.x, kn.y, t, warn);
    }
    // the moonbloom
    const door = L.door, taken = s ? s.taken.filter(Boolean).length : 0, total = L.berries.length || 1;
    if (door) {
      const open = s?.open ? clamp(s.openT / 0.8, 0, 1) : 0, closing = s?.status === 'clear' ? clamp((s.statusT - 0.3) / 0.7, 0, 1) : 0;
      if (open > 0) {
        // light rays
        g.save(); g.translate(door.x, door.y - 1.3); g.rotate(t * 0.3);
        for (let i = 0; i < 8; i++) { g.rotate(TAU / 8); g.fillStyle = `rgba(255,250,230,${0.07 * open})`; g.beginPath(); g.moveTo(0, 0); g.lineTo(-0.25, -3.2); g.lineTo(0.25, -3.2); g.fill(); }
        g.restore();
      }
      drawBloom(g, Z, door.x, door.y, t, taken / total, open, closing);
    }
    // glowberries and fireflies
    L.berries.forEach((b, i) => { if (!s || !s.taken[i]) drawBerry(g, Z, b.x, b.y, t); });
    L.flies.forEach((f, i) => { if (!s || !s.flies[i]) { const q = fireflyPos(f, t, i); drawFirefly(g, q.x, q.y, t, i); } });
    // the burrs
    if (s) for (const f of s.foes) {
      const e = f.emerge > 0 ? 1 - f.emerge / 0.7 : 1;
      drawBurr(g, f.kind, f.x + f.w / 2, f.y + f.h, {
        roll: f.roll, squash: f.squash, look: p ? Math.sign(p.x - f.x) : f.dir, t, scale: 0.4 + e * 0.6, alpha: f.emerge > 0 ? 0.35 + e * 0.5 : 1,
        mode: f.mode, vy: f.vy, crouch: f.crouch,
      });
    }
    // Dew
    if (p && s.status !== 'dying' && s.status !== 'over' && !(s.status === 'clear' && s.statusT > 0.35)) {
      const blinkOut = p.inv > 0 && Math.floor(p.inv * 12) % 2 === 0;
      drawDew(g, p, t, { alpha: blinkOut ? 0.35 : s.status === 'clear' ? 1 - s.statusT / 0.35 : 1 });
    }
    // editor markers for Dew's start
    if (!s && L.start) drawDew(g, { x: L.start.x - 0.35, y: L.start.y - 0.85, w: 0.7, h: 0.85, vx: 0, vy: 0, mode: 'ground', face: 1, landT: 1, runT: 0 }, t);
    drawParts();

    // night: darkness with light around every glowing thing
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, lc.width, lc.height);
    lg.fillStyle = `rgba(4,6,22,${Z.dark + dim})`; lg.fillRect(0, 0, lc.width, lc.height);
    lg.globalCompositeOperation = 'destination-out';
    const k = ts / 2;
    const hole = (x, y, r, a = 1) => { lg.globalAlpha = a; lg.drawImage(LIGHT, (x - r) * k, (y - r) * k, r * 2 * k, r * 2 * k); };
    if (p && s.status === 'play') hole(p.x + p.w / 2, p.y + p.h / 2, 4.2);
    L.berries.forEach((b, i) => { if (!s || !s.taken[i]) hole(b.x, b.y, 2); });
    L.flies.forEach((f, i) => { if (!s || !s.flies[i]) hole(f.x, f.y, 1.8); });
    if (door) hole(door.x, door.y - 1.2, s?.open ? 5 : 2 + (taken / total) * 1.5);
    if (s) for (const f of s.foes) hole(f.x + f.w / 2, f.y + f.h / 2, 1.2, 0.5);
    lg.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(lc, 0, 0, cw, ch);
    // glows on top
    g.setTransform(ts, 0, 0, ts, sx, sy);
    if (p && s.status === 'play') glow(g, 'dew', p.x + p.w / 2, p.y + p.h * 0.55, 1.5, 0.35);
    L.berries.forEach((b, i) => { if (!s || !s.taken[i]) glow(g, Z.glow, b.x, b.y + Math.sin(t * 2.4 + b.x * 1.3) * 0.06, 1.1, 0.55); });
    L.flies.forEach((f, i) => { if (!s || !s.flies[i]) { const q = fireflyPos(f, t, i); glow(g, 'green', q.x - 0.08, q.y, 0.7, 0.4 + Math.sin(t * 5 + i * 3) * 0.3); } });
    if (door) glow(g, 'moon', door.x, door.y - 1.25, 1.2 + (taken / total), 0.2 + (taken / total) * 0.3);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(vign, 0, 0);
    if (flash > 0) { g.fillStyle = `rgba(${flashCol},${flash * 1.6})`; g.fillRect(0, 0, cw, ch); }
  }

  // ---------- HUD ----------
  function dropIcon(x, y, s) {
    g.save(); g.translate(x, y); g.scale(s, s);
    g.beginPath(); g.moveTo(0, -1); g.bezierCurveTo(0.15, -0.7, 0.55, -0.45, 0.55, -0.1); g.arc(0, -0.1, 0.55, 0, Math.PI); g.bezierCurveTo(-0.55, -0.45, -0.15, -0.7, 0, -1); g.fill();
    g.restore();
  }
  function drawHud(app) {
    const s = app.sim.s, L = app.sim.L, Z = PAL[L.world ?? 0];
    const h = 58 * u;
    const gr = g.createLinearGradient(0, 0, 0, h * 1.4);
    gr.addColorStop(0, 'rgba(6,8,24,0.75)'); gr.addColorStop(1, 'rgba(6,8,24,0)');
    g.fillStyle = gr; g.fillRect(0, 0, cw, h * 1.4);
    const y = 40 * u;
    label(app.custom ? 'YOUR GARDEN' : L.id, 30 * u, y, 26, Z.accent, 700, 'left', 2);
    label(L.name.toUpperCase(), (app.custom ? 230 : 100) * u, y, 22, DIM, 600, 'left', 3);
    // berries left
    const left = s.taken.filter(t => !t).length, bx = cw / 2 - 160 * u;
    g.save(); g.translate(bx, y - 9 * u); g.scale(34 * u, 34 * u); drawBerry(g, Z, 0, 0, app.t, 0.85); g.restore();
    label(s.open ? 'HOME!' : `${L.berries.length - left} / ${L.berries.length}`, bx + 26 * u, y, 26, s.open ? '#fff6d0' : INK, 700, 'left', 1);
    // time bonus
    const bonus = Math.floor(s.timeLeft) * 50;
    label(s.hurry ? 'HURRY!' : 'BONUS ' + bonus, cw / 2 + 60 * u, y, 24, s.hurry ? (Math.floor(app.t * 4) % 2 ? '#ff7a8a' : '#ffd0d6') : s.timeLeft < 10 ? '#ffb0a0' : DIM, 700, 'left', 2);
    // score and lives
    label(pad6(s.score), cw - 250 * u, y, 28, INK, 700, 'right', 2);
    g.fillStyle = '#8fdcff';
    const n = Math.min(s.lives, 6);
    for (let i = 0; i < n; i++) dropIcon(cw - 210 * u + i * 34 * u, y + 2 * u, 15 * u);
    if (s.lives > 6) label('×' + s.lives, cw - 210 * u + 6 * 34 * u, y, 22, INK, 700);
    if (app.touch?.active && app.state === 'play') drawTouch(app);
  }
  function drawTouch(app) {
    const T = app.touch, Lt = touchLayout(cw, ch);
    const ring = (c, txt, on) => {
      g.fillStyle = on ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.1)'; g.beginPath(); g.arc(c.x, c.y, c.r, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.32)'; g.lineWidth = 2 * u; g.stroke();
      label(txt, c.x, c.y + 9 * u, 26, 'rgba(255,255,255,0.85)', 700, 'center', 2);
    };
    ring(Lt.jump, 'JUMP', T.jump); ring(Lt.pause, 'II', false);
    if (T.stick) {
      g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 2 * u;
      g.beginPath(); g.arc(T.stick.x0, T.stick.y0, Lt.stickR, 0, TAU); g.stroke();
      const dx = T.stick.x - T.stick.x0, dy = T.stick.y - T.stick.y0, d = Math.min(Lt.stickR, Math.hypot(dx, dy)), a = Math.atan2(dy, dx);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(T.stick.x0 + Math.cos(a) * d, T.stick.y0 + Math.sin(a) * d, 40 * u, 0, TAU); g.fill();
    } else label('DRAG TO MOVE', 200 * u, ch - 90 * u, 20, 'rgba(255,255,255,0.35)', 600, 'center', 3);
  }

  // ---------- screens ----------
  function logo(cy, size, t) {
    const s = 'Dewdrop';
    font(size, 700);
    if ('letterSpacing' in g) g.letterSpacing = size * 0.02 * u + 'px';
    const w = g.measureText(s).width, x = cw / 2 - w / 2;
    const gr = g.createLinearGradient(0, cy - size * 0.85 * u, 0, cy);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#a8ecff'); gr.addColorStop(1, '#4aa8e8');
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(0,0,20,0.55)'; g.fillText(s, x + 6 * u, cy + 8 * u);
    g.fillStyle = gr; g.fillText(s, x, cy);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    glow(g, 'dew', cw / 2, cy - size * 0.35 * u, w * 0.6, 0.18 + Math.sin(t * 2) * 0.04);
  }
  // a little scene: Dew hopping between two burrs on a lily pad
  function mascot(cx, fy, sc, t) {
    const ph = (t * 1.1) % 1, hop = Math.sin(ph * Math.PI);
    const p = { x: -0.35, y: -0.85 - hop * 1.4, w: 0.7, h: 0.85, vx: 0, vy: (0.5 - ph) * -20, mode: hop > 0.05 ? 'air' : 'ground', face: Math.sin(t * 0.5) > 0 ? 1 : -1, landT: ph * 1.4, runT: 0, inv: 0 };
    g.save(); g.translate(cx, fy); g.scale(sc, sc);
    drawPad(g, PAL[3], -1.4, 0.05, 2.8, t);
    drawDew(g, p, t);
    drawBurr(g, 'chase', -2.6, 0.4, { roll: t * 2, t, look: 1 });
    drawBurr(g, 'hop', 2.6, 0.4 - Math.abs(Math.sin(t * 2.2)) * 0.5, { t, look: -1, squash: Math.max(0, Math.sin(t * 2.2 + 1.2)) * 0.2 });
    g.restore();
    glow(g, 'dew', cx, fy - sc * 0.8, sc * 2.2, 0.2);
  }
  let pan = 0;
  function sceneryBackdrop(world, dt, t) { pan += dt; drawBackdrop(world, dt, t, 16 + Math.sin(pan * 0.15) * 14); }
  // with an autosave the menu opens on a taller CONTINUE (its stage and score under it)
  function menuRects(app) {
    const items = app.titleItems(), cont = items[0] === 'continue';
    let y = (cont ? 506 : 520) * u;
    return items.map(it => {
      const w = (it === 'continue' ? 520 : 360) * u, h = (it === 'continue' ? 78 : cont ? 52 : 56) * u, r = { it, x: cw / 2 - w / 2, y, w, h };
      y += h + (cont ? 6 : 10) * u;
      return r;
    });
  }
  function drawTitle(app, dt) {
    const t = app.t;
    sceneryBackdrop(0, dt, t);
    shade(0.38);
    g.drawImage(vign, 0, 0);
    logo(250 * u, 190, t);
    label('A MOONLIT GARDEN CAPER', cw / 2, 310 * u, 24, PAL[0].accent, 600, 'center', 8);
    mascot(cw / 2, 470 * u, 62 * u, t);
    const names = { continue: 'CONTINUE', play: 'PLAY', editor: 'STAGE EDITOR', exit: 'EXIT' }, rects = menuRects(app);
    rects.forEach((m, i) => {
      const on = i === app.menu, cont = m.it === 'continue';
      if (on) { glass(m.x, m.y, m.w, m.h, 28, 0.55); glow(g, 'dew', m.x + 30 * u, m.y + m.h / 2, 30 * u, 0.6); }
      label(names[m.it], cw / 2, m.y + m.h * (cont ? 0.52 : 0.7), on ? 34 : 28, on ? '#ffffff' : DIM, 700, 'center', 4);
      if (cont) label(`${app.saved.label}  ·  ${app.savedAgo()}`.toUpperCase(), cw / 2, m.y + m.h * 0.84, 18, on ? PAL[0].accent : DIM, 600, 'center', 3);
    });
    const input = app.input, kb = input.device.kind === 'keyboard';
    const rows = [[['move', 'MOVE'], ['jump', 'JUMP', true], ['climb', 'CLIMB']], [['drop', 'DROP THROUGH'], ['pause', 'PAUSE']]];
    const extra = [];
    if (kb) extra.push(['sound', 'SOUND'], ['fullscreen', 'FULL SCREEN']);
    if (kb && app.hdr?.supported) extra.push(['hdr', app.hdr.label]);
    if (app.onExit) extra.push(['quit', 'EXIT']);
    if (extra.length) rows.push(extra);
    legend(input, rows, cw / 2, (rects[0]?.it === 'continue' ? 796 : 780) * u, 48, 21);
    prompt(input, 'PRESS {start}', cw / 2, 960 * u, 30, `rgba(255,215,106,${pulse(t)})`, 'center', 700);
    const total = Object.values(app.save.best).reduce((a, b) => a + b, 0), done = Object.keys(app.save.best).length;
    label(`GARDENS CLEARED ${done}/${STAGES.length}    BEST TOTAL ${pad6(total)}    SOUND ${app.soundOn ? 'ON' : 'OFF'}`, cw / 2, 1040 * u, 18, 'rgba(255,255,255,0.45)', 600, 'center', 3);
  }
  function selectRect(i) {
    const w = Math.floor(i / 6), k = i % 6, tw = 236 * u, th = Math.round(tw * 9 / 16);
    return { x: 380 * u + k * (tw + 22 * u), y: 150 * u + w * 200 * u, w: tw, h: th };
  }
  function drawSelect(app, dt) {
    const t = app.t, sel = app.sel, world = STAGES[sel].world;
    sceneryBackdrop(world, dt, t);
    shade(0.6);
    label('CHOOSE A GARDEN', cw / 2, 95 * u, 44, '#ffffff', 700, 'center', 8);
    WORLDS.forEach((W, w) => {
      const y = 150 * u + w * 200 * u;
      label(W.name.toUpperCase(), 330 * u, y + 62 * u, 26, w === world ? PAL[w].accent : DIM, 700, 'right', 3);
      label(`${w + 1}`, 330 * u, y + 100 * u, 22, 'rgba(255,255,255,0.3)', 700, 'right', 3);
    });
    STAGES.forEach((d, i) => {
      const r = selectRect(i), locked = i > app.save.unlocked, on = i === sel, best = app.save.best[d.id];
      g.save();
      if (on) { glow(g, PAL[d.world].glow, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.9, 0.35); }
      g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 14 * u); g.clip();
      g.globalAlpha = locked ? 0.25 : on ? 1 : 0.75;
      g.drawImage(thumbOf(i, Math.round(r.w), Math.round(r.h)), r.x, r.y, r.w, r.h);
      g.restore();
      g.strokeStyle = on ? '#ffffff' : 'rgba(255,255,255,0.15)'; g.lineWidth = (on ? 4 : 2) * u;
      g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 14 * u); g.stroke();
      label(d.id, r.x + 6 * u, r.y + r.h + 30 * u, 22, on ? '#ffffff' : DIM, 700, 'left', 2);
      if (best) label(pad6(best), r.x + r.w - 4 * u, r.y + r.h + 30 * u, 18, GOLD, 600, 'right', 1);
      if (locked) {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.roundRect(cx - 18 * u, cy - 4 * u, 36 * u, 28 * u, 5 * u); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 6 * u; g.beginPath(); g.arc(cx, cy - 6 * u, 12 * u, Math.PI, TAU); g.stroke();
      }
    });
    const d = STAGES[sel], locked = sel > app.save.unlocked;
    glass(220 * u, 965 * u, cw - 440 * u, 90 * u, 24, 0.55);
    label(`${d.id}  ${d.name.toUpperCase()}`, 260 * u, 1020 * u, 30, '#ffffff', 700, 'left', 3);
    label(locked ? 'CLEAR THE GARDEN BEFORE IT TO OPEN THIS ONE' : d.hint ?? '', 760 * u, 1020 * u, 20, DIM, 500, 'left', 1);
    prompt(app.input, locked ? '{back} BACK' : '{start} PLAY   {back} BACK', cw - 260 * u, 1020 * u, 22, 'rgba(255,255,255,0.75)', 'right');
  }
  function drawReady(app) {
    const d = app.def, t = app.stT, W = WORLDS[d.world ?? 0];
    shade(0.35 * (1 - ease((t - (app.worldIntro ? 2.6 : 1.3)) * 3)));
    const a = clamp(t * 4, 0, 1) * (1 - clamp((t - (app.worldIntro ? 2.8 : 1.5)) * 4, 0, 1));
    if (a <= 0) return;
    g.globalAlpha = a;
    const w = 1000 * u, h = (app.worldIntro ? 330 : 250) * u, x = (cw - w) / 2, y = (ch - h) / 2 - 20 * u;
    glass(x, y, w, h, 34, 0.62);
    let yy = y + 70 * u;
    if (app.worldIntro) {
      label(W.name.toUpperCase(), cw / 2, yy + 10 * u, 56, PAL[d.world].accent, 700, 'center', 10);
      label(W.blurb, cw / 2, yy + 56 * u, 22, DIM, 500, 'center', 1);
      yy += 110 * u;
    }
    label(app.custom ? 'YOUR GARDEN' : 'GARDEN ' + d.id, cw / 2, yy, 24, DIM, 700, 'center', 6);
    label(d.name, cw / 2, yy + 58 * u, 50, '#ffffff', 700, 'center', 2);
    if (d.hint) label(d.hint, cw / 2, yy + 104 * u, 22, GOLD, 500, 'center', 1);
    g.globalAlpha = 1;
  }
  function drawPause(app) {
    shade(0.5);
    const w = 640 * u, h = 440 * u, x = (cw - w) / 2, y = (ch - h) / 2;
    glass(x, y, w, h);
    label('PAUSED', cw / 2, y + 95 * u, 60, '#ffffff', 700, 'center', 12);
    const rows = [[['pause', 'RESUME']], [['restart', 'RETRY GARDEN']], [['quit', app.custom ? 'BACK TO EDITOR' : 'CHOOSE GARDEN']]];
    if (app.input.device.kind === 'keyboard') rows.push([['sound', app.soundOn ? 'SOUND OFF' : 'SOUND ON']]);
    legend(app.input, rows, cw / 2, y + 180 * u, 58, 24);
  }
  function drawClear(app) {
    const s = app.sim.s, T = s.tally, t = app.stT;
    shade(0.45 * ease(t * 2));
    const w = 820 * u, h = 560 * u, x = (cw - w) / 2, y = (ch - h) / 2;
    glass(x, y, w, h, 34, 0.66);
    label('HOME AGAIN!', cw / 2, y + 90 * u, 56, '#fff6d0', 700, 'center', 6);
    label(app.custom ? 'YOUR GARDEN' : `${app.def.id}  ${app.def.name.toUpperCase()}`, cw / 2, y + 135 * u, 22, DIM, 600, 'center', 4);
    const rows = [
      ['GLOWBERRIES', `${T.berries} × 100`, T.berries * 100],
      ['FIREFLIES', T.flyCount ? `${T.fireflies} / ${T.flyCount} × 500` : '—', T.fireflies * 500],
      ['TIME BONUS', `${T.secs}s × 50`, T.time],
      ['GARDEN BONUS', '', T.clear],
    ];
    rows.forEach(([a, b, v], i) => {
      const k = clamp((t - 0.25 - i * 0.3) * 3, 0, 1);
      if (k <= 0) return;
      g.globalAlpha = k;
      const yy = y + 215 * u + i * 58 * u;
      label(a, x + 70 * u, yy, 26, DIM, 600, 'left', 3);
      label(b, x + 470 * u, yy, 22, 'rgba(255,255,255,0.45)', 600, 'right', 1);
      label(String(Math.round(v * k)), x + w - 70 * u, yy, 30, '#ffffff', 700, 'right', 1);
      g.globalAlpha = 1;
    });
    const k = clamp((t - 1.5) * 3, 0, 1);
    if (k > 0) {
      g.globalAlpha = k;
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(x + 60 * u, y + 430 * u, w - 120 * u, 2 * u);
      label('GARDEN SCORE', x + 70 * u, y + 478 * u, 28, GOLD, 700, 'left', 3);
      label(String(T.stage), x + w - 70 * u, y + 478 * u, 38, GOLD, 700, 'right', 1);
      if (app.newBest) label('NEW BEST!', cw / 2, y + 520 * u, 22, `rgba(160,255,190,${pulse(app.t, 6)})`, 700, 'center', 6);
      g.globalAlpha = 1;
    }
    if (t > 1.2) {
      const last = !app.custom && app.stage === STAGES.length - 1;
      prompt(app.input, app.custom ? '{start} BACK TO EDITOR' : last ? '{start} GO HOME' : '{start} NEXT GARDEN   {back} CHOOSE', cw / 2, y + h + 50 * u, 26, `rgba(255,215,106,${pulse(app.t)})`, 'center', 700);
    }
  }
  function drawOver(app) {
    shade(0.55);
    const w = 760 * u, h = 330 * u, x = (cw - w) / 2, y = (ch - h) / 2;
    glass(x, y, w, h);
    label('GAME OVER', cw / 2, y + 100 * u, 64, '#ff9ab0', 700, 'center', 10);
    label('SCORE ' + pad6(app.sim.s.score), cw / 2, y + 155 * u, 26, '#ffffff', 600, 'center', 4);
    const left = Math.max(0, Math.ceil(10 - app.stT));
    label('CONTINUE?  ' + left, cw / 2, y + 220 * u, 34, GOLD, 700, 'center', 6);
    if (app.stT > 0.8) prompt(app.input, '{start} YES   {back} NO', cw / 2, y + 285 * u, 24, 'rgba(255,255,255,0.8)', 'center', 700);
  }
  function drawEnding(app, dt) {
    const t = app.stT;
    sceneryBackdrop(3, dt, app.t);
    shade(0.3);
    g.drawImage(vign, 0, 0);
    // the Great Lily on the Moon Pond, Dew on it
    const cx = cw / 2, fy = 760 * u, sc = 110 * u;
    g.save(); g.translate(cx, fy); g.scale(sc, sc);
    drawPad(g, PAL[3], -3, 0, 6, app.t);
    drawBloom(g, PAL[3], 0, 0.1, app.t, 1, clamp(t / 2, 0, 1));
    g.restore();
    const hop = Math.abs(Math.sin(app.t * 2.2));
    g.save(); g.translate(cx + 2.1 * sc, fy); g.scale(sc * 0.7, sc * 0.7);
    drawDew(g, { x: -0.35, y: -0.85 - hop * 0.6, w: 0.7, h: 0.85, vx: 0, vy: 0, mode: hop > 0.1 ? 'air' : 'ground', face: -1, landT: 1, runT: 0 }, app.t);
    g.restore();
    glow(g, 'moon', cx, fy - 1.3 * sc, 4 * sc, 0.25);
    const lines = ['The last moonbloom opens on the Great Lily.', 'Dew is home, and the whole garden glows with her berries.', 'The burrs grumble off into the hedges until tomorrow night.'];
    lines.forEach((l, i) => { const k = clamp((t - 0.8 - i * 1.2) * 2, 0, 1); if (k > 0) label(l, cw / 2, 170 * u + i * 52 * u, 30, `rgba(244,240,255,${k})`, 500, 'center'); });
    if (t > 4) {
      label('SCORE ' + pad6(app.run.score), cw / 2, 930 * u, 30, '#ffffff', 700, 'center', 4);
      prompt(app.input, 'PRESS {start}', cw / 2, 1000 * u, 26, `rgba(255,215,106,${pulse(app.t)})`, 'center', 700);
    }
  }
  function drawEditor(app, dt) {
    const E = app.editor, L = E.level, t = app.t;
    L.world = E.world;
    drawScene(L, null, dt, t, { dim: -0.2, focus: 16 });
    g.setTransform(ts, 0, 0, ts, 0, 0);
    // grid
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1 / ts;
    g.beginPath();
    for (let c = 1; c < COLS; c++) { g.moveTo(c, 1); g.lineTo(c, ROWS); }
    for (let r = 1; r < ROWS; r++) { g.moveTo(0, r); g.lineTo(COLS, r); }
    g.stroke();
    // what can't be seen in the art: bramble knots' kind, wind is none here
    for (const [k, kn] of Object.entries(L.knots)) label(k.toUpperCase(), kn.x * ts, (kn.y - 0.7) * ts, 20, '#ffb0b0', 700, 'center');
    // cursor and hover
    const cur = E.cur, hov = E.hover;
    g.strokeStyle = `rgba(255,255,255,${pulse(t, 6)})`; g.lineWidth = 3 / ts;
    g.strokeRect(cur.c + 0.04, cur.r + 0.04, 0.92, 0.92);
    if (hov && hov.r > 0) { g.strokeStyle = 'rgba(160,230,255,0.6)'; g.strokeRect(hov.c + 0.04, hov.r + 0.04, 0.92, 0.92); }
    // toolbar on row 0
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = 'rgba(8,10,30,0.88)'; g.fillRect(0, 0, cw, ts);
    BRUSHES.forEach((b, i) => {
      const x = i * ts, on = i === E.brush;
      if (on) { g.fillStyle = 'rgba(160,230,255,0.25)'; g.fillRect(x, 0, ts, ts); }
      brushIcon(b, x, 0, ts, E.world, t);
      if (on) { g.strokeStyle = '#ffffff'; g.lineWidth = 2 * u; g.strokeRect(x + 1, 1, ts - 2, ts - 2); }
    });
    const bl = { world: WORLDS[E.world].name.split(' ')[0].toUpperCase(), slot: 'SLOT ' + (E.slot + 1), test: '▶ TEST', exit: 'EXIT' };
    for (const b of BUTTONS) {
      g.fillStyle = b.id === 'test' ? 'rgba(120,220,160,0.25)' : 'rgba(255,255,255,0.08)';
      g.beginPath(); g.roundRect(b.c * ts + 3 * u, 6 * u, b.w * ts - 6 * u, ts - 12 * u, 10 * u); g.fill();
      label(bl[b.id], (b.c + b.w / 2) * ts, ts * 0.64, 18, '#ffffff', 700, 'center', 1);
    }
    // status line
    const name = BRUSH_NAMES[BRUSHES[E.brush]];
    glass(20 * u, ch - 70 * u, cw - 40 * u, 54 * u, 18, 0.6);
    label(name.toUpperCase(), 44 * u, ch - 34 * u, 20, GOLD, 700, 'left', 2);
    if (E.msg) label(E.msg.text, cw / 2, ch - 34 * u, 22, '#ffb0b0', 700, 'center', 1);
    else prompt(app.input, 'CLICK PAINTS · RIGHT CLICK ERASES   {pick} CURSOR  {start} PAINT  {edit} BRUSH  {restart} TEST  {back} EXIT', cw - 44 * u, ch - 43 * u, 17, 'rgba(255,255,255,0.7)', 'right');
  }
  function brushIcon(b, x, y, s, world, t) {
    const Z = PAL[world];
    g.save(); g.translate(x, y); g.scale(s, s);
    g.beginPath(); g.rect(0.05, 0.05, 0.9, 0.9); g.clip();
    switch (b) {
      case '.': g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 0.06; g.beginPath(); g.moveTo(0.25, 0.25); g.lineTo(0.75, 0.75); g.moveTo(0.75, 0.25); g.lineTo(0.25, 0.75); g.stroke(); break;
      case '#': g.fillStyle = Z.earth[2]; g.beginPath(); g.roundRect(0.12, 0.2, 0.76, 0.7, 0.12); g.fill(); g.fillStyle = Z.moss[1]; g.fillRect(0.12, 0.18, 0.76, 0.14); break;
      case '=': case '+': g.fillStyle = Z.bark[1]; g.beginPath(); g.roundRect(0.08, 0.4, 0.84, 0.2, 0.1); g.fill(); if (b === '+') { g.fillStyle = Z.vine[1]; g.fillRect(0.44, 0.1, 0.12, 0.8); } break;
      case 'H': g.fillStyle = Z.vine[1]; g.fillRect(0.44, 0.08, 0.12, 0.84); g.fillStyle = Z.leaf[1]; g.beginPath(); g.ellipse(0.62, 0.4, 0.14, 0.06, -0.5, 0, TAU); g.fill(); break;
      case '-': g.strokeStyle = Z.vine[1]; g.lineWidth = 0.1; g.beginPath(); g.moveTo(0.08, 0.3); g.quadraticCurveTo(0.5, 0.45, 0.92, 0.3); g.stroke(); break;
      case 'T': drawToadstool(g, -0.0, -0.05, 0, t); break;
      case '^': g.fillStyle = Z.thorn[1]; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(0.12 + i * 0.2, 0.9); g.lineTo(0.22 + i * 0.2, 0.35); g.lineTo(0.32 + i * 0.2, 0.9); g.fill(); } break;
      case '~': g.fillStyle = Z.water[1]; g.fillRect(0.08, 0.35, 0.84, 0.6); g.fillStyle = Z.water[2]; g.fillRect(0.08, 0.35, 0.84, 0.06); break;
      case '<': case '>': g.fillStyle = Z.earth[1]; g.fillRect(0.08, 0.4, 0.84, 0.5); g.fillStyle = Z.water[1]; g.fillRect(0.08, 0.3, 0.84, 0.14); label(b === '<' ? '◀' : '▶', 0, 0, 1, '#fff'); g.fillStyle = '#fff'; g.beginPath(); if (b === '<') { g.moveTo(0.3, 0.37); g.lineTo(0.5, 0.25); g.lineTo(0.5, 0.49); } else { g.moveTo(0.7, 0.37); g.lineTo(0.5, 0.25); g.lineTo(0.5, 0.49); } g.fill(); break;
      case 'x': drawLeafPlatform(g, Z, 0, 0.35, 0, t, 0); break;
      case 'o': drawBerry(g, Z, 0.5, 0.55, t, 1); break;
      case '*': drawFirefly(g, 0.55, 0.5, t, 0); break;
      case 'P': drawDew(g, { x: 0.15, y: 0.05, w: 0.7, h: 0.85, vx: 0, vy: 0, mode: 'ground', face: 1, landT: 1, runT: 0 }, t); break;
      case 'D': g.scale(0.6, 0.6); drawBloom(g, Z, 0.83, 1.5, t, 1, 0); break;
      default: drawBurr(g, ['chase', 'patrol', 'hop', 'chase'][b.charCodeAt(0) - 97], 0.5, 0.95, { t, scale: 0.85 }); label(b.toUpperCase(), 0.12, 0.35, 1, '#fff'); break;
    }
    g.restore();
    if (b >= 'a' && b <= 'd') label(b.toUpperCase(), x + s * 0.18, y + s * 0.42, 16, '#ffd0d0', 700, 'center');
  }

  let lastT = performance.now();
  function draw(app) {
    lastApp = app;
    const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    stepParts(dt);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    const s = app.state, sim = app.sim;
    if (s === 'title') drawTitle(app, dt);
    else if (s === 'select') drawSelect(app, dt);
    else if (s === 'ending') drawEnding(app, dt);
    else if (s === 'editor') drawEditor(app, dt);
    else if (sim.L) {
      drawScene(sim.L, sim.s, dt, app.t);
      drawHud(app);
      if (s === 'ready') drawReady(app);
      else if (s === 'pause') drawPause(app);
      else if (s === 'clear') drawClear(app);
      else if (s === 'over') drawOver(app);
    }
    if (app.fade > 0) shade(Math.min(1, app.fade), '0,0,0');
  }

  return {
    draw,
    events,
    stage() { parts = []; drift = []; squash.clear(); shake = 0; flash = 0; },
    // touch picks: which stage tile or title entry is under a canvas point
    tileAt(x, y) {
      for (let i = 0; i < STAGES.length; i++) { const r = selectRect(i); if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h + 40 * u) return i; }
      return null;
    },
    menuAt(x, y) {
      const m = lastApp ? menuRects(lastApp) : [];
      const i = m.findIndex(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
      return i >= 0 ? i : null;
    },
    get world() { return curWorld; },
    destroy() { destroyed = true; unfit(); },
  };
}
export { FOE_COL };
