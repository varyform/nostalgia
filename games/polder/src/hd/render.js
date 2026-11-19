// The HD renderer: the flats and the app's screens as lit vectors at the window's own
// resolution, 16:9 on a landscape window and 9:16 on a portrait one, where the field turns a
// quarter (layout.js). Still layers are painted once and again when they change: the backdrop
// per light, the water per light, the land whenever a dyke closes (old dykes, sandbanks, meadow,
// new dykes, a sandy shore and a shadow onto the water). Each frame adds the water's glints,
// the sweep of drained cells rippling in from the new dyke, the dyke being staked and the
// undertow running up it, the actors, particles, the HUD and the screens. It only reads state.
//
//   const view = createRenderer(canvas, app);
//   view.events(sim.events, sim);  view.draw(app);  view.hit(x, y, app) → target;  view.rotated
import { fitWide } from '@nostalgia/game/runtime';
import { drawPrompt } from '@nostalgia/input';
import { LETTERS } from '../app.js';
import { H, LAND, MADE, N, W } from '../sim.js';
import { CONCH, LIGHTS, NETTLE, PEARL, TAU, canvas, drawConch, drawCrab, drawJelly, drawLife, drawPearl, drawSkimmer, glow, hash, mix, rgba } from './art.js';
import { fieldMatrix, inside, layout, letterRect, menuRects, okRect, pauseRects, screenAngle, toScreen } from './layout.js';

const F = "'Outfit','Avenir Next','Segoe UI',system-ui,sans-serif", LOGO = "'DM Serif Display','Georgia',serif";
const TEXT = '#f6efe2', MUTED = 'rgba(246,239,226,0.62)', INK = '#06080c', DANGER = '#ff6a55';
const fmt = n => Math.max(0, n | 0).toLocaleString('en-US');
const easeOut = k => 1 - (1 - k) ** 3;
const clamp01 = k => (k < 0 ? 0 : k > 1 ? 1 : k);
const DEATH = { jelly: 'A jelly broke the dyke!', nettle: 'A sea nettle broke the dyke!', tangle: 'Tangled in your own dyke!', crab: 'Nipped by a shore crab!', undertow: 'The undertow caught you!' };
export const NOTES = [
  'Run out over the water and back to land: every stretch with no jelly in it drains.',
  'Pearls lie out on the flats. Drain the water round them to bring them in.',
  'A shore crab patrols the dykes. A conch drained in calms the jellies a while.',
  'Sandbanks: a dyke run out to one closes there.',
  'The undertow runs up a fresh dyke behind you. Keep the long cuts quick.',
  'Two crabs now, and a rock out in the bay.',
  'Red sea nettles drift faster than jellies.',
  'Groynes split the narrows in three.',
  'Breakwaters, and a quicker undertow.',
  'Night on Lantern Cove: the jellies glow.',
  'Skerries everywhere, little islands to run a dyke to.',
  'High water: everything at once.',
];

