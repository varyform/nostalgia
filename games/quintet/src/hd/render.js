// The HD renderer: the board and the app's screens as lit vectors at the window's own resolution,
// 16:9 on a landscape window and 9:16 on a portrait one (see layout.js). The table, the tray and
// its wells are painted once per size into a layer; the glass comes from sprites (marbles.js);
// motes in the lamplight, the marbles' moves, the shatter of a row and the HUD are drawn every
// frame. It only reads state.
//
//   const view = createRenderer(canvas, app);
//   view.events(sim.events, sim);  view.draw(app);  view.hit(x, y, app) → target;  view.cellAt(x, y)
import { fitWide } from '@nostalgia/game/runtime';
import { drawGlyphs, drawPrompt, glyphs, measureGlyphs } from '@nostalgia/input';
import { LETTERS } from '../app.js';
import { CELLS, CLEAR_T, EMPTY, PRISM } from '../sim.js';
import { cellAt, cellX, cellY, inside, layout, letterRect, menuRects, okRect, pauseRects } from './layout.js';
import { GLASS, PRISM_COLS, TAU, canvas, drawPrism, glow, marbleSprites, rgba } from './marbles.js';

const F = "'Jost','Avenir Next','Segoe UI',system-ui,sans-serif", LOGO = "'Fraunces','Georgia',serif";
const TEXT = '#f4e9da', MUTED = 'rgba(244,233,218,0.62)', GOLD = '#e8b866', DANGER = '#ff6a4a', INK = '#0a0709';
const fmt = n => Math.max(0, n | 0).toLocaleString('en-US');
const hash = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const colOf = c => (c === PRISM ? '#ffffff' : GLASS[c].base);
const lightOf = c => (c === PRISM ? '#ffffff' : GLASS[c].light);
const easeOut = k => 1 - (1 - k) ** 3;
const easeInOut = k => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const elastic = k => (k <= 0 ? 0 : k >= 1 ? 1 : 1 + 2 ** (-10 * k) * Math.sin((k * 10 - 0.75) * ((2 * Math.PI) / 3)));
const COMBO = ['', '', 'CROSS', 'TRIPLE', 'QUADRUPLE'];

