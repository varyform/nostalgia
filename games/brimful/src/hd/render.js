// The HD renderer: the simulation and the app's screens as lit vectors at the window's own
// resolution, 16:9. Everything is drawn in a 1920 × 1080 reference frame scaled to fit; the
// static venue art is painted once per venue into two layers (behind and in front of the
// customers). It only reads state, like the CGA renderer.
//
//   const view = createHdRenderer(canvas, app);
//   view.events(sim.events, sim);  view.draw(app);  view.hit(x, y, app) → touch target
import { drawGlyphs, drawPrompt, glyphs, measureGlyphs } from '@nostalgia/input';
import { fitWide } from '@nostalgia/game/runtime';
import { LETTERS } from '../app.js';
import { ROWS, SHOW_T } from '../sim.js';
import { VENUES } from '../venues.js';
import { ART, BAND, COUNTER, HUD_H, REF_H, REF_W, U, X0, canvas, glow, paintBack, paintFront, rowY } from './art.js';
import { drawCoin, drawCustomer, drawGlass, drawPip, drawShow } from './sprites.js';

const F = "'Baloo 2','Trebuchet MS',system-ui,sans-serif";
const TAU = Math.PI * 2;
const pad6 = n => String(Math.max(0, n | 0)).padStart(6, '0');
const PADS = [
  { x: 960, y: 300, id: 'pier', col: '#ff7aa6', name: 'SHAKE' },
  { x: 1250, y: 560, id: 'lodge', col: '#ffb347', name: 'COCOA' },
  { x: 960, y: 820, id: 'market', col: '#06d6a0', name: 'BUBBLE TEA' },
  { x: 670, y: 560, id: 'moon', col: '#46f0ff', name: 'FLOAT' },
];
const PAD_W = 230, PAD_H = 180;
const POUR = { x: 1790, y: 950, r: 100 }, PAUSE = { x: 1862, y: 48, r: 36 };