export function createRenderer(cv, app0) {
  const g = cv.getContext('2d');
  let cw = 1, ch = 1, u = 1, L = layout(false), portrait = null, unfit = null, destroyed = false, lastApp = app0;
  let vign = null, back = null, backKey = '', land = null, landTmp = null, landKey = '';
  const pending = new Uint8Array(N);
  let pendRev = 0, anims = [], parts = [], pops = [], rings = [], flash = 0, shake = 0, deathMsg = '', ang = 0, lastSerial = -1;
  const view = { draw, events, hit, destroy, rotated: false };

  function fit(w, h) {
    cw = w; ch = h; L = layout(portrait); u = cw / L.W;
    view.rotated = portrait;
    vign = canvas(cw / 2, ch / 2);
    const v = vign.getContext('2d'), gr = v.createRadialGradient(cw / 4, ch / 4, Math.min(cw, ch) * 0.25, cw / 4, ch / 4, Math.max(cw, ch) * 0.36);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.42)');
    v.fillStyle = gr; v.fillRect(0, 0, cw / 2, ch / 2);
    backKey = landKey = '';
    if (lastApp) draw(lastApp);
  }
  function refit() {
    const p = innerHeight > innerWidth * 1.05;
    if (p === portrait) return;
    portrait = p;
    unfit?.();
    unfit = fitWide(cv, { ratio: p ? [9, 16] : [16, 9], onFit: fit });
  }
  window.addEventListener('resize', refit);
  void document.fonts?.ready.then(() => { if (!destroyed && lastApp) draw(lastApp); });
  const ref = (ox = 0, oy = 0) => g.setTransform(u, 0, 0, u, ox * u, oy * u);
  const cpx = () => L.cell * u; // device pixels a cell

  // ---------- still layers ----------
  function backLayer(Lt) {
    const key = `${Lt.name}:${cw}x${ch}`;
    if (backKey === key) return back;
    backKey = key;
    back = canvas(cw, ch);
    const b = back.getContext('2d');
    b.setTransform(u, 0, 0, u, 0, 0);
    const bg = b.createLinearGradient(0, 0, 0, L.H);
    bg.addColorStop(0, Lt.bg0); bg.addColorStop(1, Lt.bg1);
    b.fillStyle = bg; b.fillRect(0, 0, L.W, L.H);
    const hz = b.createRadialGradient(L.W * 0.5, L.H * 0.1, 0, L.W * 0.5, L.H * 0.1, Math.max(L.W, L.H) * 0.8);
    hz.addColorStop(0, rgba(Lt.haze, 0.22)); hz.addColorStop(1, rgba(Lt.haze, 0));
    b.fillStyle = hz; b.fillRect(0, 0, L.W, L.H);
    // the field's frame: a shadow and a thin rim of light
    b.save(); b.shadowColor = 'rgba(0,0,0,0.7)'; b.shadowBlur = 50 * u; b.shadowOffsetY = 16 * u;
    b.fillStyle = '#000'; b.fillRect(L.fx, L.fy, L.fw, L.fh); b.restore();
    b.strokeStyle = rgba(Lt.glint, 0.25); b.lineWidth = 3; b.strokeRect(L.fx - 4, L.fy - 4, L.fw + 8, L.fh + 8);
    paintWater(b, Lt);
    return back;
  }
  // the water, painted into the backdrop under the field (one big layer fewer each frame)
  function paintWater(w, Lt) {
    w.setTransform(...fieldMatrix(L, u));
    const gr = w.createLinearGradient(0, 0, W * 0.3, H);
    gr.addColorStop(0, Lt.deep); gr.addColorStop(0.55, Lt.sea0); gr.addColorStop(1, Lt.sea1);
    w.fillStyle = gr; w.fillRect(0, 0, W, H);
    // the sun's (or the moon's) light on the water
    const sx = W * 0.68, sy = H * 0.3, sun = w.createRadialGradient(sx, sy, 0, sx, sy, W * 0.45);
    sun.addColorStop(0, rgba(Lt.glint, 0.2)); sun.addColorStop(1, rgba(Lt.glint, 0));
    w.fillStyle = sun; w.fillRect(0, 0, W, H);
    // faint ripples, still
    w.strokeStyle = rgba(Lt.glint, 0.06); w.lineWidth = 0.08; w.lineCap = 'round';
    for (let k = 0; k < 220; k++) {
      const x = hash(k) * sw(), y = hash(k + 500) * sh(), l = 0.6 + hash(k + 900) * 1.8;
      w.beginPath(); w.moveTo(...lvl(x, y)); w.quadraticCurveTo(...lvl(x + l / 2, y - 0.25), ...lvl(x + l, y)); w.stroke();
    }
  }
  function landLayer(sim, Lt) {
    const c = cpx(), key = `${sim.serial}:${sim.landRev}:${pendRev}:${Lt.name}:${cw}`;
    if (landKey === key && land) return land;
    landKey = key;
    if (!land || land.width !== Math.round(W * c) || land.height !== Math.round(H * c)) { land = canvas(W * c, H * c); landTmp = canvas(W * c, H * c); }
    const t = landTmp.getContext('2d');
    t.setTransform(1, 0, 0, 1, 0, 0); t.clearRect(0, 0, landTmp.width, landTmp.height);
    t.setTransform(c, 0, 0, c, 0, 0);
    paintLand(t, sim, Lt);
    const l = land.getContext('2d');
    l.setTransform(1, 0, 0, 1, 0, 0); l.clearRect(0, 0, land.width, land.height);
    l.save(); l.shadowColor = 'rgba(0,0,0,0.42)'; l.shadowBlur = c * 0.7; l.shadowOffsetX = c * 0.16; l.shadowOffsetY = c * 0.24;
    l.drawImage(landTmp, 0, 0); l.restore();
    return land;
  }
  const isLand = (sim, x, y) => x >= 0 && y >= 0 && x < W && y < H && sim.grid[y * W + x] === LAND && !pending[y * W + x];
  function cellCol(Lt, m, i) {
    if (m === MADE.dyke) return Lt.dyke[hash(i) < 0.5 ? 0 : 1];
    if (m === MADE.sand) return Lt.sand;
    if (m === MADE.built) return Lt.built;
    return Lt.grass[Math.floor(hash(i) * 3)];
  }
  function paintLand(t, sim, Lt) {
    const M = sim.made;
    for (let i = 0; i < N; i++) {
      const x = i % W, y = (i / W) | 0;
      if (!isLand(sim, x, y)) continue;
      t.fillStyle = cellCol(Lt, M[i], i);
      t.fillRect(x, y, 1.03, 1.03);
    }
    for (let i = 0; i < N; i++) {
      const x = i % W, y = (i / W) | 0;
      if (!isLand(sim, x, y)) continue;
      const m = M[i];
      if (m === MADE.meadow && hash(i + 77) < 0.12) {
        t.fillStyle = Lt.flower[hash(i + 3) < 0.5 ? 0 : 1];
        t.beginPath(); t.arc(x + 0.3 + hash(i + 5) * 0.4, y + 0.3 + hash(i + 6) * 0.4, 0.09, 0, TAU); t.fill();
      } else if (m === MADE.meadow && hash(i + 91) < 0.3) {
        t.strokeStyle = 'rgba(20,50,20,0.25)'; t.lineWidth = 0.07;
        const ax = x + 0.2 + hash(i + 8) * 0.6, ay = y + 0.75;
        t.beginPath(); t.moveTo(ax - 0.12, ay); t.lineTo(ax, ay - 0.35); t.lineTo(ax + 0.12, ay); t.stroke();
      } else if (m === MADE.dyke) {
        t.fillStyle = 'rgba(0,0,0,0.12)'; t.fillRect(x, y + 0.92, 1, 0.08);
        if ((x + y) % 2) t.fillRect(x + 0.92, y, 0.08, 1);
      } else if (m === MADE.built) {
        // a raised path along the new dyke
        t.fillStyle = mix(Lt.built, '#fff4dc', 0.22);
        t.fillRect(x + 0.27, y + 0.27, 0.46, 0.46);
        if (x < W - 1 && M[i + 1] === MADE.built && !pending[i + 1]) t.fillRect(x + 0.5, y + 0.27, 1, 0.46);
        if (y < H - 1 && M[i + W] === MADE.built && !pending[i + W]) t.fillRect(x + 0.27, y + 0.5, 0.46, 1);
      }
    }
    // the shore: a strip of wet sand and a lit rim wherever land meets water
    t.fillStyle = rgba(Lt.sand, 0.8);
    const rim = new Path2D();
    for (let i = 0; i < N; i++) {
      const x = i % W, y = (i / W) | 0;
      if (!isLand(sim, x, y)) continue;
      const s = 0.16;
      if (y > 0 && !isLand(sim, x, y - 1)) { t.fillRect(x, y, 1.02, s); rim.moveTo(x, y + 0.02); rim.lineTo(x + 1, y + 0.02); }
      if (y < H - 1 && !isLand(sim, x, y + 1)) { t.fillRect(x, y + 1 - s, 1.02, s); rim.moveTo(x, y + 0.98); rim.lineTo(x + 1, y + 0.98); }
      if (x > 0 && !isLand(sim, x - 1, y)) { t.fillRect(x, y, s, 1.02); rim.moveTo(x + 0.02, y); rim.lineTo(x + 0.02, y + 1); }
      if (x < W - 1 && !isLand(sim, x + 1, y)) { t.fillRect(x + 1 - s, y, s, 1.02); rim.moveTo(x + 0.98, y); rim.lineTo(x + 0.98, y + 1); }
    }
    t.strokeStyle = rgba(Lt.foam, 0.55); t.lineWidth = 0.07; t.stroke(rim);
  }

  // ---------- text and panels ----------
  const font = (size, wgt = 500, fam = F, ital = false) => { g.font = `${ital ? 'italic ' : ''}${wgt} ${size}px ${fam}`; };
  const spacing = s => { if ('letterSpacing' in g) g.letterSpacing = s + 'px'; };
  function label(s, x, y, size, col, wgt = 500, align = 'left', sp = 0) {
    font(size, wgt); g.fillStyle = col; g.textAlign = align; g.textBaseline = 'alphabetic'; spacing(sp);
    g.fillText(s, x, y); spacing(0); g.textAlign = 'left';
  }
  function logo(s, x, y, size, Lt) {
    font(size, 400, LOGO, true); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const lg = g.createLinearGradient(0, y - size * 0.8, 0, y + size * 0.1);
    lg.addColorStop(0, '#fffaf0'); lg.addColorStop(0.55, mix(Lt.accent, '#ffffff', 0.35)); lg.addColorStop(1, Lt.accent);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillText(s, x + size * 0.03, y + size * 0.05);
    g.fillStyle = lg; g.fillText(s, x, y);
    g.textAlign = 'left';
  }
  function outlined(s, x, y, size, col, wgt = 700) {
    font(size, wgt); g.textAlign = 'center'; g.lineJoin = 'round'; spacing(2);
    g.strokeStyle = 'rgba(4,8,14,0.85)'; g.lineWidth = size * 0.16; g.strokeText(s, x, y);
    g.fillStyle = col; g.fillText(s, x, y); spacing(0); g.textAlign = 'left';
  }
  const prompt = (input, s, x, y, size, col, align = 'left', wgt = 500) =>
    drawPrompt(g, input, s, x, y, { font: `${wgt} ${size}px ${F}`, size: size * 1.3, color: col, align, letterSpacing: 1, style: { font: F } });
  function panel(x, y, w, h, r = 28, a = 0.8, Lt = null) {
    g.fillStyle = `rgba(8,14,22,${a})`; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
    g.strokeStyle = rgba(Lt?.accent ?? '#ffd6a0', 0.35); g.lineWidth = 2.5; g.stroke();
  }
  const shadeAll = a => { g.fillStyle = `rgba(3,6,10,${a})`; g.fillRect(0, 0, L.W, L.H); };
  const pulse = t => 0.55 + 0.45 * Math.sin(t * 4);
  function wrap(s, maxW, size, wgt = 500) {
    font(size, wgt);
    const out = [];
    let line = '';
    for (const w of s.split(' ')) {
      const tryLine = line ? line + ' ' + w : w;
      if (g.measureText(tryLine).width > maxW && line) { out.push(line); line = w; } else line = tryLine;
    }
    if (line) out.push(line);
    return out;
  }
  const touchy = app => app.touch?.active || app.input.device.kind === 'touch';

  // ---------- particles, pop-ups, rings (reference units) ----------
  const rand = Math.random;
  const cellPt = (x, y) => toScreen(L, x + 0.5, y + 0.5);
  function burst(x, y, col, n, speed = 300, life = 0.8, size = 6, grav = 300) {
    if (parts.length > 900) return;
    for (let k = 0; k < n; k++) {
      const a = rand() * TAU, s = speed * (0.3 + rand() * 0.7);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.5 + rand() * 0.5), max: life, col, size: size * (0.5 + rand()), grav });
    }
  }
  const pop = (x, y, text, col, size, life = 1.4) => pops.push({ x, y, text, col, size, life, max: life });
  const ring = (x, y, col, r0, r1, life = 0.6, w = 4) => { if (rings.length < 60) rings.push({ x, y, col, r0, r1, t: 0, life, w }); };

  function events(list, sim) {
    const Lt = LIGHTS[sim.sc.light];
    for (const e of list) {
      switch (e.type) {
        case 'stage': case 'newgame': case 'resume':
          anims = []; pending.fill(0); pendRev++; parts = []; pops = []; rings = []; shake = 0; deathMsg = '';
          break;
        case 'claim': {
          let maxD = 1;
          for (let k = 0; k < e.dist.length; k++) if (e.dist[k] > maxD) maxD = e.dist[k];
          const spd = Math.min(0.03, 1.1 / (maxD + 1));
          for (const i of e.cells) pending[i] = 1;
          pendRev++;
          anims.push({ cells: e.cells, dist: e.dist, t0: lastT, spd, maxD, made: e.cells.map(i => sim.made[i]) });
          const P = cellPt(e.x, e.y);
          pop(P.x, P.y - 30, '+' + fmt(e.pts), TEXT, e.n > 300 ? 64 : e.n > 80 ? 52 : 42);
          if (e.mult > 1) pop(P.x, P.y + 20, `BIG CUT ×${e.mult}`, Lt.accent, 30, 1.6);
          flash = Math.min(0.35, 0.06 + e.n / 3000);
          break;
        }
        case 'pearl': { const P = cellPt(e.x, e.y); burst(P.x, P.y, PEARL, 22, 260, 0.9, 6, 0); ring(P.x, P.y, PEARL, 10, 90, 0.7); pop(P.x, P.y - 40, `PEARL +${fmt(e.pts)}`, PEARL, 32, 1.6); break; }
        case 'slack': { const P = cellPt(e.x, e.y); burst(P.x, P.y, CONCH, 24, 240, 1, 6, 0); ring(P.x, P.y, CONCH, 10, 260, 1.2, 6); pop(P.x, P.y - 40, 'SLACK WATER', CONCH, 34, 1.8); break; }
        case 'death': {
          const P = toScreen(L, e.px + 0.5, e.py + 0.5);
          shake = 1; flash = 0.3;
          burst(P.x, P.y, '#d9a66a', 18, 520, 1.1, 9, 900);
          burst(P.x, P.y, Lt.foam, 26, 420, 0.8, 5, 600);
          ring(P.x, P.y, Lt.foam, 10, 120, 0.7, 6); ring(P.x, P.y, '#ffffff', 10, 70, 0.4, 3);
          const H2 = cellPt(e.x, e.y);
          if (e.cause === 'jelly' || e.cause === 'undertow') { ring(H2.x, H2.y, e.who === 'nettle' ? NETTLE : Lt.jelly, 8, 90, 0.6, 5); burst(H2.x, H2.y, Lt.foam, 12, 300, 0.6, 5, 500); }
          // the broken dyke's stakes float off
          for (let k = 0; k < Math.min(30, e.trail.length); k++) {
            const i = e.trail[Math.floor(rand() * e.trail.length)], Q = cellPt(i % W, (i / W) | 0);
            parts.push({ x: Q.x, y: Q.y, vx: (rand() - 0.5) * 80, vy: (rand() - 0.5) * 80, life: 0.8 + rand() * 0.6, max: 1.4, col: Lt.built, size: 5, grav: 0 });
          }
          deathMsg = DEATH[e.cause === 'jelly' && e.who === 'nettle' ? 'nettle' : e.cause] ?? '';
          break;
        }
        case 'bounce': {
          if (e.who === 'crab' || rand() < 0.5) break;
          const P = cellPt(e.x, e.y);
          ring(P.x, P.y, e.who === 'nettle' ? NETTLE : Lt.jelly, 6, 34, 0.5, 2.5);
          break;
        }
        case 'launch': { const P = cellPt(e.x, e.y); ring(P.x, P.y, Lt.foam, 6, 50, 0.5, 3); burst(P.x, P.y, Lt.foam, 8, 160, 0.5, 4, 200); break; }
        case 'tide': {
          if (e.x < 0) break;
          const P = cellPt(e.x, e.y);
          ring(P.x, P.y, Lt.jelly, 10, 140, 1, 5);
          pop(P.x, P.y - 50, 'THE TIDE BRINGS A JELLY', Lt.jelly, 28, 2);
          break;
        }
        case 'life': { const P = toScreen(L, sim.p.x + 0.5, sim.p.y + 0.5); pop(P.x, P.y - 70, 'EXTRA SKIMMER', Lt.accent, 34, 2); break; }
        case 'go': { const P = toScreen(L, sim.p.x + 0.5, sim.p.y + 0.5); ring(P.x, P.y, Lt.accent, 10, 80, 0.6, 4); break; }
        case 'clear': {
          flash = 0.4;
          for (let k = 0; k < 60; k++) {
            const x = L.fx + rand() * L.fw, y = L.fy + rand() * L.fh;
            parts.push({ x, y, vx: (rand() - 0.5) * 60, vy: -40 - rand() * 80, life: 1.5 + rand() * 1.5, max: 3, col: Lt.flower[k % 2], size: 6, grav: -10 });
          }
          break;
        }
      }
    }
  }
  function stepFx(dt) {
    for (const p of parts) { p.life -= dt; p.vy += p.grav * dt; p.vx *= 0.985; p.x += p.vx * dt; p.y += p.vy * dt; }
    parts = parts.filter(p => p.life > 0);
    for (const p of pops) { p.life -= dt; p.y -= 36 * dt; }
    pops = pops.filter(p => p.life > 0);
    for (const r of rings) r.t += dt;
    rings = rings.filter(r => r.t < r.life);
    flash = Math.max(0, flash - dt);
    shake = Math.max(0, shake - dt * 1.7);
  }
  function drawFx() {
    for (const r of rings) {
      const k = r.t / r.life;
      g.strokeStyle = rgba(r.col, 0.7 * (1 - k)); g.lineWidth = r.w * (1 - k) + 1;
      g.beginPath(); g.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * easeOut(k), 0, TAU); g.stroke();
    }
    for (const p of parts) {
      const a = Math.min(1, p.life / (p.max * 0.4));
      g.fillStyle = rgba(p.col, a);
      g.beginPath(); g.arc(p.x, p.y, p.size * (0.4 + 0.6 * a), 0, TAU); g.fill();
    }
    for (const p of pops) {
      const k = 1 - p.life / p.max, a = Math.min(1, p.life * 2.5), s = k < 0.12 ? 0.6 + (k / 0.12) * 0.4 : 1;
      g.globalAlpha = a;
      outlined(p.text, p.x, p.y, p.size * s, p.col);
      g.globalAlpha = 1;
    }
  }

  // ---------- the field ----------
  // water decorations lie level on the screen: (a, b) across and down the field as shown, in cells
  const sw = () => (L.portrait ? H : W), sh = () => (L.portrait ? W : H);
  const lvl = (a, b) => (L.portrait ? [b, H - a] : [a, b]);
  function waterFx(t, Lt) {
    g.lineCap = 'round';
    const SW = sw(), SH = sh();
    for (let k = 0; k < 46; k++) {
      const sp = 0.25 + hash(k + 1) * 0.5, x = (((hash(k) * SW + t * sp) % SW) + SW) % SW, y = hash(k + 2) * SH + Math.sin(t * 0.3 + k) * 0.6;
      const a = 0.08 + 0.16 * (0.5 + 0.5 * Math.sin(t * 1.4 + k * 2.1)), l = 0.5 + hash(k + 3) * 1.4;
      g.strokeStyle = rgba(Lt.glint, a); g.lineWidth = 0.09;
      g.beginPath(); g.moveTo(...lvl(x, y)); g.lineTo(...lvl(Math.min(SW, x + l), y)); g.stroke();
    }
    g.lineWidth = 1.1;
    for (let b = 0; b < 3; b++) {
      g.strokeStyle = rgba(Lt.glint, 0.035);
      g.beginPath();
      const y0 = SH * (0.2 + b * 0.3);
      for (let x = 0; x <= SW; x += 2) g.lineTo(...lvl(x, y0 + Math.sin(x * 0.18 + t * 0.5 + b * 2) * 1.2 + Math.sin(x * 0.05 - t * 0.2) * 2));
      g.stroke();
    }
  }
  // the drained cells rippling in from the new dyke, ring by ring
  function sweeps(t, Lt) {
    const done = [];
    for (const a of anims) {
      const el = t - a.t0, front = el / a.spd;
      let any = false;
      for (let k = 0; k < a.cells.length; k++) {
        const local = (el - a.dist[k] * a.spd) / 0.32;
        if (local <= 0) { any = true; continue; }
        const i = a.cells[k], x = i % W, y = (i / W) | 0, m = a.made[k];
        if (local < 1) {
          any = true;
          const s = 0.35 + 0.65 * easeOut(local);
          g.fillStyle = '#5e4a32'; g.fillRect(x + (1 - s) / 2, y + (1 - s) / 2, s, s);
          g.globalAlpha = local; g.fillStyle = cellCol(Lt, m, i); g.fillRect(x + (1 - s) / 2, y + (1 - s) / 2, s, s);
          g.globalAlpha = (1 - local) * 0.6; g.fillStyle = Lt.glint; g.fillRect(x, y, 1, 1);
          g.globalAlpha = 1;
        } else {
          g.fillStyle = cellCol(Lt, m, i); g.fillRect(x, y, 1.03, 1.03);
        }
      }
      // sparkles at the front
      for (let n = 0; n < 5; n++) {
        const k = Math.floor(rand() * a.cells.length);
        if (Math.abs(a.dist[k] - front) > 1.2) continue;
        const i = a.cells[k], P = cellPt(i % W, (i / W) | 0);
        if (parts.length < 900) parts.push({ x: P.x, y: P.y, vx: (rand() - 0.5) * 60, vy: -30 - rand() * 60, life: 0.5 + rand() * 0.4, max: 0.9, col: rand() < 0.5 ? Lt.glint : Lt.flower[0], size: 3.5, grav: 40 });
      }
      if (!any) done.push(a);
    }
    if (done.length) {
      anims = anims.filter(a => !done.includes(a));
      for (const a of done) for (const i of a.cells) pending[i] = 0;
      // cells still in another sweep stay pending
      for (const a of anims) for (const i of a.cells) pending[i] = 1;
      pendRev++;
    }
  }
  // the dyke being staked, the undertow running up it
  function trailPts(sim) {
    const pts = [];
    if (sim.from >= 0) pts.push([(sim.from % W) + 0.5, ((sim.from / W) | 0) + 0.5]);
    for (const i of sim.trail) pts.push([(i % W) + 0.5, ((i / W) | 0) + 0.5]);
    return pts;
  }
  function drawTrail(sim, t, Lt) {
    if (!sim.trail.length) return;
    const pts = trailPts(sim), q = sim.posOf(sim.p);
    pts.push([q.x + 0.5, q.y + 0.5]);
    const path = new Path2D();
    pts.forEach(([x, y], k) => (k ? path.lineTo(x, y) : path.moveTo(x, y)));
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.translate(0.08, 0.12); g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.78; g.stroke(path); g.translate(-0.08, -0.12);
    g.strokeStyle = Lt.built; g.lineWidth = 0.6; g.stroke(path);
    g.strokeStyle = rgba(Lt.accent, 0.35 + 0.25 * Math.sin(t * 8)); g.lineWidth = 0.2; g.stroke(path);
    g.fillStyle = '#4a2f18';
    const first = sim.from >= 0 ? 1 : 0;
    for (let k = first; k < pts.length - 1; k++) {
      const [x, y] = pts[k], side = k % 2 ? 0.24 : -0.24, [nx, ny] = pts[Math.min(pts.length - 1, k + 1)], dx = nx - x, dy = ny - y;
      g.beginPath(); g.arc(x - dy * side, y + dx * side, 0.1, 0, TAU); g.fill();
    }
    const w = sim.tow;
    if (!w) return;
    if (w.pos < 0) {
      // the undertow gathering at the dyke's root
      const k = clamp01(1 + w.pos / (w.speed * 1.2)), [x, y] = pts[0];
      g.strokeStyle = rgba(Lt.deep, 0.5 * k); g.lineWidth = 0.12;
      for (let r = 0; r < 3; r++) { g.beginPath(); g.arc(x, y, 0.4 + r * 0.35 + ((t * 1.5) % 0.35), t * 3 + r, t * 3 + r + 4); g.stroke(); }
      return;
    }
    const pos = w.pos + (sim.from >= 0 ? 1 : 0), i0 = Math.min(pts.length - 2, Math.floor(pos)), f = Math.min(1, pos - i0);
    const hx = pts[i0][0] + (pts[i0 + 1][0] - pts[i0][0]) * f, hy = pts[i0][1] + (pts[i0 + 1][1] - pts[i0][1]) * f;
    const sub = new Path2D();
    sub.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k <= i0; k++) sub.lineTo(pts[k][0], pts[k][1]);
    sub.lineTo(hx, hy);
    g.strokeStyle = rgba(Lt.deep, 0.85); g.lineWidth = 0.82; g.stroke(sub);
    g.strokeStyle = rgba(Lt.glint, 0.25); g.lineWidth = 0.1; g.setLineDash([0.3, 0.4]); g.lineDashOffset = -t * 3; g.stroke(sub); g.setLineDash([]);
    glow(g, Lt.deep, hx, hy, 1.8, 0.9);
    g.strokeStyle = rgba(Lt.glint, 0.5); g.lineWidth = 0.1;
    for (let r = 0; r < 3; r++) { g.beginPath(); g.arc(hx, hy, 0.3 + r * 0.3, t * 6 + r * 2, t * 6 + r * 2 + 3.6); g.stroke(); }
  }

  function drawScene(sim, t, Lt, live = true) {
    // a shake moves the whole picture, backdrop and all
    const sx = shake > 0 ? (rand() - 0.5) * shake * 26 : 0, sy = shake > 0 ? (rand() - 0.5) * shake * 26 : 0;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = INK; g.fillRect(0, 0, cw, ch);
    g.drawImage(backLayer(Lt), sx * u, sy * u);
    g.setTransform(...fieldMatrix(L, u, sx, sy));
    waterFx(t, Lt);
    g.drawImage(landLayer(sim, Lt), 0, 0, W, H);
    sweeps(t, Lt);
    drawTrail(sim, t, Lt);
    ref(sx, sy);
    const c = L.cell;
    for (const o of sim.items) { const P = cellPt(o.i % W, (o.i / W) | 0); (o.kind === 'pearl' ? drawPearl : drawConch)(g, P.x, P.y, c * 0.62, t); }
    const slack = sim.slack > 0;
    if (slack) g.globalAlpha = 0.75;
    sim.jellies.forEach((j, k) => {
      const q = sim.posOf(j), P = toScreen(L, q.x + 0.5, q.y + 0.5), nettle = j.kind === 'nettle';
      drawJelly(g, P.x, P.y, c * (nettle ? 0.74 : 0.86), slack ? t * 0.4 : t, nettle ? NETTLE : Lt.jelly, k * 1.7, nettle);
    });
    g.globalAlpha = 1;
    for (const cr of sim.crabs) { const q = sim.posOf(cr), P = toScreen(L, q.x + 0.5, q.y + 0.5); drawCrab(g, P.x, P.y, c * 0.85, t, live); }
    const p = sim.p;
    if (sim.status !== 'dead' && sim.status !== 'over' && !(p.safe > 0 && Math.sin(t * 30) < -0.2)) {
      const q = sim.posOf(p), P = toScreen(L, q.x + 0.5, q.y + 0.5), [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[p.dir];
      const want = screenAngle(L, dx, dy);
      let d = want - ang;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      ang += d * 0.35;
      const onSea = sim.grid[p.y * W + p.x] !== LAND || sim.trail.length > 0;
      if (onSea && p.moving && live && rand() < 0.5 && parts.length < 900)
        parts.push({ x: P.x - Math.cos(ang) * c * 0.9 + (rand() - 0.5) * 8, y: P.y - Math.sin(ang) * c * 0.9 + (rand() - 0.5) * 8, vx: (rand() - 0.5) * 30, vy: (rand() - 0.5) * 30, life: 0.6, max: 0.6, col: Lt.foam, size: 3.5, grav: 0 });
      drawSkimmer(g, P.x, P.y, c * 0.95, ang, t, Lt);
    }
    drawFx();
  }

  // ---------- HUD ----------
  function hud(app, t, Lt) {
    const sim = app.sim, P = L.portrait, sc = sim.sc, pct = sim.pct, target = sc.target;
    const tide = Math.max(0, Math.ceil(sim.tide)), low = tide <= 10 && sim.status === 'play';
    const stageText = `STAGE ${sim.stage + 1}` + (sim.loop ? ` · TIDE ${sim.loop + 1}` : '');
    let bx, by, bw;
    if (!P) {
      label(stageText, L.fx, 38, 20, MUTED, 600, 'left', 5);
      font(34, 400, LOGO, true); g.fillStyle = TEXT; g.fillText(sc.name, L.fx, 80);
      bx = 760; by = 58; bw = 400;
      label(fmt(sim.score), L.fx + L.fw, 62, 46, TEXT, 600, 'right', 1);
      for (let k = 0; k < Math.min(8, sim.lives); k++) drawLife(g, L.fx + L.fw - 18 - k * 38, 84, 14);
      clock(1238, 56, 24, sim, tide, low, Lt, t);
      label(`${Math.floor(tide / 60)}:${String(tide % 60).padStart(2, '0')}`, 1272, 66, 28, low ? DANGER : TEXT, 600, 'left', 1);
    } else {
      font(40, 400, LOGO, true); g.fillStyle = TEXT; g.fillText(sc.name, L.fx, 82);
      label(stageText, L.fx, 124, 22, MUTED, 600, 'left', 5);
      label(fmt(sim.score), L.fx + L.fw, 84, 54, TEXT, 600, 'right', 1);
      for (let k = 0; k < Math.min(8, sim.lives); k++) drawLife(g, L.fx + L.fw - 18 - k * 40, 116, 15);
      bx = L.fx; by = 170; bw = 700;
      clock(870, 166, 24, sim, tide, low, Lt, t);
      label(`${Math.floor(tide / 60)}:${String(tide % 60).padStart(2, '0')}`, 904, 176, 28, low ? DANGER : TEXT, 600, 'left', 1);
    }
    // drained so far, and the mark to reach
    label(`DRAINED ${Math.floor(pct * 100)}%`, bx, by - 14, 20, TEXT, 600, 'left', 3);
    label(`GOAL ${Math.round(target * 100)}%`, bx + bw, by - 14, 20, MUTED, 600, 'right', 3);
    g.fillStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.roundRect(bx, by, bw, 16, 8); g.fill();
    const fill = g.createLinearGradient(bx, 0, bx + bw, 0);
    fill.addColorStop(0, Lt.grass[0]); fill.addColorStop(1, Lt.grass[1]);
    g.fillStyle = fill; g.beginPath(); g.roundRect(bx, by, Math.max(16, bw * Math.min(1, pct)), 16, 8); g.fill();
    const tx = bx + bw * target;
    g.fillStyle = Lt.accent; g.fillRect(tx - 2, by - 5, 4, 26);
    if (pct >= target) glow(g, Lt.accent, tx, by + 8, 30, 0.6);
    if (sim.slack > 0) label(`SLACK ${Math.ceil(sim.slack)}`, bx + bw / 2, by - 14, 20, CONCH, 700, 'center', 3);
    if (!app.demo && touchy(app)) {
      const R = L.pause;
      g.fillStyle = 'rgba(8,14,22,0.55)'; g.beginPath(); g.roundRect(R.x, R.y, R.w, R.h, 22); g.fill();
      g.strokeStyle = rgba(Lt.accent, 0.4); g.lineWidth = 2.5; g.stroke();
      g.fillStyle = TEXT; const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
      g.fillRect(cx - 14, cy - 18, 9, 36); g.fillRect(cx + 5, cy - 18, 9, 36);
    }
  }
  function clock(x, y, r, sim, tide, low, Lt, t) {
    const k = Math.min(1, sim.tide / sim.sc.tide);
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 6; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
    g.strokeStyle = low ? `rgba(255,106,85,${0.6 + 0.4 * Math.sin(t * 8)})` : Lt.jelly; g.lineCap = 'round';
    g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * k); g.stroke(); g.lineCap = 'butt';
    // a little wave in the middle: the tide
    g.strokeStyle = TEXT; g.lineWidth = 3; g.beginPath();
    for (let a = -10; a <= 10; a += 2) g.lineTo(x + a, y + Math.sin(a * 0.5 + t * 3) * 3);
    g.stroke();
  }
  function stick(app) {
    const S = app.touch?.stick;
    if (!S || app.state !== 'play') return;
    const x0 = S.x0 / u, y0 = S.y0 / u, x = S.x / u, y = S.y / u, R = app.touch.radius / u;
    g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 4; g.beginPath(); g.arc(x0, y0, R, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.arc(x, y, R * 0.42, 0, TAU); g.fill();
    if (app.touch.dir) {
      const a = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[app.touch.dir];
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath();
      g.moveTo(x0 + Math.cos(a) * R * 1.25, y0 + Math.sin(a) * R * 1.25);
      g.lineTo(x0 + Math.cos(a + 0.35) * R * 0.95, y0 + Math.sin(a + 0.35) * R * 0.95);
      g.lineTo(x0 + Math.cos(a - 0.35) * R * 0.95, y0 + Math.sin(a - 0.35) * R * 0.95);
      g.fill();
    }
  }

  // ---------- the play overlays: ready, a death, a stage drained ----------
  const midX = () => L.fx + L.fw / 2, midY = () => L.fy + L.fh / 2;
  function overlays(app, t, Lt) {
    const sim = app.sim, s = sim.status, P = L.portrait;
    if (s === 'ready' && app.state === 'play') {
      const a = Math.min(1, sim.statusT * 4);
      g.globalAlpha = a;
      outlined(sim.lives && sim.statusT < 2 && sim.p.safe > 0 ? 'STEADY…' : 'GET READY', midX(), midY(), P ? 72 : 64, TEXT);
      g.globalAlpha = 1;
    }
    if (s === 'dead' && sim.statusT > 0.25) {
      const a = Math.min(1, (sim.statusT - 0.25) * 4);
      g.globalAlpha = a;
      outlined(deathMsg, midX(), midY() - 10, P ? 56 : 52, '#ffe2d6');
      label(sim.lives > 0 ? `${sim.lives} ${sim.lives === 1 ? 'SKIMMER' : 'SKIMMERS'} LEFT` : 'NO SKIMMERS LEFT', midX(), midY() + 50, P ? 28 : 24, MUTED, 600, 'center', 4);
      g.globalAlpha = 1;
    }
    if (s === 'clear') {
      const I = sim.clearInfo, k = Math.min(1, sim.statusT * 3), w = P ? 860 : 720, h = P ? 560 : 440, x = midX() - w / 2, y = midY() - h / 2;
      g.globalAlpha = k;
      panel(x, y, w, h, 36, 0.86, Lt);
      logo('Flats drained', midX(), y + (P ? 120 : 100), P ? 84 : 70, Lt);
      const rows = [['DRAINED', `${Math.floor(I.pct * 100)}%`], ['TIDE LEFT', '+' + fmt(I.tide)], ['OVER THE GOAL', '+' + fmt(I.over)], ['STAGE BONUS', '+' + fmt(I.stage)]];
      rows.forEach(([a, b], i) => {
        if (sim.statusT < 0.45 + i * 0.35) return;
        const yy = y + (P ? 220 : 180) + i * (P ? 70 : 52);
        label(a, x + 70, yy, P ? 30 : 24, MUTED, 600, 'left', 4);
        label(b, x + w - 70, yy, P ? 36 : 30, i ? TEXT : Lt.accent, 600, 'right', 1);
      });
      if (sim.statusT > 1.9) label(`TOTAL  +${fmt(I.total)}`, midX(), y + h - (P ? 50 : 40), P ? 40 : 34, Lt.accent, 700, 'center', 3);
      g.globalAlpha = 1;
    }
  }

  // ---------- screens ----------
  function drawCard(app, t, Lt) {
    const sim = app.sim, P = L.portrait, k = Math.min(1, app.stT * 3);
    shadeAll(0.45 * k);
    g.globalAlpha = k;
    const w = P ? 940 : 980, h = P ? 640 : 460, x = L.W / 2 - w / 2, y = midY() - h / 2;
    panel(x, y, w, h, 40, 0.88, Lt);
    label(`STAGE ${sim.stage + 1} OF 12` + (sim.loop ? ` · TIDE ${sim.loop + 1}` : ''), L.W / 2, y + (P ? 90 : 76), P ? 28 : 24, MUTED, 600, 'center', 6);
    logo(sim.sc.name, L.W / 2, y + (P ? 220 : 180), P ? 120 : 104, Lt);
    label(`Drain ${Math.round(sim.sc.target * 100)}% of the flats`, L.W / 2, y + (P ? 310 : 250), P ? 38 : 32, TEXT, 500, 'center', 1);
    const note = sim.loop && sim.stage === 0 ? 'The tide comes round again: everything is quicker.' : NOTES[sim.stage];
    wrap(note, w - 140, P ? 32 : 26).slice(0, 3).forEach((s, i) => label(s, L.W / 2, y + (P ? 390 : 314) + i * (P ? 44 : 36), P ? 32 : 26, MUTED, 500, 'center'));
    if (app.stT > 0.5 && !touchy(app)) prompt(app.input, 'PRESS {start}', L.W / 2, y + h - (P ? 60 : 40), P ? 30 : 26, rgba(Lt.accent, pulse(t)), 'center', 600);
    g.globalAlpha = 1;
  }
  const menuNames = { continue: 'CONTINUE', play: 'NEW GAME', scores: 'HIGH SCORES', exit: 'EXIT' };
  function drawTitle(app, t, Lt) {
    shadeAll(0.5);
    const P = L.portrait, cx = L.W / 2, ly = P ? 640 : 330;
    logo('Polder', cx, ly, P ? 260 : 220, Lt);
    label('DRAIN THE TIDAL FLATS', cx, ly + (P ? 90 : 74), P ? 32 : 26, mix(Lt.accent, '#ffffff', 0.4), 500, 'center', 9);
    const items = app.titleItems(), R = menuRects(L, items.length);
    R.forEach((m, i) => {
      const on = i === app.menu, it = items[i], big = P ? 50 : 34;
      if (on) { panel(m.x, m.y, m.w, m.h, 26, 0.72, Lt); glow(g, Lt.accent, m.x + 38, m.y + m.h / 2, 26, 0.9); }
      const sub = it === 'continue' && app.resume;
      label(menuNames[it], cx, m.y + m.h / 2 + (sub ? -2 : big * 0.36), on ? big : big * 0.86, on ? TEXT : MUTED, 600, 'center', 5);
      if (sub) label(`${app.resume.label} · ${app.resumeAgo()}`, cx, m.y + m.h / 2 + (P ? 38 : 25), P ? 26 : 18, on ? Lt.accent : rgba(Lt.accent, 0.6), 500, 'center', 2);
    });
    const last = R.at(-1), input = app.input, by = last.y + last.h + (P ? 90 : 62);
    if (touchy(app)) label('DRAG ANYWHERE TO STEER', cx, by, P ? 30 : 24, TEXT, 500, 'center', 3);
    else {
      prompt(input, '{steer} STEER   {pause} PAUSE', cx, by, P ? 26 : 22, MUTED, 'center');
      const extra = [...(input.device.kind === 'keyboard' ? [`{sound} ${app.soundOn ? 'SOUND ON' : 'SOUND OFF'}`, '{fullscreen} FULL SCREEN'] : []), ...(app.onExit ? ['{quit} EXIT'] : [])];
      if (extra.length) prompt(input, extra.join('   '), cx, by + 44, P ? 24 : 20, MUTED, 'center');
      prompt(input, 'PRESS {start}', cx, L.H - (P ? 120 : 46), P ? 40 : 30, rgba(Lt.accent, pulse(t)), 'center', 600);
    }
  }
  function drawScores(app, t, Lt) {
    shadeAll(0.62);
    const P = L.portrait, cx = L.W / 2, w = P ? 960 : 1000, x = cx - w / 2, y = P ? 240 : 80, h = P ? 1380 : 920;
    panel(x, y, w, h, 40, 0.86, Lt);
    logo('Best Wardens', cx, y + (P ? 150 : 120), P ? 96 : 80, Lt);
    const rowH = P ? 120 : 78, y0 = y + (P ? 300 : 226);
    app.scores.forEach((s, i) => {
      const yy = y0 + i * rowH, on = i === app.newRank, col = on ? rgba(Lt.accent, pulse(t)) : TEXT;
      if (on) { g.fillStyle = rgba(Lt.accent, 0.12); g.beginPath(); g.roundRect(x + 30, yy - rowH * 0.62, w - 60, rowH * 0.86, 18); g.fill(); }
      label(String(i + 1), x + 80, yy, P ? 40 : 32, MUTED, 600, 'center');
      label(s.name, x + 150, yy, P ? 50 : 40, col, 600, 'left', 6);
      label(fmt(s.score), x + w - (P ? 320 : 340), yy, P ? 50 : 40, col, 600, 'right', 1);
      label(`stage ${s.stage + 1}${s.loop ? ` · tide ${s.loop + 1}` : ''}`, x + w - 60, yy, P ? 28 : 24, MUTED, 500, 'right');
    });
    if (!touchy(app)) prompt(app.input, 'PRESS {start}', cx, L.H - (P ? 120 : 28), 30, rgba(Lt.accent, pulse(t)), 'center');
  }
  function drawPause(app, t, Lt) {
    shadeAll(0.6);
    const P = L.portrait, cx = L.W / 2, R = pauseRects(L);
    logo('Paused', cx, R[0].y - (P ? 110 : 70), P ? 130 : 100, Lt);
    ['RESUME', 'QUIT TO TITLE'].forEach((s, i) => {
      const on = i === app.pmenu, m = R[i];
      if (on) { panel(m.x, m.y, m.w, m.h, 26, 0.75, Lt); glow(g, Lt.accent, m.x + 38, m.y + m.h / 2, 26, 0.9); }
      label(s, cx, m.y + m.h / 2 + (P ? 16 : 12), P ? 46 : 34, on ? TEXT : MUTED, 600, 'center', 5);
    });
    label('QUITTING KEEPS THIS STAGE: CONTINUE STARTS IT AGAIN', cx, R[1].y + R[1].h + (P ? 90 : 60), P ? 24 : 20, MUTED, 500, 'center', 3);
  }
  function drawOver(app, t, Lt) {
    const k = Math.min(1, app.stT * 1.5), sim = app.sim, st = sim.stats;
    shadeAll(0.55 * k);
    const P = L.portrait, cx = L.W / 2, w = P ? 920 : 880, h = P ? 760 : 560, x = cx - w / 2, y = L.H / 2 - h / 2;
    g.globalAlpha = k;
    panel(x, y, w, h, 40, 0.88, Lt);
    logo('The tide has won', cx, y + (P ? 150 : 120), P ? 84 : 72, Lt);
    label(fmt(sim.score), cx, y + (P ? 290 : 232), P ? 110 : 92, TEXT, 600, 'center', 2);
    const rows = [['REACHED', `${sim.sc.name}`], ['DYKES', st.cuts], ['BIGGEST CUT', st.biggest || '—'], ['PEARLS', st.pearls]];
    rows.forEach(([a, b], i) => {
      const xx = cx + (i - 1.5) * (w / 4.2), yy = y + (P ? 420 : 340);
      label(a, xx, yy, P ? 22 : 18, MUTED, 600, 'center', 3);
      label(String(b), xx, yy + (P ? 52 : 42), P ? (i ? 44 : 32) : i ? 34 : 26, Lt.accent, 600, 'center', 1);
    });
    if (app.stT > 1.4) {
      if (touchy(app)) label('TAP TO GO ON', cx, y + h - 46, 26, rgba(Lt.accent, pulse(t)), 600, 'center', 4);
      else prompt(app.input, 'PRESS {start}', cx, y + h - 46, 28, rgba(Lt.accent, pulse(t)), 'center', 600);
    }
    g.globalAlpha = 1;
  }
  function drawInitials(app, t, Lt) {
    shadeAll(0.66);
    const P = L.portrait, cx = L.W / 2, E = app.entry;
    logo('A new best!', cx, P ? 420 : 190, P ? 120 : 96, Lt);
    label(fmt(app.sim.score), cx, P ? 560 : 300, P ? 90 : 70, TEXT, 600, 'center', 2);
    label('YOUR INITIALS', cx, P ? 680 : 384, P ? 32 : 26, MUTED, 600, 'center', 6);
    for (let i = 0; i < 3; i++) {
      const R = letterRect(L, i), on = i === E.pos;
      panel(R.x, R.y, R.w, R.h, 26, on ? 0.9 : 0.6, Lt);
      if (on) { glow(g, Lt.accent, R.x + R.w / 2, R.y + R.h / 2, R.w, 0.25); g.strokeStyle = Lt.accent; g.lineWidth = 4; g.beginPath(); g.roundRect(R.x, R.y, R.w, R.h, 26); g.stroke(); }
      label(LETTERS[E.letters[i]], R.x + R.w / 2, R.y + R.h * 0.72, R.h * 0.62, on ? TEXT : MUTED, 600, 'center');
      if (on) { label('▲', R.x + R.w / 2, R.y - 14, 32, Lt.accent, 600, 'center'); label('▼', R.x + R.w / 2, R.y + R.h + 42, 32, Lt.accent, 600, 'center'); }
    }
    const O = okRect(L);
    panel(O.x, O.y, O.w, O.h, 26, 0.8, Lt);
    label('OK', O.x + O.w / 2, O.y + O.h / 2 + 18, 50, Lt.accent, 600, 'center', 4);
    if (!touchy(app)) prompt(app.input, '{letters} PICK A LETTER · {start} NEXT · OR TYPE THEM', cx, P ? 1480 : 770, P ? 26 : 28, TEXT, 'center');
  }

  let lastT = 0;
  function draw(app) {
    lastApp = app;
    if (!vign) return;
    const t = app.t, dt = Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    const backdrop = (app.state === 'title' || app.state === 'scores' || app.state === 'initials') && app.back ? app.back : app.sim;
    if (backdrop.serial !== lastSerial) { lastSerial = backdrop.serial; anims = []; pending.fill(0); pendRev++; }
    const Lt = LIGHTS[backdrop.sc.light];
    stepFx(dt);
    drawScene(backdrop, t, Lt, app.state !== 'pause');
    ref();
    switch (app.state) {
      case 'title': drawTitle(app, t, Lt); break;
      case 'scores': drawScores(app, t, Lt); break;
      case 'initials': drawInitials(app, t, Lt); break;
      case 'card': hud(app, t, Lt); drawCard(app, t, Lt); break;
      case 'pause': hud(app, t, Lt); drawPause(app, t, Lt); break;
      case 'over': hud(app, t, Lt); drawOver(app, t, Lt); break;
      default: hud(app, t, Lt); overlays(app, t, Lt); stick(app);
    }
    if (flash > 0) { g.globalAlpha = Math.min(0.12, flash * 0.4); g.fillStyle = '#fff6e8'; g.fillRect(0, 0, L.W, L.H); g.globalAlpha = 1; }
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
      const R = L.pause;
      return inside({ x: R.x - 30, y: R.y - 30, w: R.w + 60, h: R.h + 60 }, x, y) ? { act: 'pause' } : { act: 'field' };
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
  function destroy() { destroyed = true; window.removeEventListener('resize', refit); unfit?.(); }
  return view;
}