export function createRenderer(cv, app0) {
  const g = cv.getContext('2d');
  let cw = 1, ch = 1, u = 1, L = layout(false), back = null, vign = null, spr = null, destroyed = false, lastApp = app0;
  let portrait = null, unfit = null;
  function fit(w, h) {
    cw = w; ch = h; L = layout(portrait); u = cw / L.W;
    back = canvas(cw, ch);
    const b = back.getContext('2d');
    b.setTransform(u, 0, 0, u, 0, 0);
    paintBack(b);
    vign = canvas(cw / 2, ch / 2);
    const v = vign.getContext('2d'), gr = v.createRadialGradient(cw / 4, ch / 4, Math.min(cw, ch) * 0.25, cw / 4, ch / 4, Math.max(cw, ch) * 0.36);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.5)');
    v.fillStyle = gr; v.fillRect(0, 0, cw / 2, ch / 2);
    spr = marbleSprites(L.cell * 0.4 * u);
    if (lastApp) draw(lastApp);
  }
  // a landscape window gets the 16:9 frame, an upright phone the 9:16 one
  function refit() {
    const p = innerHeight > innerWidth * 1.05;
    if (p === portrait) return;
    portrait = p;
    unfit?.();
    unfit = fitWide(cv, { ratio: p ? [9, 16] : [16, 9], onFit: fit });
  }
  window.addEventListener('resize', refit);
  void document.fonts?.ready.then(() => { if (!destroyed && lastApp) draw(lastApp); });
  const ref = () => g.setTransform(u, 0, 0, u, 0, 0);

  // ---------- the still layer: table, tray, wells ----------
  function paintBack(b) {
    const { W, H, bx, by, size, cell } = L;
    const bg = b.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1a0f13'); bg.addColorStop(1, '#070407');
    b.fillStyle = bg; b.fillRect(0, 0, W, H);
    // the lamp, up and to the left
    const lx = W * 0.16, ly = -H * 0.06, lamp = b.createRadialGradient(lx, ly, 0, lx, ly, Math.max(W, H) * 0.85);
    lamp.addColorStop(0, 'rgba(255,196,128,0.30)'); lamp.addColorStop(0.45, 'rgba(255,150,90,0.09)'); lamp.addColorStop(1, 'rgba(255,150,90,0)');
    b.fillStyle = lamp; b.fillRect(0, 0, W, H);
    // lacquer sheen on the table
    b.save(); b.globalAlpha = 0.05; b.strokeStyle = '#ffd8b0';
    for (let k = 0; k < 9; k++) { b.lineWidth = 6 + hash(k) * 30; b.beginPath(); b.moveTo(-200 + k * 300, H + 100); b.lineTo(300 + k * 300 + hash(k + 9) * 200, -100); b.stroke(); }
    b.restore();
    // the tray: black lacquer over red-brown wood, a gold inlay, wells for 81 marbles
    const pad = L.pad, fx = bx - pad, fy = by - pad, fs = size + pad * 2;
    b.save();
    b.shadowColor = 'rgba(0,0,0,0.7)'; b.shadowBlur = 70; b.shadowOffsetX = 18; b.shadowOffsetY = 30;
    const wood = b.createLinearGradient(fx, fy, fx + fs, fy + fs);
    wood.addColorStop(0, '#4a2219'); wood.addColorStop(0.5, '#2a120f'); wood.addColorStop(1, '#170909');
    b.fillStyle = wood; b.beginPath(); b.roundRect(fx, fy, fs, fs, 40); b.fill();
    b.restore();
    b.strokeStyle = 'rgba(255,210,160,0.32)'; b.lineWidth = 3; b.beginPath(); b.roundRect(fx + 2, fy + 2, fs - 4, fs - 4, 38); b.stroke();
    const field = b.createRadialGradient(bx + size * 0.25, by + size * 0.2, 0, bx + size * 0.4, by + size * 0.4, size * 0.9);
    field.addColorStop(0, '#24151a'); field.addColorStop(1, '#0b0609');
    b.fillStyle = field; b.beginPath(); b.roundRect(bx - 10, by - 10, size + 20, size + 20, 20); b.fill();
    b.strokeStyle = 'rgba(214,168,94,0.55)'; b.lineWidth = 2.5; b.beginPath(); b.roundRect(bx - 16, by - 16, size + 32, size + 32, 24); b.stroke();
    for (let i = 0; i < CELLS; i++) {
      const x = cellX(L, i), y = cellY(L, i), r = cell * 0.43;
      const w = b.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.1, x, y, r);
      w.addColorStop(0, '#040204'); w.addColorStop(0.75, '#0d070a'); w.addColorStop(1, '#1e1216');
      b.fillStyle = w; b.beginPath(); b.arc(x, y, r, 0, TAU); b.fill();
      // the lit lower rim inside the dish, the dark upper one
      b.lineWidth = 2.5;
      b.strokeStyle = 'rgba(255,200,150,0.16)'; b.beginPath(); b.arc(x, y, r - 2, 0.05 * Math.PI, 0.8 * Math.PI); b.stroke();
      b.strokeStyle = 'rgba(0,0,0,0.6)'; b.beginPath(); b.arc(x, y, r - 2, 1.05 * Math.PI, 1.8 * Math.PI); b.stroke();
      b.strokeStyle = 'rgba(255,220,180,0.07)'; b.lineWidth = 1.5; b.beginPath(); b.arc(x, y, r + 3, 1.1 * Math.PI, 1.75 * Math.PI); b.stroke();
    }
  }

  // ---------- text ----------
  const font = (size, wgt = 500, fam = F, ital = false) => { g.font = `${ital ? 'italic ' : ''}${wgt} ${size}px ${fam}`; };
  const spacing = s => { if ('letterSpacing' in g) g.letterSpacing = s + 'px'; };
  function label(s, x, y, size, col, wgt = 500, align = 'left', sp = 0) {
    font(size, wgt); g.fillStyle = col; g.textAlign = align; g.textBaseline = 'alphabetic'; spacing(sp);
    g.fillText(s, x, y); spacing(0); g.textAlign = 'left';
  }
  function logo(s, x, y, size) {
    font(size, 600, LOGO, true); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const lg = g.createLinearGradient(0, y - size * 0.8, 0, y + size * 0.1);
    lg.addColorStop(0, '#fff6e6'); lg.addColorStop(0.55, '#f1c27a'); lg.addColorStop(1, '#b8743a');
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(s, x + size * 0.03, y + size * 0.05);
    g.fillStyle = lg; g.fillText(s, x, y);
    g.textAlign = 'left';
  }
  const GST = { font: F };
  const prompt = (input, s, x, y, size, col, align = 'left', wgt = 500) =>
    drawPrompt(g, input, s, x, y, { font: `${wgt} ${size}px ${F}`, size: size * 1.3, color: col, align, letterSpacing: 1, style: GST });
  function legendRow(input, a, l, x, y, size = 24) {
    const list = glyphs(input, a), gs = size * 1.3, gw = measureGlyphs(g, list, gs, GST, 6);
    drawGlyphs(g, list, x - gw, y, gs, GST, 6);
    label(l, x + 16, y + size * 0.36, size, MUTED, 500, 'left', 1);
  }
  function panel(x, y, w, h, r = 28, a = 0.78) {
    g.fillStyle = `rgba(18,10,14,${a})`; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
    g.strokeStyle = 'rgba(232,184,102,0.3)'; g.lineWidth = 2.5; g.stroke();
  }
  const shadeAll = a => { g.fillStyle = `rgba(6,3,6,${a})`; g.fillRect(0, 0, L.W, L.H); };
  const pulse = t => 0.55 + 0.45 * Math.sin(t * 4);

  // ---------- particles, pop-ups ----------
  let parts = [], pops = [], rings = [], flash = 0, seenClear = null;
  const rand = Math.random;
  function shatter(x, y, c, n = 12) {
    if (parts.length > 700) return;
    for (let k = 0; k < n; k++) {
      const a = rand() * TAU, s = 160 + rand() * 520, lit = k % 3 === 0;
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 140, life: 0.6 + rand() * 0.6, max: 1.2, c: c === PRISM && !lit ? Math.floor(rand() * GLASS.length) : c, size: lit ? 6 + rand() * 6 : 8 + rand() * 12, lit, spin: rand() * TAU, vs: (rand() - 0.5) * 14 });
    }
  }
  const pop = (x, y, text, col, size, life = 1.4, dy = 0) => pops.push({ x, y: y + dy, text, col, size, life, max: life });
  function events(list) {
    for (const e of list) {
      if (e.type === 'newgame' || e.type === 'resume') { parts = []; pops = []; rings = []; }
      if (e.type === 'undo') flash = 0.25;
    }
  }
  // the shatter starts a beat into the clear: spawned when the renderer sees that moment
  function clearFx(sim) {
    const C = sim.clearing;
    if (!C || sim.phaseT < CLEAR_T * 0.32 || seenClear === C) return;
    seenClear = C;
    let sx = 0, sy = 0;
    C.cells.forEach((i, k) => {
      const x = cellX(L, i), y = cellY(L, i);
      sx += x; sy += y;
      shatter(x, y, C.colours[k], 12);
      rings.push({ x, y, t: 0, c: C.colours[k] });
    });
    sx /= C.cells.length; sy /= C.cells.length;
    const longest = Math.max(...C.lines.map(l => l.cells.length));
    pop(sx, sy, '+' + fmt(C.pts), '#ffffff', longest >= 7 ? 84 : longest >= 6 ? 70 : 58);
    let dy = 52;
    if (C.combo >= 2) { pop(sx, sy, `${COMBO[Math.min(4, C.combo)]} ×${C.combo}`, GOLD, 34, 1.6, dy); dy += 40; }
    if (C.chain > 1) { pop(sx, sy, `STREAK ×${C.chain}`, '#9fe3ff', 30, 1.6, dy); dy += 38; }
    if (longest >= 6) { pop(sx, sy, `ROW OF ${longest}`, '#ffd1a8', 30, 1.6, dy); dy += 38; }
    if (C.by === 'arrive') pop(sx, sy, 'LUCKY', '#c9f7c0', 28, 1.6, dy);
    flash = longest >= 7 || C.combo >= 2 ? 0.35 : 0.12;
  }
  function stepFx(dt) {
    for (const p of parts) { p.life -= dt; p.vy += 900 * dt; p.vx *= 0.985; p.x += p.vx * dt; p.y += p.vy * dt; p.spin += p.vs * dt; }
    parts = parts.filter(p => p.life > 0);
    for (const p of pops) { p.life -= dt; p.y -= 40 * dt; }
    pops = pops.filter(p => p.life > 0);
    for (const r of rings) r.t += dt;
    rings = rings.filter(r => r.t < 0.6);
    flash = Math.max(0, flash - dt);
  }
  function drawFx() {
    for (const r of rings) {
      const k = r.t / 0.6;
      g.strokeStyle = rgba(lightOf(r.c), 0.7 * (1 - k)); g.lineWidth = 6 * (1 - k) + 1;
      g.beginPath(); g.arc(r.x, r.y, L.cell * (0.35 + k * 0.6), 0, TAU); g.stroke();
    }
    for (const p of parts) {
      const a = Math.min(1, p.life / (p.max * 0.45));
      if (p.lit) { glow(g, lightOf(p.c), p.x, p.y, p.size * 3, a * 0.9); continue; }
      g.globalAlpha = a;
      g.save(); g.translate(p.x, p.y); g.rotate(p.spin);
      g.fillStyle = colOf(p.c);
      g.beginPath(); g.moveTo(0, -p.size * 0.6); g.lineTo(p.size * 0.45, p.size * 0.4); g.lineTo(-p.size * 0.4, p.size * 0.3); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.moveTo(0, -p.size * 0.6); g.lineTo(p.size * 0.12, 0); g.lineTo(-p.size * 0.1, 0); g.fill();
      g.restore();
    }
    g.globalAlpha = 1;
    for (const p of pops) {
      const k = 1 - p.life / p.max, a = Math.min(1, p.life * 2.5), s = k < 0.12 ? 0.6 + (k / 0.12) * 0.4 : 1;
      g.globalAlpha = a;
      font(p.size * s, 600); g.textAlign = 'center'; g.lineJoin = 'round';
      g.strokeStyle = 'rgba(10,5,8,0.85)'; g.lineWidth = p.size * 0.16; g.strokeText(p.text, p.x, p.y);
      g.fillStyle = p.col; g.fillText(p.text, p.x, p.y);
      g.textAlign = 'left'; g.globalAlpha = 1;
    }
  }

  // ---------- the glass ----------
  const R0 = () => L.cell * 0.4;
  function shadow(c, x, y, s = 1, a = 1) {
    const S = (spr.shSize / u) * s;
    g.globalAlpha = a;
    g.drawImage(spr.shadow[c === PRISM ? 7 : c], x - S / 2, y - S / 2, S, S);
    g.globalAlpha = 1;
  }
  function marble(c, x, y, s = 1, { rot = 0, a = 1, sq = 0, t = 0 } = {}) {
    if (s <= 0.01 || a <= 0.01) return;
    g.globalAlpha = a;
    if (c === PRISM) drawPrism(g, x, y, R0() * s, t, rot);
    else if (!rot && !sq) { const S = (spr.size / u) * s; g.drawImage(spr.still[c], x - S / 2, y - S / 2, S, S); }
    else {
      const S = (spr.size / u) * s;
      g.save(); g.translate(x, y); g.scale(1 + sq, 1 - sq);
      g.drawImage(spr.base[c], -S / 2, -S / 2, S, S);
      g.rotate(rot); g.drawImage(spr.core[c], -S / 2, -S / 2, S, S); g.rotate(-rot);
      g.drawImage(spr.gloss, -S / 2, -S / 2, S, S);
      g.restore();
    }
    g.globalAlpha = 1;
  }
  // where the rolling marble is: along its path, eased over the whole roll
  function rollPos(sim) {
    const R = sim.roll, n = R.path.length - 1, p = easeInOut(Math.min(1, sim.phaseT / R.dur)) * n;
    const k = Math.min(n - 1, Math.floor(p)), f = p - k, a = R.path[k], b = R.path[k + 1];
    const x = cellX(L, a) + (cellX(L, b) - cellX(L, a)) * f, y = cellY(L, a) + (cellY(L, b) - cellY(L, a)) * f;
    const dir = Math.sign(cellX(L, b) - cellX(L, a) + cellY(L, b) - cellY(L, a)) || 1;
    return { x, y, rot: (p * L.cell * dir) / R0(), p };
  }

  function drawBoard(app, t) {
    const sim = app.sim, B = sim.board, C = sim.clearing, A = sim.arriving;
    const clearing = new Map(C ? C.cells.map((i, k) => [i, k]) : []);
    const arriving = new Map(A ? A.map((a, k) => [a.at, { ...a, k }]) : []);
    const kc = C ? sim.phaseT / CLEAR_T : 0;
    // what each marble looks like this frame: position, size, lift, squash
    const items = [];
    for (let i = 0; i < CELLS; i++) {
      const c = B[i];
      if (c === EMPTY) continue;
      let x = cellX(L, i), y = cellY(L, i), s = 1, lift = 0, sq = 0, a = 1, glowA = 0;
      if (clearing.has(i)) {
        if (kc < 0.32) { glowA = kc / 0.32; s = 1 + 0.08 * glowA; }
        else { const k = (kc - 0.32) / 0.68; s = 1.1 + 0.3 * k; a = 1 - easeOut(k); glowA = 1 - k; }
      } else if (arriving.has(i)) {
        const ar = arriving.get(i), k = (sim.phaseT - ar.k * 0.1) / 0.3;
        if (ar.from >= 0) {
          const f = easeInOut(Math.max(0, Math.min(1, k * 1.4)));
          x = cellX(L, ar.from) + (x - cellX(L, ar.from)) * f; y = cellY(L, ar.from) + (y - cellY(L, ar.from)) * f;
        }
        s = 0.38 + 0.62 * elastic(Math.max(0, Math.min(1, k)));
      } else if (i === app.sel) {
        const b = Math.abs(Math.sin(app.selT * 5.4));
        lift = b * L.cell * 0.17; sq = (1 - b) ** 10 * 0.12;
        glowA = 0.5;
      }
      if (app.shake?.cell === i) x += Math.sin(app.shake.t * 62) * 9 * (1 - app.shake.t / 0.5);
      items.push({ i, c, x, y, s, lift, sq, a, glowA });
    }
    // seeds: the next marbles, small, in the cells they will grow in
    const seeds = sim.phase === 'arrive' ? [] : sim.preview.filter(p => p.at >= 0);
    for (const p of seeds) {
      const x = cellX(L, p.at), y = cellY(L, p.at), k = 0.5 + 0.5 * Math.sin(t * 2.2 + p.at);
      glow(g, lightOf(p.c), x, y, L.cell * (0.42 + 0.05 * k), 0.3 + 0.12 * k);
      shadow(p.c, x, y, 0.4, 0.6);
      marble(p.c, x, y, 0.38 + 0.025 * k, { a: 0.92, t });
    }
    for (const it of items) shadow(it.c, it.x + it.lift * 0.25, it.y + it.lift * 0.15, it.s * (1 - it.lift / (L.cell * 0.6)), it.a * (1 - it.lift / (L.cell * 0.4)));
    // the rolling marble, with what's left of its trail
    let roll = null;
    if (sim.phase === 'roll' && sim.roll) {
      roll = rollPos(sim);
      const P = sim.roll.path;
      for (let k = Math.ceil(roll.p) + 1; k < P.length; k++) glow(g, lightOf(sim.roll.c), cellX(L, P[k]), cellY(L, P[k]), L.cell * 0.18, 0.5);
      shadow(sim.roll.c, roll.x, roll.y);
    }
    for (const it of items) {
      if (it.glowA > 0) glow(g, lightOf(it.c), it.x, it.y - it.lift, L.cell * 0.9, it.glowA * 0.55);
      marble(it.c, it.x, it.y - it.lift, it.s, { sq: it.sq, a: it.a, t });
    }
    if (roll) marble(sim.roll.c, roll.x, roll.y, 1, { rot: roll.rot, t });
    // the rows being cleared: a beam of light along each
    if (C && kc < 0.7) {
      const a = kc < 0.32 ? kc / 0.32 : 1 - (kc - 0.32) / 0.38;
      for (const l of C.lines) {
        const c = lightOf(l.c), n = l.cells.length;
        for (let k = 0; k < (n - 1) * 3 + 1; k++) {
          const f = k / ((n - 1) * 3), i0 = l.cells[0], i1 = l.cells[n - 1];
          glow(g, c, cellX(L, i0) + (cellX(L, i1) - cellX(L, i0)) * f, cellY(L, i0) + (cellY(L, i1) - cellY(L, i0)) * f, L.cell * 0.4, a * 0.6);
        }
      }
    }
  }

  // the selection's way to the cursor, the cursor itself, the demo's hand
  function drawGuides(app, t) {
    const sim = app.sim;
    if (app.path && app.sel >= 0 && sim.phase === 'idle') {
      const c = sim.board[app.sel], P = app.path;
      for (let k = 1; k < P.length; k++) {
        const x = cellX(L, P[k]), y = cellY(L, P[k]), w = 0.5 + 0.5 * Math.sin(t * 6 - k * 0.7);
        glow(g, lightOf(c), x, y, L.cell * (0.12 + 0.05 * w), 0.65);
      }
      const e = P.at(-1);
      g.strokeStyle = rgba(lightOf(c), 0.75); g.lineWidth = 3; g.setLineDash([10, 8]); g.lineDashOffset = -t * 30;
      g.beginPath(); g.arc(cellX(L, e), cellY(L, e), L.cell * 0.36, 0, TAU); g.stroke(); g.setLineDash([]);
    }
    const crossAt = (i, a) => {
      const x = cellX(L, i), y = cellY(L, i), r = L.cell * 0.16;
      g.strokeStyle = rgba(DANGER, a); g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke();
    };
    if (app.bad >= 0) crossAt(app.bad, 0.45);
    if (app.shake) crossAt(app.shake.to, 1 - app.shake.t / 0.5);
    const showCursor = app.demo || app.mode === 'keys';
    const cur = showCursor ? app.cursor : app.mode === 'pointer' ? app.hover : -1;
    if (cur >= 0 && !app.demo) {
      const x = cellX(L, cur), y = cellY(L, cur), s = L.cell * 0.48;
      g.strokeStyle = app.mode === 'keys' ? `rgba(255,236,200,${0.6 + 0.3 * Math.sin(t * 5)})` : 'rgba(255,236,200,0.35)';
      g.lineWidth = app.mode === 'keys' ? 4 : 2.5;
      g.beginPath(); g.roundRect(x - s, y - s, s * 2, s * 2, 18); g.stroke();
    }
    const H = app.hand;
    if (app.demo && H) {
      const x = L.bx + (H.x + 0.5) * L.cell, y = L.by + (H.y + 0.5) * L.cell;
      if (H.press < 0.4) { const k = H.press / 0.4; g.strokeStyle = `rgba(255,240,220,${0.8 * (1 - k)})`; g.lineWidth = 4; g.beginPath(); g.arc(x, y, L.cell * (0.25 + 0.4 * k), 0, TAU); g.stroke(); }
      // a fingertip pointer: a soft disc with a bright core, offset so the cell stays visible
      const px = x + L.cell * 0.22, py = y + L.cell * 0.26;
      glow(g, '#fff0d8', px, py, L.cell * 0.32, 0.5);
      g.fillStyle = 'rgba(255,248,236,0.9)'; g.beginPath(); g.arc(px, py, L.cell * 0.08, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(40,20,20,0.6)'; g.lineWidth = 2; g.stroke();
    }
  }

  // ---------- motes in the lamplight ----------
  function motes(t) {
    for (let k = 0; k < 16; k++) {
      const sp = 6 + hash(k) * 14, x = ((hash(k + 3) * L.W + Math.sin(t * 0.13 + k) * 60) % L.W + L.W) % L.W;
      const y = L.H - ((t * sp + hash(k + 7) * L.H) % (L.H + 100)) + 50;
      const a = 0.05 + 0.07 * (0.5 + 0.5 * Math.sin(t * 0.7 + k * 1.7));
      glow(g, k % 4 ? '#ffd8a8' : PRISM_COLS[k % 7], x, y, 12 + hash(k + 11) * 34, a);
    }
  }

  // ---------- HUD ----------
  function hud(app, t) {
    const sim = app.sim, best = Math.max(app.scores[0]?.score ?? 0, sim.score), P = L.portrait;
    if (L.logo) logo('Quintet', L.logo.x, L.logo.y, L.logo.size);
    // score, best, turn
    const sx = L.score.x;
    label('SCORE', sx, L.score.y - 64, 22, MUTED, 600, 'left', 5);
    label(fmt(sim.score), sx, L.score.y, 64, TEXT, 600, 'left', 1);
    const bAlign = L.best.right ? 'right' : 'left';
    label('BEST', L.best.x, L.best.y - (P ? 64 : 44), 22, MUTED, 600, bAlign, 5);
    label(fmt(best), L.best.x, L.best.y, P ? 64 : 40, GOLD, 600, bAlign, 1);
    label(`TURN ${sim.turn + 1}` + (sim.streak > 0 ? `  ·  STREAK ${sim.streak}` : ''), L.turn.x, L.turn.y, 24, MUTED, 500, L.turn.center ? 'center' : 'left', 3);
    // next: the seeds' colours, a turn ahead
    const nx = L.next;
    panel(nx.x, nx.y, nx.w, nx.h, 30, 0.6);
    label('NEXT', nx.x + nx.w / 2, nx.y + 40, 22, MUTED, 600, 'center', 6);
    const list = sim.phase === 'arrive' ? (sim.arriving ?? []) : sim.preview;
    list.forEach((p, k) => {
      const x = nx.x + nx.w / 2 + (k - 1) * nx.gap, y = nx.y + nx.h / 2 + 22;
      shadow(p.c, x, y, nx.r / R0() * 0.9, 0.8);
      marble(p.c, x, y, nx.r / R0() * 0.9, { t });
    });
    // room: the free cells, and how many turns of arrivals they hold
    const free = sim.free(), turns = Math.ceil(free / 3), low = app.low, Rm = L.room;
    const rw = Rm.w, rx = Rm.x, ry = Rm.y;
    label('ROOM', rx, ry, 22, MUTED, 600, 'left', 6);
    label(`${free} cells · ${turns} ${turns === 1 ? 'turn' : 'turns'}`, rx + rw, ry, 24, low ? DANGER : TEXT, 500, 'right', 1);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.roundRect(rx, ry + 18, rw, 14, 7); g.fill();
    const k = free / CELLS, col = low ? `rgba(255,106,74,${0.7 + 0.3 * Math.sin(t * 5)})` : k < 0.35 ? '#f0b45a' : '#8fd6a8';
    g.fillStyle = col; g.beginPath(); g.roundRect(rx, ry + 18, Math.max(14, rw * k), 14, 7); g.fill();
    if (app.demo) return;
    // take-backs, and the buttons
    const can = sim.canUndo(), U = L.undo, Pz = L.pause, tk = L.tokens;
    if (!tk.center) label('TAKE-BACKS', tk.x, tk.y - 34, 20, MUTED, 600, 'left', 4);
    for (let i = 0; i < 3; i++) {
      const on = i < sim.undos, x = tk.center ? tk.x + (i - 1) * 46 : tk.x + 220 + i * 40, y = tk.center ? tk.y : tk.y - 40;
      g.strokeStyle = on ? GOLD : 'rgba(255,255,255,0.2)'; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.arc(x, y, 12, -0.4 * Math.PI, 1.25 * Math.PI); g.stroke();
      g.fillStyle = on ? GOLD : 'rgba(255,255,255,0.2)'; g.beginPath(); g.moveTo(x - 17, y - 2); g.lineTo(x - 5, y - 4); g.lineTo(x - 12, y - 14); g.fill();
    }
    button(U, can, app.input, '{undo} UNDO', P ? 40 : 30);
    button(Pz, true, app.input, '{pause} PAUSE', P ? 40 : 28);
    if (L.legend && !app.touch?.active) {
      const lx = L.legend.x, ly = L.legend.y, kb = app.input.device.kind === 'keyboard';
      const rows = [...(kb ? [['click', 'Pick, then place']] : []), ['aim', 'Cursor'], ['select', 'Pick up · set down'], ['deselect', 'Put back'], ['sound', app.soundOn ? 'Sound on' : 'Sound off']];
      rows.forEach(([a, l], k) => legendRow(app.input, a, l, lx, ly + k * 56, 22));
    }
  }
  function button(R, on, input, text, size) {
    g.fillStyle = on ? 'rgba(232,184,102,0.16)' : 'rgba(255,255,255,0.04)';
    g.beginPath(); g.roundRect(R.x, R.y, R.w, R.h, 22); g.fill();
    g.strokeStyle = on ? 'rgba(232,184,102,0.6)' : 'rgba(255,255,255,0.14)'; g.lineWidth = 2.5; g.stroke();
    if (input.device.kind === 'touch') label(text.replace(/\{\w+\}\s*/, ''), R.x + R.w / 2, R.y + R.h / 2 + size * 0.36, size, on ? TEXT : 'rgba(255,255,255,0.35)', 600, 'center', 4);
    else prompt(input, text, R.x + R.w / 2, R.y + R.h / 2 + size * 0.36, size, on ? TEXT : 'rgba(255,255,255,0.35)', 'center', 600);
  }
  function lowGlow(app, t) {
    if (!app.low) return;
    const a = 0.25 + 0.15 * Math.sin(t * 2.4), pad = L.pad + 4;
    g.strokeStyle = `rgba(255,90,60,${a})`; g.lineWidth = 10;
    g.beginPath(); g.roundRect(L.bx - pad, L.by - pad, L.size + pad * 2, L.size + pad * 2, 44); g.stroke();
  }

  function drawPlay(app, t, fx = true) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(back, 0, 0);
    ref();
    motes(t);
    lowGlow(app, t);
    clearFx(app.sim);
    drawBoard(app, t);
    drawGuides(app, t);
    if (fx) drawFx();
    hud(app, t);
  }

  // ---------- screens ----------
  const menuNames = { continue: 'CONTINUE', play: 'NEW GAME', scores: 'HIGH SCORES', exit: 'EXIT' };
  function titleArt(t, y) {
    // five marbles rolling to and fro over the logo
    for (let k = 0; k < 5; k++) {
      const c = [0, 2, 3, 5, 6][k], x = L.W / 2 + (k - 2) * 96 + Math.sin(t * 0.8 + k * 0.9) * 10, yy = y - Math.abs(Math.sin(t * 1.6 + k * 0.7)) * 16;
      shadow(c, x, y + 30, 0.9, 0.7);
      marble(c, x, yy, 0.95, { rot: Math.sin(t * 0.8 + k * 0.9) * 0.6, t });
    }
  }
  function drawTitle(app, t) {
    drawStill(app, t, 0.62);
    const P = L.portrait, cx = L.W / 2;
    const ly = P ? 560 : 300;
    titleArt(t, ly - (P ? 260 : 200));
    logo('Quintet', cx, ly, P ? 230 : 190);
    label('FIVE IN A ROW, IN GLASS', cx, ly + (P ? 90 : 70), P ? 30 : 26, '#f3d3a6', 500, 'center', 8);
    const items = app.titleItems(), R = menuRects(L, items.length);
    R.forEach((m, i) => {
      const on = i === app.menu, it = items[i], big = P ? 50 : 34;
      if (on) { panel(m.x, m.y, m.w, m.h, 26, 0.7); glow(g, GOLD, m.x + 36, m.y + m.h / 2, 26, 0.9); }
      const sub = it === 'continue' && app.resume;
      label(menuNames[it], cx, m.y + m.h / 2 + (sub ? -2 : big * 0.36), on ? big : big * 0.86, on ? TEXT : MUTED, 600, 'center', 5);
      if (sub) label(`${app.resume.label} · ${app.resumeAgo()}`, cx, m.y + m.h / 2 + (P ? 38 : 24), P ? 26 : 18, on ? GOLD : 'rgba(232,184,102,0.6)', 500, 'center', 2);
    });
    const last = R.at(-1), input = app.input, by = last.y + last.h + (P ? 90 : 64);
    if (app.touch?.active || input.device.kind === 'touch') label('TAP A MARBLE, THEN WHERE IT GOES', cx, by, P ? 30 : 24, TEXT, 500, 'center', 3);
    else {
      prompt(input, '{aim} CURSOR   {select} PICK UP · SET DOWN   {undo} TAKE BACK', cx, by, P ? 26 : 22, MUTED, 'center');
      const extra = ['{pause} PAUSE', ...(input.device.kind === 'keyboard' ? [`{sound} ${app.soundOn ? 'SOUND ON' : 'SOUND OFF'}`, '{fullscreen} FULL SCREEN'] : []), ...(app.onExit ? ['{quit} EXIT'] : [])];
      prompt(input, extra.join('   '), cx, by + 46, P ? 24 : 20, MUTED, 'center');
    }
    if (input.device.kind !== 'touch') prompt(input, 'PRESS {start}', cx, L.H - (P ? 120 : 50), P ? 40 : 32, `rgba(243,211,166,${pulse(t)})`, 'center', 600);
  }
  // the board as a backdrop: the sim's marbles, dimmed
  function drawStill(app, t, dim) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(back, 0, 0);
    ref();
    motes(t);
    drawBoard({ ...app, sel: -1, shake: null }, t);
    shadeAll(dim);
  }
  function drawScores(app, t) {
    drawStill(app, t, 0.7);
    const P = L.portrait, cx = L.W / 2, w = P ? 960 : 1000, x = cx - w / 2, y = P ? 220 : 80, h = P ? 1400 : 920;
    panel(x, y, w, h, 40, 0.85);
    logo('Best Glass', cx, y + (P ? 150 : 120), P ? 96 : 80);
    const rowH = P ? 120 : 76, y0 = y + (P ? 300 : 220);
    app.scores.forEach((s, i) => {
      const yy = y0 + i * rowH, on = i === app.newRank, col = on ? `rgba(232,184,102,${pulse(t)})` : TEXT;
      if (on) { g.fillStyle = 'rgba(232,184,102,0.12)'; g.beginPath(); g.roundRect(x + 30, yy - rowH * 0.62, w - 60, rowH * 0.86, 18); g.fill(); }
      marble(i % 7, x + 90, yy - 14, P ? 0.5 : 0.4, { t });
      label(s.name, x + 150, yy, P ? 50 : 40, col, 600, 'left', 6);
      label(fmt(s.score), x + w - (P ? 300 : 330), yy, P ? 50 : 40, col, 600, 'right', 1);
      label(s.turns ? `${s.turns} turns` : '', x + w - 60, yy, P ? 30 : 26, MUTED, 500, 'right');
    });
    const S = app.stats;
    if (S.games) {
      const line = `${S.games} ${S.games === 1 ? 'GAME' : 'GAMES'} · ${fmt(S.lines)} ROWS · LONGEST ROW ${S.bestLine}` + (S.bestCombo > 1 ? ` · BEST ×${S.bestCombo}` : '');
      label(line, cx, y + h - (P ? 70 : 50), P ? 26 : 22, MUTED, 500, 'center', 3);
    }
    if (app.input.device.kind !== 'touch') prompt(app.input, 'PRESS {start}', cx, L.H - (P ? 120 : 26), 30, `rgba(243,211,166,${pulse(t)})`, 'center');
  }
  function drawPause(app, t) {
    drawPlay(app, t, false);
    shadeAll(0.6);
    const P = L.portrait, cx = L.W / 2, R = pauseRects(L);
    logo('Paused', cx, R[0].y - (P ? 110 : 70), P ? 130 : 100);
    ['RESUME', 'QUIT TO TITLE'].forEach((s, i) => {
      const on = i === app.pmenu, m = R[i];
      if (on) { panel(m.x, m.y, m.w, m.h, 26, 0.75); glow(g, GOLD, m.x + 36, m.y + m.h / 2, 26, 0.9); }
      label(s, cx, m.y + m.h / 2 + (P ? 16 : 12), P ? 46 : 34, on ? TEXT : MUTED, 600, 'center', 5);
    });
    label('THE GAME IS SAVED AFTER EVERY TURN', cx, R[1].y + R[1].h + (P ? 90 : 60), P ? 26 : 20, MUTED, 500, 'center', 3);
  }
  function drawOver(app, t) {
    drawPlay(app, t);
    const k = Math.min(1, app.stT * 1.5);
    shadeAll(0.55 * k);
    const sim = app.sim, s = sim.stats, P = L.portrait, cx = L.W / 2, w = P ? 900 : 860, h = P ? 760 : 560, x = cx - w / 2, y = L.H / 2 - h / 2;
    g.globalAlpha = k;
    panel(x, y, w, h, 40, 0.88);
    logo('The board is full', cx, y + (P ? 150 : 120), P ? 82 : 72);
    label(fmt(sim.score), cx, y + (P ? 290 : 230), P ? 110 : 92, TEXT, 600, 'center', 2);
    const rows = [['TURNS', sim.turn], ['ROWS', s.lines], ['LONGEST ROW', s.bestLine || '—'], ['BEST CLEAR', s.best ? '+' + fmt(s.best) : '—']];
    rows.forEach(([a, b], i) => {
      const xx = cx + (i - 1.5) * (w / 4.3), yy = y + (P ? 420 : 340);
      label(a, xx, yy, P ? 24 : 19, MUTED, 600, 'center', 3);
      label(String(b), xx, yy + (P ? 52 : 42), P ? 44 : 34, GOLD, 600, 'center', 1);
    });
    if (app.stT > 1.6) {
      if (app.input.device.kind === 'touch' || app.touch?.active) label('TAP TO GO ON', cx, y + h - 46, 26, `rgba(243,211,166,${pulse(t)})`, 600, 'center', 4);
      else prompt(app.input, 'PRESS {start}', cx, y + h - 46, 28, `rgba(243,211,166,${pulse(t)})`, 'center', 600);
    }
    g.globalAlpha = 1;
  }
  function drawInitials(app, t) {
    drawStill(app, t, 0.72);
    const P = L.portrait, cx = L.W / 2, E = app.entry;
    logo('A new best!', cx, P ? 420 : 190, P ? 120 : 96);
    label(fmt(app.sim.score), cx, P ? 560 : 300, P ? 90 : 70, TEXT, 600, 'center', 2);
    label('YOUR INITIALS', cx, P ? 660 : 380, P ? 32 : 26, MUTED, 600, 'center', 6);
    for (let i = 0; i < 3; i++) {
      const R = letterRect(L, i), on = i === E.pos;
      panel(R.x, R.y, R.w, R.h, 26, on ? 0.9 : 0.6);
      if (on) { glow(g, GOLD, R.x + R.w / 2, R.y + R.h / 2, R.w, 0.25); g.strokeStyle = GOLD; g.lineWidth = 4; g.beginPath(); g.roundRect(R.x, R.y, R.w, R.h, 26); g.stroke(); }
      label(LETTERS[E.letters[i]], R.x + R.w / 2, R.y + R.h * 0.72, R.h * 0.62, on ? TEXT : MUTED, 600, 'center');
      if (on) { label('▲', R.x + R.w / 2, R.y - 14, 32, GOLD, 600, 'center'); label('▼', R.x + R.w / 2, R.y + R.h + 42, 32, GOLD, 600, 'center'); }
    }
    const O = okRect(L);
    panel(O.x, O.y, O.w, O.h, 26, 0.8);
    label('OK', O.x + O.w / 2, O.y + O.h / 2 + 18, 50, GOLD, 600, 'center', 4);
    if (app.input.device.kind !== 'touch') prompt(app.input, '{letters} PICK A LETTER · {start} NEXT · OR TYPE THEM', cx, P ? 1440 : 760, P ? 26 : 28, TEXT, 'center');
  }

  let lastT = 0;
  function draw(app) {
    lastApp = app;
    if (!back) return;
    const t = app.t, dt = Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    stepFx(dt);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = INK; g.fillRect(0, 0, cw, ch);
    ref();
    switch (app.state) {
      case 'title': drawTitle(app, t); break;
      case 'scores': drawScores(app, t); break;
      case 'initials': drawInitials(app, t); break;
      case 'pause': drawPause(app, t); break;
      case 'over': drawOver(app, t); break;
      default: drawPlay(app, t);
    }
    ref();
    if (flash > 0) { g.globalAlpha = Math.min(0.1, flash * 0.4); g.fillStyle = '#fff3e0'; g.fillRect(0, 0, L.W, L.H); g.globalAlpha = 1; }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(vign, 0, 0, cw, ch);
    ref();
    if (app.demo) label('DEMO', L.W - 36, L.H - 30, 26, `rgba(255,255,255,${0.35 + 0.25 * Math.sin(t * 3)})`, 600, 'right', 6);
    if (app.fade > 0) { g.globalAlpha = Math.min(1, app.fade); g.fillStyle = INK; g.fillRect(0, 0, L.W, L.H); g.globalAlpha = 1; }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  refit();

  // ---------- hit tests (canvas pixels in) ----------
  function hit(px, py, app) {
    if (!app) return { act: 'tap' };
    const x = px / u, y = py / u;
    if (app.state === 'title') {
      const m = menuRects(L, app.titleItems().length).findIndex(R => inside(R, x, y));
      return m >= 0 ? { act: 'menu', i: m } : { act: 'tap' };
    }
    if (app.state === 'play') {
      if (inside(L.undo, x, y)) return { act: 'undo' };
      if (inside(L.pause, x, y)) return { act: 'pause' };
      const i = cellAt(L, x, y);
      return i >= 0 ? { act: 'cell', i } : { act: 'tap' };
    }
    if (app.state === 'pause') {
      const m = pauseRects(L).findIndex(R => inside(R, x, y));
      return m >= 0 ? { act: 'pmenu', i: m } : { act: 'tap' };
    }
    if (app.state === 'initials') {
      if (inside(okRect(L), x, y)) return { act: 'ok' };
      for (let i = 0; i < 3; i++) {
        const R = letterRect(L, i);
        if (inside({ x: R.x - 20, y: R.y - 70, w: R.w + 40, h: R.h + 140 }, x, y)) {
          if (i !== app.entry.pos) return { act: 'letter', i };
          return { act: y < R.y + R.h / 2 ? 'up' : 'down' };
        }
      }
    }
    return { act: 'tap' };
  }
  const cellAtPx = (px, py) => cellAt(L, px / u, py / u);
  return {
    draw, events, hit, cellAt: cellAtPx,
    destroy() { destroyed = true; window.removeEventListener('resize', refit); unfit?.(); },
  };
}