export function createHdRenderer(cv) {
  const g = cv.getContext('2d');
  let cw = 1, ch = 1, u = 1, vign = null, destroyed = false, lastApp = null;
  let layers = { key: '', back: null, front: null };
  // the largest 16:9 box in the window, at device resolution (capped)
  function fit(w, h) {
    cw = w; ch = h;
    u = ch / REF_H;
    vign = canvas(cw, ch);
    const v = vign.getContext('2d'), gr = v.createRadialGradient(cw / 2, ch / 2, ch * 0.4, cw / 2, ch / 2, cw * 0.62);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.5)');
    v.fillStyle = gr; v.fillRect(0, 0, cw, ch);
    layers = { key: '', back: null, front: null };
    if (lastApp) draw(lastApp);
  }
  // the still demo frame is drawn once; draw it again when the web font arrives
  void document.fonts?.ready.then(() => { if (!destroyed && lastApp) draw(lastApp); });

  const ref = () => g.setTransform(u, 0, 0, u, 0, 0);
  function venueLayers(id, rows) {
    const key = id + rows.map(r => r.len).join(',') + ':' + cw;
    if (layers.key !== key) {
      const make = paint => { const c = canvas(cw, ch), x = c.getContext('2d'); x.setTransform(u, 0, 0, u, 0, 0); paint(x, id, rows); return c; };
      layers = { key, back: make(paintBack), front: make(paintFront) };
    }
    return layers;
  }

  // ---------- text ----------
  const font = (size, wgt = 700) => { g.font = `${wgt} ${size}px ${F}`; };
  function label(s, x, y, size, col, wgt = 700, align = 'left', spacing = 0) {
    font(size, wgt); g.fillStyle = col; g.textAlign = align; g.textBaseline = 'alphabetic';
    if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
    g.fillText(s, x, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.textAlign = 'left';
  }
  function outlined(s, x, y, size, col, line = '#1b1030', lw = 8, align = 'center', spacing = 0) {
    font(size, 800); g.textAlign = align; g.lineJoin = 'round';
    if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
    g.strokeStyle = line; g.lineWidth = lw; g.strokeText(s, x, y);
    g.fillStyle = col; g.fillText(s, x, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.textAlign = 'left';
  }
  function labelW(s, size, wgt = 700, spacing = 0) {
    font(size, wgt);
    if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
    const w = g.measureText(s).width;
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    return w;
  }
  const GST = { font: F };
  const prompt = (input, s, x, y, size, col, align = 'left', wgt = 700) =>
    drawPrompt(g, input, s, x, y, { font: `${wgt} ${size}px ${F}`, size: size * 1.3, color: col, align, letterSpacing: 1, style: GST });
  function legend(input, rows, cx, y, pitch = 48, size = 24) {
    const gs = size * 1.3, gap = 6, gw = [], lw = [];
    const gl = (a, all) => glyphs(input, a, all);
    for (const r of rows) r.forEach(([a, l, all], k) => { gw[k] = Math.max(gw[k] || 0, measureGlyphs(g, gl(a, all), gs, GST, gap)); lw[k] = Math.max(lw[k] || 0, labelW(l, size, 600, 1)); });
    const colGap = 44, inner = 12;
    const total = gw.reduce((w, x, k) => w + (k ? colGap : 0) + x + inner + lw[k], 0);
    rows.forEach((r, i) => {
      let x = cx - total / 2;
      const yc = y + i * pitch;
      r.forEach(([a, l, all], k) => {
        const list = gl(a, all);
        drawGlyphs(g, list, x + gw[k] - measureGlyphs(g, list, gs, GST, gap), yc, gs, GST, gap);
        label(l, x + gw[k] + inner, yc + size * 0.36, size, 'rgba(255,255,255,0.88)', 600, 'left', 1);
        x += gw[k] + inner + lw[k] + colGap;
      });
    });
  }
  function panel(x, y, w, h, r = 28, a = 0.72) {
    g.fillStyle = `rgba(20,10,36,${a})`; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 3; g.stroke();
  }
  const shadeAll = a => { g.fillStyle = `rgba(6,2,14,${a})`; g.fillRect(0, 0, REF_W, REF_H); };
  const pulse = t => 0.55 + 0.45 * Math.sin(t * 4);

  // ---------- particles and pop-ups (reference units) ----------
  let parts = [], pops = [], shake = 0, flash = 0, flashCol = '#ffffff';
  const doorT = [0, 0, 0, 0];
  const rand = Math.random;
  function burst(x, y, n, cols, speed = 300, life = 0.7, grav = 600, size = 6, lit = false) {
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU, s = speed * (0.3 + rand() * 0.7);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.4, life: life * (0.5 + rand() * 0.5), max: life, col: cols[Math.floor(rand() * cols.length)], size: size * (0.6 + rand() * 0.8), grav, lit, spin: rand() * TAU });
    }
  }
  const pop = (x, y, text, col = '#ffffff', size = 34) => pops.push({ x, y, text, col, size, life: 1.1 });
  function events(list, sim) {
    const A = ART[sim.V?.id] ?? ART.pier;
    for (const e of list) {
      const y = e.row != null ? rowY(e.row) + COUNTER - 10 : 540, x = e.x != null ? X0 + e.x * U : 960;
      switch (e.type) {
        case 'slide': if (e.perfect) { burst(X0 + 10, y - 60, 14, ['#ffffff', A.accent, '#ffe08a'], 260, 0.6, 0, 5, true); pop(X0 + 70, y - 80, 'BRIMFUL!', '#ffe08a', 30); } break;
        case 'catch': burst(x, y - 50, 10, [A.drink, A.foam], 220, 0.5, 900, 6); pop(x, y - 110, '+50', '#ffffff', 28); break;
        case 'collect': burst(x, y - 30, 8, ['#ffffff', A.light], 200, 0.4, 0, 4, true); pop(x, y - 70, '+100', A.light, 28); break;
        case 'out': doorT[e.row] = 0.6; pop(x - 40, y - 120, '+100', '#ffffff', 30); break;
        case 'enter': doorT[e.row] = 0.6; break;
        case 'tip': burst(x, y - 20, 24, ['#ffd34d', '#fff2a8', '#ffffff'], 380, 0.9, 700, 7, true); pop(x, y - 90, '+250  SHOWTIME!', '#ffd34d', 34); break;
        case 'spill': burst(X0, y - 40, 22, [A.drink, A.foam], 160, 0.9, 1100, 7); pop(X0 + 60, y - 100, 'OVERFLOW!', A.drink, 28); break;
        case 'sip': burst(x - 30, y - 70, 3, [A.foam], 60, 0.4, -80, 4); break;
        case 'miss':
          shake = 0.45; flash = 0.25; flashCol = '#ff4060';
          if (e.cause === 'crash') burst(X0 + sim.rows[e.row].len * U + 40, y - 20, 30, ['#ffffff', '#cfe8ff', A.drink], 520, 1.1, 1400, 7);
          else if (e.cause === 'drop') burst(X0 - 30, y + 70, 30, ['#ffffff', '#cfe8ff'], 420, 1.1, 1400, 6);
          break;
        case 'clear': for (let k = 0; k < 6; k++) burst(200 + k * 300, 200 + rand() * 300, 26, ['#ff6f91', '#ffd166', '#06d6a0', '#46f0ff', '#ffffff'], 500, 1.8, 500, 9); break;
        case 'life': pop(960, 500, 'EXTRA LIFE!', '#ffd166', 56); flash = 0.15; flashCol = '#ffd166'; break;
        case 'screen': case 'bonus': parts = []; pops = []; break;
        case 'pad': if (!e.show) { const p = PADS[e.pad]; burst(p.x, p.y, 12, [p.col, '#ffffff'], 300, 0.5, 0, 6, true); } break;
        case 'round': burst(960, 560, 30, ['#ffd166', '#ffffff', '#ff6f91'], 500, 1, 300, 8, true); pop(960, 470, 'ORDER UP!', '#ffd166', 60); break;
        case 'wrong': shake = 0.3; flash = 0.2; flashCol = '#ff4060'; break;
        case 'perfect': for (let k = 0; k < 5; k++) burst(300 + k * 330, 400, 30, ['#ff6f91', '#ffd166', '#06d6a0', '#46f0ff'], 600, 1.6, 400, 9); break;
      }
    }
  }
  function stepParts(dt) {
    for (const p of parts) { p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.spin += dt * 6; }
    parts = parts.filter(p => p.life > 0);
    for (const p of pops) { p.life -= dt; p.y -= 60 * dt; }
    pops = pops.filter(p => p.life > 0);
    shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt);
    for (let r = 0; r < 4; r++) doorT[r] = Math.max(0, doorT[r] - dt);
  }
  function drawParts() {
    for (const p of parts) {
      const a = Math.min(1, p.life / (p.max * 0.4));
      if (p.lit) glow(g, p.col.length === 7 ? p.col : '#ffffff', p.x, p.y, p.size * 4, a * 0.6);
      g.globalAlpha = a; g.fillStyle = p.col;
      g.save(); g.translate(p.x, p.y); g.rotate(p.spin); g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7); g.restore();
    }
    g.globalAlpha = 1;
    for (const p of pops) {
      g.globalAlpha = Math.min(1, p.life * 2.5);
      outlined(p.text, p.x, p.y, p.size, p.col, 'rgba(20,8,30,0.85)', 6);
    }
    g.globalAlpha = 1;
  }

  // ---------- the counters ----------
  function liveScenery(id, sim, t) {
    if (id === 'pier') {
      for (let i = 0; i < 26; i++) {
        const y = 380 + ((i * 97) % 680), x = ((i * 233 + t * (20 + (i % 5) * 8)) % (REF_W + 200)) - 100;
        g.fillStyle = `rgba(255,220,180,${0.18 + 0.2 * Math.sin(t * 2 + i)})`; g.fillRect(x, y, 60 + (i % 4) * 20, 3);
      }
    } else if (id === 'lodge') {
      g.fillStyle = 'rgba(255,255,255,0.9)';
      for (let r = 0; r < ROWS; r++) for (let k = 0; k < 4; k++) for (let i = 0; i < 6; i++) {
        const wx = 520 + k * 300, wy = rowY(r) + 14;
        const fx = wx + ((i * 37 + Math.sin(t + i) * 10 + 150) % 150), fy = wy + ((i * 23 + t * 30 + k * 11) % 86);
        g.fillRect(fx, fy, 3, 3);
      }
      for (let r = 0; r < ROWS; r++) glow(g, '#ff8a2a', 130, rowY(r) + 120, 150 + Math.sin(t * 7 + r) * 12, 0.12);
    } else if (id === 'market') {
      for (let r = 0; r < ROWS; r++) {
        const y0 = rowY(r), ex = X0 + sim.rows[r].len * U;
        g.strokeStyle = 'rgba(255,220,150,0.6)'; g.lineWidth = 2; g.beginPath();
        for (let x = X0 - 40; x <= ex + 60; x += 30) g.lineTo(x, y0 + 72 + Math.sin(x / 90) * 10);
        g.stroke();
        for (let x = X0 + 30, k = 0; x < ex + 40; x += 120, k++) {
          const sw = Math.sin(t * 1.6 + k + r) * 0.12, ly = y0 + 82 + Math.sin(x / 90) * 10;
          g.save(); g.translate(x, ly); g.rotate(sw);
          g.fillStyle = k % 3 === 1 ? '#ffcf5a' : '#ff5d4a';
          g.beginPath(); g.ellipse(0, 18, 18, 22, 0, 0, TAU); g.fill();
          g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-10, -4, 20, 6); g.fillRect(-10, 38, 20, 5);
          g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-2, 0, 4, 36);
          g.restore();
          glow(g, '#ff8a3c', x, ly + 18, 70 + Math.sin(t * 5 + k) * 6, 0.55);
        }
      }
    } else {
      for (let i = 0; i < 24; i++) { const a = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.7); g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect((i * 331) % REF_W, (i * 157) % 1000 + 60, 3, 3); }
      for (let r = 0; r < ROWS; r++) glow(g, '#46f0ff', X0 + 300 + ((t * 120 + r * 400) % 1200), rowY(r) + COUNTER + 34, 60, 0.35);
    }
  }
  function drawScene(app, t) {
    const sim = app.sim, id = sim.V.id, A = ART[id];
    const L = venueLayers(id, sim.rows);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(L.back, 0, 0);
    ref();
    if (shake > 0) g.translate((rand() - 0.5) * 30 * shake, (rand() - 0.5) * 30 * shake);
    liveScenery(id, sim, t);
    // open doors while someone passes
    sim.rows.forEach((row, r) => {
      if (doorT[r] <= 0) return;
      const y0 = rowY(r), ex = X0 + row.len * U, o = Math.sin((doorT[r] / 0.6) * Math.PI);
      g.fillStyle = 'rgba(255,230,180,0.85)'; g.fillRect(ex + 14, y0 + 28, 66, COUNTER - 24);
      glow(g, A.light, ex + 47, y0 + 100, 90, 0.6 * o);
    });
    const drinkDraw = (x, y, f) => drawGlass(g, id, A, x, y, f, { full: f > 0.9, s: 0.8 });
    sim.rows.forEach((row, r) => {
      const base = rowY(r) + COUNTER + 12;
      for (const c of row.cust) {
        drawCustomer(g, X0 + c.x * U, base, {
          id, kind: c.kind, state: c.look > 0.5 && (c.state === 'walk' || c.state === 'wait') ? 'look' : c.state, t, bob: c.bob, catchT: c.catchT, look: c.look,
          drink: c.state === 'drink' ? Math.max(0, c.t / sim.P.drink) : 1, A, drinkDraw,
        });
      }
    });
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(L.front, 0, 0);
    ref();
    if (shake > 0) g.translate((rand() - 0.5) * 30 * shake, (rand() - 0.5) * 30 * shake);
    // dispenser lights
    for (let r = 0; r < ROWS; r++) glow(g, A.accent, 127, rowY(r) + 130, 40 + (sim.server.row === r ? 16 : 0), sim.server.row === r ? 0.9 : 0.4);
    // tips and glasses on the counter tops
    sim.rows.forEach((row, r) => {
      const cy = rowY(r) + COUNTER - 10;
      for (const tp of row.tips) {
        if (tp.t > 7 && Math.floor(t * 8) % 2) continue;
        drawCoin(g, X0 + tp.x * U, cy - 16, t + tp.x);
      }
      for (const gl of row.glasses) {
        const gx = X0 + gl.x * U;
        if (gl.full) {
          g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(gx - 70, cy - 30, 50, 3); g.fillRect(gx - 50, cy - 18, 30, 3);
          drawGlass(g, id, A, gx, cy, 1, { tilt: 0.06 });
          if (gl.perfect) glow(g, '#ffe08a', gx, cy - 40, 50, 0.45);
        } else drawGlass(g, id, A, gx, cy, 0.08, { full: false, tilt: -0.05 });
      }
    });
    drawPipNow(sim, t, A, id);
    if (sim.status === 'miss' && sim.miss) missMarker(sim, t, id, A);
    drawParts();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(vign, 0, 0);
    ref();
  }
  function drawPipNow(sim, t, A, id) {
    // Pip stands just right of the glass he is filling, reaching back to it
    const sv = sim.server, y0 = rowY(sv.row), feet = y0 + BAND - 8, x = X0 + sv.x * U + 46;
    let pose = 'stand', face = 1, sq = 0;
    if (sim.status === 'clear') pose = 'cheer';
    else if (sim.status === 'miss' && sim.miss?.cause === 'grab' && sim.miss.row === sv.row) pose = 'down';
    else if (sv.catchT > 0) { pose = 'catch'; sq = -0.06; }
    else if (sv.moving) { pose = 'walk'; face = sv.face; }
    else if (sv.x < 0.7 && (sv.fill > 0 || sv.throwT > 0)) { pose = 'pour'; face = -1; }
    if (sv.hop > 0) sq = -0.12 * Math.sin((sv.hop / 0.12) * Math.PI);
    if (sv.throwT > 0) sq = 0.08 * (sv.throwT / 0.25);
    const hopUp = sv.hop > 0 ? Math.sin((sv.hop / 0.12) * Math.PI) * 26 : 0;
    // shadow
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(x, feet, 34, 8, 0, 0, TAU); g.fill();
    drawPip(g, x, feet - hopUp, { pose, face, t, sq, run: sv.run, blink: Math.sin(t * 0.9) > 0.99 });
    // the glass under the tap, filling
    if (sv.fill > 0 && sv.x < 0.7) {
      const cy = y0 + COUNTER - 10, spoutY = y0 + 88;
      if (sv.fill < 1 || sv.over > 0) {
        g.fillStyle = A.drink; g.fillRect(X0 - 3, spoutY, 6, cy - spoutY - 52 * sv.fill + 50);
        glow(g, A.drink, X0, spoutY + 10, 24, 0.6);
      }
      drawGlass(g, id, A, X0, cy, sv.fill, { full: sv.fill >= 1, s: sv.fill >= 1 ? 1 + Math.sin(t * 30) * 0.02 : 1 });
      // the brim gauge: a ring that turns gold at the brim, red as it is about to overflow
      const k = sv.fill < 1 ? sv.fill : 1, warn = sv.over / 0.6;
      g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(X0 + 50, cy - 120, 20, 0, TAU); g.stroke();
      g.strokeStyle = sv.fill < 1 ? '#ffffff' : warn > 0.35 ? '#ff4060' : '#ffd166';
      g.beginPath(); g.arc(X0 + 50, cy - 120, 20, -Math.PI / 2, -Math.PI / 2 + k * TAU); g.stroke();
      if (sv.fill >= 1 && warn < 0.35) glow(g, '#ffd166', X0 + 50, cy - 120, 50, 0.7);
      if (sv.over > 0.2) burst(X0 + (rand() - 0.5) * 30, cy - 60, 1, [A.drink, A.foam], 80, 0.5, 900, 5);
    }
  }
  function missMarker(sim, t, id, A) {
    const m = sim.miss, y0 = rowY(m.row), cy = y0 + COUNTER - 10;
    if (m.cause === 'grab') drawCustomer(g, X0 - 20, cy + 6, { id, kind: 3, state: 'grab', t, bob: t, A });
    const mx = m.cause === 'crash' ? X0 + sim.rows[m.row].len * U + 44 : X0 - 20;
    const a = 0.5 + 0.5 * Math.sin(t * 12);
    g.strokeStyle = `rgba(255,70,100,${a})`; g.lineWidth = 6; g.beginPath(); g.arc(mx, cy - 40, 80, 0, TAU); g.stroke();
    glow(g, '#ff4060', mx, cy - 40, 140, 0.35 * a);
  }

  function hud(app, t) {
    const sim = app.sim, best = Math.max(app.scores[0]?.score ?? 0, sim.score), A = ART[sim.V.id];
    if (sim.show && sim.mode !== 'bonus') {
      g.fillStyle = 'rgba(10,4,24,0.55)'; g.fillRect(0, 0, REF_W, HUD_H + 120);
      drawShow(g, sim.show.kind, sim.show.t / SHOW_T, t);
      outlined(sim.V.showName.toUpperCase() + '!', sim.show.t / SHOW_T < 0.5 ? 1500 : 420, 70, 40, '#ffe08a', '#2a0c30', 8, 'center', 3);
      return;
    }
    label('SCORE', 40, 34, 20, 'rgba(255,255,255,0.6)', 700, 'left', 3);
    outlined(pad6(sim.score), 40, 78, 44, '#ffffff', 'rgba(0,0,0,0.55)', 6, 'left', 2);
    label('HI ' + pad6(best), 330, 74, 28, A.hud, 700, 'left', 2);
    const V = sim.V;
    if (sim.mode === 'bonus') outlined('ORDER UP!  BONUS ' + sim.bonus.points, 960, 70, 40, '#ffd166', 'rgba(0,0,0,0.55)', 6);
    else {
      outlined(V.name.toUpperCase(), 960, 58, 40, A.hud, 'rgba(0,0,0,0.55)', 6, 'center', 3);
      for (let i = 0; i < V.screens; i++) { g.fillStyle = i < sim.screen ? A.accent : i === sim.screen ? '#ffffff' : 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(960 - (V.screens - 1) * 16 + i * 32, 80, 7, 0, TAU); g.fill(); }
      if (sim.loop) label('TOUR ' + (sim.loop + 1), 1140, 74, 24, A.accent, 700, 'left', 2);
      // customers still to serve
      label('TO SERVE', 1420, 34, 20, 'rgba(255,255,255,0.6)', 700, 'left', 3);
      outlined(String(Math.max(0, sim.quota - sim.served)), 1420, 78, 40, '#ffffff', 'rgba(0,0,0,0.55)', 6, 'left');
    }
    for (let i = 0; i < Math.min(sim.lives - 1, 5); i++) drawGlass(g, V.id, A, 1770 - i * 46, 82, 1, { s: 0.62 });
    void t;
  }

  // ---------- the bonus round ----------
  function padRect(k) { const p = PADS[k]; return { x: p.x - PAD_W / 2, y: p.y - PAD_H / 2, w: PAD_W, h: PAD_H }; }
  function drawBonus(app, t) {
    const b = app.sim.bonus;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, ch); bg.addColorStop(0, '#1a0b33'); bg.addColorStop(1, '#3a0f3e');
    g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
    ref();
    if (shake > 0) g.translate((rand() - 0.5) * 30 * shake, (rand() - 0.5) * 30 * shake);
    // a checkered soda-shop floor and neon
    for (let i = 0; i < 14; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(i * 140, 760 + j * 80, 140, 80); }
    glow(g, '#ff6f91', 960, 560, 520, 0.18);
    PADS.forEach((p, k) => {
      const R = padRect(k), lit = b.lit === k, bad = b.phase === 'fail' && b.wrong === k;
      const s = lit ? 1.08 : 1;
      g.save(); g.translate(p.x, p.y); g.scale(s, s); g.translate(-p.x, -p.y);
      if (lit || bad) glow(g, bad ? '#ff4060' : p.col, p.x, p.y, 220, 0.85);
      g.fillStyle = lit ? p.col : bad ? '#ff4060' : 'rgba(255,255,255,0.08)';
      g.beginPath(); g.roundRect(R.x, R.y, R.w, R.h, 36); g.fill();
      g.strokeStyle = p.col; g.lineWidth = lit ? 8 : 4; g.stroke();
      drawGlass(g, p.id, ART[p.id], p.x, p.y + 52, 1, { s: 1.25 });
      label(p.name, p.x, R.y + R.h - 12, 22, lit ? '#1a0b33' : 'rgba(255,255,255,0.7)', 800, 'center', 2);
      g.restore();
    });
    // the customer calling the order
    const calling = b.phase === 'show' && b.lit >= 0;
    drawCustomer(g, 960, 640, { id: 'pier', kind: 1, state: calling ? 'look' : 'wait', t, bob: t, look: calling ? 1 : 0, A: ART.pier });
    if (calling) {
      panel(1010, 420, 120, 100, 24, 0.85);
      drawGlass(g, PADS[b.lit].id, ART[PADS[b.lit].id], 1070, 505, 1, { s: 0.9 });
    }
    const R = b.B.rounds;
    R.forEach((n, i) => { g.fillStyle = i < b.got ? '#ffd166' : i === b.round ? '#ffffff' : 'rgba(255,255,255,0.2)'; g.beginPath(); g.roundRect(960 - R.length * 40 + i * 80 + 8, 980, 64, 14, 7); g.fill(); });
    let msg = '';
    if (b.phase === 'intro') msg = 'Remember the order, then repeat it';
    else if (b.phase === 'show') msg = `Round ${b.round + 1} · watch the order`;
    else if (b.phase === 'input') msg = `Your turn · ${b.idx} / ${R[b.round]}`;
    else if (b.phase === 'good') msg = 'Order up!';
    else if (b.phase === 'fail') msg = 'Wrong order!';
    else msg = 'Perfect memory!  +2000';
    outlined(msg, 960, 1052, 40, b.phase === 'fail' ? '#ff8095' : '#ffffff', 'rgba(0,0,0,0.6)', 6);
    if (b.phase === 'intro') prompt(app.input, app.touch?.active ? 'TAP THE PADS' : 'USE {pads}', 960, 160, 30, '#ffd166', 'center');
    drawParts();
    hud(app, t);
  }

  // ---------- screens ----------
  const titleSim = { V: VENUES[0], rows: [] };
  function drawTitle(app, t) {
    const L = venueLayers('pier', titleSim.rows);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(L.back, 0, 0);
    ref();
    liveScenery('pier', titleSim, t);
    shadeAll(0.45);
    // a big glass filling, brimming over, and starting again
    const ph = (t * 0.3) % 1, f = Math.min(1, ph * 1.5), A = ART.pier;
    glow(g, '#ff7aa6', 360, 380, 260, 0.35);
    drawGlass(g, 'pier', A, 360, 520, f, { full: f >= 1, s: 4.2 });
    if (f >= 1) for (let i = 0; i < 2; i++) burst(360 + (rand() - 0.5) * 100, 270, 1, [A.drink, A.foam], 120, 0.7, 900, 9);
    drawPip(g, 560, 700, { pose: f < 1 ? 'pour' : 'cheer', face: -1, t, sq: f >= 1 ? Math.sin(t * 10) * 0.04 : 0 });
    // the logo
    const lx = 1180;
    g.save(); g.translate(lx, 250); g.rotate(-0.04);
    font(190, 800); g.textAlign = 'center'; g.lineJoin = 'round';
    g.strokeStyle = '#2a0c30'; g.lineWidth = 26; g.strokeText('Brimful', 0, 0);
    const lg = g.createLinearGradient(0, -150, 0, 20); lg.addColorStop(0, '#fff3f8'); lg.addColorStop(0.5, '#ff9cc2'); lg.addColorStop(1, '#ff4f8b');
    g.fillStyle = lg; g.fillText('Brimful', 0, 0);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(-300, -112, 600, 6);
    g.restore(); g.textAlign = 'left';
    label('A SODA FOUNTAIN FRENZY', lx, 320, 32, '#ffe1c2', 700, 'center', 8);
    const items = app.titleItems(), names = { play: 'PLAY', scores: 'HIGH SCORES', exit: 'EXIT' };
    menuRects(app).forEach((m, i) => {
      const on = i === app.menu;
      if (on) { panel(m.x, m.y, m.w, m.h, 30, 0.6); glow(g, '#ff7aa6', m.x + 34, m.y + m.h / 2, 30, 0.9); }
      label(names[items[i]], lx, m.y + m.h * 0.72, on ? 40 : 32, on ? '#ffffff' : 'rgba(255,255,255,0.6)', 800, 'center', 4);
    });
    const input = app.input, kb = input.device.kind === 'keyboard';
    const extra = [['pause', 'PAUSE']];
    if (kb) extra.push(['sound', app.soundOn ? 'SOUND ON' : 'SOUND OFF'], ['fullscreen', 'FULL SCREEN']);
    if (app.onExit) extra.push(['quit', 'EXIT']);
    const ly = 650 + (items.length - 2) * 30;
    if (app.touch?.active) label('TAP A COUNTER TO GO THERE · HOLD POUR TO FILL, LET GO TO SLIDE', 960, ly + 30, 26, '#ffffff', 700, 'center', 2);
    else {
      legend(input, [[['switch', 'CHANGE COUNTER'], ['walk', 'WALK ALONG IT']]], 1180, ly);
      legend(input, [[['pour', 'HOLD TO FILL, LET GO TO SLIDE']]], 1180, ly + 52);
      legend(input, [extra], 1180, ly + 104);
    }
    prompt(input, 'PRESS {start}', 1180, 930, 40, `rgba(255,215,140,${pulse(t)})`, 'center', 800);
    label('FILL TO THE BRIM · SLIDE IT · CATCH EVERY EMPTY', 960, 1050, 22, 'rgba(255,255,255,0.45)', 600, 'center', 4);
  }
  function menuRects(app) {
    return app.titleItems().map((_, i) => ({ x: 1180 - 210, y: 390 + i * 74, w: 420, h: 64 }));
  }
  function drawScores(app, t) {
    drawTitleBack(t);
    panel(460, 90, 1000, 900, 40, 0.78);
    outlined('BEST SERVERS', 960, 190, 72, '#ffd166', '#2a0c30', 10, 'center', 6);
    app.scores.forEach((s, i) => {
      const y = 290 + i * 80, on = i === app.newRank, col = on ? `rgba(255,209,102,${pulse(t)})` : '#ffffff';
      if (on) { g.fillStyle = 'rgba(255,209,102,0.12)'; g.beginPath(); g.roundRect(500, y - 52, 920, 70, 20); g.fill(); }
      label(`${i + 1}`, 560, y, 40, 'rgba(255,255,255,0.5)', 800, 'right');
      label(s.name, 610, y, 44, col, 800, 'left', 6);
      label(pad6(s.score), 900, y, 44, col, 800, 'right', 2);
      label(((s.loop ? `Tour ${s.loop + 1} · ` : '') + (VENUES[s.venue ?? 0]?.name ?? '')), 960, y, 30, 'rgba(255,255,255,0.6)', 600, 'left');
    });
    prompt(app.input, 'PRESS {start}', 960, 1040, 32, `rgba(255,215,140,${pulse(t)})`, 'center');
  }
  function drawTitleBack(t) {
    const L = venueLayers('pier', titleSim.rows);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(L.back, 0, 0);
    ref();
    liveScenery('pier', titleSim, t);
    shadeAll(0.55);
  }
  function drawCard(app, t) {
    const sim = app.sim;
    if (sim.mode === 'bonus') {
      drawBonus(app, t);
      shadeAll(0.6);
      panel(420, 300, 1080, 420, 40, 0.85);
      label('BONUS ROUND', 960, 390, 34, '#ffd166', 800, 'center', 10);
      outlined('Order Up!', 960, 500, 110, '#ff9cc2', '#2a0c30', 14);
      label('A customer calls an order. Repeat it on the four pads.', 960, 590, 32, '#ffffff', 600, 'center');
      label('Each round is one longer.', 960, 640, 32, 'rgba(255,255,255,0.7)', 600, 'center');
      return;
    }
    drawScene(app, t);
    hud(app, t);
    shadeAll(0.45);
    const V = sim.V, A = ART[V.id], k = Math.min(1, app.stT * 3);
    g.save(); g.translate(960, 540); g.scale(0.8 + 0.2 * k, 0.8 + 0.2 * k); g.translate(-960, -540); g.globalAlpha = k;
    panel(460, 330, 1000, 400, 44, 0.82);
    label(`SCREEN ${sim.screen + 1} OF ${V.screens}` + (sim.loop ? `  ·  TOUR ${sim.loop + 1}` : ''), 960, 410, 30, A.accent, 800, 'center', 6);
    outlined(V.name, 960, 520, 104, '#ffffff', '#2a0c30', 14);
    label(V.blurb, 960, 590, 34, A.hud, 600, 'center', 2);
    label('Today: ' + V.drink, 960, 660, 32, 'rgba(255,255,255,0.75)', 600, 'center', 1);
    drawGlass(g, V.id, A, 1380, 690, 1, { s: 1.3 });
    g.restore(); g.globalAlpha = 1;
  }
  function statusOverlay(app, t) {
    const sim = app.sim;
    if (sim.status === 'ready') {
      const go = sim.statusT >= 0.9, s = go ? 1 + (sim.statusT - 0.9) * 0.6 : 1;
      g.save(); g.translate(960, 560); g.scale(s, s);
      outlined(go ? 'Serve!' : 'Ready…', 0, 0, 110, go ? '#ffd166' : '#ffffff', '#2a0c30', 14);
      g.restore();
    } else if (sim.status === 'miss' && sim.statusT > 0.5) {
      const msg = { crash: 'A glass flew off the end!', drop: 'An empty hit the floor!', grab: 'A customer got fed up!' }[sim.miss?.cause] ?? '';
      panel(500, 450, 920, 190, 36, 0.82);
      outlined(msg, 960, 535, 58, '#ff9cb0', '#2a0c30', 10);
      label(sim.lives > 0 ? `${sim.lives} ${sim.lives === 1 ? 'life' : 'lives'} left` : 'Last one…', 960, 600, 34, '#ffffff', 600, 'center', 2);
    } else if (sim.status === 'over' || app.state === 'over') {
      shadeAll(0.35);
      panel(560, 380, 800, 300, 40, 0.85);
      outlined('Closing time', 960, 500, 96, '#ffd166', '#2a0c30', 14);
      label('SCORE ' + pad6(sim.score), 960, 600, 44, '#ffffff', 800, 'center', 4);
    }
    void t;
  }
  function drawClear(app, t) {
    drawScene(app, t);
    hud(app, t);
    const sim = app.sim, k = Math.min(1, app.stT * 3);
    g.save(); g.translate(960, 520); g.scale(0.7 + 0.3 * k, 0.7 + 0.3 * k); g.rotate(Math.sin(t * 3) * 0.02); g.translate(-960, -520);
    panel(560, 360, 800, 320, 44, 0.84);
    outlined('Screen clear!', 960, 470, 96, '#ffffff', '#2a0c30', 14);
    label(`${sim.tally?.served ?? 0} served`, 960, 545, 36, 'rgba(255,255,255,0.75)', 600, 'center', 2);
    outlined('BONUS ' + (sim.tally?.bonus ?? 0), 960, 625, 56, '#ffd166', '#2a0c30', 10);
    g.restore();
    if (Math.random() < 0.3) burst(Math.random() * REF_W, -20, 2, ['#ff6f91', '#ffd166', '#06d6a0', '#46f0ff'], 120, 3, 300, 9);
  }
  function drawPause(app, t) {
    drawGame(app, t);
    shadeAll(0.5);
    panel(640, 380, 640, 300, 40, 0.85);
    outlined('Paused', 960, 480, 90, '#ffffff', '#2a0c30', 12);
    prompt(app.input, '{pause} RESUME', 960, 570, 32, '#ffffff', 'center');
    prompt(app.input, '{quit} QUIT TO TITLE', 960, 630, 28, 'rgba(255,255,255,0.65)', 'center');
  }
  function letterRect(i) { return { x: 960 - 230 + i * 160 - 60, y: 420, w: 120, h: 170 }; }
  const OK = { x: 1240, y: 450, w: 170, h: 110 };
  function drawInitials(app, t) {
    drawTitleBack(t);
    outlined('A new high score!', 960, 190, 90, '#ffd166', '#2a0c30', 14);
    outlined(pad6(app.sim.score), 960, 300, 70, '#ffffff', '#2a0c30', 10);
    label('ENTER YOUR INITIALS', 960, 380, 30, 'rgba(255,255,255,0.75)', 700, 'center', 6);
    const E = app.entry;
    for (let i = 0; i < 3; i++) {
      const R = letterRect(i), on = i === E.pos;
      panel(R.x, R.y, R.w, R.h, 26, on ? 0.9 : 0.6);
      if (on) { glow(g, '#ff7aa6', R.x + R.w / 2, R.y + R.h / 2, 120, 0.4); g.strokeStyle = '#ff9cc2'; g.lineWidth = 5; g.beginPath(); g.roundRect(R.x, R.y, R.w, R.h, 26); g.stroke(); }
      outlined(LETTERS[E.letters[i]], R.x + R.w / 2, R.y + 125, 110, on ? '#ffffff' : 'rgba(255,255,255,0.7)', '#2a0c30', 10);
      if (on) { label('▲', R.x + R.w / 2, R.y - 14, 34, '#ffd166', 700, 'center'); label('▼', R.x + R.w / 2, R.y + R.h + 44, 34, '#ffd166', 700, 'center'); }
    }
    panel(OK.x, OK.y, OK.w, OK.h, 26, 0.75);
    label('OK', OK.x + OK.w / 2, OK.y + 74, 50, '#ffd166', 800, 'center', 4);
    prompt(app.input, '{letters} PICK A LETTER · {start} NEXT · OR TYPE THEM', 960, 760, 30, '#ffffff', 'center');
  }
  function drawTouch(app) {
    const T = app.touch;
    if (!T?.active || (app.state !== 'play' && app.state !== 'bonus')) return;
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(PAUSE.x, PAUSE.y, PAUSE.r, 0, TAU); g.fill();
    g.fillStyle = '#ffffff'; g.fillRect(PAUSE.x - 12, PAUSE.y - 14, 8, 28); g.fillRect(PAUSE.x + 4, PAUSE.y - 14, 8, 28);
    if (app.state !== 'play') return;
    const on = T.pour, A = ART[app.sim.V.id];
    if (on) glow(g, A.accent, POUR.x, POUR.y, POUR.r * 1.8, 0.6);
    g.fillStyle = on ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(POUR.x, POUR.y, POUR.r, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 4; g.stroke();
    drawGlass(g, app.sim.V.id, A, POUR.x, POUR.y + 30, on ? Math.min(1, app.sim.server.fill + 0.01) : 0.3, { s: 0.9 });
    label('POUR', POUR.x, POUR.y + 70, 24, '#ffffff', 800, 'center', 3);
  }

  function drawGame(app, t) {
    const sim = app.sim;
    if (sim.mode === 'bonus') { drawBonus(app, t); return; }
    drawScene(app, t);
    hud(app, t);
    statusOverlay(app, t);
  }

  let lastT = 0;
  function draw(app) {
    lastApp = app;
    const t = app.t, dt = Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    stepParts(dt);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch);
    ref();
    switch (app.state) {
      case 'title': drawTitle(app, t); drawParts(); break;
      case 'scores': drawScores(app, t); break;
      case 'card': drawCard(app, t); break;
      case 'clear': drawClear(app, t); break;
      case 'pause': drawPause(app, t); break;
      case 'initials': drawInitials(app, t); break;
      default: drawGame(app, t); if (app.demo && app.sim.status === 'clear') drawClear(app, t);
    }
    ref();
    if (flash > 0) { g.globalAlpha = Math.min(0.35, flash); g.fillStyle = flashCol; g.fillRect(0, 0, REF_W, REF_H); g.globalAlpha = 1; }
    if (app.demo) label('DEMO', 1880, 1060, 26, `rgba(255,255,255,${0.35 + 0.25 * Math.sin(t * 3)})`, 800, 'right', 6);
    drawTouch(app);
    if (app.fade > 0) { g.globalAlpha = Math.min(1, app.fade); g.fillStyle = '#000'; g.fillRect(0, 0, REF_W, REF_H); g.globalAlpha = 1; }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  const unfit = fitWide(cv, { onFit: fit });

  // ---------- touch targets (canvas pixels in) ----------
  function hit(px, py, app) {
    const x = px / u, y = py / u;
    const inside = R => x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h;
    const near = (c, r) => Math.hypot(x - c.x, y - c.y) < r;
    switch (app.state) {
      case 'title': {
        const m = menuRects(app).findIndex(inside);
        return m >= 0 ? { act: 'menu', i: m } : null;
      }
      case 'play': {
        if (near(PAUSE, PAUSE.r * 1.5)) return { act: 'pause' };
        if (near(POUR, POUR.r * 1.25)) return { act: 'pour' };
        const r = Math.floor((y - TOP_Y) / BAND);
        if (r < 0 || r >= ROWS) return null;
        const len = app.sim.rows[r]?.len ?? 16;
        return { act: 'row', row: r, x: Math.max(0, Math.min(len - 1.2, (x - X0) / U)) };
      }
      case 'bonus': {
        if (near(PAUSE, PAUSE.r * 1.5)) return { act: 'pause' };
        for (let k = 0; k < 4; k++) { const R = padRect(k); if (inside({ x: R.x - 20, y: R.y - 20, w: R.w + 40, h: R.h + 40 })) return { act: 'pad', pad: k }; }
        return null;
      }
      case 'initials': {
        if (inside(OK)) return { act: 'ok' };
        for (let i = 0; i < 3; i++) {
          const R = letterRect(i);
          if (inside({ x: R.x - 20, y: R.y - 70, w: R.w + 40, h: R.h + 140 })) {
            if (i !== app.entry.pos) return { act: i < app.entry.pos ? 'left' : 'right' };
            return { act: y < R.y + R.h / 2 ? 'up' : 'down' };
          }
        }
        return null;
      }
    }
    return null;
  }

  return { draw, events, hit, destroy() { destroyed = true; unfit(); } };
}
const TOP_Y = rowY(0);
