// The HD renderer: Cinder side-on at the window's own resolution, in the largest 16:9 box.
// A painted backdrop per scene in parallax layers (cached per theme and size), the floor, the
// lanterns and their flicker, drop gates, the archer on the wall and darts, then the figures:
// skeletal rigs (rig.js) posed from each fighter's move (the rig editor's, rig-poses.js; with
// ?rig=off, or where it has none, the hand-made poses.js), cross-faded whenever the move
// changes, with sash tails, hair ties and coats that trail behind. Hits throw sparks and ink
// and shake the view. It only reads `app` and `sim.s`.
//
//   const view = createRenderer(canvas, app);
//   view.events(sim.events, sim); view.draw(app); view.menuAt(x, y) → index | null
import { fitWide } from '@nostalgia/game/runtime';
import { blendFor, KNEEL, lerpPose, poseFor as handPose } from './poses.js';
import { rigPoseFor } from './rig-poses.js';
import { anchors, drawFigure, palette, ribbon, SIZE, solve, TRAIL } from './rig.js';
import { buildLayers, clamp, drawFloor, drawLamp, drawMist, drawShine, drawWeather, hash, lampsIn, makeWeather, mix, TAU, THEMES } from './scenery.js';
import { banner, drawHud, drawTouch, label, nameCard, INK, DIM, EMBER, HEAD, RED, pad6 } from './hud.js';
import { drawScreens, menuRects } from './screens.js';

const VIEW = 10; // metres across the screen
const H_AT = { high: 1.5, mid: 1.1, low: 0.5 }; // where blows and darts land
const GATE_H = 3.2; // the drop gates' lintel
const ease = q => q * q * (3 - 2 * q);

// ?rig=off draws the hand-made poses, to compare.
const RIG = typeof location === 'undefined' || new URLSearchParams(location.search).get('rig') !== 'off';
const poseFor = (f, kind, ctx) => (RIG && rigPoseFor(f, kind, ctx)) || handPose(f, kind, ctx);

export function createRenderer(cv, app0) {
  const g = cv.getContext('2d');
  const ui = { g, cw: 1, ch: 1, u: 1, P: 1, GY: 1 };
  let L = null, layerKey = '', destroyed = false, lastApp = app0 ?? null;
  const weather = makeWeather(7);

  function fit(w, h) {
    ui.cw = w; ui.ch = h; ui.u = h / 1080; ui.P = w / VIEW; ui.GY = Math.round(h * 0.8);
    layerKey = '';
  }
  const unfit = fitWide(cv, { onFit: fit });
  void document.fonts?.ready.then(() => { if (!destroyed && lastApp) draw(lastApp); });
  function useTheme(name) {
    const key = name + ui.cw + 'x' + ui.ch;
    if (key !== layerKey) { layerKey = key; L = buildLayers(name, ui.cw, ui.ch, ui.P, ui.GY); pals.clear(); }
    return L;
  }
  const themeOf = (sim, s) => sim?.scenes?.[s?.scene]?.theme ?? ['dusk', 'gate', 'court', 'hall', 'stair', 'throne', 'garden'][s?.scene ?? 0] ?? 'dusk';

  // ---------- per-figure memory: the last pose (for cross-fades), trailing cloth, the coat ----------
  const mems = new Map(), pals = new Map();
  const palOf = (kind, flash) => {
    const q = Math.round(clamp(flash, 0, 1) * 4) / 4, key = kind + q;
    let p = pals.get(key);
    if (!p) { p = palette(kind, L.th, q * 0.75); pals.set(key, p); }
    return p;
  };
  function mem(id) {
    let m = mems.get(id);
    if (!m) { m = { move: null, moveT: 0, from: null, last: null, bd: 0.1, chains: {}, coat: 0, coatV: 0, px: null, ph: 0, hitH: 'high' }; mems.set(id, m); }
    return m;
  }

  // ---------- trailing cloth: short verlet chains in world metres ----------
  const CHAIN = { sash: { n: 8, seg: 0.085, r0: 0.042, r1: 0.024 }, hair: { n: 5, seg: 0.06, r0: 0.024, r1: 0.01 } };
  // cloth ripples along its length, more toward the free end
  const flutter = (pts, t, k, amp = 0.014) => pts.map((p, i) => [p[0], p[1] + Math.sin(t * 8 - i * 1.1 + k) * amp * (i / pts.length)]);
  function chainStep(ch, anchor, face, dt, wind) {
    const { pts, prev, seg } = ch;
    pts[0] = anchor; prev[0] = anchor;
    const steps = dt > 0 ? Math.ceil(dt / (1 / 120)) : 0, h = steps ? dt / steps : 0;
    for (let s = 0; s < steps; s++) {
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i], q = prev[i], vx = (p[0] - q[0]) * 0.96, vy = (p[1] - q[1]) * 0.96;
        prev[i] = p;
        pts[i] = [p[0] + vx + wind * h * h, p[1] + vy - 4.2 * h * h];
      }
      for (let k = 0; k < 2; k++) for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1e-5, f = seg / d;
        pts[i] = [a[0] + dx * f, Math.max(0.015, a[1] + dy * f)];
      }
    }
    void face;
  }
  function chainFor(m, name, anchor, face, wind, cfg) {
    let ch = m.chains[name];
    if (!ch || Math.hypot(ch.pts[0][0] - anchor[0], ch.pts[0][1] - anchor[1]) > 1.2) {
      // hang it behind and let it settle, so a first (or a still) frame looks at rest
      const pts = []; for (let i = 0; i < cfg.n; i++) pts.push([anchor[0] - face * i * cfg.seg * 0.5, anchor[1] - i * cfg.seg * 0.85]);
      ch = m.chains[name] = { pts, prev: pts.map(p => [...p]), seg: cfg.seg };
      for (let k = 0; k < 40; k++) chainStep(ch, anchor, face, 1 / 60, wind);
    }
    return ch;
  }

  // ---------- effects: world particles (metres), a shake, a flash ----------
  let parts = [], later = [], shake = 0, flash = 0, flashCol = '255,240,220', regen = 0, wipe = 0;
  const rand = Math.random;
  function spark(x, y, n, col, sp = 4, dir = 0) {
    for (let i = 0; i < n; i++) { const a = rand() * TAU, v = sp * (0.5 + rand() * 0.9); parts.push({ k: 'spark', x, y, vx: Math.cos(a) * v + dir * sp * 0.7, vy: Math.sin(a) * v + 0.8, life: 0.12 + rand() * 0.2, max: 0.32, c: col[i % col.length], r: 0.012 + rand() * 0.014 }); }
  }
  function ink(x, y, n, dir, sp = 2.5) {
    for (let i = 0; i < n; i++) { const a = (rand() - 0.5) * 1.6 + (dir < 0 ? Math.PI : 0), v = sp * (0.3 + rand()); parts.push({ k: 'ink', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 1.2, life: 1.4, max: 1.4, r: 0.012 + rand() * 0.028, land: false }); }
  }
  function dust(x, n, spread = 0.6, y = 0.05, big = 1) {
    for (let i = 0; i < n; i++) parts.push({ k: 'dust', x: x + (rand() - 0.5) * spread, y: y + rand() * 0.08, vx: (rand() - 0.5) * 1.8 * big, vy: 0.1 + rand() * 0.35, life: 0.7 + rand() * 0.6, max: 1.3, r: (0.12 + rand() * 0.16) * big });
  }
  const ring = (x, y, col = '255,240,220') => parts.push({ k: 'ring', x, y, life: 0.16, max: 0.16, c: col });
  const fighter = (s, id) => (id === 'hero' ? s.hero : s.foes.find(f => f.id === id));
  function events(list, sim) {
    const s = sim?.s;
    if (!s) return;
    for (const e of list) {
      const f = e.who != null ? fighter(s, e.who) : null, y = H_AT[e.h] ?? 1.1;
      switch (e.k) {
        case 'intro': mems.clear(); parts = []; later = []; break;
        case 'hit': {
          const dir = f ? -f.face : 1;
          spark(e.x, y, 14, ['#fff6d0', '#ffb050', '#ff7a2a'], 4.5, dir);
          ink(e.x, y, 6 + (e.dmg | 0) * 3, dir);
          ring(e.x, y);
          shake = Math.max(shake, 0.14 + 0.06 * (e.dmg | 0)); flash = Math.max(flash, 0.12); flashCol = '255,236,210';
          if (f) mem(f.id).hitH = e.h ?? 'high';
          break;
        }
        case 'block': spark(e.x, y, 8, ['#ffffff', '#d8e6ff'], 3, f ? -f.face : 1); ring(e.x, y, '210,230,255'); shake = Math.max(shake, 0.05); break;
        case 'ko': { shake = Math.max(shake, 0.2); const x = e.x - (f?.face ?? 1) * 0.85; later.push({ t: 0.75, fn: () => { dust(x, 10, 1.2, 0.05, 1.2); shake = Math.max(shake, 0.12); } }); break; }
        case 'gateShake': dust(e.x, 4, 1.2, GATE_H - 0.1, 0.6); shake = Math.max(shake, 0.06); break;
        case 'gateSlam': dust(e.x - 0.5, 10, 0.6, 0.05, 1.3); dust(e.x + 0.5, 10, 0.6, 0.05, 1.3); shake = Math.max(shake, 0.5); break;
        case 'crush': ink(e.x, 0.8, 18, 1, 3.5); ink(e.x, 0.8, 18, -1, 3.5); flash = 0.3; flashCol = '120,20,10'; break;
        case 'dartHit': { const h = s.hero; spark(e.x, 1.2, 10, ['#fff6d0', '#ff9a44'], 3, h ? -h.face : 1); ink(e.x, 1.2, 6, h ? -h.face : 1); shake = Math.max(shake, 0.15); break; }
        case 'dartBlock': spark(e.x, 1.3, 9, ['#ffffff', '#ffd090'], 3.5, s.hero ? s.hero.face : 1); ring(e.x, 1.3, '255,220,170'); break;
        case 'step': if (f?.stance === 'run') dust(e.x, 1, 0.1, 0.03, 0.4); break;
        case 'stance': if (f) dust(f.x, 2, 0.4, 0.03, 0.5); break;
        case 'regen': regen = 1; break;
        case 'die': shake = Math.max(shake, 0.25); break;
        case 'win': flash = 0.5; flashCol = '255,230,190'; break;
      }
    }
  }
  function stepFx(dt) {
    for (const p of parts) {
      p.life -= dt;
      if (p.k === 'spark') { p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 14 * dt; p.vx *= 0.94; }
      else if (p.k === 'ink' && !p.land) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 11 * dt; if (p.y <= 0.01) { p.y = 0.005; p.land = true; p.life = Math.min(p.life, 1.2); } }
      else if (p.k === 'dust') { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.r += dt * 0.18; }
    }
    parts = parts.filter(p => p.life > 0);
    for (const l of later) { l.t -= dt; if (l.t <= 0) l.fn(); }
    later = later.filter(l => l.t > 0);
    shake = Math.max(0, shake - dt * 1.6); flash = Math.max(0, flash - dt * 2); regen = Math.max(0, regen - dt * 0.8);
  }

  // ---------- the world ----------
  let X0 = 0, SY = 0; // the world → screen offset in px: sx = X0 + x·P, sy = GY − y·P (+ shake)
  const SX = x => X0 + x * ui.P;
  const world = () => g.setTransform(ui.P, 0, 0, -ui.P, X0, ui.GY + SY);
  function drawBack(cam) {
    const { cw, P } = ui, th = L.th;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(L.sky, 0, 0);
    const strip = (img, par, top) => { const W = L.W, o = (((-cam * P * par + (shakeX * 0.3)) % W) + W) % W; g.drawImage(img, o - W, top); if (o < cw) g.drawImage(img, o, top); };
    strip(L.far, th.indoor ? 0.25 : 0.05, L.farTop);
    strip(L.mid, th.indoor ? 0.55 : 0.28, L.midTop);

  }
  let shakeX = 0;
  function drawLamps(cam, t, front) {
    const { cw, P, GY, u } = ui, half = cw / P / 2 + 2;
    for (const l of lampsIn(L, cam - half, cam + half)) {
      // all stand on the floor line, behind the fighters
      if (front) drawShine(g, L, SX(l.x), GY + SY, P, t, l.k);
      else drawLamp(g, L, SX(l.x), GY + SY, L.th.lamps.kind === 'stone' ? P * 0.9 : P, t, l.k, u);
    }
  }
  function drawGateFrame(gt) {
    const { P } = ui, x = SX(gt.x), top = ui.GY + SY - GATE_H * P, w = 0.85 * P;
    const wood = mix(L.th.ground[0], '#120806', 0.55);
    g.fillStyle = wood;
    g.fillRect(x - w - 0.18 * P, top - 0.25 * P, 0.22 * P, GATE_H * P + 0.25 * P);
    g.fillRect(x + w - 0.04 * P, top - 0.25 * P, 0.22 * P, GATE_H * P + 0.25 * P);
    g.fillStyle = 'rgba(255,200,150,0.07)'; g.fillRect(x - w - 0.18 * P, top - 0.25 * P, 0.05 * P, GATE_H * P + 0.25 * P);
  }
  function drawGate(gt, t) {
    const { P } = ui, jx = gt.shake > 0 ? (hash((t * 60) | 0, 3) - 0.5) * gt.shake * 0.06 * P : 0;
    const x = SX(gt.x) + jx, top = ui.GY + SY - GATE_H * P, w = 0.78 * P, bottom = ui.GY + SY - (1 - clamp(gt.y, 0, 1)) * (GATE_H - 0.15) * P;
    // the portcullis: iron-shod timbers dropping out of the lintel
    if (bottom > top) {
      g.save(); g.beginPath(); g.rect(x - w - 2, top, w * 2 + 4, ui.GY + SY - top + 2); g.clip();
      const iron = '#2a2422', hi = 'rgba(255,190,140,0.16)';
      for (let k = -3; k <= 3; k++) {
        const bx = x + k * w / 3.3;
        g.fillStyle = iron; g.fillRect(bx - 0.045 * P, top - P * 3, 0.09 * P, bottom - top + P * 3);
        g.fillStyle = hi; g.fillRect(bx - 0.045 * P, top - P * 3, 0.02 * P, bottom - top + P * 3);
        g.fillStyle = iron; g.beginPath(); g.moveTo(bx - 0.06 * P, bottom); g.lineTo(bx, bottom + 0.16 * P); g.lineTo(bx + 0.06 * P, bottom); g.fill();
      }
      g.fillStyle = '#3a302c';
      for (let y = bottom - 0.3 * P; y > top - P * 3; y -= 0.55 * P) g.fillRect(x - w, y - 0.04 * P, w * 2, 0.08 * P);
      g.restore();
    }
    // the lintel over it
    const wood = mix(L.th.ground[0], '#120806', 0.5);
    g.fillStyle = wood; g.fillRect(x - w - 0.3 * P, top - 0.35 * P, w * 2 + 0.6 * P, 0.38 * P);
    g.fillStyle = 'rgba(255,200,150,0.1)'; g.fillRect(x - w - 0.3 * P, top - 0.35 * P, w * 2 + 0.6 * P, 0.05 * P);
  }
  // the archer at the court's far end, behind a waist-high parapet, drawing on Wren: a crouch
  // for a mid dart, standing for a high one, and the dart's ember tip glowing as the tell
  function drawArcher(s, t) {
    const a = s.archer, { P } = ui;
    if (!a) return;
    const x = SX(a.x), base = ui.GY + SY, d = clamp(a.draw ?? 0, 0, 1), face = s.hero && s.hero.x > a.x ? 1 : -1;
    const high = (a.h ?? 'high') === 'high', aim = H_AT[high ? 'high' : 'mid'];
    const pose = high
      ? { hx: 0, hy: 0.94, t: -2 - d * 3, n: -4, la: 90, le: 0, ra: 86, re: 20 + d * 130, lx: 0.16, ly: 0.08, rx: -0.2, ry: 0.08, lf: 0, rf: 0, op: 0 }
      : { hx: 0, hy: 0.58, t: 18, n: -14, la: 108, le: 0, ra: 104, re: 20 + d * 130, lx: 0.3, ly: 0.08, rx: -0.34, ry: 0.08, lf: 0, rf: 40, op: 0 };
    const J = solve(pose), sz = SIZE.footman, hw = J.la.w, sw = J.ra.w;
    // shift the figure so its bow hand sits on the dart's flight line
    const oy = aim - hw[1] * sz;
    g.setTransform(face * P * sz, 0, 0, -P * sz, x, base - oy * P);
    drawFigure(g, J, 'footman', palOf('footman', 0), { light: [L.th.light * face * 0.6, 0.8], t });
    const r = 0.6, bend = 0.12 + d * 0.14;
    g.strokeStyle = '#3a2412'; g.lineWidth = 0.035;
    g.beginPath(); g.moveTo(hw[0] - bend * 0.3, hw[1] + r); g.quadraticCurveTo(hw[0] + bend * 2.2, hw[1], hw[0] - bend * 0.3, hw[1] - r); g.stroke();
    g.strokeStyle = 'rgba(240,230,210,0.8)'; g.lineWidth = 0.01;
    g.beginPath(); g.moveTo(hw[0] - bend * 0.3, hw[1] + r); g.lineTo(sw[0], sw[1]); g.lineTo(hw[0] - bend * 0.3, hw[1] - r); g.stroke();
    if (d > 0.05) {
      g.strokeStyle = '#d8c8a8'; g.lineWidth = 0.018; g.beginPath(); g.moveTo(sw[0], sw[1]); g.lineTo(hw[0] + 0.16, hw[1]); g.stroke();
      const glow = d > 0.6 ? 0.6 + 0.4 * Math.sin(t * 30) : d;
      g.fillStyle = `rgba(255,${(150 + glow * 90) | 0},60,${0.4 + glow * 0.6})`; g.beginPath(); g.arc(hw[0] + 0.18, hw[1], 0.025 + glow * 0.04, 0, TAU); g.fill();
      if (d > 0.6) { g.fillStyle = `rgba(255,180,80,${0.22 * glow})`; g.beginPath(); g.arc(hw[0] + 0.18, hw[1], 0.28, 0, TAU); g.fill(); }
    }
    // the parapet in front of its legs
    g.setTransform(1, 0, 0, 1, 0, 0);
    const stone = mix(L.th.ground[0], L.th.sky[2], 0.35), w0 = x - 1.6 * P, w1 = x + 1.6 * P, top = base - 0.95 * P;
    g.fillStyle = stone; g.fillRect(w0, top, w1 - w0, base - top);
    g.fillStyle = mix(stone, '#ffffff', 0.12); g.fillRect(w0 - 0.08 * P, top - 0.1 * P, w1 - w0 + 0.16 * P, 0.12 * P);
    g.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 1; k < 4; k++) g.fillRect(w0 + (k * (w1 - w0)) / 4, top, 2 * ui.u, base - top);
  }
  function drawDarts(s) {
    world();
    for (const d of s.darts ?? []) {
      const y = H_AT[d.h] ?? 1.3, dir = Math.sign(d.vx) || -1;
      const gr = g.createLinearGradient(d.x, 0, d.x - dir * 1.4, 0);
      gr.addColorStop(0, 'rgba(255,200,120,0.55)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = gr; g.fillRect(Math.min(d.x, d.x - dir * 1.4), y - 0.012, 1.4, 0.024);
      g.strokeStyle = '#2a1a10'; g.lineWidth = 0.022; g.beginPath(); g.moveTo(d.x, y); g.lineTo(d.x - dir * 0.36, y); g.stroke();
      g.fillStyle = '#d8d0c0'; g.beginPath(); g.moveTo(d.x - dir * 0.3, y); g.lineTo(d.x - dir * 0.4, y + 0.045); g.lineTo(d.x - dir * 0.37, y); g.lineTo(d.x - dir * 0.4, y - 0.045); g.fill();
      g.fillStyle = '#ffb050'; g.beginPath(); g.moveTo(d.x + dir * 0.06, y); g.lineTo(d.x, y + 0.02); g.lineTo(d.x, y - 0.02); g.fill();
    }
  }
  function drawParts() {
    world();
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.k === 'spark') { g.strokeStyle = p.c; g.globalAlpha = a; g.lineWidth = p.r; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); g.stroke(); }
      else if (p.k === 'ink') { g.globalAlpha = a; g.fillStyle = '#120806'; g.beginPath(); if (p.land) g.ellipse(p.x, p.y, p.r * 2.2, p.r * 0.5, 0, 0, TAU); else g.arc(p.x, p.y, p.r, 0, TAU); g.fill(); }
      else if (p.k === 'dust') { g.globalAlpha = a * 0.3; const r = p.r * 2.2; g.drawImage(L.dust, p.x - r, p.y - r * 0.55, r * 2, r * 1.1); }
      else if (p.k === 'ring') { const r = 0.12 + (1 - a) * 0.35; g.globalAlpha = a * 0.9; g.drawImage(L.glow, p.x - r, p.y - r, r * 2, r * 2); }
    }
    g.globalAlpha = 1;
  }
  // a dark foreground silhouette now and then, nearer than the path (parallax > 1)
  function drawFore(cam, t0 = 0) {
    const { cw, ch, P, u } = ui, par = 1.4, th = L.th, step = th.indoor ? 26 : 14;
    const col = th.indoor ? 'rgba(8,3,2,0.92)' : 'rgba(10,5,8,0.9)';
    const lo = Math.floor((cam - cw / P) / step), hi = Math.ceil((cam + cw / P) / step);
    for (let k = lo; k <= hi; k++) {
      const wx = k * step + hash(k, 41) * 6, sx = cw / 2 + (wx - cam) * P * par + shakeX;
      if (sx < -300 * u || sx > cw + 300 * u) continue;
      g.fillStyle = col;
      if (th.indoor) { const gr = g.createLinearGradient(sx - 0.2 * P, 0, sx + 0.2 * P, 0); gr.addColorStop(0, 'rgba(8,3,2,0)'); gr.addColorStop(0.3, 'rgba(8,3,2,0.85)'); gr.addColorStop(0.7, 'rgba(8,3,2,0.85)'); gr.addColorStop(1, 'rgba(8,3,2,0)'); g.fillStyle = gr; g.fillRect(sx - 0.2 * P, 0, 0.4 * P, ch); }
      else { // tufts of near grass rising from the bottom edge, swaying a little
        g.beginPath();
        for (let j = 0; j < 7; j++) {
          const bx = sx - 0.5 * P + j * 0.16 * P, by = ch + 4 * u, h = (0.3 + hash(k, j) * 0.4) * P * (1 - Math.abs(j - 3) * 0.12), lean = (hash(j, k) - 0.4) * 0.3 * P + Math.sin(t0 * 1.3 + j) * 0.03 * P;
          g.moveTo(bx - 0.035 * P, by); g.quadraticCurveTo(bx + lean * 0.3, by - h * 0.6, bx + lean, by - h); g.quadraticCurveTo(bx + lean * 0.3 + 0.02 * P, by - h * 0.5, bx + 0.04 * P, by);
        }
        g.fill();
      }
    }
  }

  // ---------- the figures ----------
  function figure(f, kind, t, dt, { pose: forced = null } = {}) {
    const m = mem(f.id ?? kind), { P } = ui, th = L.th;
    // the move it's in, and a cross-fade from the last pose drawn when the move changes
    let target;
    if (forced) target = forced;
    else {
      let ff = f;
      // the guard shuffle and the run follow the feet: stepping back plays the cycle backwards
      if (m.px != null && (f.move === 'walk' || f.move === 'run')) {
        let dp = (f.phase ?? 0) - m.ph; dp -= Math.round(dp);
        const dx = (f.x - m.px) * f.face;
        if ((dx < -1e-4 && dp > 0) || (dx > 1e-4 && dp < 0)) m.flip = true; else if (Math.abs(dx) > 1e-4) m.flip = false;
        if (m.flip) ff = { ...f, phase: 1 - (f.phase ?? 0) };
      }
      target = f.down && f.move !== 'ko' ? poseFor({ ...f, move: 'ko', moveT: 99 }, kind, { t, hitH: m.hitH }) : poseFor(ff, kind, { t, hitH: m.hitH });
    }
    const mv = forced ? 'forced' : f.move, T = f.moveT ?? 0;
    if (mv !== m.move || T < m.moveT - 1e-4) { m.from = m.last; m.move = mv; m.bd = blendFor(mv, f); }
    m.moveT = T;
    const pose = m.from && T < m.bd ? lerpPose(m.from, target, ease(clamp(T / m.bd, 0, 1))) : target;
    m.last = { ...pose };
    // the coat swings behind as it moves
    const vx = m.px != null && dt > 0 ? clamp((f.x - m.px) / dt, -6, 6) : 0;
    m.px = f.x; m.ph = f.phase ?? 0;
    if (dt > 0) { const goal = clamp(vx * f.face * 0.07, -0.18, 0.22) + Math.sin(t * 1.3 + f.x) * 0.02; m.coatV += ((goal - m.coat) * 70 - m.coatV * 9) * dt; m.coat += m.coatV * dt; }
    const J = solve(pose), sz = SIZE[kind] ?? 1, face = f.face || 1;
    // trailing cloth hangs behind the figure
    const an = anchors(J, kind), trail = TRAIL[kind], pal = palOf(kind, f.flash > 0 ? Math.min(1, f.flash * 5) : 0);
    if (trail && an.sash) {
      const wind = -1.6 * face + Math.sin(t * 0.9) * 0.8 - vx * 0.8;
      const toW = p => [f.x + face * p[0] * sz, p[1] * sz];
      world();
      const sash = chainFor(m, 'sash', toW(an.sash), face, wind, CHAIN.sash); chainStep(sash, toW(an.sash), face, dt, wind);
      ribbon(g, flutter(sash.pts, t, 0), CHAIN.sash.r0 * sz, CHAIN.sash.r1 * sz, pal[trail[0]].d);
      if (kind === 'hero') { // a second, shorter tail beside it
        const p2 = flutter(sash.pts.slice(0, 6).map((p, i) => [p[0] + face * 0.014 * i, p[1] + 0.016 * i]), t, 2);
        ribbon(g, p2, CHAIN.sash.r0 * sz * 0.85, CHAIN.sash.r1 * sz, pal.sash.b);
      }
      if (an.hair) { const hair = chainFor(m, 'hair', toW(an.hair), face, wind, CHAIN.hair); chainStep(hair, toW(an.hair), face, dt, wind); ribbon(g, flutter(hair.pts, t, 4, 0.01), CHAIN.hair.r0 * sz, CHAIN.hair.r1 * sz, pal.sash.b); }
    }
    g.setTransform(face * P * sz, 0, 0, -P * sz, SX(f.x), ui.GY + SY);
    drawFigure(g, J, kind, pal, { light: [th.light * face * 0.6, 0.8], coat: m.coat, t });
    g.setTransform(1, 0, 0, 1, 0, 0);
    return J;
  }
  function shadow(x, J, sz, face, lying) {
    const hx = x + face * J.H[0] * sz, w = lying ? 1.0 : 0.35 + Math.abs(J.ll.a[0] - J.rl.a[0]) * 0.5 * sz, air = Math.min(J.ll.a[1], J.rl.a[1]);
    world();
    g.fillStyle = `rgba(0,0,0,${0.32 * clamp(1 - (air - 0.08) * 1.5, 0.3, 1)})`;
    g.beginPath(); g.ellipse(lying ? hx - face * 0.4 : hx, 0.0, w, 0.07, 0, 0, TAU); g.fill();
  }
  const kindOf = f => (f.id === 'hero' ? 'hero' : f.kind ?? 'footman');
  function drawCast(s, t, dt) {
    const list = [];
    // every foe in view: one walking in or bowing isn't `active` yet, and waiting ones stand off-screen
    for (const f of s.foes ?? []) if (f.ai !== 'wait') list.push(f);
    list.sort((a, b) => (b.down ? 1 : 0) - (a.down ? 1 : 0)); // the fallen behind
    if (s.teacher) list.unshift({ ...s.teacher, id: 'teacher', kind: 'teacher', stance: 'run', teacher: true });
    if (s.hero) list.push(s.hero);
    const half = ui.cw / ui.P / 2 + 2;
    for (const f of list) {
      if (Math.abs(f.x - s.cam) > half + 1.5) continue;
      const kind = f.teacher ? 'teacher' : kindOf(f), m = mem(f.id);
      let forced = null;
      if (f.teacher && !f.freed) { const b = Math.sin(t * 1.4) * 0.01; forced = { ...KNEEL, hy: KNEEL.hy + b, t: KNEEL.t + b * 80 }; }
      // shadow from the pose last drawn (a frame behind, which can't be seen)
      if (m.last) shadow(f.x, solve(m.last), SIZE[kind] ?? 1, f.face || 1, f.down);
      figure(f, kind, t, dt, { pose: forced });
    }
  }
  function drawWorld(sim, s, t, dt) {
    useTheme(themeOf(sim, s));
    const cam = s.cam ?? s.hero?.x ?? 0;
    shakeX = shake > 0 ? (rand() - 0.5) * shake * 34 * ui.u : 0;
    SY = shake > 0 ? (rand() - 0.5) * shake * 24 * ui.u : 0;
    X0 = ui.cw / 2 - cam * ui.P + shakeX;
    drawBack(cam);
    drawFloor(g, L, ui.cw, ui.ch, ui.GY + SY, ui.P, cam, t);
    drawLamps(cam, t, true);
    drawLamps(cam, t, false);
    drawArcher(s, t);
    for (const gt of s.gates ?? []) drawGateFrame(gt);
    drawCast(s, t, dt);
    drawDarts(s);
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (const gt of s.gates ?? []) drawGate(gt, t);
    drawParts();
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (!L.th.indoor) drawMist(g, L, ui.cw, ui.ch, ui.GY + ui.ch * 0.12, cam * 1.2, ui.P, t * 1.3);
    drawWeather(g, L, weather, ui.cw, ui.ch, cam, ui.P, t);
    drawFore(cam, t);
  }

  // ---------- frame ----------
  let lastT = performance.now();
  function draw(app) {
    lastApp = app;
    const now = performance.now(), dt = Math.min(1 / 20, (now - lastT) / 1000);
    lastT = now;
    stepFx(dt);
    const sim = app.sim, s = sim?.s, t = app.t ?? 0, st = app.state;
    g.setTransform(1, 0, 0, 1, 0, 0);
    // the title, initials and scores screens draw a world of their own behind them
    if (!app.demo && (st === 'title' || st === 'entry')) {
      drawScreens(ctx, app, t, dt);
    } else if (s) {
      drawWorld(sim, s, s.t ?? t, dt);
      g.setTransform(1, 0, 0, 1, 0, 0);
      const ss = s.status, k = s.statusT ?? 0;
      if (app.demo) label(ui, 'DEMO', ui.cw / 2, ui.ch - 34 * ui.u, 24, Math.floor(t * 2) % 2 ? EMBER : DIM, { font: HEAD, align: 'center', spacing: 6 });
      else {
        drawHud(ui, app, s, t, { regen });
        if (ss === 'intro') nameCard(ui, s.scene, sim.scenes?.[s.scene]?.name ?? '', Math.min(k * 3, (2.2 - k) * 2.5));
        if (ss === 'dead' && k > 0.6) banner(ui, 'FALLEN', s.lives > 0 ? `${s.lives} ${s.lives === 1 ? 'lantern' : 'lanterns'} left` : '', (k - 0.6) * 2.5, RED);
      }
      // scene changes: a fade to dark as Wren walks off, back in as the next scene begins
      wipe = ss === 'clear' ? clamp((k - 0.8) / 0.6, 0, 1) : ss === 'intro' ? clamp(1 - k / 0.5, 0, 1) : 0;
      if (wipe > 0) { g.fillStyle = `rgba(6,2,1,${wipe})`; g.fillRect(0, 0, ui.cw, ui.ch); }
      if (!app.demo) drawScreens(ctx, app, t, dt);
      drawTouch(ui, app);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);

    if (flash > 0) { g.fillStyle = `rgba(${flashCol},${flash * 0.6})`; g.fillRect(0, 0, ui.cw, ui.ch); }
    if (app.fade > 0) { g.fillStyle = `rgba(6,2,1,${app.fade})`; g.fillRect(0, 0, ui.cw, ui.ch); }
  }
  // what the screens module needs from here
  const ctx = { ui, drawWorld, figure, useTheme, get L() { return L; }, mem, THEMES, pad6, INK };
  /** the menu entry a tap at (x, y) (canvas pixels) lands on, on the title or the pause screen */
  function menuAt(x, y) {
    const i = menuRects.findIndex(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    return i >= 0 ? menuRects[i].i : null;
  }
  function destroy() { destroyed = true; unfit(); }
  return { draw, events, menuAt, destroy };
}
export { INK };
